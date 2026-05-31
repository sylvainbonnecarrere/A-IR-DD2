/**
 * @fileoverview Routes API pour la gestion des médias
 * 
 * SÉCURITÉ CRITIQUE:
 * - Validation anti path-traversal sur tous les chemins
 * - Vérification de propriété (userId) obligatoire
 * - Streaming pour fichiers volumineux (évite OOM)
 * - Range Requests pour vidéos (seek)
 * 
 * Routes:
 * - GET    /api/media/:mediaId     - Récupérer un média (stream)
 * - GET    /api/media              - Lister les médias (paginé)
 * - DELETE /api/media/:mediaId     - Supprimer un média
 * - POST   /api/media/test-cloud   - Tester connexion cloud
 * 
 * @see backend/src/models/MediaReference.model.ts
 * @see backend/src/services/mediaStorage.service.ts
 */

import { Router, Request, Response } from 'express';
import { createReadStream, existsSync, statSync } from 'fs';
import { stat, unlink } from 'fs/promises';
import path from 'path';
import { z } from 'zod';
import mongoose from 'mongoose';
import { requireAuth } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validation.middleware';
import { MediaReference, IMediaReference } from '../models/MediaReference.model';
import { AgentJournal } from '../models/AgentJournal.model';
import { UserToolRun } from '../models/UserToolRun.model';
import { getMediaStorageService } from '../services/mediaStorage.service';
import { S3StorageStrategy } from '../services/s3Storage.service';
import { GCSStorageStrategy } from '../services/gcsStorage.service';
import { WorkflowMediaExplorerService } from '../services/workflowMediaExplorer.service';
import { resolveCloudAccessForMediaReference } from '../services/cloudMediaAccess.service';
import { resolveMediaReferenceLocalPath } from '../services/mediaLocalPath.service';
import { IUser } from '../models/User.model';
import { 
    CloudStorageConfig, 
    validateCloudConfig,
    CloudStorageError,
    CloudStorageErrorCodes
} from '../types/cloudStorage';

const router = Router();

// ============================================
// CONSTANTES
// ============================================

// Tailles de chunks pour streaming
const DEFAULT_CHUNK_SIZE = 1024 * 1024; // 1MB
const MAX_CHUNK_SIZE = 10 * 1024 * 1024; // 10MB
const workflowMediaExplorerService = new WorkflowMediaExplorerService();

interface DeleteMediaWarning {
    code: 'RUNTIME_OUTPUT_RUN_REFERENCES_RETAINED';
    message: string;
    executionId: string;
}

function asPayloadRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }

    return value as Record<string, unknown>;
}

/**
 * Valide un ObjectId MongoDB
 */
function isValidObjectId(id: string): boolean {
    return mongoose.Types.ObjectId.isValid(id);
}

/**
 * Log sécurisé (masque les données sensibles)
 */
