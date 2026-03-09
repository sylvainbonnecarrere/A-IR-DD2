import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { LocalLLMProfile } from '../models/LocalLLMProfile.model';
import { requireAuth } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validation.middleware';

const router = Router();

/**
 * Zod schema for POST/PUT validation
 */
const profileSchema = z.object({
    name: z.string().min(1).max(100).trim(),
    endpoint: z.string().min(1).trim(),
    capabilities: z.record(z.boolean()).optional().default({}),
    enabled: z.boolean().default(true)
});

/**
 * GET /api/local-llm-profiles
 * List all profiles for the authenticated user (sorted by name)
 */
router.get('/', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = req.user as any;
        const profiles = await LocalLLMProfile.find({ userId: user.id }).sort({ name: 1 });

        const result = profiles.map(p => ({
            id: p._id.toString(),
            name: p.name,
            endpoint: p.endpoint,
            capabilities: p.capabilities,
            enabled: p.enabled,
            createdAt: p.createdAt,
            updatedAt: p.updatedAt
        }));

        res.json(result);
    } catch (error) {
        console.error('[LocalLLMProfiles] GET error:', error);
        res.status(500).json({ error: 'Erreur récupération des profils LLM local' });
    }
});

/**
 * POST /api/local-llm-profiles
 * Create a new profile
 */
router.post('/', requireAuth, validateRequest(profileSchema), async (req: Request, res: Response) => {
    try {
        const user = req.user as any;
        const { name, endpoint, capabilities, enabled } = req.body;

        const profile = new LocalLLMProfile({
            userId: user.id,
            name,
            endpoint,
            capabilities: capabilities || {},
            enabled: enabled !== undefined ? enabled : true
        });

        await profile.save();

        res.status(201).json({
            id: profile._id.toString(),
            name: profile.name,
            endpoint: profile.endpoint,
            capabilities: profile.capabilities,
            enabled: profile.enabled,
            createdAt: profile.createdAt,
            updatedAt: profile.updatedAt
        });
    } catch (error: any) {
        console.error('[LocalLLMProfiles] POST error:', error);

        if (error.code === 11000) {
            return res.status(409).json({ error: 'Un profil avec ce nom existe déjà' });
        }

        res.status(500).json({ error: 'Erreur création du profil LLM local' });
    }
});

/**
 * PUT /api/local-llm-profiles/:id
 * Update an existing profile
 */
router.put('/:id', requireAuth, validateRequest(profileSchema), async (req: Request, res: Response) => {
    try {
        const user = req.user as any;
        const { id } = req.params;
        const { name, endpoint, capabilities, enabled } = req.body;

        const profile = await LocalLLMProfile.findById(id);

        if (!profile) {
            return res.status(404).json({ error: 'Profil introuvable' });
        }

        if (profile.userId.toString() !== user.id.toString()) {
            return res.status(403).json({ error: 'Accès non autorisé' });
        }

        profile.name = name;
        profile.endpoint = endpoint;
        profile.capabilities = capabilities || {};
        profile.enabled = enabled !== undefined ? enabled : true;

        await profile.save();

        res.json({
            id: profile._id.toString(),
            name: profile.name,
            endpoint: profile.endpoint,
            capabilities: profile.capabilities,
            enabled: profile.enabled,
            createdAt: profile.createdAt,
            updatedAt: profile.updatedAt
        });
    } catch (error: any) {
        console.error('[LocalLLMProfiles] PUT error:', error);

        if (error.code === 11000) {
            return res.status(409).json({ error: 'Un profil avec ce nom existe déjà' });
        }

        res.status(500).json({ error: 'Erreur mise à jour du profil LLM local' });
    }
});

/**
 * DELETE /api/local-llm-profiles/:id
 * Delete a profile (ownership check)
 */
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = req.user as any;
        const { id } = req.params;

        const profile = await LocalLLMProfile.findById(id);

        if (!profile) {
            return res.status(404).json({ error: 'Profil introuvable' });
        }

        if (profile.userId.toString() !== user.id.toString()) {
            return res.status(403).json({ error: 'Accès non autorisé' });
        }

        await profile.deleteOne();

        res.json({ message: 'Profil supprimé' });
    } catch (error) {
        console.error('[LocalLLMProfiles] DELETE error:', error);
        res.status(500).json({ error: 'Erreur suppression du profil LLM local' });
    }
});

export default router;
