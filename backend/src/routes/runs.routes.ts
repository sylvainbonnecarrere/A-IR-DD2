import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.middleware';
import { IUser } from '../models/User.model';
import { RuntimeCompatibilityService } from '../services/runtimeCompatibility.service';
import { UserToolRunQueryService } from '../services/userToolRunQuery.service';
import { UserToolRunRetentionService } from '../services/userToolRunRetention.service';

const router = Router();
const runtimeCompatibilityService = new RuntimeCompatibilityService();
const userToolRunQueryService = new UserToolRunQueryService();
const userToolRunRetentionService = new UserToolRunRetentionService();

const idParamSchema = z.string().regex(/^[a-f\d]{24}$/i, 'ID doit être un ObjectId MongoDB valide');
const artifactQuerySchema = z.object({
    path: z.string().min(1, 'Le chemin d\'artefact est requis')
});
const cleanupRunsSchema = z.object({
    retentionDays: z.number().int().min(1).max(365).optional(),
    retainLatest: z.number().int().min(0).max(200).optional(),
    dryRun: z.boolean().optional().default(false)
}).refine((value) => value.retentionDays !== undefined || value.retainLatest !== undefined, {
    message: 'retentionDays ou retainLatest est requis'
});

const listRunsQuerySchema = z.object({
    workflowId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
    toolId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
    agentInstanceId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional().default(20),
    page: z.coerce.number().int().min(1).optional().default(1),
    status: z.enum(['queued', 'running', 'completed', 'failed', 'stopped', 'timed_out']).optional(),
    sortBy: z.enum(['createdAt', 'durationMs', 'status']).optional().default('createdAt'),
    sortOrder: z.enum(['asc', 'desc']).optional().default('desc')
});

router.get('/', requireAuth, async (req, res) => {
    try {
        const queryResult = listRunsQuerySchema.safeParse(req.query);
        if (!queryResult.success) {
            return res.status(400).json({ error: 'Paramètres runs invalides', details: queryResult.error.issues });
        }

        const user = req.user as IUser;
        const runtimeCompatibility = await runtimeCompatibilityService.getRuntimeCompatibility();
        runtimeCompatibilityService.applyResponseHeaders(res, runtimeCompatibility);

        const runs = await userToolRunQueryService.listRuns(user.id, queryResult.data);
        res.json({ ...runs, runtimeCompatibility });
    } catch (error) {
        console.error('[RunsRoute] GET / error:', error);
        res.status(500).json({ error: 'Erreur lors de la récupération des runs' });
    }
});

router.get('/tool/:toolId', requireAuth, async (req, res) => {
    try {
        const idResult = idParamSchema.safeParse(req.params.toolId);
        if (!idResult.success) {
            return res.status(400).json({ error: 'ID de tool invalide' });
        }

        const queryResult = listRunsQuerySchema.safeParse(req.query);
        if (!queryResult.success) {
            return res.status(400).json({ error: 'Paramètres runs invalides', details: queryResult.error.issues });
        }

        const user = req.user as IUser;
        const runtimeCompatibility = await runtimeCompatibilityService.getRuntimeCompatibility();
        runtimeCompatibilityService.applyResponseHeaders(res, runtimeCompatibility);

        const runs = await userToolRunQueryService.listRunsForTool(idResult.data, user.id, queryResult.data);
        if (!runs) {
            return res.status(404).json({ error: 'Tool introuvable' });
        }

        res.json({ ...runs, runtimeCompatibility });
    } catch (error) {
        console.error('[RunsRoute] GET /tool/:toolId error:', error);
        res.status(500).json({ error: 'Erreur lors de la récupération des runs du tool' });
    }
});

