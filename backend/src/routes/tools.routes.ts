import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.middleware';
import { IUser } from '../models/User.model';
import { BuildPreparationError, BuildService } from '../services/build.service';
import { NativePythonProvisioningService } from '../services/nativePythonProvisioning.service';
import { RuntimeCompatibilityService } from '../services/runtimeCompatibility.service';
import { toolCommandService } from '../services/toolCommand.service';
import { ToolReadinessService } from '../services/toolReadiness.service';
import { ToolReadAdapterService } from '../services/toolReadAdapter.service';

const router = Router();
const runtimeCompatibilityService = new RuntimeCompatibilityService();
const toolReadAdapterService = new ToolReadAdapterService();
const buildService = new BuildService();
const nativePythonProvisioningService = new NativePythonProvisioningService();
const toolReadinessService = new ToolReadinessService();

const idParamSchema = z.string().regex(/^[a-f\d]{24}$/i, 'ID doit être un ObjectId MongoDB valide');
const toolRuntimeSchema = z.enum(['python', 'typescript']);
const buildQuerySchema = z.object({
    versionTag: z.string().optional()
});

const createToolSchema = z.object({
    name: z
        .string()
        .min(2)
        .max(64)
        .regex(/^[a-z][a-z0-9_]*$/, 'Le nom doit être en snake_case (lettres minuscules, chiffres, _)'),
    description: z.string().min(10).max(500),
    language: toolRuntimeSchema.optional(),
    runtime: toolRuntimeSchema.optional(),
    workflowId: z
        .string()
        .regex(/^[a-f\d]{24}$/i, 'workflowId doit être un ObjectId valide')
        .optional()
        .nullable(),
    inputSchema: z.object({}).passthrough().optional().default({}),
    outputSchema: z.object({}).passthrough().optional().default({}),
    codeInline: z.string().max(50_000).optional().nullable(),
    dependencies: z.array(z.string().max(100)).max(20).optional().default([]),
    tags: z.array(z.string().max(30)).max(10).optional().default([])
}).superRefine((value, ctx) => {
    if (!value.language && !value.runtime) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'language ou runtime est requis',
            path: ['runtime']
        });
    }

    if (value.language && value.runtime && value.language !== value.runtime) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'language et runtime doivent etre identiques',
            path: ['runtime']
        });
    }
});

const updateToolSchema = z.object({
    description: z.string().min(10).max(500).optional(),
    language: toolRuntimeSchema.optional(),
    runtime: toolRuntimeSchema.optional(),
    workflowId: z
        .string()
        .regex(/^[a-f\d]{24}$/i, 'workflowId doit être un ObjectId valide')
        .optional()
        .nullable(),
    inputSchema: z.object({}).passthrough().optional(),
    outputSchema: z.object({}).passthrough().optional(),
    codeInline: z.string().max(50_000).optional().nullable(),
    dependencies: z.array(z.string().max(100)).max(20).optional(),
    tags: z.array(z.string().max(30)).max(10).optional()
}).superRefine((value, ctx) => {
    if (value.language && value.runtime && value.language !== value.runtime) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'language et runtime doivent etre identiques',
            path: ['runtime']
        });
    }
});

const listToolsQuerySchema = z.object({
    workflowId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
    runtime: z.enum(['python', 'typescript']).optional(),
    isEnabled: z.enum(['true', 'false']).optional(),
    status: z.enum(['draft', 'ready', 'disabled', 'deprecated']).optional()
});

async function applyRuntimeCompatibility(res: any) {
    const runtimeCompatibility = await runtimeCompatibilityService.getRuntimeCompatibility();
    runtimeCompatibilityService.applyResponseHeaders(res, runtimeCompatibility);
    return runtimeCompatibility;
}

function withToolReadiness(tool: any, runtimeCompatibility: any) {
    return {
        ...tool,
        readinessStatus: toolReadinessService.evaluateToolReadiness(tool, runtimeCompatibility)
    };
}

router.get('/', requireAuth, async (req, res) => {
    try {
        const queryResult = listToolsQuerySchema.safeParse(req.query);
        if (!queryResult.success) {
            return res.status(400).json({ error: 'Paramètres tools invalides', details: queryResult.error.issues });
        }

        const user = req.user as IUser;
        const runtimeCompatibility = await applyRuntimeCompatibility(res);

        const tools = await toolReadAdapterService.listTools(user.id, {
            workflowId: queryResult.data.workflowId,
            runtime: queryResult.data.runtime,
            isEnabled: queryResult.data.isEnabled !== undefined ? queryResult.data.isEnabled === 'true' : undefined,
            status: queryResult.data.status
        });

        const toolsWithReadiness = tools.map((tool) => withToolReadiness(tool, runtimeCompatibility));

        res.json({ items: toolsWithReadiness, runtimeCompatibility });
    } catch (error) {
        console.error('[ToolsRoute] GET / error:', error);
        res.status(500).json({ error: 'Erreur lors de la récupération des tools' });
    }
});