function secureLog(action: string, details: Record<string, unknown>) {
    const safeDetails = { ...details };
    
    // Masquer les chemins complets
    if (typeof safeDetails.path === 'string') {
        safeDetails.path = safeDetails.path.replace(/^.*users\//, 'users/');
    }
    
    console.log(`[MediaRoutes] ${action}:`, safeDetails);
}

async function resolveLegacyDeleteWarnings(mediaRef: IMediaReference): Promise<DeleteMediaWarning[]> {
    if (mediaRef.provenance !== 'runtime_output' || !mediaRef.sourceExecutionId) {
        return [];
    }

    try {
        const runReference = await UserToolRun.findOne({
            ownerUserId: mediaRef.userId,
            executionId: mediaRef.sourceExecutionId,
            ...(mediaRef.localPath ? { 'outputs.artifacts.path': mediaRef.localPath } : {}),
        })
            .select({ _id: 1 })
            .lean();

        if (!runReference) {
            return [];
        }

        return [{
            code: 'RUNTIME_OUTPUT_RUN_REFERENCES_RETAINED',
            message: `L'historique runtime conserve encore une reference legacy vers cet artefact supprime pour l'execution ${mediaRef.sourceExecutionId}.`,
            executionId: mediaRef.sourceExecutionId,
        }];
    } catch (error) {
        console.warn('[MediaRoutes] Legacy runtime warning lookup failed:', error);
        return [];
    }
}

function buildCloudStrategy(config: CloudStorageConfig) {
    switch (config.provider) {
        case 's3':
            return new S3StorageStrategy();
        case 'gcs':
            return new GCSStorageStrategy();
        default:
            throw new Error('Provider cloud non supporté');
    }
}

function resolveCloudErrorStatus(error: CloudStorageError): number {
    switch (error.code) {
        case CloudStorageErrorCodes.SIGNED_URL_FAILED:
        case CloudStorageErrorCodes.DELETE_FAILED:
        case CloudStorageErrorCodes.CONNECTION_FAILED:
            return 502;
        case CloudStorageErrorCodes.INVALID_CONFIG:
        case CloudStorageErrorCodes.NOT_INITIALIZED:
        case CloudStorageErrorCodes.INVALID_CREDENTIALS:
        case CloudStorageErrorCodes.ACCESS_DENIED:
        case CloudStorageErrorCodes.BUCKET_NOT_FOUND:
        case CloudStorageErrorCodes.PROVIDER_NOT_SUPPORTED:
        default:
            return 409;
    }
}

// ============================================
// SCHEMAS VALIDATION
// ============================================

const listMediaQuerySchema = z.object({
    page: z.coerce.number().min(1).default(1),
    limit: z.coerce.number().min(1).max(100).default(20),
    workflowId: z.string().optional(),
    agentInstanceId: z.string().optional(),
    mimeType: z.string().optional()
});

const workflowMediaExplorerQuerySchema = z.object({
    q: z.string().optional(),
    mimeType: z.string().optional(),
    agentName: z.string().optional(),
    includeOrphans: z.coerce.boolean().optional().default(false),
    sortBy: z.enum(['updatedAt', 'createdAt', 'name', 'size']).optional().default('updatedAt'),
    sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
    storageMode: z.enum(['db', 'workspace', 'cloud']).optional(),
});

const workflowMediaExplorerRepairSchema = z.object({
    storageMode: z.enum(['db', 'workspace', 'cloud']).optional(),
});

const testCloudConfigSchema = z.object({
    provider: z.enum(['s3', 'gcs']),
    s3: z.object({
        accessKeyId: z.string().min(1),
        secretAccessKey: z.string().min(1),
        region: z.string().min(1),
        bucketName: z.string().min(1),
        endpoint: z.string().optional(),
        forcePathStyle: z.boolean().optional()
    }).optional(),
    gcs: z.object({
        projectId: z.string().min(1),
        bucketName: z.string().min(1),
        serviceAccountKey: z.string().optional()
    }).optional()
});

// ============================================
// ROUTES
// ============================================

router.get('/workflows/:workflowId/explorer', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = req.user as IUser;
        const { workflowId } = req.params;

        if (!isValidObjectId(workflowId)) {
            return res.status(400).json({ error: 'workflowId invalide' });
        }

        const parseResult = workflowMediaExplorerQuerySchema.safeParse(req.query);
        if (!parseResult.success) {
            return res.status(400).json({
                error: 'Paramètres invalides',
                details: parseResult.error.errors,
            });
        }

        const result = await workflowMediaExplorerService.listWorkflowMedia({
            ownerUserId: user._id.toString(),
            workflowId,
            storageMode: parseResult.data.storageMode,
            search: parseResult.data.q,
            mimeType: parseResult.data.mimeType,
            agentName: parseResult.data.agentName,
            includeOrphans: parseResult.data.includeOrphans,
            sortBy: parseResult.data.sortBy,
            sortOrder: parseResult.data.sortOrder,
        });

        return res.json({
            data: result.items,
            meta: {
                total: result.items.length,
                counts: result.counts,
            },
        });
    } catch (error) {
        console.error('[MediaRoutes] Erreur read model workflow media:', error);
        return res.status(500).json({ error: 'Erreur serveur' });
    }
});

