/**
 * @fileoverview Modèle AgentInstance LÉGER - Nouvelle architecture Jalon 1
 * 
 * Ce modèle remplace la logique monolithique de l'ancien AgentInstance.model.ts
 * Il ne contient que la configuration et l'état - PAS l'historique/contenu.
 * 
 * L'historique est stocké dans AgentJournal (collection agent_journals).
 * 
 * MIGRATION:
 * - L'ancien modèle reste disponible pour la rétrocompatibilité
 * - Le nouveau modèle utilise le suffixe "V2" temporairement
 * - Collection cible: agent_instances_v2 (sera renommée après migration)
 * 
 * @see backend/src/types/persistence.ts
 * @see Guides/WIP/PLAN_CORRECTIF_PERSISTANCE_WORKFLOW.md
 */

import mongoose, { Document, Schema, Model } from 'mongoose';
import {
    PersistenceConfig,
    AgentRuntimeState,
    AgentInstanceStatus,
    AgentInstanceConfiguration,
    DEFAULT_PERSISTENCE_CONFIG,
    MediaStorageMode
} from '../types/persistence';

// ============================================
// INTERFACE DOCUMENT
// ============================================

export interface IAgentInstanceV2 extends Document {
    // Relations
    workflowId: mongoose.Types.ObjectId;
    userId: mongoose.Types.ObjectId;
    prototypeId?: mongoose.Types.ObjectId;
    
    // Identité
    name: string;
    role: string;
    robotId: string;
    
    // Configuration LLM
    configuration: AgentInstanceConfiguration;
    
    // Configuration de persistance
    persistenceConfig: PersistenceConfig;
    
    // État runtime (court terme)
    state: AgentRuntimeState;
    status: AgentInstanceStatus;
    
    // Timestamps
    createdAt: Date;
    updatedAt: Date;
}

// ============================================
// SOUS-SCHÉMAS
// ============================================

const ToolConfigSchema = new Schema({
    name: { type: String, required: true },
    enabled: { type: Boolean, default: true },
    parameters: { type: Schema.Types.Mixed }
}, { _id: false });

const HistoryConfigSchema = new Schema({
    maxMessages: { type: Number, default: 100 },
    summarizeAfter: { type: Number, default: 50 }
}, { _id: false });

const ConfigurationSchema = new Schema<AgentInstanceConfiguration>({
    llmProvider: { type: String, required: true },
    llmModel: { type: String, required: true },
    temperature: { type: Number, min: 0, max: 2, default: 0.7 },
    maxTokens: { type: Number, min: 1 },
    systemPrompt: { type: String },
    tools: [ToolConfigSchema],
    historyConfig: HistoryConfigSchema,
    outputConfig: { type: Schema.Types.Mixed }
}, { _id: false });

const PersistenceConfigSchema = new Schema<PersistenceConfig>({
    saveChat: { type: Boolean, default: true },
    saveChatHistory: { type: Boolean, default: true },
    saveErrors: { type: Boolean, default: true },
    saveTasks: { type: Boolean, default: false },
    saveTaskExecution: { type: Boolean, default: false },
    saveLinks: { type: Boolean, default: false },
    saveMedia: { type: Boolean, default: true },
    mediaStorage: {
        type: String,
        enum: ['db', 'local', 'cloud'] as const,
        default: 'db'
    },
    saveHistorySummary: { type: Boolean, default: false },
    retentionDays: { type: Number, min: 1 }
}, { _id: false });

const RuntimeStateSchema = new Schema<AgentRuntimeState>({
    memory: { type: String },
    variables: { type: Schema.Types.Mixed, default: {} },
    lastActivity: { type: Date },
    currentTask: { type: String }
}, { _id: false });

// ============================================
// SCHÉMA PRINCIPAL
// ============================================

const AgentInstanceV2Schema = new Schema<IAgentInstanceV2>({
    // Relations
    workflowId: {
        type: Schema.Types.ObjectId,
        ref: 'Workflow',
        required: true
    },
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    prototypeId: {
        type: Schema.Types.ObjectId,
        ref: 'AgentPrototype'
    },
    
    // Identité
    name: {
        type: String,
        required: true,
        trim: true,
        maxlength: 100
    },
    role: {
        type: String,
        required: true,
        trim: true,
        maxlength: 200
    },
    robotId: {
        type: String,
        required: true,
        enum: ['AR_001', 'BOS_001', 'COM_001', 'PHIL_001', 'TIM_001']
    },
    
    // Configuration
    configuration: {
        type: ConfigurationSchema,
        required: true
    },
    
    // Persistance
    persistenceConfig: {
        type: PersistenceConfigSchema,
        default: () => ({ ...DEFAULT_PERSISTENCE_CONFIG })
    },
    
    // État runtime
    state: {
        type: RuntimeStateSchema,
        default: () => ({
            memory: '',
            variables: {},
            lastActivity: new Date()
        })
    },
    status: {
        type: String,
        enum: ['idle', 'running', 'error', 'paused', 'completed'] as AgentInstanceStatus[],
        default: 'idle'
    }
}, {
    timestamps: true,
    collection: 'agent_instances_v2', // Collection dédiée pour migration progressive
    
    // Optimisations
    minimize: false, // Préserver les objets vides
    strict: true     // Rejeter les champs non définis
});

