// Routes proxy sécurisé pour LMStudio
import { Router, Request, Response } from 'express';
import {
    checkLMStudioHealth,
    fetchLMStudioModels,
    detectAvailableEndpoint,
    streamChatCompletion,
    fetchChatCompletion
} from '../services/lmstudioProxy.service';
import type { ChatCompletionRequest } from '../types/lmstudio.types';
import { lmstudioRateLimiter, strictRateLimiter } from '../middleware/rateLimiter';
import {
    validateChatRequest,
    validateEndpoint,
    validateChatOptions
} from '../middleware/validateLMStudioRequest';
import { logLMStudioRequest, errorHandler } from '../middleware/logger';
import { optionalAuth } from '../middleware/auth.middleware';

const router = Router();

// Appliquer les middlewares globaux à toutes les routes LMStudio
router.use(lmstudioRateLimiter); // Rate limiting global
router.use(logLMStudioRequest);   // Logging des requêtes
router.use(optionalAuth);         // Optional auth for profile-based endpoint authorization
router.use(validateEndpoint);     // Validation endpoint localhost

/**
 * GET /api/lmstudio/health
 * Health check du serveur LMStudio
 * Query param: endpoint (optionnel, default: http://localhost:1234)
 */
router.get('/health', async (req: Request, res: Response) => {
    try {
        const endpoint = (req.query.endpoint as string) || 'http://localhost:1234';

        console.log(`[LMStudio Proxy] Health check for endpoint: ${endpoint}`);
        const health = await checkLMStudioHealth(endpoint);

        res.json(health);
    } catch (error) {
        console.error('[LMStudio Proxy] Health check error:', error);
        res.status(500).json({
            healthy: false,
            error: error instanceof Error ? error.message : 'Health check failed'
        });
    }
});

/**
 * GET /api/lmstudio/models
 * Récupérer la liste des modèles disponibles
 * Query param: endpoint (optionnel, default: http://localhost:1234)
 */
router.get('/models', async (req: Request, res: Response) => {
    try {
        const endpoint = (req.query.endpoint as string) || 'http://localhost:1234';

        console.log(`[LMStudio Proxy] Fetching models from: ${endpoint}`);
        const models = await fetchLMStudioModels(endpoint);

        console.log(`[LMStudio Proxy] Found ${models.data?.length || 0} models`);
        res.json(models);
    } catch (error) {
        console.error('[LMStudio Proxy] Fetch models error:', error);
        res.status(500).json({
            error: error instanceof Error ? error.message : 'Failed to fetch models'
        });
    }
});

/**
 * GET /api/lmstudio/detect-endpoint
 * Auto-détecter l'endpoint LMStudio disponible
 * Response: { healthy, endpoint, models, detected }
 */
router.get('/detect-endpoint', async (req: Request, res: Response) => {
    try {
        console.log('[LMStudio Proxy] Auto-detecting endpoint...');
        const endpoint = await detectAvailableEndpoint();

        // Récupérer la liste des modèles pour enrichir la réponse
        const modelsData = await fetchLMStudioModels(endpoint);
        const modelsList = modelsData.data?.map(m => m.id) || [];

        console.log(`[LMStudio Proxy] Detected endpoint: ${endpoint} with ${modelsList.length} models`);

        res.json({
            healthy: true,
            endpoint,
            models: modelsList,
            detected: true
        });
    } catch (error) {
        console.error('[LMStudio Proxy] Endpoint detection failed:', error);
        res.status(404).json({
            healthy: false,
            detected: false,
            error: error instanceof Error ? error.message : 'No server detected'
        });
    }
});

/**
 * POST /api/lmstudio/embeddings
 * Generate embeddings for text
 * Body: { endpoint, model, input }
 */
