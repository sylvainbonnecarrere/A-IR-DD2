/**
 * 🎯 ROUTES: Local LLM Detection
 * 
 * Route Unique: GET /api/local-llm/detect-capabilities
 * Responsabilité: Orchestre la détection intelligente des capacités
 * Architecture: Une seule route proxy (SRP)
 */

import { Router, Request, Response } from 'express';
import { detectLocalLLMCapabilities } from '../services/localLLMService';
import { lmstudioRateLimiter } from '../middleware/rateLimiter';
import { logLMStudioRequest } from '../middleware/logger';
import { LOCAL_ENDPOINT_POLICY_ERROR } from '../utils/localEndpointPolicy';
import { optionalAuth } from '../middleware/auth.middleware';
import { isEndpointAccessibleForUser } from '../services/localEndpointAccess.service';

const router = Router();

// Appliquer middlewares
router.use(lmstudioRateLimiter);
router.use(logLMStudioRequest);
router.use(optionalAuth);

/**
 * GET /api/local-llm/detect-capabilities
 * 
 * Détecte les capacités d'un LLM local via endpoint
 * 
 * Query Parameters:
 *   - endpoint (required): URL du LLM local (ex: http://localhost:11434)
 * 
 * Response:
 * {
 *   healthy: boolean,
 *   endpoint: string,
 *   modelId?: string,
 *   modelName?: string,
 *   capabilities: LLMCapability[],
 *   detectedAt: ISO8601 string,
 *   error?: string
 * }
 */
router.get('/detect-capabilities', async (req: Request, res: Response) => {
    try {
        const endpoint = req.query.endpoint as string;

        if (!endpoint) {
            return res.status(400).json({
                error: 'Missing required parameter: endpoint',
                example: '/api/local-llm/detect-capabilities?endpoint=http://localhost:11434'
            });
        }

        // Validation basique de l'endpoint
        try {
            new URL(endpoint);
        } catch {
            return res.status(400).json({
                error: 'Invalid endpoint URL format',
                received: endpoint
            });
        }

        const userId = (req.user as { id?: string } | undefined)?.id;
        if (!(await isEndpointAccessibleForUser(endpoint, userId))) {
            return res.status(403).json({
                healthy: false,
                capabilities: [],
                detectedAt: new Date().toISOString(),
                error: LOCAL_ENDPOINT_POLICY_ERROR
            });
        }

        console.log(`[Local-LLM-Routes] Detecting capabilities for endpoint: ${endpoint}`);

        // Appeler le service de détection
        const result = await detectLocalLLMCapabilities(endpoint);

        // Status 200 même si unhealthy (utile pour afficher erreur au frontend)
        res.json(result);

    } catch (error) {
        console.error('[Local-LLM-Routes] Unexpected error:', error);
        res.status(500).json({
            healthy: false,
            capabilities: [],
            detectedAt: new Date().toISOString(),
            error: 'Internal server error during capability detection'
        });
    }
});

export default router;
