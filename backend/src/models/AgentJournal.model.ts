/**
 * @fileoverview Modèle AgentJournal - Stockage de l'historique/événements
 * 
 * Collection dédiée aux données "lourdes" des agents :
 * - Messages de chat (user/agent/tool)
 * - Erreurs et exceptions
 * - Médias générés (images, audio, vidéos)
 * - Tâches d'exécution et raisonnement
 * - Événements système
 * 
 * Pattern polymorphique : le champ 'payload' varie selon 'type'.
 * 
 * Index optimisé pour :
 * - Récupération paginée par agentInstanceId + timestamp ASC (chronologique)
 * - Filtrage par type (chat, error, media, etc.)
 * - Nettoyage en cascade par workflowId
 * 
 * @see backend/src/types/persistence.ts
 * @see Guides/WIP/PLAN_CORRECTIF_PERSISTANCE_WORKFLOW.md
 */

import mongoose, { Document, Schema, Model } from 'mongoose';
import {
    JournalEntryType,
    JournalSeverity,
    ChatJournalPayload,
    ErrorJournalPayload,
    MediaJournalPayload,
    TaskJournalPayload,
    SystemJournalPayload,
    ToolInvocationJournalPayload
} from '../types/persistence';

// ============================================
// INTERFACE DOCUMENT
// ============================================

export interface IAgentJournal extends Document {
    // Relations
    agentInstanceId: mongoose.Types.ObjectId;
    workflowId: mongoose.Types.ObjectId;
    
    // Classification
    type: JournalEntryType;
    severity: JournalSeverity;
    
    // Timestamp
    timestamp: Date;
    
    // Contenu polymorphe
    payload: ChatJournalPayload | ErrorJournalPayload | MediaJournalPayload | 
             TaskJournalPayload | SystemJournalPayload | ToolInvocationJournalPayload;
    
    // Groupement optionnel
    sessionId?: string;

    // ⭐ ÉTAPE 2: Déduplication safeguard
    // Hash unique pour détecter les doublons au niveau base de données
    _deduplicationKey?: string;
    
    // ⭐ ÉTAPE 2: Création timestamp avec défaut
    _createdAt: Date;
}

// ============================================
// SOUS-SCHÉMAS POUR PAYLOADS
// ============================================

/**
 * Schéma pour les messages de chat
 * ⭐ FIX QA: Added imageBase64, mimeType, fileName for media in chat messages
 */
const ChatPayloadSchema = new Schema({
    role: {
        type: String,
        enum: ['user', 'agent', 'tool', 'tool_result'],
        required: true
    },
    content: { type: String, required: true },
    llmProvider: { type: String },
    modelUsed: { type: String },
    tokensUsed: { type: Number },
    toolCalls: [{
        id: { type: String },
        name: { type: String },
        arguments: { type: String }
    }],
    // ⭐ FIX QA: Support images inline dans les messages chat
    imageBase64: { type: String },  // Image data en base64 
    fileContent: { type: String },  // Contenu texte de fichier importé
    mimeType: { type: String },     // ex: image/png, image/jpeg
    fileName: { type: String }      // Nom original du fichier
}, { _id: false });

/**
 * Schéma pour les erreurs
 */
const ErrorPayloadSchema = new Schema({
    errorCode: { type: String, required: true },
    message: { type: String, required: true },
    source: {
        type: String,
        enum: ['llm_service', 'tool_executor', 'frontend', 'system'],
        required: true
    },
    retryable: { type: Boolean, default: false },
    attempts: { type: Number, default: 1 },
    stack: { type: String }
}, { _id: false });

/**
 * Schéma pour les médias
 */
const MediaPayloadSchema = new Schema({
    mimeType: { type: String, required: true },
    fileName: { type: String, required: true },
    size: { type: Number, required: true },
    storageMode: {
        type: String,
        enum: ['database', 'local', 'cloud'],
        required: true
    },
    data: { type: Buffer },           // Mode database
    path: { type: String },           // Mode local
    url: { type: String },            // Mode cloud
    checksum: { type: String },
    thumbnailPath: { type: String },
    generationPrompt: { type: String },
    generationModel: { type: String },
    generationTime: { type: Number },
    metadata: { type: Schema.Types.Mixed }
}, { _id: false });

/**
 * Schéma pour les tâches
 */
const TaskPayloadSchema = new Schema({
    taskName: { type: String, required: true },
    taskStatus: {
        type: String,
        enum: ['started', 'progress', 'completed', 'failed'],
        required: true
    },
    reasoning: { type: String },
    stepNumber: { type: Number },
    totalSteps: { type: Number },
    duration: { type: Number }
}, { _id: false });

/**
 * Schéma pour les événements système
 */
