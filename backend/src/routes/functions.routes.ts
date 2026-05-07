/**
 * Routes API — Gestion des Fonctions Personnalisées (Tools V2)
 *
 * ENDPOINTS :
 *   GET    /api/functions              — Liste (native + custom de l'utilisateur)
 *   GET    /api/functions/:id          — Détail d'une fonction
 *   GET    /api/functions/agent/:agentId — Fonctions associées à un prototype
 *
 * Cette facade legacy est volontairement en lecture seule.
 * Les commandes passent desormais par /api/tools et /api/runs.
 */

import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.middleware';
import { BuildService } from '../services/build.service';
import { RuntimeCompatibilityService } from '../services/runtimeCompatibility.service';
import { ToolReadAdapterService } from '../services/toolReadAdapter.service';
import { UserToolRunQueryService } from '../services/userToolRunQuery.service';
import { IUser } from '../models/User.model';

const router = Router();
const buildService = new BuildService();
const runtimeCompatibilityService = new RuntimeCompatibilityService();
const toolReadAdapterService = new ToolReadAdapterService();
const userToolRunQueryService = new UserToolRunQueryService();

async function applyRuntimeCompatibility(res: any) {
    const runtimeCompatibility = await runtimeCompatibilityService.getRuntimeCompatibility();
    runtimeCompatibilityService.applyResponseHeaders(res, runtimeCompatibility);
    return runtimeCompatibility;
}

function respondLegacyWriteDisabled(
    res: any,
    canonical: { method: string; path: string }
) {
    res.status(410).json({
        error: 'La facade /api/functions est desormais en lecture seule.',
        code: 'legacy_functions_read_only',
        canonical,
        message: `Utilisez ${canonical.method} ${canonical.path}.`
    });
}

// ─── Schémas de Validation Zod ─────────────────────────────────────────────

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
router.post('/', requireAuth, async (_req, res) => {
    respondLegacyWriteDisabled(res, { method: 'POST', path: '/api/tools' });
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

router.post('/:id/runs/cleanup', requireAuth, async (req, res) => {
    respondLegacyWriteDisabled(res, { method: 'POST', path: `/api/runs/tool/${req.params.id}/cleanup` });
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
router.post('/:id/build', requireAuth, async (req, res) => {
    respondLegacyWriteDisabled(res, { method: 'POST', path: `/api/tools/${req.params.id}/build` });
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
router.put('/:id', requireAuth, async (req, res) => {
    respondLegacyWriteDisabled(res, { method: 'PUT', path: `/api/tools/${req.params.id}` });
});

// ─── DELETE /api/functions/:id ───────────────────────────────────────────────
router.delete('/:id', requireAuth, async (req, res) => {
    respondLegacyWriteDisabled(res, { method: 'DELETE', path: `/api/tools/${req.params.id}` });
});

// ─── PATCH /api/functions/:id/toggle ─────────────────────────────────────────
router.patch('/:id/toggle', requireAuth, async (req, res) => {
    respondLegacyWriteDisabled(res, { method: 'PATCH', path: `/api/tools/${req.params.id}/toggle` });
});

export default router;
