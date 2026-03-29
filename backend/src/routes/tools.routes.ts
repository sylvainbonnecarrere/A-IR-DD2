import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.middleware';
import { IUser } from '../models/User.model';
import { BuildPreparationError, BuildService } from '../services/build.service';
import { RuntimeCompatibilityService } from '../services/runtimeCompatibility.service';
import { ToolReadinessService } from '../services/toolReadiness.service';
import { ToolReadAdapterService } from '../services/toolReadAdapter.service';

const router = Router();
const runtimeCompatibilityService = new RuntimeCompatibilityService();
const toolReadAdapterService = new ToolReadAdapterService();
const buildService = new BuildService();
const toolReadinessService = new ToolReadinessService();

const idParamSchema = z.string().regex(/^[a-f\d]{24}$/i, 'ID doit être un ObjectId MongoDB valide');
const buildQuerySchema = z.object({
    versionTag: z.string().optional()
});

const listToolsQuerySchema = z.object({
    workflowId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
    runtime: z.enum(['python', 'typescript']).optional(),
    isEnabled: z.enum(['true', 'false']).optional(),
    status: z.enum(['draft', 'ready', 'disabled', 'deprecated']).optional()
});

router.get('/', requireAuth, async (req, res) => {
    try {
        const queryResult = listToolsQuerySchema.safeParse(req.query);
        if (!queryResult.success) {
            return res.status(400).json({ error: 'Paramètres tools invalides', details: queryResult.error.issues });
        }

        const user = req.user as IUser;
        const runtimeCompatibility = await runtimeCompatibilityService.getRuntimeCompatibility();
        runtimeCompatibilityService.applyResponseHeaders(res, runtimeCompatibility);

        const tools = await toolReadAdapterService.listTools(user.id, {
            workflowId: queryResult.data.workflowId,
            runtime: queryResult.data.runtime,
            isEnabled: queryResult.data.isEnabled !== undefined ? queryResult.data.isEnabled === 'true' : undefined,
            status: queryResult.data.status
        });

        const toolsWithReadiness = tools.map((tool) => ({
            ...tool,
            readinessStatus: toolReadinessService.evaluateToolReadiness(tool, runtimeCompatibility)
        }));

        res.json({ items: toolsWithReadiness, runtimeCompatibility });
    } catch (error) {
        console.error('[ToolsRoute] GET / error:', error);
        res.status(500).json({ error: 'Erreur lors de la récupération des tools' });
    }
});

router.get('/:id', requireAuth, async (req, res) => {
    try {
        const idResult = idParamSchema.safeParse(req.params.id);
        if (!idResult.success) {
            return res.status(400).json({ error: 'ID de tool invalide' });
        }

        const user = req.user as IUser;
        const runtimeCompatibility = await runtimeCompatibilityService.getRuntimeCompatibility();
        runtimeCompatibilityService.applyResponseHeaders(res, runtimeCompatibility);

        const tool = await toolReadAdapterService.getToolById(idResult.data, user.id);
        if (!tool) {
            return res.status(404).json({ error: 'Tool introuvable' });
        }

        res.json({
            tool: {
                ...tool,
                readinessStatus: toolReadinessService.evaluateToolReadiness(tool, runtimeCompatibility)
            },
            runtimeCompatibility
        });
    } catch (error) {
        console.error('[ToolsRoute] GET /:id error:', error);
        res.status(500).json({ error: 'Erreur lors de la récupération du tool' });
    }
});

router.get('/:id/build-status', requireAuth, async (req, res) => {
    try {
        const idResult = idParamSchema.safeParse(req.params.id);
        if (!idResult.success) {
            return res.status(400).json({ error: 'ID de tool invalide' });
        }

        const queryResult = buildQuerySchema.safeParse(req.query);
        if (!queryResult.success) {
            return res.status(400).json({ error: 'Paramètres build invalides', details: queryResult.error.issues });
        }

        const user = req.user as IUser;
        const status = await buildService.getToolBuildStatus(idResult.data, user.id, queryResult.data.versionTag);

        if (!status) {
            return res.status(404).json({ error: 'Aucun build disponible pour ce tool/version' });
        }

        res.json(status);
    } catch (error) {
        console.error('[ToolsRoute] GET /:id/build-status error:', error);
        res.status(500).json({ error: 'Erreur lors de la lecture du statut de build' });
    }
});

router.post('/:id/build', requireAuth, async (req, res) => {
    try {
        const idResult = idParamSchema.safeParse(req.params.id);
        if (!idResult.success) {
            return res.status(400).json({ error: 'ID de tool invalide' });
        }

        const queryResult = buildQuerySchema.safeParse(req.query);
        if (!queryResult.success) {
            return res.status(400).json({ error: 'Paramètres build invalides', details: queryResult.error.issues });
        }

        const user = req.user as IUser;
        const result = await buildService.prepareToolVersion(idResult.data, user.id, queryResult.data.versionTag);
        res.json(result);
    } catch (error) {
        console.error('[ToolsRoute] POST /:id/build error:', error);

        if (error instanceof BuildPreparationError) {
            return res.status(409).json({ error: error.message });
        }

        res.status(500).json({ error: 'Erreur lors de la préparation du build' });
    }
});

export default router;