router.post('/workflows/:workflowId/explorer/repair-legacy-catalog', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = req.user as IUser;
        const { workflowId } = req.params;

        if (!isValidObjectId(workflowId)) {
            return res.status(400).json({ error: 'workflowId invalide' });
        }

        const parseResult = workflowMediaExplorerRepairSchema.safeParse(req.body ?? {});
        if (!parseResult.success) {
            return res.status(400).json({
                error: 'Paramètres invalides',
                details: parseResult.error.errors,
            });
        }

        const result = await workflowMediaExplorerService.repairLegacyWorkflowMediaCatalog({
            ownerUserId: user._id.toString(),
            workflowId,
            storageMode: parseResult.data.storageMode,
        });

        if (!result.workflowOwned) {
            return res.status(404).json({ error: 'Workflow introuvable' });
        }

        return res.json({
            success: true,
            meta: result,
        });
    } catch (error) {
        console.error('[MediaRoutes] Erreur maintenance catalogue media legacy:', error);
        return res.status(500).json({ error: 'Erreur serveur' });
    }
});

/**
 * GET /api/media/:mediaId
 * 
 * Récupère un média avec streaming sécurisé.
 * Supporte les Range Requests pour les vidéos.
 * 
 * Headers supportés:
 * - Range: bytes=0-1024 (pour streaming vidéo)
 * - If-None-Match: etag (pour cache)
 * 
 * Réponses:
 * - 200: Fichier complet
 * - 206: Partial Content (range request)
 * - 304: Not Modified (cache hit)
 * - 403: Accès non autorisé
 * - 404: Média non trouvé
 */
router.get('/:mediaId', requireAuth, async (req: Request, res: Response) => {
    try {
        const { mediaId } = req.params;
        const user = req.user as IUser;
        const userId = user._id.toString();
        
        // Validation ID
        if (!isValidObjectId(mediaId)) {
            return res.status(400).json({ 
                error: 'ID média invalide',
                code: 'INVALID_MEDIA_ID'
            });
        }
        
        // Récupérer la référence média
        const mediaRef = await MediaReference.findById(mediaId).lean() as unknown as IMediaReference | null;
        
        if (!mediaRef) {
            return res.status(404).json({ 
                error: 'Média non trouvé',
                code: 'MEDIA_NOT_FOUND'
            });
        }
        
        // ⚠️ SÉCURITÉ: Vérifier que l'utilisateur est propriétaire
        if (mediaRef.userId.toString() !== userId) {
            secureLog('ACCESS_DENIED', { mediaId, requestedBy: userId, ownedBy: mediaRef.userId.toString() });
            return res.status(403).json({ 
                error: 'Accès non autorisé à ce média',
                code: 'FORBIDDEN'
            });
        }
        
        // Route selon le mode de stockage
        switch (mediaRef.storageMode) {
            case 'local':
                return await streamLocalMedia(req, res, mediaRef, userId);
                
            case 'db':
                return await streamDatabaseMedia(req, res, mediaRef);
                
            case 'cloud':
                return await redirectToCloudMedia(req, res, mediaRef, userId);
                
            default:
                return res.status(500).json({ 
                    error: 'Mode de stockage non supporté',
                    code: 'UNSUPPORTED_STORAGE_MODE'
                });
        }
        
    } catch (error) {
        if (error instanceof CloudStorageError) {
            return res.status(resolveCloudErrorStatus(error)).json({
                error: error.message,
                code: error.code,
                provider: error.provider,
            });
        }

        console.error('[MediaRoutes] Erreur récupération média:', error);
        return res.status(500).json({ 
            error: 'Erreur serveur',
            code: 'INTERNAL_ERROR'
        });
    }
});

