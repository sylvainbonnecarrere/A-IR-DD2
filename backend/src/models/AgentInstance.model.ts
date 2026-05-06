import mongoose, { Document, Schema } from 'mongoose';
import { CANONICAL_ROBOT_IDS } from '../types';

// ============================================
// PERSISTENCE CONFIG (copie de AgentPrototype)
// ============================================

/**
 * ⭐ PERSISTENCE CONFIG: Configuration granulaire par agent instance
 * Hérité du prototype avec possibilité d'override à l'instanciation
 */
export interface IPersistenceConfig {
    saveChat: boolean;             // Défaut: true - Sauvegarder les messages de chat
    saveChatHistory?: boolean;     // ⭐ Alias pour saveChat (compatibilité)
    saveErrors: boolean;           // Défaut: true - Sauvegarder les erreurs rencontrées
    saveTasks: boolean;            // Défaut: false - Sauvegarder les tâches assignées
    saveTaskExecution?: boolean;   // ⭐ Alias pour saveTasks (compatibilité)
    saveLinks: boolean;            // Défaut: false - Sauvegarder les liens entre agents
    saveMedia?: boolean;           // ⭐ Activer sauvegarde des fichiers médias
    saveHistorySummary: boolean;   // Défaut: false - Générer et stocker un résumé périodique
    mediaStorage?: 'db' | 'local' | 'cloud'; // Défaut: 'db' - Stockage GridFS
    cloudStorageConfig?: {         // ⭐ FIX QA: Config cloud S3/GCS
        provider?: 'aws' | 'gcs';
        bucket?: string;
        region?: string;
        endpoint?: string;
    } | null;
    retentionDays?: number;        // Durée de conservation en jours
}

export interface IToolSelectionVersionRef {
    versionTag?: string;
    versionNumber?: number;
    workspaceId?: string | null;
}

export interface IToolSelection {
    toolId: string;
    versionRef?: IToolSelectionVersionRef;
}

// ============================================
// TYPES DE CONTENU POLYMORPHE (ÉTAPE 1.6)
// ============================================

// Type: Chat Message
export interface IAgentInstanceChatContent {
    type: 'chat';
    role: 'user' | 'agent' | 'tool' | 'tool_result';
    message: string;
    timestamp: Date;
    metadata?: {
        llmProvider?: string;
        modelUsed?: string;
        tokensUsed?: number;
    };
}

// Type: Generated Image
export interface IAgentInstanceImageContent {
    type: 'image';
    mediaId: string; // UUID pour GridFS
    prompt: string;
    url: string;
    timestamp: Date;
    metadata: {
        model: string;
        size: string;
    };
}

// Type: Generated Video
export interface IAgentInstanceVideoContent {
    type: 'video';
    mediaId: string; // UUID pour GridFS
    prompt: string;
    duration: number; // secondes
    timestamp: Date;
    metadata: {
        model: string;
        fps: number;
        resolution: string;
    };
}

// Type: Error
export interface IAgentInstanceErrorContent {
    type: 'error';
    subType: 'llm_timeout' | 'api_rate_limit' | 'invalid_tool_call' | 'authentication_error' | 'network_error' | 'validation_error' | 'unknown_error';
    message: string;
    timestamp: Date;
    metadata: {
        errorCode?: string;
        source: 'llm_service' | 'tool_executor' | 'frontend';
        retryable: boolean;
        attempts: number;
    };
}

// Union de tous les types de contenu
export type IAgentInstanceContent = 
    | IAgentInstanceChatContent 
    | IAgentInstanceImageContent 
    | IAgentInstanceVideoContent 
    | IAgentInstanceErrorContent;

// Métriques d'exécution
export interface IAgentInstanceMetrics {
    totalTokens: number;
    totalErrors: number;
    totalMediaGenerated: number;
    callCount: number;
}

// ============================================
// INTERFACE PRINCIPALE (MISE À JOUR ÉTAPE 1.6)
// ============================================

export interface IAgentInstance extends Document {
    workflowId: mongoose.Types.ObjectId; // FK → Workflow (LOCAL)
    userId: mongoose.Types.ObjectId; // FK → User (dénormalisé pour queries)
    prototypeId?: mongoose.Types.ObjectId; // FK → AgentPrototype (optionnel)

