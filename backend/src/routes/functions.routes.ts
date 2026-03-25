/**
 * Routes API — Gestion des Fonctions Personnalisées (Tools V2)
 *
 * ENDPOINTS :
 *   GET    /api/functions              — Liste (native + custom de l'utilisateur)
 *   POST   /api/functions              — Créer une fonction custom
 *   GET    /api/functions/:id          — Détail d'une fonction
 *   PUT    /api/functions/:id          — Mettre à jour (custom uniquement)
 *   DELETE /api/functions/:id          — Supprimer (custom uniquement)
 *   PATCH  /api/functions/:id/toggle   — Activer/désactiver
 *   GET    /api/functions/agent/:agentId — Fonctions associées à un prototype
 */

import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validation.middleware';
import { FunctionService } from '../services/function.service';
import { BuildPreparationError, BuildService } from '../services/build.service';
import { RuntimeCompatibilityService } from '../services/runtimeCompatibility.service';
import { ToolReadAdapterService } from '../services/toolReadAdapter.service';
import { UserToolRunQueryService } from '../services/userToolRunQuery.service';
import { UserToolRunRetentionService } from '../services/userToolRunRetention.service';
import { IUser } from '../models/User.model';

const router = Router();
const functionService = new FunctionService();
const buildService = new BuildService();
const runtimeCompatibilityService = new RuntimeCompatibilityService();
const toolReadAdapterService = new ToolReadAdapterService();
const userToolRunQueryService = new UserToolRunQueryService();
const userToolRunRetentionService = new UserToolRunRetentionService();

async function applyRuntimeCompatibility(res: any) {
    const runtimeCompatibility = await runtimeCompatibilityService.getRuntimeCompatibility();
    runtimeCompatibilityService.applyResponseHeaders(res, runtimeCompatibility);
    return runtimeCompatibility;
}

// ─── Schémas de Validation Zod ─────────────────────────────────────────────

const createFunctionSchema = z.object({
    name: z
        .string()
        .min(2)
        .max(64)
        .regex(/^[a-z][a-z0-9_]*$/, 'Le nom doit être en snake_case (lettres minuscules, chiffres, _)'),
    description: z.string().min(10).max(500),
    language: z.enum(['python', 'typescript']),
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
});

const updateFunctionSchema = createFunctionSchema.partial().omit({ name: true });

const buildFunctionSchema = z.object({
    force: z.boolean().optional().default(false)
});

const idParamSchema = z
    .string()
    .regex(/^[a-f\d]{24}$/i, 'ID doit être un ObjectId MongoDB valide');

const listRunsQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(50).optional().default(20),
    page: z.coerce.number().int().min(1).optional().default(1),
    status: z.enum(['queued', 'running', 'completed', 'failed', 'stopped', 'timed_out']).optional(),
    sortBy: z.enum(['createdAt', 'durationMs', 'status']).optional().default('createdAt'),
    sortOrder: z.enum(['asc', 'desc']).optional().default('desc')
});

const cleanupRunsSchema = z.object({
    retentionDays: z.number().int().min(1).max(365).optional(),
    retainLatest: z.number().int().min(0).max(200).optional(),
    dryRun: z.boolean().optional().default(false)
}).refine((value) => value.retentionDays !== undefined || value.retainLatest !== undefined, {
    message: 'retentionDays ou retainLatest est requis'
});

const artifactQuerySchema = z.object({
    path: z.string().min(1, 'Le chemin d\'artefact est requis')
});

// ─── GET /api/functions ──────────────────────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
    try {
        const user = req.user as IUser;

        // Valider les query params
        const querySchema = z.object({
            workflowId: z
                .string()
                .regex(/^[a-f\d]{24}$/i)
                .optional(),
            origin: z.enum(['native', 'custom']).optional(),
            language: z.enum(['python', 'typescript']).optional(),
            enabled: z.enum(['true', 'false']).optional()
        });

        const queryResult = querySchema.safeParse(req.query);
        if (!queryResult.success) {
            return res.status(400).json({
                error: 'Paramètres de requête invalides',
                details: queryResult.error.issues
            });
        }

        const { workflowId, origin, language, enabled } = queryResult.data;
        const runtimeCompatibility = await applyRuntimeCompatibility(res);

        const functions = await toolReadAdapterService.listLegacyFunctions(user.id, {
            workflowId,
            origin,
            language,
            isEnabled: enabled !== undefined ? enabled === 'true' : undefined
        });

        res.json(functions.map((fn) => ({
            ...fn,
            runtimeCompatibility
        })));
    } catch (error) {
        console.error('[FunctionsRoute] GET / error:', error);
        res.status(500).json({ error: 'Erreur lors de la récupération des fonctions' });
    }
});

// ─── POST /api/functions ─────────────────────────────────────────────────────
router.post('/', requireAuth, validateRequest(createFunctionSchema), async (req, res) => {
    try {
        const user = req.user as IUser;
        const created = await functionService.createFunction(user.id, req.body);
        const runtimeCompatibility = await applyRuntimeCompatibility(res);
        res.status(201).json({
            ...created,
            runtimeCompatibility
        });
    } catch (error: any) {
        console.error('[FunctionsRoute] POST / error:', error);
        if (error.code === 11000) {
            return res.status(409).json({
                error: 'Une fonction avec ce nom existe déjà dans votre espace de travail'
            });
        }
        res.status(500).json({ error: 'Erreur lors de la création de la fonction' });
    }
});