/**
 * GET /api/media
 * 
 * Liste les médias de l'utilisateur avec pagination.
 * 
 * Query params:
 * - page: numéro de page (défaut: 1)
 * - limit: éléments par page (défaut: 20, max: 100)
 * - workflowId: filtrer par workflow
 * - agentInstanceId: filtrer par agent
 * - mimeType: filtrer par type (préfixe, ex: "image/")
 */
router.get('/', requireAuth, async (req: Request, res: Response) => {
    try {
        const user = req.user as IUser;
        const userId = user._id.toString();
        
        // Validation et parsing des query params
        const parseResult = listMediaQuerySchema.safeParse(req.query);
        if (!parseResult.success) {
            return res.status(400).json({ 
                error: 'Paramètres invalides',
                details: parseResult.error.errors 
            });
        }
        
        const { page, limit, workflowId, agentInstanceId, mimeType } = parseResult.data;
        
        // Validation des IDs si fournis
        if (workflowId && !isValidObjectId(workflowId)) {
            return res.status(400).json({ error: 'workflowId invalide' });
        }
        if (agentInstanceId && !isValidObjectId(agentInstanceId)) {
            return res.status(400).json({ error: 'agentInstanceId invalide' });
        }
        
        // Utiliser la méthode statique du modèle
        const result = await (MediaReference as any).findByUser(userId, {
            workflowId,
            agentInstanceId,
            mimeType,
            page,
            limit
        });
        
        // Formater la réponse (sans exposer les chemins complets)
        const safeData = result.data.map((media: IMediaReference) => ({
            id: media._id,
            fileName: media.fileName,
            originalName: media.originalName,
            mimeType: media.mimeType,
            size: media.size,
            storageMode: media.storageMode,
            workflowId: media.workflowId,
            agentInstanceId: media.agentInstanceId,
            generatedBy: media.generatedBy,
            createdAt: media.createdAt
        }));
        
        return res.json({
            data: safeData,
            meta: {
                page,
                limit,
                total: result.total,
                pages: result.pages
            }
        });
        
    } catch (error) {
        console.error('[MediaRoutes] Erreur listage médias:', error);
        return res.status(500).json({ error: 'Erreur serveur' });
    }
});

/**
 * DELETE /api/media/:mediaId
 * 
 * Supprime un média et son fichier physique.
 * Vérifie la propriété avant suppression.
 */
router.delete('/:mediaId', requireAuth, async (req: Request, res: Response) => {
    try {
        const { mediaId } = req.params;
        const user = req.user as IUser;
        const userId = user._id.toString();
        
        // Validation ID
        if (!isValidObjectId(mediaId)) {
            return res.status(400).json({ error: 'ID média invalide' });
        }
        
        // Récupérer et vérifier propriété
        const mediaRef = await MediaReference.findById(mediaId);
        
        if (!mediaRef) {
            return res.status(404).json({ error: 'Média non trouvé' });
        }
        
        if (mediaRef.userId.toString() !== userId) {
            return res.status(403).json({ error: 'Accès non autorisé' });
        }

        const warnings = await resolveLegacyDeleteWarnings(mediaRef);
        
        // Supprimer le fichier physique selon le mode
        const storageService = getMediaStorageService();
        let fileDeleted = false;
        
        switch (mediaRef.storageMode) {
            case 'local':
                fileDeleted = await deleteLocalMediaByReference(mediaRef, userId, storageService);
                break;
                
            case 'db':
                fileDeleted = await deleteDatabaseMediaByReference(mediaRef);
                if (!fileDeleted) {
                    return res.status(501).json({
                        error: 'Suppression des médias base de données non supportée pour cette référence',
                        code: 'DATABASE_DELETE_NOT_IMPLEMENTED'
                    });
                }
                break;
                
            case 'cloud':
                fileDeleted = await deleteCloudMediaByReference(mediaRef, userId);
                break;
        }
        
        // Supprimer la référence MongoDB
        await MediaReference.findByIdAndDelete(mediaId);
        
        secureLog('DELETE_SUCCESS', {
            mediaId,
            storageMode: mediaRef.storageMode,
            fileDeleted,
            warningCodes: warnings.map((warning) => warning.code),
        });
        
        return res.json({
            success: true,
            message: 'Média supprimé',
            fileDeleted,
            warnings,
        });
        
    } catch (error) {
        if (error instanceof CloudStorageError) {
            return res.status(resolveCloudErrorStatus(error)).json({
                error: error.message,
                code: error.code,
                provider: error.provider,
            });
        }

        console.error('[MediaRoutes] Erreur suppression média:', error);
        return res.status(500).json({ error: 'Erreur serveur' });
    }
});

