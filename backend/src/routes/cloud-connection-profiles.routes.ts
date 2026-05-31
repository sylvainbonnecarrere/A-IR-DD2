import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { CloudConnectionProfile, ICloudConnectionProfile, CloudConnectionProfileConfig } from '../models/CloudConnectionProfile.model';
import { requireAuth } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validation.middleware';
import { validateCloudConfig } from '../types/cloudStorage';
import { S3StorageStrategy } from '../services/s3Storage.service';
import { GCSStorageStrategy } from '../services/gcsStorage.service';

const router = Router();

const baseSchema = z.object({
    displayName: z.string().min(1).max(100).trim(),
    provider: z.enum(['s3', 'gcs']),
    enabled: z.boolean().optional(),
    s3: z.object({
        accessKeyId: z.string().min(1).trim().optional(),
        secretAccessKey: z.string().min(1).trim().optional(),
        bucketName: z.string().min(1).trim(),
        region: z.string().min(1).trim(),
        endpoint: z.string().trim().optional(),
        forcePathStyle: z.boolean().optional(),
        keyPrefix: z.string().trim().optional()
    }).optional(),
    gcs: z.object({
        projectId: z.string().min(1).trim(),
        bucketName: z.string().min(1).trim(),
        serviceAccountKey: z.string().min(1).optional(),
        location: z.string().trim().optional(),
        keyPrefix: z.string().trim().optional()
    }).optional()
});

const createProfileSchema = baseSchema;

const updateProfileSchema = baseSchema.extend({
    replaceSecret: z.boolean().optional()
});

function trimToUndefined(value?: string | null): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

function toProfileDTO(profile: ICloudConnectionProfile) {
    const common = {
        id: profile._id.toString(),
        displayName: profile.displayName,
        provider: profile.provider,
        enabled: profile.enabled,
        hasSecretMaterial: profile.hasSecretMaterial(),
        secretSummary: profile.getSafeSecretSummary(),
        status: {
            state: profile.statusState,
            lastValidatedAt: profile.lastValidatedAt,
            lastErrorCode: profile.lastErrorCode,
            lastValidationMessage: profile.lastValidationMessage
        },
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt
    };

    if (profile.provider === 's3') {
        return {
            ...common,
            target: {
                bucketName: profile.target.bucketName,
                region: profile.target.region || null,
                endpoint: profile.target.endpoint || null,
                forcePathStyle: profile.target.forcePathStyle ?? false,
                keyPrefix: profile.target.keyPrefix || null
            }
        };
    }

    return {
        ...common,
        target: {
            projectId: profile.target.projectId || null,
            bucketName: profile.target.bucketName,
            location: profile.target.location || null,
            keyPrefix: profile.target.keyPrefix || null
        }
    };
}

function hasBodySecretMaterial(config: CloudConnectionProfileConfig): boolean {
    if (config.provider === 's3') {
        return !!(config.s3.accessKeyId && config.s3.secretAccessKey);
    }

    return !!config.gcs.serviceAccountKey;
}

function buildProfileConfig(body: any): CloudConnectionProfileConfig {
    if (body.provider === 's3') {
        if (!body.s3) {
            throw new Error('Configuration S3 requise');
        }

        return {
            provider: 's3',
            s3: {
                accessKeyId: trimToUndefined(body.s3.accessKeyId),
                secretAccessKey: trimToUndefined(body.s3.secretAccessKey),
                bucketName: body.s3.bucketName,
                region: body.s3.region,
                endpoint: trimToUndefined(body.s3.endpoint),
                forcePathStyle: body.s3.forcePathStyle,
                keyPrefix: trimToUndefined(body.s3.keyPrefix)
            }
        };
    }

    if (!body.gcs) {
        throw new Error('Configuration GCS requise');
    }

    return {
        provider: 'gcs',
        gcs: {
            projectId: body.gcs.projectId,
            bucketName: body.gcs.bucketName,
            serviceAccountKey: body.gcs.serviceAccountKey,
            location: trimToUndefined(body.gcs.location),
            keyPrefix: trimToUndefined(body.gcs.keyPrefix)
        }
    };
}

function assertCreateSecretMaterial(config: CloudConnectionProfileConfig): void {
    if (config.provider === 's3' && (!config.s3.accessKeyId || !config.s3.secretAccessKey)) {
        throw new Error('Configuration S3 invalide: credentials requis');
    }

    if (config.provider === 'gcs' && !config.gcs.serviceAccountKey) {
        throw new Error('Configuration GCS invalide: serviceAccountKey requis');
    }
}

function buildCloudStrategy(profileConfig: ReturnType<ICloudConnectionProfile['toDecryptedCloudStorageConfig']>) {
    if (!profileConfig) {
        throw new Error('Le profil ne contient pas de secret exploitable');
    }

    switch (profileConfig.provider) {
        case 's3':
            return new S3StorageStrategy();
        case 'gcs':
            return new GCSStorageStrategy();
        default:
            throw new Error('Provider cloud non supporté');
    }
}

router.get('/', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = req.user as any;
        const profiles = await CloudConnectionProfile.find({ userId: user.id }).sort({ displayName: 1 });
        res.json(profiles.map(toProfileDTO));
    } catch (error) {
        console.error('[CloudConnectionProfiles] GET error:', error);
        res.status(500).json({ error: 'Erreur récupération des profils cloud' });
    }
});

