import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { LLMConfig } from '../models/LLMConfig.model';
import { requireAuth } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validation.middleware';

const router = Router();

/**
 * ⚠️ NOTE PHASE 2 : Routes proxy LLM simplifiées
 * 
 * Cette implémentation initiale fournit une API sécurisée pour:
 * 1. Récupérer API keys déchiffrées (sans localStorage)
 * 2. Valider provider configs utilisateur
 * 3. Centraliser l'authentification LLM
 * 
 * Architecture actuelle (Phase 2):
 * - Frontend récupère API key via POST /api/llm/get-api-key
 * - Frontend appelle LLM services directement (comme actuellement)
 * - API key stockée en mémoire (React state) au lieu de localStorage
 * 
 * TODO Phase 3 (optionnel - sécurité maximale):
 * - Implémenter streaming SSE côté backend
 * - API keys JAMAIS exposées au frontend
 * - Backend devient proxy complet entre frontend ↔ LLM providers
 */

/**
 * Schema validation pour requête API key
 */
const getApiKeySchema = z.object({
    provider: z.string()
});

/**
 * POST /api/llm/get-api-key
 * Récupère API key déchiffrée pour un provider spécifique
 * 
 * SÉCURITÉ:
 * - Requiert authentification JWT
 * - API key déchiffrée server-side
 * - Alternative sécurisée au localStorage
 * 
 * Body:
 * {
 *   provider: string
 * }
 * 
 * Response:
 * {
 *   provider: string,
 *   apiKey: string (déchiffrée),
 *   capabilities: object
 * }
 * 
 * ⚠️ USAGE FRONTEND:
 * 1. Appeler cette route au login
 * 2. Stocker API key en mémoire (React state, Zustand)
 * 3. Passer API key aux LLM services
 * 4. Effacer de la mémoire au logout
 */
router.post('/get-api-key', requireAuth, validateRequest(getApiKeySchema), async (req: Request, res: Response) => {
    try {
        const user = req.user as any;
        const { provider } = req.body;

        // Récupérer config LLM utilisateur
        const config = await LLMConfig.findOne({ userId: user.id, provider });

        if (!config) {
            return res.status(404).json({
                error: 'Provider non configuré',
                provider,
                suggestion: 'Configurez ce provider via POST /api/llm-configs'
            });
        }

        if (!config.enabled) {
            return res.status(403).json({
                error: 'Provider désactivé',
                provider
            });
        }

        // Déchiffrer API key côté serveur (SÉCURITÉ)
        const apiKey = config.getDecryptedApiKey();

        console.log(`[LLMProxy] API key retrieved for user ${user.id}, provider ${provider}`);

        res.json({
            provider: config.provider,
            apiKey, // ⚠️ Transmise une seule fois, stockée en mémoire frontend
            capabilities: config.capabilities,
            enabled: config.enabled
        });

    } catch (error) {
        console.error('[LLMProxy] POST /get-api-key error:', error);
        res.status(500).json({
            error: 'Erreur récupération API key',
            details: error instanceof Error ? error.message : 'Erreur inconnue'
        });
    }
});

/**
 * POST /api/llm/get-all-api-keys
 * Récupère TOUTES les API keys déchiffrées de TOUS les providers (activés ou non)
 * 
 * USAGE: Appelé une fois au login pour récupérer toutes les configs
 * 
 * Response:
 * [
 *   {
 *     provider: string,
 *     apiKey: string,
 *     capabilities: object,
 *     enabled: boolean
 *   }
 * ]
 * 
 * ⭐ J4.6 FIX: Récupère TOUS les configs (enabled + disabled)
 * Raison: Quand l'utilisateur configure un nouveau provider, on doit retourner
 * TOUS les providers de l'utilisateur, pas seulement les activés
 * Sinon le formulaire perd les configs des providers désactivés
 */
router.post('/get-all-api-keys', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = req.user as any;

        // ⭐ J4.6: Récupérer TOUS les configs (enabled=true ET enabled=false)
        const configs = await LLMConfig.find({ userId: user.id });

        if (configs.length === 0) {
            return res.json([]); // Aucune config, retourner tableau vide
        }

        // Déchiffrer toutes les API keys - AVEC gestion d'erreur gracieuse
        // ⭐ FIX: Si une clé ne peut pas être déchiffrée (données corrompues, encryption clé changée),
        // on retourne la config SANS la clé (apiKey vide) ET disabled rather than crashing avec 500
        const decryptedConfigs = configs
          .map(config => {
            try {
              const decryptedKey = config.getDecryptedApiKey();
              return {
                provider: config.provider,
                apiKey: decryptedKey,
                capabilities: config.capabilities,
                enabled: config.enabled
              };
            } catch (decryptError: any) {
              console.warn(`[LLMProxy] ⚠️ Could not decrypt API key for provider ${config.provider} (user ${user.id}):`, decryptError.message);
              // ⭐ FIX: Preserve REAL enabled status from DB + signal reconfiguration needed
              // Previous bug: forcing enabled=false hid the provider from frontend entirely
              return {
                provider: config.provider,
                apiKey: '',
                capabilities: config.capabilities,
                enabled: config.enabled, // ← PRESERVE real DB status
                needsReconfig: true      // ← Signal to frontend: key must be re-entered
              };
            }
          });

        const failedCount = decryptedConfigs.filter((c: any) => c.needsReconfig).length;
        if (failedCount > 0) {
          console.warn(`[LLMProxy] ⚠️ ${failedCount}/${configs.length} API keys need reconfiguration (encryption key mismatch) for user ${user.id}`);
        }

        res.json(decryptedConfigs);

    } catch (error) {
        console.error('[LLMProxy] POST /get-all-api-keys error:', error);
        res.status(500).json({
            error: 'Erreur récupération API keys',
            details: error instanceof Error ? error.message : 'Erreur inconnue'
        });
    }
});

/**
 * POST /api/llm/validate-provider
 * Valide qu'un provider est configuré et actif (sans retourner l'API key)
 * 
 * USAGE: Vérification avant génération LLM
 * 
 * Body:
 * {
 *   provider: string
 * }
 * 
 * Response:
 * {
 *   valid: boolean,
 *   provider: string,
 *   enabled: boolean,
 *   hasApiKey: boolean,
 *   capabilities: object
 * }
 */
router.post('/validate-provider', requireAuth, validateRequest(getApiKeySchema), async (req: Request, res: Response) => {
    try {
        const user = req.user as any;
        const { provider } = req.body;

        const config = await LLMConfig.findOne({ userId: user.id, provider });

        if (!config) {
            return res.json({
                valid: false,
                provider,
                enabled: false,
                hasApiKey: false,
                capabilities: {},
                error: 'Provider non configuré'
            });
        }

        res.json({
            valid: config.enabled && !!config.apiKeyEncrypted,
            provider: config.provider,
            enabled: config.enabled,
            hasApiKey: !!config.apiKeyEncrypted,
            capabilities: config.capabilities
        });

    } catch (error) {
        console.error('[LLMProxy] POST /validate-provider error:', error);
        res.status(500).json({
            error: 'Erreur validation provider'
        });
    }
});

export default router;
