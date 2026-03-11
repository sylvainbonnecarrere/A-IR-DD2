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
import { IUser } from '../models/User.model';

const router = Router();
const functionService = new FunctionService();

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

const idParamSchema = z
    .string()
    .regex(/^[a-f\d]{24}$/i, 'ID doit être un ObjectId MongoDB valide');

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

        const functions = await functionService.listFunctions(user.id, {
            workflowId,
            origin,
            language,
            isEnabled: enabled !== undefined ? enabled === 'true' : undefined
        });

        res.json(functions);
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
        res.status(201).json(created);
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
        const functions = await functionService.getFunctionsForAgent(
            agentIdResult.data,
            user.id
        );
        res.json(functions);
    } catch (error) {
        console.error('[FunctionsRoute] GET /agent/:agentId error:', error);
        res.status(500).json({ error: 'Erreur lors de la récupération des fonctions de l\'agent' });
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
        const fn = await functionService.getFunctionById(idResult.data, user.id);

        if (!fn) {
            return res.status(404).json({ error: 'Fonction introuvable' });
        }

        res.json(fn);
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

        res.json(updated);
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