router.get('/executions/:executionId', requireAuth, async (req, res) => {
    try {
        const executionId = String(req.params.executionId || '').trim();
        if (!executionId) {
            return res.status(400).json({ error: 'executionId invalide' });
        }

        const toolId = typeof req.query.toolId === 'string' ? req.query.toolId : undefined;
        if (toolId) {
            const idResult = idParamSchema.safeParse(toolId);
            if (!idResult.success) {
                return res.status(400).json({ error: 'ID de tool invalide' });
            }
        }

        const user = req.user as IUser;
        const run = await userToolRunQueryService.getRunByExecutionId(user.id, executionId, { toolId });
        if (!run) {
            return res.status(404).json({ error: 'Run introuvable' });
        }

        res.json(run);
    } catch (error) {
        console.error('[RunsRoute] GET /executions/:executionId error:', error);
        res.status(500).json({ error: 'Erreur lors de la récupération du run' });
    }
});

router.get('/tool/:toolId/:executionId/artifacts/content', requireAuth, async (req, res) => {
    try {
        const idResult = idParamSchema.safeParse(req.params.toolId);
        if (!idResult.success) {
            return res.status(400).json({ error: 'ID de tool invalide' });
        }

        const executionId = String(req.params.executionId || '').trim();
        if (!executionId) {
            return res.status(400).json({ error: 'executionId invalide' });
        }

        const queryResult = artifactQuerySchema.safeParse(req.query);
        if (!queryResult.success) {
            return res.status(400).json({ error: 'Paramètres d\'artefact invalides', details: queryResult.error.issues });
        }

        const user = req.user as IUser;
        const preview = await userToolRunQueryService.getArtifactPreviewForTool(idResult.data, user.id, executionId, queryResult.data.path);
        if (!preview) {
            return res.status(404).json({ error: 'Artefact introuvable' });
        }

        res.json(preview);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Erreur lors de la lecture de l\'artefact';
        if (message.includes('Artifact path') || message.includes('escapes output root')) {
            return res.status(400).json({ error: message });
        }

        console.error('[RunsRoute] GET /tool/:toolId/:executionId/artifacts/content error:', error);
        res.status(500).json({ error: message });
    }
});

router.get('/tool/:toolId/:executionId/artifacts/download', requireAuth, async (req, res) => {
    try {
        const idResult = idParamSchema.safeParse(req.params.toolId);
        if (!idResult.success) {
            return res.status(400).json({ error: 'ID de tool invalide' });
        }

        const executionId = String(req.params.executionId || '').trim();
        if (!executionId) {
            return res.status(400).json({ error: 'executionId invalide' });
        }

        const queryResult = artifactQuerySchema.safeParse(req.query);
        if (!queryResult.success) {
            return res.status(400).json({ error: 'Paramètres d\'artefact invalides', details: queryResult.error.issues });
        }

        const user = req.user as IUser;
        const artifactFile = await userToolRunQueryService.getArtifactFileForTool(idResult.data, user.id, executionId, queryResult.data.path);
        if (!artifactFile) {
            return res.status(404).json({ error: 'Artefact introuvable' });
        }

        res.setHeader('Content-Type', artifactFile.artifact.contentType);
        res.download(artifactFile.artifact.absolutePath, artifactFile.artifact.fileName);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Erreur lors du téléchargement de l\'artefact';
        if (message.includes('Artifact path') || message.includes('escapes output root')) {
            return res.status(400).json({ error: message });
        }

        console.error('[RunsRoute] GET /tool/:toolId/:executionId/artifacts/download error:', error);
        res.status(500).json({ error: message });
    }
});

router.post('/tool/:toolId/cleanup', requireAuth, async (req, res) => {
    try {
        const idResult = idParamSchema.safeParse(req.params.toolId);
        if (!idResult.success) {
            return res.status(400).json({ error: 'ID de tool invalide' });
        }

        const bodyResult = cleanupRunsSchema.safeParse(req.body);
        if (!bodyResult.success) {
            return res.status(400).json({ error: 'Paramètres cleanup invalides', details: bodyResult.error.issues });
        }

        const user = req.user as IUser;
        const result = await userToolRunRetentionService.cleanupRunsForTool(idResult.data, user.id, bodyResult.data);
        if (!result) {
            return res.status(404).json({ error: 'Tool introuvable' });
        }

        res.json(result);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Erreur lors du nettoyage des runs';
        console.error('[RunsRoute] POST /tool/:toolId/cleanup error:', error);
        res.status(500).json({ error: message });
    }
});

export default router;