// ============================================
// INDEX COMPOSÉS
// ============================================

// Récupération rapide des instances d'un workflow
AgentInstanceV2Schema.index({ workflowId: 1, status: 1 });

// Récupération par utilisateur
AgentInstanceV2Schema.index({ userId: 1, workflowId: 1 });

// Filtrage par prototype source
AgentInstanceV2Schema.index({ prototypeId: 1 });

// Recherche par nom (pour autocomplete)
AgentInstanceV2Schema.index({ userId: 1, name: 'text' });

// ============================================
// MÉTHODES D'INSTANCE
// ============================================

/**
 * Mettre à jour l'état runtime de l'agent
 */
AgentInstanceV2Schema.methods.updateState = async function(
    newState: Partial<AgentRuntimeState>
): Promise<IAgentInstanceV2> {
    Object.assign(this.state, newState);
    this.state.lastActivity = new Date();
    return this.save();
};

/**
 * Changer le statut avec validation
 */
AgentInstanceV2Schema.methods.setStatus = async function(
    this: IAgentInstanceV2,
    newStatus: AgentInstanceStatus
): Promise<IAgentInstanceV2> {
    const validTransitions: Record<AgentInstanceStatus, AgentInstanceStatus[]> = {
        idle: ['running', 'paused'],
        running: ['idle', 'paused', 'error', 'completed'],
        paused: ['running', 'idle'],
        error: ['idle', 'running'],
        completed: ['idle']
    };
    
    const currentStatus = this.status as AgentInstanceStatus;
    if (!validTransitions[currentStatus]?.includes(newStatus)) {
        throw new Error(
            `Invalid status transition: ${currentStatus} -> ${newStatus}`
        );
    }
    
    this.status = newStatus;
    this.state.lastActivity = new Date();
    return this.save();
};

// ============================================
// MÉTHODES STATIQUES
// ============================================

interface IAgentInstanceV2Model extends Model<IAgentInstanceV2> {
    findByWorkflow(workflowId: string | mongoose.Types.ObjectId): Promise<IAgentInstanceV2[]>;
    findByUser(userId: string | mongoose.Types.ObjectId): Promise<IAgentInstanceV2[]>;
    countByWorkflow(workflowId: string | mongoose.Types.ObjectId): Promise<number>;
}

/**
 * Récupérer toutes les instances d'un workflow
 */
AgentInstanceV2Schema.statics.findByWorkflow = function(
    workflowId: string | mongoose.Types.ObjectId
): Promise<IAgentInstanceV2[]> {
    return this.find({ workflowId })
        .sort({ createdAt: 1 })
        .exec();
};

/**
 * Récupérer toutes les instances d'un utilisateur
 */
AgentInstanceV2Schema.statics.findByUser = function(
    userId: string | mongoose.Types.ObjectId
): Promise<IAgentInstanceV2[]> {
    return this.find({ userId })
        .sort({ updatedAt: -1 })
        .exec();
};

/**
 * Compter les instances d'un workflow
 */
AgentInstanceV2Schema.statics.countByWorkflow = function(
    workflowId: string | mongoose.Types.ObjectId
): Promise<number> {
    return this.countDocuments({ workflowId });
};

// ============================================
// MIDDLEWARES
// ============================================

/**
 * Avant sauvegarde : mettre à jour lastActivity
 */
AgentInstanceV2Schema.pre('save', function(next) {
    if (this.isModified('state') || this.isModified('status')) {
        this.state.lastActivity = new Date();
    }
    next();
});

// ============================================
// EXPORT
// ============================================

export const AgentInstanceV2 = mongoose.model<IAgentInstanceV2, IAgentInstanceV2Model>(
    'AgentInstanceV2',
    AgentInstanceV2Schema
);

// Export alias pour clarté
export { AgentInstanceV2 as AgentInstanceLean };