// ─── GET /api/functions/agent/:agentId ───────────────────────────────────────
// IMPORTANT: cette route doit être AVANT /:id pour ne pas être capturée
router.get('/agent/:agentId', requireAuth, async (req, res) => {
    try {
        const agentIdResult = idParamSchema.safeParse(req.params.agentId);
        if (!agentIdResult.success) {
            return res.status(400).json({ error: 'agentId invalide' });
        }

        const user = req.user as IUser;
        const functions = await toolReadAdapterService.getLegacyFunctionsForAgent(
            agentIdResult.data,
            user.id
        );
        const runtimeCompatibility = await applyRuntimeCompatibility(res);
        res.json(functions.map((fn) => ({
            ...fn,
            runtimeCompatibility
        })));
    } catch (error) {
        console.error('[FunctionsRoute] GET /agent/:agentId error:', error);
        res.status(500).json({ error: 'Erreur lors de la récupération des fonctions de l\'agent' });
    }
});

// ─── GET /api/functions/:id/build-status ─────────────────────────────────────
router.get('/:id/runs', requireAuth, async (req, res) => {
    try {
        const idResult = idParamSchema.safeParse(req.params.id);
        if (!idResult.success) {
            return res.status(400).json({ error: 'ID de fonction invalide' });
        }

        const queryResult = listRunsQuerySchema.safeParse(req.query);
        if (!queryResult.success) {
            return res.status(400).json({ error: 'Paramètres de runs invalides', details: queryResult.error.issues });
        }

        const user = req.user as IUser;
        const runs = await userToolRunQueryService.listRunsForFunction(idResult.data, user.id, {
            limit: queryResult.data.limit,
            page: queryResult.data.page,
            status: queryResult.data.status,
            sortBy: queryResult.data.sortBy,
            sortOrder: queryResult.data.sortOrder
        });
        if (!runs) {
            return res.status(404).json({ error: 'Fonction introuvable' });
        }

        res.json(runs);
    } catch (error) {
        console.error('[FunctionsRoute] GET /:id/runs error:', error);
        res.status(500).json({ error: 'Erreur lors de la récupération des exécutions' });
    }
});

