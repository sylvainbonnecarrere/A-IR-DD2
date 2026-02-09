import mongoose, { Document, Schema } from 'mongoose';

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
    retentionDays?: number;        // Durée de conservation en jours
}

export interface IAgentPrototype extends Document {
    userId: mongoose.Types.ObjectId;
    name: string;
    role: string;
    systemPrompt: string;
    llmProvider: string;
    llmModel: string;
    capabilities: string[];
    historyConfig?: object;
    tools?: object[];
    outputConfig?: object;
    robotId: string;
    isPrototype: true;
    persistenceConfig: IPersistenceConfig; // ⭐ NEW: Configuration de persistance
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

const AgentPrototypeSchema = new Schema<IAgentPrototype>({
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true
        // Removed: index: true (conflicts with composite indexes below)
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
    tools: [Schema.Types.Mixed],
    outputConfig: Schema.Types.Mixed,
    robotId: {
        type: String,
        required: true,
        enum: {
            // ⭐ J4.5: Must match frontend RobotId enum in types.ts
            values: ['AR_001', 'BO_002', 'CO_003', 'PH_004', 'TI_005'],
            message: 'RobotId invalide. Seuls AR_001, BO_002, CO_003, PH_004, TI_005 sont autorisés'
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
    }
}, {
    timestamps: true,
    collection: 'agent_prototypes'
});

// Index pour queries optimisées
AgentPrototypeSchema.index({ userId: 1, createdAt: -1 });
AgentPrototypeSchema.index({ userId: 1, robotId: 1 });

export const AgentPrototype = mongoose.model<IAgentPrototype>('AgentPrototype', AgentPrototypeSchema);
