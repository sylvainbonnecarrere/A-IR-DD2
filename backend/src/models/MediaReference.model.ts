/**
 * @fileoverview Modèle MediaReference - Index des médias stockés
 * 
 * Ce modèle sert de référence centralisée pour tous les fichiers médias
 * stockés par les agents, quel que soit le mode de stockage (db, local, cloud).
 * 
 * Sécurité:
 * - Chaque média est lié à un userId pour contrôle d'accès
 * - Les chemins locaux sont validés pour éviter le path-traversal
 * - Les credentials cloud sont référencés mais jamais stockés ici
 * 
 * @see backend/src/services/mediaStorage.service.ts
 * @see backend/src/routes/media.routes.ts
 */

import mongoose, { Document, Schema, Types } from 'mongoose';

// ============================================
// TYPES
// ============================================

export type MediaStorageMode = 'db' | 'local' | 'cloud';
export type ProductMediaStorageMode = 'db' | 'workspace' | 'cloud';
export type CloudProvider = 's3' | 'gcs';
export type MediaOrphanReason = 'agent_deleted' | 'workflow_deleted' | 'source_missing' | 'manual_detach' | 'unknown';
export type MediaProvenance = 'user' | 'agent' | 'function' | 'import' | 'runtime_output';

function derivePrimaryStorageMode(storageMode: MediaStorageMode): ProductMediaStorageMode {
    switch (storageMode) {
        case 'local':
            return 'workspace';
        case 'cloud':
            return 'cloud';
        case 'db':
        default:
            return 'db';
    }
}

function buildCanonicalLocator(source: {
    storageMode: MediaStorageMode;
    localPath?: string;
    gridfsId?: Types.ObjectId;
    journalEntryId?: Types.ObjectId;
    cloudKey?: string;
    cloudProvider?: CloudProvider;
    cloudBucket?: string;
}): string | undefined {
    switch (source.storageMode) {
        case 'local':
            return source.localPath ? `workspace://${source.localPath}` : undefined;
        case 'db':
            if (source.gridfsId) {
                return `gridfs://${source.gridfsId.toString()}`;
            }

            return source.journalEntryId ? `journal://${source.journalEntryId.toString()}` : undefined;
        case 'cloud':
            if (!source.cloudKey) {
                return undefined;
            }

            if (source.cloudProvider && source.cloudBucket) {
                return `${source.cloudProvider}://${source.cloudBucket}/${source.cloudKey}`;
            }

            return `cloud://${source.cloudKey}`;
        default:
            return undefined;
    }
}

/**
 * Interface du document MediaReference
 */
export interface IMediaReference extends Document {
    _id: Types.ObjectId;
    
    // Propriétaire et contexte
    userId: Types.ObjectId;
    workflowId: Types.ObjectId;
    agentInstanceId: Types.ObjectId;
    journalEntryId?: Types.ObjectId;
    
    // Mode de stockage
    storageMode: MediaStorageMode;
    primaryStorageMode: ProductMediaStorageMode;
    canonicalLocator: string;
    
    // Références selon le mode (mutuellement exclusives)
    localPath?: string;             // Mode 'local': chemin relatif users/{userId}/...
    gridfsId?: Types.ObjectId;      // Mode 'db': ID du fichier GridFS
    cloudKey?: string;              // Mode 'cloud': clé S3/GCS
    cloudProvider?: CloudProvider;  // Mode 'cloud': provider utilisé
    cloudBucket?: string;           // Mode 'cloud': nom du bucket
    cloudConnectionProfileId?: string;
    
    // Métadonnées fichier
    fileName: string;               // Nom unique généré
    originalName: string;           // Nom original du fichier
    mimeType: string;               // Type MIME
    size: number;                   // Taille en bytes
    checksum?: string;              // SHA-256 pour vérification intégrité
    
    // Métadonnées génération
    generatedBy?: string;           // ID/nom de l'agent générateur
    prompt?: string;                // Prompt utilisé pour la génération
    modelUsed?: string;             // Modèle LLM utilisé
    provenance?: MediaProvenance;
    sourceExecutionId?: string;

    // Métadonnées DDD additives
    createdByAgentInstanceId?: Types.ObjectId;
    createdByAgentName?: string;
    lastModifiedByAgentInstanceId?: Types.ObjectId;
    lastModifiedByAgentName?: string;
    isOrphan: boolean;
    orphanedAt?: Date;
    orphanReason?: MediaOrphanReason;
    
    // Timestamps
    createdAt: Date;
    updatedAt: Date;
}

/**
 * Interface pour création (sans les champs auto-générés)
 */
export interface IMediaReferenceCreate {
    userId: Types.ObjectId | string;
    workflowId: Types.ObjectId | string;
    agentInstanceId: Types.ObjectId | string;
    journalEntryId?: Types.ObjectId | string;
    
    storageMode: MediaStorageMode;
    primaryStorageMode?: ProductMediaStorageMode;
    canonicalLocator?: string;
    
    localPath?: string;
    gridfsId?: Types.ObjectId | string;
    cloudKey?: string;
    cloudProvider?: CloudProvider;
    cloudBucket?: string;
    cloudConnectionProfileId?: string;
    
