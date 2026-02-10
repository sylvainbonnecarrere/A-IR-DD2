/**
 * @fileoverview Modèle WorkflowNode V2 - Architecture relationnelle
 * 
 * Différences avec V1 :
 * - Ajout de workflowId (FK vers Workflow)
 * - Ajout de instanceId (FK vers AgentInstance pour type='agent')
 * - Ajout de uiConfig pour la configuration visuelle React Flow
 * 
 * @see Guides/WIP/PLAN_CORRECTIF_PERSISTANCE_WORKFLOW.md
 */

import mongoose, { Document, Schema, Model } from 'mongoose';

// ============================================
// TYPES
// ============================================

export type WorkflowNodeType = 'agent' | 'connection' | 'event' | 'file' | 'trigger' | 'action';

/**
 * Configuration UI du nœud (pour React Flow)
 */
export interface IWorkflowNodeUIConfig {
    label?: string;
    color?: string;
    icon?: string;
    expanded?: boolean;
    width?: number;
    height?: number;
}

// ============================================
// INTERFACE DOCUMENT
// ============================================

export interface IWorkflowNodeV2 extends Document {
    // Relations
    workflowId: mongoose.Types.ObjectId;
    ownerId: mongoose.Types.ObjectId;
    
    // Lien vers l'instance d'agent (si nodeType === 'agent')
    instanceId?: mongoose.Types.ObjectId;
    
    // Type de nœud
    nodeType: WorkflowNodeType;
    
    // Données spécifiques au type (pour types non-agent)
    nodeData?: Record<string, unknown>;
    
    // Position sur le canvas
    position: { x: number; y: number };
    
    // Configuration visuelle
    uiConfig: IWorkflowNodeUIConfig;
    
    // Métadonnées
    metadata?: Record<string, unknown>;
    
    // Timestamps
    createdAt: Date;
    updatedAt: Date;
}

// ============================================
// SCHÉMA
// ============================================

const UIConfigSchema = new Schema<IWorkflowNodeUIConfig>({
    label: { type: String, maxlength: 100 },
    color: { type: String, maxlength: 20 },
    icon: { type: String, maxlength: 50 },
    expanded: { type: Boolean, default: true },
    width: { type: Number },
    height: { type: Number }
}, { _id: false });

const WorkflowNodeV2Schema = new Schema<IWorkflowNodeV2>({
    // Relations
    workflowId: {
        type: Schema.Types.ObjectId,
        ref: 'Workflow',
        required: true
    },
    ownerId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    
    // Lien instance agent
    instanceId: {
        type: Schema.Types.ObjectId,
        ref: 'AgentInstance'
    },
    
    // Type
    nodeType: {
        type: String,
        enum: ['agent', 'connection', 'event', 'file', 'trigger', 'action'] as WorkflowNodeType[],
        required: true
    },
    
    // Données
    nodeData: {
        type: Schema.Types.Mixed
    },
    
    // Position
    position: {
        type: {
            x: { type: Number, required: true },
            y: { type: Number, required: true }
        },
        required: true
    },
    
    // UI
    uiConfig: {
        type: UIConfigSchema,
        default: () => ({ expanded: true })
    },
    
    // Métadonnées
    metadata: {
        type: Schema.Types.Mixed
    }
}, {
    timestamps: true,
    collection: 'workflow_nodes_v2'
});

// ============================================
// INDEX COMPOSÉS
// ============================================

// Récupération des nœuds d'un workflow
WorkflowNodeV2Schema.index({ workflowId: 1, nodeType: 1 });

// Récupération par owner
WorkflowNodeV2Schema.index({ ownerId: 1, workflowId: 1 });

// Recherche par instance (pour synchronisation)
WorkflowNodeV2Schema.index({ instanceId: 1 }, { sparse: true });

// ============================================
// MÉTHODES STATIQUES
// ============================================

interface IWorkflowNodeV2Model extends Model<IWorkflowNodeV2> {
    findByWorkflow(workflowId: string | mongoose.Types.ObjectId): Promise<IWorkflowNodeV2[]>;
    findAgentNode(instanceId: string | mongoose.Types.ObjectId): Promise<IWorkflowNodeV2 | null>;
    deleteByWorkflow(workflowId: string | mongoose.Types.ObjectId): Promise<number>;
}

/**
 * Récupérer tous les nœuds d'un workflow
 */
WorkflowNodeV2Schema.statics.findByWorkflow = function(
    workflowId: string | mongoose.Types.ObjectId
): Promise<IWorkflowNodeV2[]> {
    return this.find({ workflowId }).sort({ createdAt: 1 }).exec();
};

/**
 * Trouver le nœud associé à une instance d'agent
 */
WorkflowNodeV2Schema.statics.findAgentNode = function(
    instanceId: string | mongoose.Types.ObjectId
): Promise<IWorkflowNodeV2 | null> {
    return this.findOne({ instanceId, nodeType: 'agent' }).exec();
};

/**
 * Supprimer tous les nœuds d'un workflow
 */
WorkflowNodeV2Schema.statics.deleteByWorkflow = async function(
    workflowId: string | mongoose.Types.ObjectId
): Promise<number> {
    const result = await this.deleteMany({ workflowId });
    return result.deletedCount || 0;
};

// ============================================
// EXPORT
// ============================================

export const WorkflowNodeV2 = mongoose.model<IWorkflowNodeV2, IWorkflowNodeV2Model>(
    'WorkflowNodeV2',
    WorkflowNodeV2Schema
);
