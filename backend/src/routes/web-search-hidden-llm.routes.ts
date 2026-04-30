import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validation.middleware';
import { completeWebSearchHiddenLlm } from '../services/webSearchHiddenLlm.service';

const router = Router();

const runtimeSchema = z.object({
    provider: z.string().min(1),
    model: z.string().min(1),
    endpoint: z.string().optional(),
    api_key: z.string().optional(),
    transport: z.string().optional(),
});

const completeSchema = z.object({
    runtime: runtimeSchema,
    systemPrompt: z.string(),
    userPrompt: z.string(),
    timeoutSeconds: z.number().int().min(0).optional(),
    maxTokens: z.number().int().positive().max(1000).optional(),
});

router.post('/complete', requireAuth, validateRequest(completeSchema), async (req: Request, res: Response) => {
    const startedAt = Date.now();
    try {
        console.info('[WebSearchHiddenLLM] POST /complete start', {
            provider: req.body?.runtime?.provider,
            model: req.body?.runtime?.model,
            timeoutSeconds: req.body?.timeoutSeconds,
            maxTokens: req.body?.maxTokens,
            systemPromptLength: typeof req.body?.systemPrompt === 'string' ? req.body.systemPrompt.length : 0,
            userPromptLength: typeof req.body?.userPrompt === 'string' ? req.body.userPrompt.length : 0,
        });
        const text = await completeWebSearchHiddenLlm(req.body);
        console.info('[WebSearchHiddenLLM] POST /complete success', {
            provider: req.body?.runtime?.provider,
            model: req.body?.runtime?.model,
            durationMs: Date.now() - startedAt,
            textLength: typeof text === 'string' ? text.length : 0,
        });
        res.json({ text });
    } catch (error) {
        console.error('[WebSearchHiddenLLM] POST /complete error:', error);
        res.status(500).json({
            error: error instanceof Error ? error.message : 'Erreur hidden LLM web_search_py',
        });
    }
});

export default router;