router.post('/embeddings', async (req: Request, res: Response) => {
    try {
        const { endpoint = 'http://localhost:1234', model, input } = req.body;

        if (!model || !input) {
            return res.status(400).json({
                error: 'Missing required parameters: model and input'
            });
        }

        console.log(`[LMStudio Proxy] Embeddings request - Model: ${model}`);

        const response = await fetch(`${endpoint}/v1/embeddings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, input })
        });

        if (!response.ok) {
            const errorText = await response.text().catch(() => response.statusText);
            throw new Error(`LMStudio embeddings error: ${response.status} - ${errorText}`);
        }

        const result = await response.json();
        res.json(result);
    } catch (error) {
        console.error('[LMStudio Proxy] Embeddings error:', error);
        res.status(500).json({
            error: error instanceof Error ? error.message : 'Embeddings failed'
        });
    }
});

/**
 * POST /api/lmstudio/completions
 * Text completion (non-chat)
 * Body: { endpoint, model, prompt, max_tokens, temperature }
 */
router.post('/completions', async (req: Request, res: Response) => {
    try {
        const { endpoint = 'http://localhost:1234', model, prompt, max_tokens = 100, temperature = 0.7 } = req.body;

        if (!model || !prompt) {
            return res.status(400).json({
                error: 'Missing required parameters: model and prompt'
            });
        }

        console.log(`[LMStudio Proxy] Completion request - Model: ${model}`);

        const response = await fetch(`${endpoint}/v1/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, prompt, max_tokens, temperature })
        });

        if (!response.ok) {
            const errorText = await response.text().catch(() => response.statusText);
            throw new Error(`LMStudio completion error: ${response.status} - ${errorText}`);
        }

        const result = await response.json();
        res.json(result);
    } catch (error) {
        console.error('[LMStudio Proxy] Completion error:', error);
        res.status(500).json({
            error: error instanceof Error ? error.message : 'Completion failed'
        });
    }
});

/**
 * POST /api/lmstudio/chat/completions
 * Chat completion avec streaming ou synchrone
 * Body: { endpoint, model, messages, stream, temperature, max_tokens, tools }
 * Middlewares : strictRateLimiter, validateChatRequest, validateChatOptions
 */
router.post(
    '/chat/completions',
    strictRateLimiter,      // Rate limiting strict (30 req/min)
    validateChatRequest,    // Validation model + messages
    validateChatOptions,    // Validation temperature, max_tokens, stream
    async (req: Request, res: Response) => {
        try {
            const { endpoint = 'http://localhost:1234', ...requestBody } = req.body as ChatCompletionRequest & { endpoint?: string };

            console.log(`[LMStudio Proxy] Chat completion request - Model: ${requestBody.model}, Stream: ${requestBody.stream}`);

            // Mode streaming (SSE)
            if (requestBody.stream) {
                // Configuration SSE headers
                res.setHeader('Content-Type', 'text/event-stream');
                res.setHeader('Cache-Control', 'no-cache');
                res.setHeader('Connection', 'keep-alive');
                res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
                res.flushHeaders?.();
                res.write(': connected\n\n');

                try {
                    // Stream depuis LMStudio vers frontend
                    for await (const chunk of streamChatCompletion(endpoint, requestBody)) {
                        res.write(chunk);
                    }

                    res.end();
                } catch (streamError) {
                    console.error('[LMStudio Proxy] Streaming error:', streamError);
                    res.write(`data: {"error": "${streamError instanceof Error ? streamError.message : 'Streaming failed'}"}\n\n`);
                    res.end();
                }
            }
            // Mode synchrone (non-streaming)
            else {
                const result = await fetchChatCompletion(endpoint, requestBody);
                res.json(result);
            }
        } catch (error) {
            console.error('[LMStudio Proxy] Chat completion error:', error);
            // Log full error details for debugging
            if (error instanceof Error) {
                console.error('[LMStudio Proxy] Error stack:', error.stack);
            }
            res.status(500).json({
                error: error instanceof Error ? error.message : 'Chat completion failed',
                details: error instanceof Error ? error.stack : String(error)
            });
        }
    }
);

// Error handler global pour toutes les routes
router.use(errorHandler);

export default router;
