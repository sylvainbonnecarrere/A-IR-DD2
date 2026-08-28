import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { LocalLLMProfile, ILocalLLMProfile } from '../models/LocalLLMProfile.model';
import { requireAuth } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validation.middleware';

const router = Router();

/**
 * Zod schema for POST/PUT validation
 */
const profileSchema = z.object({
    name: z.string().min(1).max(100).trim(),
    endpoint: z.string().url().trim(),
    capabilities: z.record(z.string(),z.boolean()).optional().default({}),
    enabled: z.boolean().default(true),
    detectedModel: z.string().trim().nullable().optional()
});

/**
 * Serialises a Mongoose document to the API response shape.
 * Single source of truth — avoids the same object literal in every handler.
 */
function toProfileDTO(p: ILocalLLMProfile) {
    return {
        id: p._id.toString(),
        name: p.name,
        endpoint: p.endpoint,
        capabilities: p.capabilities,
        enabled: p.enabled,
        detectedModel: p.detectedModel ?? null,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt
    };
}

/**
 * GET /api/local-llm-profiles
 * List all profiles for the authenticated user (sorted by name)
 */
router.get('/', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = req.user as any;
        const profiles = await LocalLLMProfile.find({ userId: user.id }).sort({ name: 1 });
        res.json(profiles.map(toProfileDTO));
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
        const { name, endpoint, capabilities, enabled, detectedModel } = req.body;

        const profile = new LocalLLMProfile({
            userId: user.id,
            name,
            endpoint,
            capabilities: capabilities || {},
            enabled: enabled !== undefined ? enabled : true,
            detectedModel: detectedModel ?? null
        });

        await profile.save();
        res.status(201).json(toProfileDTO(profile));
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
 * Update an existing profile (ownership enforced via findOne)
 */
router.put('/:id', requireAuth, validateRequest(profileSchema), async (req: Request, res: Response) => {
    try {
        const user = req.user as any;
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'ID de profil invalide' });
        }

        const { name, endpoint, capabilities, enabled, detectedModel } = req.body;

        // findOne with userId prevents unauthorized access (404 instead of 403 — information hiding)
        const profile = await LocalLLMProfile.findOne({ _id: id, userId: user.id });
        if (!profile) {
            return res.status(404).json({ error: 'Profil introuvable' });
        }

        profile.name = name;
        profile.endpoint = endpoint;
        profile.capabilities = capabilities || {};
        profile.enabled = enabled !== undefined ? enabled : true;
        if (detectedModel !== undefined) {
            profile.detectedModel = detectedModel ?? null;
        }

        await profile.save();
        res.json(toProfileDTO(profile));
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
 * Delete a profile (ownership enforced via findOne)
 */
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = req.user as any;
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'ID de profil invalide' });
        }

        // findOne with userId prevents unauthorized access (404 instead of 403 — information hiding)
        const profile = await LocalLLMProfile.findOne({ _id: id, userId: user.id });
        if (!profile) {
            return res.status(404).json({ error: 'Profil introuvable' });
        }

        await profile.deleteOne();
        res.json({ message: 'Profil supprimé' });
    } catch (error) {
        console.error('[LocalLLMProfiles] DELETE error:', error);
        res.status(500).json({ error: 'Erreur suppression du profil LLM local' });
    }
});

export default router;