/**
 * POST /api/media/test-cloud
 * 
 * Teste la connexion et les permissions cloud.
 * Utilisé pour valider la configuration avant sauvegarde.
 */
router.post('/test-cloud', requireAuth, async (req: Request, res: Response) => {
    try {
        // Validation du body
        const parseResult = testCloudConfigSchema.safeParse(req.body);
        if (!parseResult.success) {
            return res.status(400).json({
                error: 'Configuration invalide',
                details: parseResult.error.errors
            });
        }
        
        const config = parseResult.data as CloudStorageConfig;
        
        // Valider la cohérence de la config
        const validation = validateCloudConfig(config);
        if (!validation.valid) {
            return res.status(400).json({
                error: 'Configuration incomplète',
                details: validation.errors
            });
        }

        const strategy = buildCloudStrategy(config);
        await strategy.initialize(config);
        const result = await strategy.testConnection();

        return res.json(result);
        
    } catch (error) {
        console.error('[MediaRoutes] Erreur test cloud:', error);
        
        if (error instanceof CloudStorageError) {
            return res.status(400).json({
                error: error.message,
                code: error.code,
                provider: error.provider
            });
        }
        
        return res.status(500).json({ error: 'Erreur serveur' });
    }
});

// ============================================
// HANDLERS DE STREAMING
// ============================================

/**
 * Stream un fichier local avec support Range Requests
 */
async function streamLocalMedia(
    req: Request, 
    res: Response, 
    mediaRef: IMediaReference,
    userId: string
): Promise<Response | void> {
    const absolutePath = await resolveLocalMediaAbsolutePath(mediaRef, userId);
    if (!absolutePath) {
        return res.status(403).json({ 
            error: 'Chemin de fichier invalide',
            code: 'INVALID_PATH'
        });
    }
    
    // Vérifier existence
    if (!existsSync(absolutePath)) {
        console.warn(`[MediaRoutes] Fichier manquant: ${mediaRef.localPath}`);
        return res.status(404).json({ 
            error: 'Fichier non trouvé sur le disque',
            code: 'FILE_MISSING'
        });
    }
    
    // Récupérer les stats
    const stats = statSync(absolutePath);
    const fileSize = stats.size;
    
    // Headers communs
    res.setHeader('Content-Type', mediaRef.mimeType);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=86400'); // 24h cache
    
    // ETag pour cache
    if (mediaRef.checksum) {
        res.setHeader('ETag', `"${mediaRef.checksum}"`);
        
        // Vérifier If-None-Match
        const ifNoneMatch = req.get('If-None-Match');
        if (ifNoneMatch === `"${mediaRef.checksum}"`) {
            return res.status(304).end();
        }
    }
    
    // Content-Disposition pour téléchargement
    const disposition = req.query.download === 'true' ? 'attachment' : 'inline';
    res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(mediaRef.originalName)}"`);
    
    // Gestion Range Request (pour vidéos)
    const range = req.headers.range;
    
    if (range && mediaRef.mimeType.startsWith('video/')) {
        // Parse la plage demandée
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : Math.min(start + DEFAULT_CHUNK_SIZE, fileSize - 1);
        
        // Validation des bornes
        if (start >= fileSize || end >= fileSize || start > end) {
            res.setHeader('Content-Range', `bytes */${fileSize}`);
            return res.status(416).json({ error: 'Range non satisfiable' });
        }
        
        const chunkSize = end - start + 1;
        
        // Headers 206 Partial Content
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
        res.setHeader('Content-Length', chunkSize);
        
        // Stream le chunk
        const stream = createReadStream(absolutePath, { start, end });
        stream.on('error', (err) => {
            console.error('[MediaRoutes] Erreur stream:', err);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Erreur lecture fichier' });
            }
        });
        
        stream.pipe(res);
        
    } else {
        // Réponse complète (200)
        res.setHeader('Content-Length', fileSize);
        
        const stream = createReadStream(absolutePath);
        stream.on('error', (err) => {
            console.error('[MediaRoutes] Erreur stream:', err);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Erreur lecture fichier' });
            }
        });
        
        stream.pipe(res);
    }
}

