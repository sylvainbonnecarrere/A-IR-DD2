import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { LLMConfig } from '../models/LLMConfig.model';
// NOTE J4.4: UserSettings import REMOVED - llmConfigs field no longer exists
import { requireAuth, requireOwnershipAsync } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validation.middleware';
import { isLocalProvider } from '../utils/providerUtils';

const router = Router();

/**
 * Schema validation pour upsert config LLM
 * Supports both cloud providers (apiKey) and local providers (localEndpoint)
 */
const upsertConfigSchema = z.object({
    provider: z.enum([
        'Gemini',
        'OpenAI',
        'Mistral',
        'Anthropic',
        'Grok',
        'Perplexity',
        'Qwen',
        'Kimi K2',
        'DeepSeek',
        'LLM local (on premise)',
        'Arc-LLM'
    ]),
    enabled: z.boolean(),
    apiKey: z.string().optional(), // For cloud providers
    localEndpoint: z.string().optional(), // For local providers (e.g., http://localhost:3928)
    capabilities: z.record(z.string(),z.boolean()).optional().default({})
});

/**
 * GET /api/llm-configs
 * Liste configs LLM utilisateur (API keys JAMAIS retournées)
 * 
 * Query params:
 * - enabled: true/false (optionnel) - filtrer par statut
 * 
 * Response:
 * [
 *   {
 *     id: string,
 *     provider: string,
 *     enabled: boolean,
 *     capabilities: object,
 *     hasApiKey: boolean,
 *     updatedAt: Date
 *   }
 * ]
 */
router.get('/', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = req.user as any;
        const { enabled } = req.query;

        // Build query
        const query: any = { userId: user.id };
        if (enabled !== undefined) {
            query.enabled = enabled === 'true';
        }

        const configs = await LLMConfig.find(query).sort({ provider: 1 });

        // SÉCURITÉ CRITIQUE: Ne JAMAIS retourner les API keys
        // ⭐ Return actual localEndpoint (it's a public URL, not sensitive)
        const safeConfigs = configs.map(c => {
            // Helper: Mask apiKey only
            let maskedApiKey = '';
            
            if (c.apiKeyEncrypted) {
                try {
                    const decrypted = c.getDecryptedApiKey();
                    maskedApiKey = '•'.repeat(decrypted.length);
                } catch (err) {
                    maskedApiKey = '••••••••••••••••••••'; // 20 points default
                }
            }

            return {
                id: c._id.toString(),
                provider: c.provider,
                enabled: c.enabled,
                apiKey: maskedApiKey,
                localEndpoint: c.localEndpoint || '', // ⭐ Return actual endpoint (NOT masked)
                capabilities: c.capabilities,
                hasApiKey: !!c.apiKeyEncrypted,
                hasLocalEndpoint: !!c.localEndpoint,
                createdAt: c.createdAt,
                updatedAt: c.updatedAt
            };
        });

        res.json(safeConfigs);
    } catch (error) {
        console.error('[LLMConfig] GET error:', error);
        res.status(500).json({ error: 'Erreur récupération configs LLM' });
    }
});

/**
 * GET /api/llm-configs/:provider
 * Config LLM spécifique par provider (API key JAMAIS retournée)
 * 
 * Response:
 * {
 *   id: string,
 *   provider: string,
 *   enabled: boolean,
 *   capabilities: object,
 *   hasApiKey: boolean,
 *   updatedAt: Date
 * }
 */
router.get('/:provider', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = req.user as any;
        const { provider } = req.params;

        const config = await LLMConfig.findOne({ userId: user.id, provider });

        if (!config) {
            return res.status(404).json({ error: 'Config LLM introuvable' });
        }

        // SÉCURITÉ: Ne JAMAIS retourner l'API key
        // ⭐ Mask apiKey but return actual localEndpoint (it's a public URL, not sensitive)
        let maskedApiKey = '';
        
        if (config.apiKeyEncrypted) {
            try {
                const decrypted = config.getDecryptedApiKey();
                maskedApiKey = '•'.repeat(decrypted.length);
            } catch (err) {
                maskedApiKey = '••••••••••••••••••••';
            }
        }
        
        res.json({
            id: config._id.toString(),
            provider: config.provider,
            enabled: config.enabled,
            apiKey: maskedApiKey,
            localEndpoint: config.localEndpoint || '', // ⭐ Return actual endpoint (NOT masked)
            capabilities: config.capabilities,
            hasApiKey: !!config.apiKeyEncrypted,
            hasLocalEndpoint: !!config.localEndpoint,
            createdAt: config.createdAt,
            updatedAt: config.updatedAt
        });
    } catch (error) {
        console.error('[LLMConfig] GET :provider error:', error);
        res.status(500).json({ error: 'Erreur récupération config LLM' });
    }
});