const SystemPayloadSchema = new Schema({
    event: {
        type: String,
        enum: [
            'instance_created', 'instance_started', 'instance_paused',
            'instance_resumed', 'instance_stopped', 'config_changed',
            'persistence_config_updated'
        ],
        required: true
    },
    details: { type: Schema.Types.Mixed },
    triggeredBy: { type: String }
}, { _id: false });

// ============================================
// SCHÉMA PRINCIPAL
// ============================================

const AgentJournalSchema = new Schema<IAgentJournal>({
    // Relations
    agentInstanceId: {
        type: Schema.Types.ObjectId,
        ref: 'AgentInstance',
        required: true
    },
    workflowId: {
        type: Schema.Types.ObjectId,
        ref: 'Workflow',
        required: true
    },
    
    // Classification
    type: {
        type: String,
        enum: ['chat', 'error', 'media', 'task', 'system', 'tool_invocation'] as JournalEntryType[],
        required: true
    },
    severity: {
        type: String,
        enum: ['info', 'warn', 'error'] as JournalSeverity[],
        default: 'info'
    },
    
    // Timestamp
    timestamp: {
        type: Date,
        default: Date.now
    },
    
    // Contenu polymorphe - Mixed pour flexibilité
    // La validation se fait au niveau applicatif
    payload: {
        type: Schema.Types.Mixed,
        required: true
    },
    
    // Groupement
    sessionId: {
        type: String
    },

    // ⭐ ÉTAPE 2: Déduplication safeguard
    // Hash unique: hash(agentInstanceId + timestamp + payload.substring(0,100))
    // Utilisé pour détecter les doublons au niveau base de données
    _deduplicationKey: {
        type: String,
        sparse: true,
        // Note: index UNIQUE créé séparément
    },

    // ⭐ ÉTAPE 2: Création timestamp avec défaut
    // Piste d'audit pour tracer quand l'entrée a été créée
    _createdAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: false, // On utilise notre propre timestamp
    collection: 'agent_journals',
    
    // Optimisations
    minimize: false,
    strict: false // Permettre les payloads flexibles
});

// ============================================
// INDEX COMPOSÉS CRITIQUES
// ============================================

/**
 * Index principal pour récupération de l'historique (ordre chronologique)
 * Requête type: db.agent_journals.find({ agentInstanceId: X }).sort({ timestamp: 1 })
 * ⭐ FIX: Tri en ordre croissant (ancien → récent) pour hydratation correcte des conversations
 */
AgentJournalSchema.index(
    { agentInstanceId: 1, timestamp: 1 },
    { name: 'idx_instance_timeline' }
);

/**
 * Index pour filtrage par type + instance
 * Requête type: récupérer seulement les messages chat d'un agent
 */
AgentJournalSchema.index(
    { agentInstanceId: 1, type: 1, timestamp: -1 },
    { name: 'idx_instance_type_timeline' }
);

/**
 * Index pour nettoyage en cascade par workflow
 * Requête type: supprimer tous les journaux d'un workflow
 */
AgentJournalSchema.index(
    { workflowId: 1 },
    { name: 'idx_workflow_cleanup' }
);

/**
 * Index pour filtrage par sévérité (monitoring erreurs)
 */
AgentJournalSchema.index(
    { severity: 1, timestamp: -1 },
    { name: 'idx_severity_timeline', sparse: true }
);

/**
 * Index pour les sessions
 */
AgentJournalSchema.index(
    { sessionId: 1, timestamp: 1 },
    { name: 'idx_session', sparse: true }
);

/**
 * ⭐ ÉTAPE 2: Index UNIQUE et SPARSE pour déduplication
 * Prévient les doublons au niveau base de données
 * SPARSE car certaines entrées (non-chat) n'auront pas de dedup key
 */
AgentJournalSchema.index(
    { _deduplicationKey: 1 },
    { name: 'idx_deduplicationKey_unique', unique: true, sparse: true }
);

// ============================================
// MÉTHODES STATIQUES
// ============================================

interface IAgentJournalModel extends Model<IAgentJournal> {
    findByInstance(
        agentInstanceId: string | mongoose.Types.ObjectId,
        options?: {
            type?: JournalEntryType;
            severity?: JournalSeverity;
            page?: number;
            limit?: number;
            startDate?: Date;
            endDate?: Date;
        }
    ): Promise<{ data: IAgentJournal[]; total: number; pages: number }>;
    
    deleteByInstance(agentInstanceId: string | mongoose.Types.ObjectId): Promise<number>;
    deleteByWorkflow(workflowId: string | mongoose.Types.ObjectId): Promise<number>;
    