    fileName: string;
    originalName: string;
    mimeType: string;
    size: number;
    checksum?: string;
    
    generatedBy?: string;
    prompt?: string;
    modelUsed?: string;
    provenance?: MediaProvenance;
    sourceExecutionId?: string;
    createdByAgentInstanceId?: Types.ObjectId | string;
    createdByAgentName?: string;
    lastModifiedByAgentInstanceId?: Types.ObjectId | string;
    lastModifiedByAgentName?: string;
    isOrphan?: boolean;
    orphanedAt?: Date | string;
    orphanReason?: MediaOrphanReason;
}

// ============================================
// SCHEMA
// ============================================

const MediaReferenceSchema = new Schema<IMediaReference>({
    // Propriétaire et contexte
    userId: { 
        type: Schema.Types.ObjectId, 
        ref: 'User',
        required: true, 
        index: true 
    },
    workflowId: { 
        type: Schema.Types.ObjectId, 
        ref: 'Workflow',
        required: true, 
        index: true 
    },
    agentInstanceId: { 
        type: Schema.Types.ObjectId, 
        ref: 'AgentInstance',
        required: true, 
        index: true 
    },
    journalEntryId: { 
        type: Schema.Types.ObjectId,
        ref: 'AgentJournal',
        required: false
    },
    
    // Mode de stockage
    storageMode: { 
        type: String, 
        enum: ['db', 'local', 'cloud'], 
        required: true,
        index: true
    },
    primaryStorageMode: {
        type: String,
        enum: ['db', 'workspace', 'cloud'],
        required: true,
        index: true,
        default: undefined,
    },
    canonicalLocator: {
        type: String,
        required: true,
        trim: true,
    },
    
    // Références stockage
    localPath: { 
        type: String,
        required: false
    },
    gridfsId: { 
        type: Schema.Types.ObjectId,
        required: false
    },
    cloudKey: { 
        type: String,
        required: false
    },
    cloudProvider: { 
        type: String, 
        enum: ['s3', 'gcs'],
        required: false
    },
    cloudBucket: {
        type: String,
        required: false
    },
    cloudConnectionProfileId: {
        type: String,
        required: false,
        trim: true,
    },
    
    // Métadonnées fichier
    fileName: { 
        type: String, 
        required: true 
    },
    originalName: { 
        type: String, 
        required: true 
    },
    mimeType: { 
        type: String, 
        required: true,
        index: true
    },
    size: { 
        type: Number, 
        required: true 
    },
    checksum: { 
        type: String,
        required: false
    },
    
    // Métadonnées génération
    generatedBy: { 
        type: String,
        required: false
    },
    prompt: { 
        type: String,
        required: false
    },
    modelUsed: {
        type: String,
        required: false
    },
    provenance: {
        type: String,
        enum: ['user', 'agent', 'function', 'import', 'runtime_output'],
        required: false,
        index: true,
    },
    sourceExecutionId: {
        type: String,
        required: false,
        trim: true,
    },

    createdByAgentInstanceId: {
        type: Schema.Types.ObjectId,
        ref: 'AgentInstance',
        required: false,
    },
    createdByAgentName: {
        type: String,
        required: false,
        trim: true,
    },
    lastModifiedByAgentInstanceId: {
        type: Schema.Types.ObjectId,
        ref: 'AgentInstance',
        required: false,
    },
    lastModifiedByAgentName: {
        type: String,
        required: false,
        trim: true,
    },
    isOrphan: {
        type: Boolean,
        required: true,
        default: false,
        index: true,
    },
    orphanedAt: {
        type: Date,
        required: false,
    },
    orphanReason: {
        type: String,
        enum: ['agent_deleted', 'workflow_deleted', 'source_missing', 'manual_detach', 'unknown'],
        required: false,
    }
}, { 
    timestamps: true,
    collection: 'media_references'
});

// ============================================
// INDEX
// ============================================

// Index composés pour requêtes fréquentes
MediaReferenceSchema.index({ userId: 1, workflowId: 1 });
MediaReferenceSchema.index({ userId: 1, createdAt: -1 });
MediaReferenceSchema.index({ agentInstanceId: 1, createdAt: -1 });
MediaReferenceSchema.index({ workflowId: 1, storageMode: 1 });
MediaReferenceSchema.index({ workflowId: 1, primaryStorageMode: 1, isOrphan: 1, updatedAt: -1 });
MediaReferenceSchema.index({ workflowId: 1, createdByAgentInstanceId: 1, updatedAt: -1 });

// Index pour nettoyage/maintenance
MediaReferenceSchema.index({ storageMode: 1, createdAt: 1 });

// ============================================
// VALIDATIONS
// ============================================