/**
 * Stream un média stocké en base (GridFS ou inline)
 */
async function streamDatabaseMedia(
    req: Request,
    res: Response,
    mediaRef: IMediaReference
): Promise<Response | void> {
    const journalEntryId = resolveJournalEntryId(mediaRef);
    if (!journalEntryId) {
        return res.status(501).json({
            error: 'Récupération GridFS non implémentée',
            code: 'NOT_IMPLEMENTED',
            hint: 'Aucune référence journal:// associée au média base'
        });
    }

    const journalEntry = await AgentJournal.findOne({
        _id: journalEntryId,
        type: 'media'
    }).select('payload');

    if (!journalEntry) {
        return res.status(404).json({
            error: 'Entrée journal media introuvable',
            code: 'JOURNAL_MEDIA_NOT_FOUND'
        });
    }

    const payload = asPayloadRecord(journalEntry.get('payload'));
    const inlineBuffer = normalizeInlineMediaBuffer(payload?.data);
    if (!payload || payload.storageMode !== 'database' || !inlineBuffer) {
        return res.status(404).json({
            error: 'Payload media inline introuvable',
            code: 'INLINE_MEDIA_MISSING'
        });
    }

    res.setHeader('Content-Type', mediaRef.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('Accept-Ranges', 'bytes');

    if (mediaRef.checksum) {
        res.setHeader('ETag', `"${mediaRef.checksum}"`);

        const ifNoneMatch = req.get('If-None-Match');
        if (ifNoneMatch === `"${mediaRef.checksum}"`) {
            return res.status(304).end();
        }
    }

    const disposition = req.query.download === 'true' ? 'attachment' : 'inline';
    res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(mediaRef.originalName)}"`);

    const range = req.headers.range;
    const fileSize = inlineBuffer.length;
    if (range && mediaRef.mimeType.startsWith('video/')) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : Math.min(start + DEFAULT_CHUNK_SIZE, fileSize - 1);

        if (start >= fileSize || end >= fileSize || start > end) {
            res.setHeader('Content-Range', `bytes */${fileSize}`);
            return res.status(416).json({ error: 'Range non satisfiable' });
        }

        const chunk = inlineBuffer.subarray(start, end + 1);
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
        res.setHeader('Content-Length', chunk.length);
        return res.end(chunk);
    }

    res.setHeader('Content-Length', fileSize);
    return res.end(inlineBuffer);
}

/**
 * Redirige vers une URL signée cloud
 */