router.get('/:id/runs/:executionId/artifacts/content', requireAuth, async (req, res) => {
    try {
        const idResult = idParamSchema.safeParse(req.params.id);
        if (!idResult.success) {
            return res.status(400).json({ error: 'ID de fonction invalide' });
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
        const preview = await userToolRunQueryService.getArtifactPreview(
            idResult.data,
            user.id,
            executionId,
            queryResult.data.path
        );

        if (!preview) {
            return res.status(404).json({ error: 'Artefact introuvable' });
        }

        res.json(preview);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Erreur lors de la lecture de l\'artefact';
        if (
            message.includes('Artifact path')
            || message.includes('escapes output root')
        ) {
            return res.status(400).json({ error: message });
        }

        console.error('[FunctionsRoute] GET /:id/runs/:executionId/artifacts/content error:', error);
        res.status(500).json({ error: message });
    }
});

router.get('/:id/runs/:executionId/artifacts/download', requireAuth, async (req, res) => {
    try {
        const idResult = idParamSchema.safeParse(req.params.id);
        if (!idResult.success) {
            return res.status(400).json({ error: 'ID de fonction invalide' });
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
        const artifactFile = await userToolRunQueryService.getArtifactFile(
            idResult.data,
            user.id,
            executionId,
            queryResult.data.path
        );

        if (!artifactFile) {
            return res.status(404).json({ error: 'Artefact introuvable' });
        }

        res.setHeader('Content-Type', artifactFile.artifact.contentType);
        res.download(artifactFile.artifact.absolutePath, artifactFile.artifact.fileName);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Erreur lors du téléchargement de l\'artefact';
        if (
            message.includes('Artifact path')
            || message.includes('escapes output root')
        ) {
            return res.status(400).json({ error: message });
        }

        console.error('[FunctionsRoute] GET /:id/runs/:executionId/artifacts/download error:', error);
        res.status(500).json({ error: message });
    }
});

router.post('/:id/runs/cleanup', requireAuth, validateRequest(cleanupRunsSchema), async (req, res) => {
    try {
        const idResult = idParamSchema.safeParse(req.params.id);
        if (!idResult.success) {
            return res.status(400).json({ error: 'ID de fonction invalide' });
        }

        const user = req.user as IUser;
        const result = await userToolRunRetentionService.cleanupRunsForFunction(idResult.data, user.id, req.body);
        if (!result) {
            return res.status(404).json({ error: 'Fonction introuvable' });
        }

        res.json(result);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Erreur lors du nettoyage des runs';
        console.error('[FunctionsRoute] POST /:id/runs/cleanup error:', error);
        res.status(500).json({ error: message });
    }
});

router.get('/:id/build-status', requireAuth, async (req, res) => {
    try {
        const idResult = idParamSchema.safeParse(req.params.id);
        if (!idResult.success) {
            return res.status(400).json({ error: 'ID de fonction invalide' });
        }

        const user = req.user as IUser;
        const status = await buildService.getBuildStatus(idResult.data, user.id);

        if (!status) {
            return res.status(404).json({ error: 'Aucun build disponible pour cette fonction' });
        }

        res.json(status);
    } catch (error: unknown) {
        console.error('[FunctionsRoute] GET /:id/build-status error:', error);
        res.status(500).json({ error: 'Erreur lors de la lecture du statut de build' });
    }
});

// ─── POST /api/functions/:id/build ───────────────────────────────────────────
router.post('/:id/build', requireAuth, validateRequest(buildFunctionSchema), async (req, res) => {
    try {
        const idResult = idParamSchema.safeParse(req.params.id);
        if (!idResult.success) {
            return res.status(400).json({ error: 'ID de fonction invalide' });
        }

        const user = req.user as IUser;
        const result = await buildService.prepareFunction(idResult.data, user.id);
        res.json(result);
    } catch (error: unknown) {
        console.error('[FunctionsRoute] POST /:id/build error:', error);

        if (error instanceof BuildPreparationError) {
            return res.status(409).json({ error: error.message });
        }

        res.status(500).json({ error: 'Erreur lors de la préparation du build' });
    }
});

// ─── GET /api/functions/:id ──────────────────────────────────────────────────
router.get('/:id', requireAuth, async (req, res) => {
    try {
        const idResult = idParamSchema.safeParse(req.params.id);
        if (!idResult.success) {
            return res.status(400).json({ error: 'ID de fonction invalide' });
        }

        const user = req.user as IUser;
        const fn = await toolReadAdapterService.getLegacyFunctionById(idResult.data, user.id);

        if (!fn) {
            return res.status(404).json({ error: 'Fonction introuvable' });
        }

        const runtimeCompatibility = await applyRuntimeCompatibility(res);
        res.json({
            ...fn,
            runtimeCompatibility
        });
    } catch (error) {
        console.error('[FunctionsRoute] GET /:id error:', error);
        res.status(500).json({ error: 'Erreur lors de la récupération de la fonction' });
    }
});

// ─── PUT /api/functions/:id ──────────────────────────────────────────────────
router.put('/:id', requireAuth, validateRequest(updateFunctionSchema), async (req, res) => {
    try {
        const idResult = idParamSchema.safeParse(req.params.id);
        if (!idResult.success) {
            return res.status(400).json({ error: 'ID de fonction invalide' });
        }

        const user = req.user as IUser;
        const updated = await functionService.updateFunction(idResult.data, user.id, req.body);

        if (!updated) {
            return res.status(404).json({
                error: 'Fonction introuvable ou non modifiable (fonctions natives en lecture seule)'
            });
        }

        const runtimeCompatibility = await applyRuntimeCompatibility(res);
        res.json({
            ...updated,
            runtimeCompatibility
        });
    } catch (error) {
        console.error('[FunctionsRoute] PUT /:id error:', error);
        res.status(500).json({ error: 'Erreur lors de la mise à jour de la fonction' });
    }
});

// ─── DELETE /api/functions/:id ───────────────────────────────────────────────
router.delete('/:id', requireAuth, async (req, res) => {
    try {
        const idResult = idParamSchema.safeParse(req.params.id);
        if (!idResult.success) {
            return res.status(400).json({ error: 'ID de fonction invalide' });
        }

        const user = req.user as IUser;
        const success = await functionService.deleteFunction(idResult.data, user.id);

        if (!success) {
            return res.status(404).json({
                error: 'Fonction introuvable ou non supprimable (fonctions natives en lecture seule)'
            });
        }

        res.status(204).send();
    } catch (error) {
        console.error('[FunctionsRoute] DELETE /:id error:', error);
        res.status(500).json({ error: 'Erreur lors de la suppression de la fonction' });
    }
});

// ─── PATCH /api/functions/:id/toggle ─────────────────────────────────────────
router.patch('/:id/toggle', requireAuth, async (req, res) => {
    try {
        const idResult = idParamSchema.safeParse(req.params.id);
        if (!idResult.success) {
            return res.status(400).json({ error: 'ID de fonction invalide' });
        }

        const user = req.user as IUser;
        // allowBashPy : consentement explicite requis pour activer bash_py
        const allowBashPy = req.body?.allowBashPy === true;

        const updated = await functionService.toggleFunction(
            idResult.data,
            user.id,
            { allowBashPy }
        );

        if (!updated) {
            return res.status(404).json({ error: 'Fonction introuvable' });
        }

        res.json({ id: updated._id, isEnabled: updated.isEnabled });
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Erreur lors du toggle';
        // bash_py consent refusal → 403
        if (msg.includes('allowBashPy')) {
            return res.status(403).json({ error: msg });
        }
        console.error('[FunctionsRoute] PATCH /:id/toggle error:', error);
        res.status(500).json({ error: 'Erreur lors du toggle de la fonction' });
    }
});

export default router;
