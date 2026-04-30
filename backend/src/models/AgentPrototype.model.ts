import mongoose, { Document, Schema } from 'mongoose';
import { CANONICAL_ROBOT_IDS, CANONICAL_ROBOT_IDS_LABEL } from '../types';

/**
 * ⭐ PERSISTENCE CONFIG: Configuration granulaire par agent
 * Permet de définir ce qui est sauvegardé pour chaque agent
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

export interface IAgentPrototype extends Document {
    userId: mongoose.Types.ObjectId;
    workflowId?: mongoose.Types.ObjectId; // ⭐ V2: Scope prototype to a specific workflow
    name: string;
    role: string;
    systemPrompt: string;
    llmProvider: string;
    llmModel: string;
    capabilities: string[];
    historyConfig?: object;
    webSearchParams?: object;
    // ⭐ Tools V2: Références vers user_functions (rétrocompat : legacyTools conservé)
    tools?: mongoose.Types.ObjectId[];     // Références vers user_functions._id
    toolSelections?: IToolSelection[];     // Références versionnées vers user_tools
    legacyTools?: object[];               // Ancien format inline (migration rétrocompat)
    outputConfig?: object;
    robotId: string;
    isPrototype: true;
    persistenceConfig: IPersistenceConfig; // ⭐ NEW: Configuration de persistance
    localLLMProfileId?: string;            // ⭐ NEW: References local_llm_profiles._id
    createdAt: Date;
    updatedAt: Date;
}

// ⭐ Sub-schema for persistence config
const PersistenceConfigSchema = new Schema<IPersistenceConfig>({
    saveChat: { type: Boolean, default: true },
    saveErrors: { type: Boolean, default: true },
    saveHistorySummary: { type: Boolean, default: false },
    saveLinks: { type: Boolean, default: false },
    saveTasks: { type: Boolean, default: false },
    mediaStorage: { 
        type: String, 
        enum: ['db', 'local', 'cloud'], 
        default: 'db' 
    }
}, { _id: false });

const ToolSelectionSchema = new Schema<IToolSelection>({
    toolId: { type: String, required: true, trim: true },
    versionRef: {
        versionTag: { type: String, required: false, trim: true },
        versionNumber: { type: Number, required: false },
        workspaceId: { type: String, required: false, default: null }
    }
}, { _id: false });

const AgentPrototypeSchema = new Schema<IAgentPrototype>({
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true
        // Removed: index: true (conflicts with composite indexes below)
    },
    // ⭐ V2: Optional workflow scope — prototypes without workflowId are "legacy" (user-level)
    workflowId: {
        type: Schema.Types.ObjectId,
        ref: 'Workflow',
        required: false,
        default: undefined
    },
    name: {
        type: String,
        required: true,
        trim: true,
        minlength: 1,
        maxlength: 100
    },
    role: {
        type: String,
        required: false,  // ⭐ J4.5: Allow empty role
        trim: true,
        maxlength: 200,
        default: ''
    },
    systemPrompt: {
        type: String,
        required: false,  // ⭐ J4.5: Allow empty systemPrompt
        default: ''
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
    webSearchParams: Schema.Types.Mixed,
    // ⭐ Tools V2: tableau de références ObjectId vers user_functions
    tools: [{
        type: Schema.Types.ObjectId,
        ref: 'UserFunction'
    }],
    toolSelections: [ToolSelectionSchema],
    // ⭐ Tools V2: conservation des anciens tools inline (migration rétrocompat)
    legacyTools: [Schema.Types.Mixed],
    outputConfig: Schema.Types.Mixed,
    robotId: {
        type: String,
        required: true,
        enum: {
            // ⭐ J4.5: Must match frontend RobotId enum in types.ts
            values: [...CANONICAL_ROBOT_IDS],
            message: `RobotId invalide. Seuls ${CANONICAL_ROBOT_IDS_LABEL} sont autorisés`
        }
        // Removed: index: true (used in composite index with userId)
    },
    isPrototype: {
        type: Boolean,
        default: true,
        immutable: true
    },
    // ⭐ NEW: Configuration de persistance granulaire par agent
    persistenceConfig: {
        type: PersistenceConfigSchema,
        default: () => ({
            saveChat: true,
            saveErrors: true,
            saveHistorySummary: false,
            saveLinks: false,
            saveTasks: false,
            mediaStorage: 'db'
        })
    },
    // ⭐ NEW: Reference to a local LLM profile (for agents using local LLM servers)
    localLLMProfileId: {
        type: String,
        required: false,
        default: undefined
    }
}, {
    timestamps: true,
    collection: 'agent_prototypes'
});

// Index pour queries optimisées
AgentPrototypeSchema.index({ userId: 1, createdAt: -1 });
AgentPrototypeSchema.index({ userId: 1, robotId: 1 });
AgentPrototypeSchema.index({ userId: 1, workflowId: 1, createdAt: -1 }); // ⭐ V2: Scope by workflow

export const AgentPrototype = mongoose.model<IAgentPrototype>('AgentPrototype', AgentPrototypeSchema);
