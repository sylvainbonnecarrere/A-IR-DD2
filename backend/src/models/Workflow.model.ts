import mongoose, { Document, Schema } from 'mongoose';

// ⭐ NOUVEAU: Interface Canvas State (ÉTAPE 1.6)
export interface ICanvasState {
    zoom: number;
    panX: number;
    panY: number;
}

export interface IWorkflow extends Document {
    userId: mongoose.Types.ObjectId;
    name: string;
    description?: string;
    isActive: boolean;
    
    // ⭐ NOUVEAU: Contrainte J4.4 - Un seul workflow par défaut par utilisateur
    isDefault: boolean;
    
    // ⭐ NOUVEAU: État du canvas pour reconstruction visuelle (ÉTAPE 1.6)
    canvasState: ICanvasState;
    
    lastSavedAt?: Date;
    isDirty: boolean;
    lastEditedBy?: string; // user._id pour audit
    createdAt: Date;
    updatedAt: Date;
}

const WorkflowSchema = new Schema<IWorkflow>({
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
    description: {
        type: String,
        maxlength: 500
    },
    isActive: {
        type: Boolean,
        default: false
    },
    
    // ⭐ NOUVEAU: Contrainte J4.4 - Un seul workflow par défaut par utilisateur
    isDefault: {
        type: Boolean,
        default: false
    },
    
    // ⭐ NOUVEAU: État du canvas pour reconstruction visuelle (ÉTAPE 1.6)
    canvasState: {
        type: {
            zoom: { type: Number, default: 1 },
            panX: { type: Number, default: 0 },
            panY: { type: Number, default: 0 }
        },
        default: {
            zoom: 1,
            panX: 0,
            panY: 0
        }
    },
    
    lastSavedAt: Date,
    isDirty: {
        type: Boolean,
        default: false
    },
    
    // ⭐ NOUVEAU: Audit trail (ÉTAPE 1.6)
    lastEditedBy: {
        type: String
    }
}, {
    timestamps: true,
    collection: 'workflows'
});

// Index: Un seul workflow actif par user
WorkflowSchema.index({ userId: 1, isActive: 1 });
WorkflowSchema.index({ userId: 1, updatedAt: -1 });

// ⭐ NOUVEAU: Index unique sparse pour contrainte isDefault (ÉTAPE 1.6)
// Garantit qu'un seul workflow isDefault=true existe par userId
WorkflowSchema.index(
    { userId: 1, isDefault: 1 }, 
    { 
        unique: true, 
        partialFilterExpression: { isDefault: true }
    }
);

export const Workflow = mongoose.model<IWorkflow>('Workflow', WorkflowSchema);