router.post('/', requireAuth, async (req, res) => {
    try {
        const payloadResult = createToolSchema.safeParse(req.body);
        if (!payloadResult.success) {
            return res.status(400).json({ error: 'Paramètres tools invalides', details: payloadResult.error.issues });
        }

        const user = req.user as IUser;
        const tool = await toolCommandService.createTool(user.id, payloadResult.data);
        const runtimeCompatibility = await applyRuntimeCompatibility(res);

        res.status(201).json({
            tool: withToolReadiness(tool, runtimeCompatibility),
            runtimeCompatibility
        });
    } catch (error: any) {
        console.error('[ToolsRoute] POST / error:', error);
        if (error.code === 11000) {
            return res.status(409).json({ error: 'Une fonction avec ce nom existe déjà dans votre espace de travail' });
        }

        res.status(500).json({ error: 'Erreur lors de la création du tool' });
    }
});

router.get('/:id', requireAuth, async (req, res) => {
    try {
        const idResult = idParamSchema.safeParse(req.params.id);
        if (!idResult.success) {
            return res.status(400).json({ error: 'ID de tool invalide' });
        }

        const user = req.user as IUser;
        const runtimeCompatibility = await applyRuntimeCompatibility(res);

        const tool = await toolReadAdapterService.getToolById(idResult.data, user.id);
        if (!tool) {
            return res.status(404).json({ error: 'Tool introuvable' });
        }

        res.json({
            tool: withToolReadiness(tool, runtimeCompatibility),
            runtimeCompatibility
        });
    } catch (error) {
        console.error('[ToolsRoute] GET /:id error:', error);
        res.status(500).json({ error: 'Erreur lors de la récupération du tool' });
    }
});

router.put('/:id', requireAuth, async (req, res) => {
    try {
        const idResult = idParamSchema.safeParse(req.params.id);
        if (!idResult.success) {
            return res.status(400).json({ error: 'ID de tool invalide' });
        }

        const payloadResult = updateToolSchema.safeParse(req.body);
        if (!payloadResult.success) {
            return res.status(400).json({ error: 'Paramètres tools invalides', details: payloadResult.error.issues });
        }

        const user = req.user as IUser;
        const updated = await toolCommandService.updateTool(idResult.data, user.id, payloadResult.data);

        if (!updated) {
            return res.status(404).json({ error: 'Tool introuvable ou non modifiable (tools natifs en lecture seule)' });
        }

        const runtimeCompatibility = await applyRuntimeCompatibility(res);
        res.json({
            tool: withToolReadiness(updated, runtimeCompatibility),
            runtimeCompatibility
        });
    } catch (error: any) {
        console.error('[ToolsRoute] PUT /:id error:', error);
        if (error.code === 11000) {
            return res.status(409).json({ error: 'Une fonction avec ce nom existe déjà dans votre espace de travail' });
        }

        res.status(500).json({ error: 'Erreur lors de la mise à jour du tool' });
    }
});

router.delete('/:id', requireAuth, async (req, res) => {
    try {
        const idResult = idParamSchema.safeParse(req.params.id);
        if (!idResult.success) {
            return res.status(400).json({ error: 'ID de tool invalide' });
        }

        const user = req.user as IUser;
        const success = await toolCommandService.deleteTool(idResult.data, user.id);

        if (!success) {
            return res.status(404).json({ error: 'Tool introuvable ou non supprimable (tools natifs en lecture seule)' });
        }

        res.status(204).send();
    } catch (error) {
        console.error('[ToolsRoute] DELETE /:id error:', error);
        res.status(500).json({ error: 'Erreur lors de la suppression du tool' });
    }
});

router.patch('/:id/toggle', requireAuth, async (req, res) => {
    try {
        const idResult = idParamSchema.safeParse(req.params.id);
        if (!idResult.success) {
            return res.status(400).json({ error: 'ID de tool invalide' });
        }

        const user = req.user as IUser;
        const allowBashPy = req.body?.allowBashPy === true;
        const updated = await toolCommandService.toggleTool(idResult.data, user.id, { allowBashPy });

        if (!updated) {
            return res.status(404).json({ error: 'Tool introuvable' });
        }

        res.json(updated);
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Erreur lors du toggle';
        if (msg.includes('allowBashPy')) {
            return res.status(403).json({ error: msg });
        }

        console.error('[ToolsRoute] PATCH /:id/toggle error:', error);
        res.status(500).json({ error: 'Erreur lors du toggle du tool' });
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

router.post('/:id/provision', requireAuth, async (req, res) => {
    try {
        const idResult = idParamSchema.safeParse(req.params.id);
        if (!idResult.success) {
            return res.status(400).json({ error: 'ID de tool invalide' });
        }

        const queryResult = buildQuerySchema.safeParse(req.query);
        if (!queryResult.success) {
            return res.status(400).json({ error: 'Paramètres provisioning invalides', details: queryResult.error.issues });
        }

        const user = req.user as IUser;
        const result = await nativePythonProvisioningService.provisionToolVersion(
            idResult.data,
            user.id,
            queryResult.data.versionTag
        );

        res.json(result);
    } catch (error) {
        console.error('[ToolsRoute] POST /:id/provision error:', error);

        if (error instanceof BuildPreparationError) {
            return res.status(409).json({ error: error.message });
        }

        res.status(500).json({ error: 'Erreur lors du provisionnement plateforme' });
    }
});

export default router;