// Validation: Au moins une référence doit être présente selon le mode
MediaReferenceSchema.pre('save', function(next) {
    const doc = this as IMediaReference;

    if (!doc.primaryStorageMode) {
        doc.primaryStorageMode = derivePrimaryStorageMode(doc.storageMode);
    }

    if (!doc.canonicalLocator) {
        const canonicalLocator = buildCanonicalLocator(doc);
        if (canonicalLocator) {
            doc.canonicalLocator = canonicalLocator;
        }
    }

    if (doc.isOrphan) {
        if (!doc.orphanedAt) {
            doc.orphanedAt = new Date();
        }
        if (!doc.orphanReason) {
            doc.orphanReason = 'unknown';
        }
    } else {
        doc.orphanedAt = undefined;
        doc.orphanReason = undefined;
    }

    if (!doc.lastModifiedByAgentInstanceId && doc.createdByAgentInstanceId) {
        doc.lastModifiedByAgentInstanceId = doc.createdByAgentInstanceId;
    }

    if (!doc.lastModifiedByAgentName && doc.createdByAgentName) {
        doc.lastModifiedByAgentName = doc.createdByAgentName;
    }
    
    switch (doc.storageMode) {
        case 'local':
            if (!doc.localPath) {
                return next(new Error('localPath requis pour mode "local"'));
            }
            // Validation anti path-traversal
            if (doc.localPath.includes('..') || doc.localPath.startsWith('/')) {
                return next(new Error('Chemin local invalide (path-traversal détecté)'));
            }
            break;
            
        case 'db':
            if (!doc.gridfsId && !doc.journalEntryId) {
                return next(new Error('gridfsId ou journalEntryId requis pour mode "db"'));
            }
            break;
            
        case 'cloud':
            if (!doc.cloudKey || !doc.cloudProvider) {
                return next(new Error('cloudKey et cloudProvider requis pour mode "cloud"'));
            }
            break;
    }

    if (!doc.canonicalLocator) {
        return next(new Error('canonicalLocator requis pour tout media reference'));
    }
    
    next();
});

// ============================================
// MÉTHODES STATIQUES
// ============================================

/**
 * Trouver les médias d'un utilisateur avec pagination
 */
MediaReferenceSchema.statics.findByUser = async function(
    userId: string,
    options: {
        workflowId?: string;
        agentInstanceId?: string;
        mimeType?: string;
        page?: number;
        limit?: number;
    } = {}
): Promise<{ data: IMediaReference[]; total: number; pages: number }> {
    const { page = 1, limit = 20, ...filters } = options;
    
    const query: Record<string, unknown> = { userId: new Types.ObjectId(userId) };
    
    if (filters.workflowId) {
        query.workflowId = new Types.ObjectId(filters.workflowId);
    }
    if (filters.agentInstanceId) {
        query.agentInstanceId = new Types.ObjectId(filters.agentInstanceId);
    }
    if (filters.mimeType) {
        query.mimeType = { $regex: new RegExp(`^${filters.mimeType}`) };
    }
    
    const total = await this.countDocuments(query);
    const pages = Math.ceil(total / limit);
    
    const data = await this.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean();
    
    return { data, total, pages };
};

/**
 * Supprimer tous les médias d'un workflow
 */
MediaReferenceSchema.statics.deleteByWorkflow = async function(
    userId: string,
    workflowId: string
): Promise<{ deletedCount: number; references: IMediaReference[] }> {
    // Récupérer les références avant suppression (pour nettoyage fichiers)
    const references = await this.find({
        userId: new Types.ObjectId(userId),
        workflowId: new Types.ObjectId(workflowId)
    }).lean();
    
    const result = await this.deleteMany({
        userId: new Types.ObjectId(userId),
        workflowId: new Types.ObjectId(workflowId)
    });
    
    return { 
        deletedCount: result.deletedCount || 0, 
        references 
    };
};

/**
 * Supprimer tous les médias d'un agent
 */
MediaReferenceSchema.statics.deleteByAgent = async function(
    userId: string,
    agentInstanceId: string
): Promise<{ deletedCount: number; references: IMediaReference[] }> {
    const references = await this.find({
        userId: new Types.ObjectId(userId),
        agentInstanceId: new Types.ObjectId(agentInstanceId)
    }).lean();
    
    const result = await this.deleteMany({
        userId: new Types.ObjectId(userId),
        agentInstanceId: new Types.ObjectId(agentInstanceId)
    });
    
    return { 
        deletedCount: result.deletedCount || 0, 
        references 
    };
};

// ============================================
// EXPORT
// ============================================

// Extension de l'interface pour les méthodes statiques
interface IMediaReferenceModel extends mongoose.Model<IMediaReference> {
    findByUser(
        userId: string,
        options?: {
            workflowId?: string;
            agentInstanceId?: string;
            mimeType?: string;
            page?: number;
            limit?: number;
        }
    ): Promise<{ data: IMediaReference[]; total: number; pages: number }>;
    
    deleteByWorkflow(
        userId: string,
        workflowId: string
    ): Promise<{ deletedCount: number; references: IMediaReference[] }>;
    
    deleteByAgent(
        userId: string,
        agentInstanceId: string
    ): Promise<{ deletedCount: number; references: IMediaReference[] }>;
}

export const MediaReference = mongoose.model<IMediaReference, IMediaReferenceModel>(
    'MediaReference', 
    MediaReferenceSchema
);