    // ⭐ NOUVEAU: Identifiant d'exécution unique (ÉTAPE 1.6)
    executionId: string; // UUID de l'exécution (ex: "run-12345...")

    // ⭐ NOUVEAU: Statut d'exécution (ÉTAPE 1.6)
    status: 'running' | 'completed' | 'failed' | 'stopped';

    // Snapshot config (copie indépendante du prototype)
    name: string;
    role: string;
    systemPrompt: string;
    llmProvider: string;
    llmModel: string;
    capabilities: string[];
    historyConfig?: object;
    // ⭐ Tools V2: références vers user_functions + héritage prototype
    tools?: mongoose.Types.ObjectId[];   // Références vers user_functions._id
    toolSelections?: IToolSelection[];   // Références versionnées effectives pour cette instance
    legacyTools?: object[];              // Ancien format inline (migration rétrocompat)
    functionInheritance?: {
        inheritFromPrototype: boolean;   // true par défaut
        overrideFunctionIds?: string[]; // Si inheritFromPrototype = false
        overrideToolSelections?: IToolSelection[];
    };
    webSearchParams?: object;
    outputConfig?: object;
    localLLMProfileId?: string;   // Which LocalLLMProfile is used for this instance
    robotId: string;

    // Canvas properties
    position: { x: number; y: number };
    isMinimized: boolean;
    isMaximized: boolean;
    zIndex: number;

    // ⭐ NOUVEAU: Contenu polymorphe (ÉTAPE 1.6)
    content: IAgentInstanceContent[];

    // ⭐ NOUVEAU: Métriques d'exécution (ÉTAPE 1.6)
    metrics: IAgentInstanceMetrics;

    // ⭐ NOUVEAU: Timeline (ÉTAPE 1.6)
    startedAt?: Date;
    completedAt?: Date;
    duration?: number; // millisecondes

    // ⭐ NOUVEAU: Contexte utilisateur (ÉTAPE 1.6)
    userNotes?: string;
    tags?: string[];

    // ⭐ NOUVEAU: Configuration de persistance (héritée du prototype avec override possible)
    persistenceConfig: IPersistenceConfig;

    createdAt: Date;
    updatedAt: Date;
}