async function redirectToCloudMedia(
    req: Request,
    res: Response,
    mediaRef: IMediaReference,
    userId: string
): Promise<Response | void> {
    if (!mediaRef.cloudKey) {
        throw new CloudStorageError(
            'Le media cloud ne reference aucune cle de stockage.',
            CloudStorageErrorCodes.INVALID_CONFIG,
            mediaRef.cloudProvider,
        );
    }

    const { strategy } = await resolveCloudAccessForMediaReference(mediaRef, userId);
    const disposition = req.query.download === 'true' ? 'attachment' : 'inline';
    const signedUrl = await strategy.getSignedUrl(mediaRef.cloudKey, {
        action: 'read',
        responseContentDisposition: `${disposition}; filename="${encodeURIComponent(mediaRef.originalName)}"`,
    });

    return res.redirect(302, signedUrl);
}

async function resolveLocalMediaAbsolutePath(mediaRef: IMediaReference, userId: string): Promise<string | null> {
    return resolveMediaReferenceLocalPath(mediaRef, userId)?.absolutePath ?? null;
}

async function deleteLocalMediaByReference(
    mediaRef: IMediaReference,
    userId: string,
    storageService: ReturnType<typeof getMediaStorageService>,
): Promise<boolean> {
    const resolvedPath = resolveMediaReferenceLocalPath(mediaRef, userId);
    if (!resolvedPath) {
        return false;
    }

    if (resolvedPath.storageZone === 'legacy') {
        return storageService.deleteLocalMedia(resolvedPath.normalizedPath);
    }

    try {
        await unlink(resolvedPath.absolutePath);
        return true;
    } catch (error) {
        console.warn(`[MediaRoutes] Échec suppression ${resolvedPath.normalizedPath}:`, error);
        return false;
    }
}

async function deleteCloudMediaByReference(
    mediaRef: IMediaReference,
    userId: string,
): Promise<boolean> {
    if (!mediaRef.cloudKey) {
        throw new CloudStorageError(
            'Le media cloud ne reference aucune cle de stockage.',
            CloudStorageErrorCodes.INVALID_CONFIG,
            mediaRef.cloudProvider,
        );
    }

    const { strategy } = await resolveCloudAccessForMediaReference(mediaRef, userId);
    const deleted = await strategy.delete(mediaRef.cloudKey);

    if (!deleted) {
        throw new CloudStorageError(
            'La suppression physique du media cloud a echoue.',
            CloudStorageErrorCodes.DELETE_FAILED,
            mediaRef.cloudProvider,
            {
                cloudKey: mediaRef.cloudKey,
                mediaId: mediaRef._id.toString(),
            },
        );
    }

    return true;
}

function resolveJournalEntryId(mediaRef: IMediaReference): string | null {
    if (mediaRef.journalEntryId) {
        return mediaRef.journalEntryId.toString();
    }

    if (typeof mediaRef.canonicalLocator === 'string' && mediaRef.canonicalLocator.startsWith('journal://')) {
        return mediaRef.canonicalLocator.slice('journal://'.length) || null;
    }

    return null;
}

function normalizeInlineMediaBuffer(value: unknown): Buffer | null {
    if (Buffer.isBuffer(value)) {
        return value;
    }

    if (value instanceof Uint8Array) {
        return Buffer.from(value);
    }

    if (typeof value === 'object' && value !== null) {
        const maybeNodeBuffer = value as { type?: string; data?: number[] };
        if (maybeNodeBuffer.type === 'Buffer' && Array.isArray(maybeNodeBuffer.data)) {
            return Buffer.from(maybeNodeBuffer.data);
        }

        if ('buffer' in (value as Record<string, unknown>)) {
            const binaryLike = value as { buffer?: ArrayBufferLike };
            if (binaryLike.buffer) {
                return Buffer.from(binaryLike.buffer);
            }
        }
    }

    return null;
}

async function deleteDatabaseMediaByReference(mediaRef: IMediaReference): Promise<boolean> {
    const journalEntryId = resolveJournalEntryId(mediaRef);
    if (!journalEntryId) {
        return false;
    }

    const result = await AgentJournal.deleteOne({
        _id: journalEntryId,
        type: 'media'
    });

    return result.deletedCount > 0;
}

// ============================================
// EXPORT
// ============================================

export default router;