router.get('/:id', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = req.user as any;
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'ID de profil invalide' });
        }

        const profile = await CloudConnectionProfile.findOne({ _id: id, userId: user.id });
        if (!profile) {
            return res.status(404).json({ error: 'Profil cloud introuvable' });
        }

        res.json(toProfileDTO(profile));
    } catch (error) {
        console.error('[CloudConnectionProfiles] GET :id error:', error);
        res.status(500).json({ error: 'Erreur récupération du profil cloud' });
    }
});

router.post('/', requireAuth, validateRequest(createProfileSchema), async (req: Request, res: Response) => {
    try {
        const user = req.user as any;
        const config = buildProfileConfig(req.body);
        assertCreateSecretMaterial(config);

        const profile = new CloudConnectionProfile({
            userId: user.id,
            displayName: req.body.displayName,
            provider: config.provider,
            enabled: req.body.enabled !== undefined ? req.body.enabled : true,
            target: {
                bucketName: config.provider === 's3' ? config.s3.bucketName : config.gcs.bucketName
            },
            statusState: 'missing_secret'
        });

        profile.setSecretMaterial(config);
        if (!profile.enabled) {
            profile.statusState = 'disabled';
        }

        await profile.save();
        res.status(201).json(toProfileDTO(profile));
    } catch (error: any) {
        console.error('[CloudConnectionProfiles] POST error:', error);

        if (error.code === 11000) {
            return res.status(409).json({ error: 'Un profil cloud avec ce nom existe déjà' });
        }

        if (error instanceof Error && /Configuration|service account|provider/i.test(error.message)) {
            return res.status(400).json({ error: error.message });
        }

        res.status(500).json({ error: 'Erreur création du profil cloud' });
    }
});

router.put('/:id', requireAuth, validateRequest(updateProfileSchema), async (req: Request, res: Response) => {
    try {
        const user = req.user as any;
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'ID de profil invalide' });
        }

        const profile = await CloudConnectionProfile.findOne({ _id: id, userId: user.id });
        if (!profile) {
            return res.status(404).json({ error: 'Profil cloud introuvable' });
        }

        const config = buildProfileConfig(req.body);
        const replaceSecret = req.body.replaceSecret === true || hasBodySecretMaterial(config);

        if (profile.provider !== config.provider && !replaceSecret) {
            return res.status(400).json({ error: 'Changer de provider requiert une rotation complète du secret' });
        }

        profile.displayName = req.body.displayName;
        profile.enabled = req.body.enabled !== undefined ? req.body.enabled : true;
        profile.setTargetConfig(config);

        if (replaceSecret) {
            assertCreateSecretMaterial(config);
            profile.setSecretMaterial(config);
        } else if (!profile.hasSecretMaterial()) {
            profile.statusState = profile.enabled ? 'missing_secret' : 'disabled';
        } else if (!profile.enabled) {
            profile.statusState = 'disabled';
        }

        await profile.save();
        res.json(toProfileDTO(profile));
    } catch (error: any) {
        console.error('[CloudConnectionProfiles] PUT error:', error);

        if (error.code === 11000) {
            return res.status(409).json({ error: 'Un profil cloud avec ce nom existe déjà' });
        }

        if (error instanceof Error && /Configuration|service account|provider/i.test(error.message)) {
            return res.status(400).json({ error: error.message });
        }

        res.status(500).json({ error: 'Erreur mise à jour du profil cloud' });
    }
});

router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = req.user as any;
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'ID de profil invalide' });
        }

        const profile = await CloudConnectionProfile.findOne({ _id: id, userId: user.id });
        if (!profile) {
            return res.status(404).json({ error: 'Profil cloud introuvable' });
        }

        await profile.deleteOne();
        res.json({ message: 'Profil cloud supprimé' });
    } catch (error) {
        console.error('[CloudConnectionProfiles] DELETE error:', error);
        res.status(500).json({ error: 'Erreur suppression du profil cloud' });
    }
});

router.post('/:id/test', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = req.user as any;
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'ID de profil invalide' });
        }

        const profile = await CloudConnectionProfile.findOne({ _id: id, userId: user.id });
        if (!profile) {
            return res.status(404).json({ error: 'Profil cloud introuvable' });
        }

        const decryptedConfig = profile.toDecryptedCloudStorageConfig();
        if (!decryptedConfig) {
            return res.status(400).json({ error: 'Le profil ne contient pas de secret exploitable' });
        }

        const validation = validateCloudConfig(decryptedConfig);
        if (!validation.valid) {
            return res.status(400).json({
                error: 'Profil cloud incomplet',
                details: validation.errors
            });
        }

        const strategy = buildCloudStrategy(decryptedConfig);
        await strategy.initialize(decryptedConfig);
        const result = await strategy.testConnection();

        profile.applyValidationResult(result);
        await profile.save();

        res.json({
            ...result,
            profile: toProfileDTO(profile)
        });
    } catch (error: any) {
        console.error('[CloudConnectionProfiles] TEST error:', error);
        res.status(500).json({
            error: error instanceof Error ? error.message : 'Erreur test du profil cloud'
        });
    }
});

export default router;