const AgentInstanceSchema = new Schema<IAgentInstance>({
    workflowId: {
        type: Schema.Types.ObjectId,
        ref: 'Workflow',
        required: true
    },
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true
        // Removed: index: true (conflicts with composite index below)
    },
    prototypeId: {
        type: Schema.Types.ObjectId,
        ref: 'AgentPrototype'
    },

    // ⭐ NOUVEAU: Identifiant d'exécution unique (ÉTAPE 1.6)
    executionId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },

    // ⭐ NOUVEAU: Statut d'exécution (ÉTAPE 1.6)
    status: {
        type: String,
        required: true,
        enum: ['running', 'completed', 'failed', 'stopped'],
        default: 'running'
    },

    // Snapshot config
    name: {
        type: String,
        required: true,
        trim: true
    },
    role: {
        type: String,
        required: true
    },
    systemPrompt: {
        type: String,
        required: true
    },
    llmProvider: {
        type: String,
        required: true
    },
    llmModel: {
        type: String,
        required: true
    },
    capabilities: [{
        type: String
    }],
    historyConfig: Schema.Types.Mixed,
    // ⭐ Tools V2: tableau de références ObjectId vers user_functions
    tools: [{
        type: Schema.Types.ObjectId,
        ref: 'UserFunction'
    }],
    toolSelections: [{
        toolId: { type: String, required: true, trim: true },
        versionRef: {
            versionTag: { type: String, required: false, trim: true },
            versionNumber: { type: Number, required: false },
            workspaceId: { type: String, required: false, default: null }
        },
        _id: false
    }],
    // ⭐ Tools V2: conservation des anciens tools inline (migration rétrocompat)
    legacyTools: [Schema.Types.Mixed],
    // ⭐ Tools V2: configuration d'héritage des fonctions depuis le prototype
    functionInheritance: {
        inheritFromPrototype: { type: Boolean, default: true },
        overrideFunctionIds: [{ type: String }],
        overrideToolSelections: [{
            toolId: { type: String, required: true, trim: true },
            versionRef: {
                versionTag: { type: String, required: false, trim: true },
                versionNumber: { type: Number, required: false },
                workspaceId: { type: String, required: false, default: null }
            },
            _id: false
        }],
        _id: false
    },
    webSearchParams: Schema.Types.Mixed,
    outputConfig: Schema.Types.Mixed,
    // ⭐ LOCAL LLM: Profil LLM local sélectionné pour cette instance
    localLLMProfileId: {
        type: String,
        default: null
    },
    robotId: {
        type: String,
        required: true,
        enum: [...CANONICAL_ROBOT_IDS]
    },

    // Canvas properties
    position: {
        type: {
            x: { type: Number, required: true },
            y: { type: Number, required: true }
        },
        required: true
    },
    isMinimized: {
        type: Boolean,
        default: false
    },
    isMaximized: {
        type: Boolean,
        default: false
    },
    zIndex: {
        type: Number,
        default: 0
    },

    // ⭐ NOUVEAU: Contenu polymorphe (ÉTAPE 1.6)
    content: [{
        type: {
            type: String,
            required: true,
            enum: ['chat', 'image', 'video', 'error']
        },
        // Chat fields
        role: {
            type: String,
            enum: ['user', 'agent', 'tool', 'tool_result']
        },
        message: String,
        // Image/Video fields
        mediaId: String,
        prompt: String,
        url: String,
        duration: Number,
        // Error fields
        subType: {
            type: String,
            enum: ['llm_timeout', 'api_rate_limit', 'invalid_tool_call', 'authentication_error', 'network_error', 'validation_error', 'unknown_error']
        },
        // Common fields
        timestamp: {
            type: Date,
            default: Date.now
        },
        metadata: Schema.Types.Mixed
    }],

    // ⭐ NOUVEAU: Métriques d'exécution (ÉTAPE 1.6)
    metrics: {
        type: {
            totalTokens: { type: Number, default: 0 },
            totalErrors: { type: Number, default: 0 },
            totalMediaGenerated: { type: Number, default: 0 },
            callCount: { type: Number, default: 0 }
        },
        default: {
            totalTokens: 0,
            totalErrors: 0,
            totalMediaGenerated: 0,
            callCount: 0
        }
    },

    // ⭐ NOUVEAU: Timeline (ÉTAPE 1.6)
    startedAt: {
        type: Date,
        default: Date.now
    },
    completedAt: Date,
    duration: Number, // millisecondes

    // ⭐ NOUVEAU: Contexte utilisateur (ÉTAPE 1.6)
    userNotes: {
        type: String,
        maxlength: 2000
    },
    tags: [{
        type: String,
        maxlength: 50
    }],

    // ⭐ NOUVEAU: Configuration de persistance (héritée du prototype avec override possible)
    persistenceConfig: {
        type: {
            saveChat: { type: Boolean, default: true },
            saveErrors: { type: Boolean, default: true },
            saveHistorySummary: { type: Boolean, default: false },
            saveLinks: { type: Boolean, default: false },
            saveTasks: { type: Boolean, default: false },
            // ⭐ FIX QA: Added saveMedia field for media persistence toggle
            saveMedia: { type: Boolean, default: false },
            mediaStorage: { 
                type: String, 
                enum: ['db', 'local', 'cloud'], 
                default: 'db' 
            },
            // ⭐ FIX QA: Added cloudStorageConfig for S3/GCS configuration
            cloudStorageConfig: {
                type: Schema.Types.Mixed,
                default: null
            }
        },
        default: {
            saveChat: true,
            saveErrors: true,
            saveHistorySummary: false,
            saveLinks: false,
            saveTasks: false,
            saveMedia: false,
            mediaStorage: 'db',
            cloudStorageConfig: null
        }
    }
}, {
    timestamps: true,
    collection: 'agent_instances'
});

// Index composés pour queries optimisées
AgentInstanceSchema.index({ workflowId: 1, createdAt: -1 });
AgentInstanceSchema.index({ userId: 1, workflowId: 1 });
AgentInstanceSchema.index({ prototypeId: 1 });
// ⭐ NOUVEAUX INDEX (ÉTAPE 1.6)
AgentInstanceSchema.index({ workflowId: 1, status: 1 });
AgentInstanceSchema.index({ 'content.type': 1 }); // Pour filtrer par type de contenu

export const AgentInstance = mongoose.model<IAgentInstance>('AgentInstance', AgentInstanceSchema);