/**
 * POST /api/llm-configs
 * Créer ou mettre à jour config LLM (upsert)
 * 
 * Body:
 * {
 *   provider: string,
 *   enabled: boolean,
 *   apiKey: string (en clair, sera chiffrée),
 *   capabilities: object
 * }
 * 
 * Response:
 * {
 *   id: string,
 *   provider: string,
 *   enabled: boolean,
 *   capabilities: object,
 *   hasApiKey: true,
 *   updatedAt: Date
 * }
 */
router.post('/', requireAuth, validateRequest(upsertConfigSchema), async (req: Request, res: Response) => {
    try {
        const user = req.user as any;
        const userId = user.id || user._id;
        const { provider, apiKey, localEndpoint, enabled, capabilities } = req.body;

        // Check for masked values (user didn't change the field)
        const isMaskedKey = apiKey && apiKey.includes('•');
        const isMaskedEndpoint = localEndpoint && localEndpoint.includes('•');
        const isLocal = isLocalProvider(provider);

        // Upsert: find existing config
        let config = await LLMConfig.findOne({ userId, provider });

        if (config) {
            // CASE: Update existing config
            config.enabled = enabled;
            config.capabilities = capabilities;
            
            if (isLocal) {
                if (!isMaskedEndpoint) {
                    config.setLocalEndpoint(localEndpoint || '');
                    console.log(`[LLMConfig] Updated local endpoint for user ${userId}, provider ${provider}`);
                }
            } else {
                if (!isMaskedKey) {
                    config.setApiKey(apiKey || '');
                    console.log(`[LLMConfig] Updated API key for user ${userId}, provider ${provider}`);
                }
            }
            
            await config.save();
        } else {
            // Create new config - masked values not allowed
            if ((isLocal && isMaskedEndpoint) || (!isLocal && isMaskedKey)) {
                return res.status(400).json({ error: 'Cannot create config with masked/empty value' });
            }
            
            config = new LLMConfig({
                userId,
                provider,
                enabled,
                capabilities
            });

            if (isLocal) {
                config.setLocalEndpoint(localEndpoint || '');
            } else {
                config.setApiKey(apiKey || '');
            }
            await config.save();
            console.log(`[LLMConfig] Created ${isLocal ? 'local' : 'cloud'} config for user ${userId}, provider ${provider}`);
        }

        // Build response (mask API key but NOT endpoint - it's public)
        let maskedApiKey = '';
        if (config.apiKeyEncrypted) {
            try {
                const decrypted = config.getDecryptedApiKey();
                maskedApiKey = '•'.repeat(decrypted.length);
            } catch (err) {
                maskedApiKey = '••••••••••••••••••••';
            }
        }
        
        res.json({
            id: config._id.toString(),
            provider: config.provider,
            enabled: config.enabled,
            apiKey: maskedApiKey,
            localEndpoint: config.localEndpoint || '',
            capabilities: config.capabilities,
            hasApiKey: config.hasApiKey(),
            hasLocalEndpoint: config.hasLocalEndpoint(),
            isLocalProvider: isLocal,
            createdAt: config.createdAt,
            updatedAt: config.updatedAt
        });
    } catch (error) {
        console.error('[LLMConfig] POST error:', error);

        // Unique constraint error
        if ((error as any).code === 11000) {
            return res.status(409).json({ error: 'Config already exists for this provider' });
        }

        res.status(500).json({ error: 'Error saving LLM config' });
    }
});

/**
 * DELETE /api/llm-configs/:provider
 * Supprimer config LLM par provider
 * 
 * Response:
 * {
 *   message: string
 * }
 */
router.delete('/:provider', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = req.user as any;
        const userId = user.id || user._id;
        const { provider } = req.params;

        const result = await LLMConfig.deleteOne({ userId, provider });

        if (result.deletedCount === 0) {
            return res.status(404).json({ error: 'Config LLM introuvable' });
        }

        // NOTE J4.4: UserSettings.llmConfigs sync REMOVED
        // llm_configs collection is now the SINGLE source of truth

        console.log(`[LLMConfig] Deleted config for user ${userId}, provider ${provider}`);
        res.json({ message: 'Config LLM supprimée' });
    } catch (error) {
        console.error('[LLMConfig] DELETE error:', error);
        res.status(500).json({ error: 'Erreur suppression config LLM' });
    }
});

export default router;