    createChatEntry(
        agentInstanceId: string | mongoose.Types.ObjectId,
        workflowId: string | mongoose.Types.ObjectId,
        payload: ChatJournalPayload,
        sessionId?: string
    ): Promise<IAgentJournal>;
    
    createErrorEntry(
        agentInstanceId: string | mongoose.Types.ObjectId,
        workflowId: string | mongoose.Types.ObjectId,
        payload: ErrorJournalPayload
    ): Promise<IAgentJournal>;
    
    createMediaEntry(
        agentInstanceId: string | mongoose.Types.ObjectId,
        workflowId: string | mongoose.Types.ObjectId,
        payload: MediaJournalPayload
    ): Promise<IAgentJournal>;
}

/**
 * Récupérer les journaux d'une instance avec pagination et filtres
 */
AgentJournalSchema.statics.findByInstance = async function(
    agentInstanceId: string | mongoose.Types.ObjectId,
    options: {
        type?: JournalEntryType;
        severity?: JournalSeverity;
        page?: number;
        limit?: number;
        startDate?: Date;
        endDate?: Date;
    } = {}
): Promise<{ data: IAgentJournal[]; total: number; pages: number }> {
    const { type, severity, page = 1, limit = 50, startDate, endDate } = options;
    
    // Construction du filtre
    const filter: Record<string, unknown> = { agentInstanceId };
    
    if (type) {
        filter.type = type;
    }
    if (severity) {
        filter.severity = severity;
    }
    if (startDate || endDate) {
        filter.timestamp = {};
        if (startDate) (filter.timestamp as Record<string, Date>).$gte = startDate;
        if (endDate) (filter.timestamp as Record<string, Date>).$lte = endDate;
    }
    
    // Exécution parallèle count + find
    const [total, data] = await Promise.all([
        this.countDocuments(filter),
        this.find(filter)
            .sort({ timestamp: 1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .exec()
    ]);
    
    return {
        data,
        total,
        pages: Math.ceil(total / limit)
    };
};

/**
 * Supprimer tous les journaux d'une instance
 */
AgentJournalSchema.statics.deleteByInstance = async function(
    agentInstanceId: string | mongoose.Types.ObjectId
): Promise<number> {
    const result = await this.deleteMany({ agentInstanceId });
    return result.deletedCount || 0;
};

/**
 * Supprimer tous les journaux d'un workflow (nettoyage cascade)
 */
AgentJournalSchema.statics.deleteByWorkflow = async function(
    workflowId: string | mongoose.Types.ObjectId
): Promise<number> {
    const result = await this.deleteMany({ workflowId });
    return result.deletedCount || 0;
};

/**
 * Créer une entrée de chat
 */
AgentJournalSchema.statics.createChatEntry = async function(
    agentInstanceId: string | mongoose.Types.ObjectId,
    workflowId: string | mongoose.Types.ObjectId,
    payload: ChatJournalPayload,
    sessionId?: string
): Promise<IAgentJournal> {
    return this.create({
        agentInstanceId,
        workflowId,
        type: 'chat',
        severity: 'info',
        payload,
        sessionId,
        timestamp: new Date()
    });
};

/**
 * Créer une entrée d'erreur
 */
AgentJournalSchema.statics.createErrorEntry = async function(
    agentInstanceId: string | mongoose.Types.ObjectId,
    workflowId: string | mongoose.Types.ObjectId,
    payload: ErrorJournalPayload
): Promise<IAgentJournal> {
    return this.create({
        agentInstanceId,
        workflowId,
        type: 'error',
        severity: 'error',
        payload,
        timestamp: new Date()
    });
};

/**
 * Créer une entrée média
 */
AgentJournalSchema.statics.createMediaEntry = async function(
    agentInstanceId: string | mongoose.Types.ObjectId,
    workflowId: string | mongoose.Types.ObjectId,
    payload: MediaJournalPayload
): Promise<IAgentJournal> {
    return this.create({
        agentInstanceId,
        workflowId,
        type: 'media',
        severity: 'info',
        payload,
        timestamp: new Date()
    });
};

// ============================================
// MÉTHODES D'INSTANCE
// ============================================

/**
 * Vérifier si l'entrée est de type chat
 */
AgentJournalSchema.methods.isChatEntry = function(): boolean {
    return this.type === 'chat';
};

/**
 * Vérifier si l'entrée est une erreur
 */
AgentJournalSchema.methods.isErrorEntry = function(): boolean {
    return this.type === 'error';
};

/**
 * Vérifier si l'entrée contient un média
 */
AgentJournalSchema.methods.isMediaEntry = function(): boolean {
    return this.type === 'media';
};

// ============================================
// EXPORT
// ============================================

export const AgentJournal = mongoose.model<IAgentJournal, IAgentJournalModel>(
    'AgentJournal',
    AgentJournalSchema
);
