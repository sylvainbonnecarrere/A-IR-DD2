import mongoose, { Document, Schema } from 'mongoose';
import bcrypt from 'bcrypt';
import config from '../config/environment';

export interface IUser extends Document {
    id: string; // Mongoose virtual getter for _id.toString()
    email: string;
    password: string; // Hash uniquement
    role: 'admin' | 'user' | 'viewer';
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
    lastLogin?: Date;
    
    // ⭐ PHASE 1: Multiple Workflows Support
    defaultWorkflowId?: mongoose.Types.ObjectId;  // Workflow marqué par défaut
    workflowCount: number;                        // Nombre total de workflows
    lastActiveWorkflowId?: mongoose.Types.ObjectId; // Dernier workflow utilisé
    
    comparePassword(candidatePassword: string): Promise<boolean>;
}

const UserSchema = new Schema<IUser>({
    email: {
        type: String,
        required: [true, 'Email requis'],
        unique: true,
        lowercase: true,
        trim: true,
        match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Email invalide']
    },
    password: {
        type: String,
        required: [true, 'Mot de passe requis'],
        minlength: [8, 'Minimum 8 caractères'],
        select: false
    },
    role: {
        type: String,
        enum: ['admin', 'user', 'viewer'],
        default: 'user'
    },
    isActive: {
        type: Boolean,
        default: true
    },
    lastLogin: Date,
    
    // ⭐ PHASE 1: Multiple Workflows Support
    defaultWorkflowId: {
        type: Schema.Types.ObjectId,
        ref: 'Workflow',
        sparse: true,
        validate: {
            async validator(this: any, value: any) {
                if (!value) return true; // Optional field
                const Workflow = mongoose.model('Workflow');
                const workflow = await Workflow.findById(value);
                return workflow?.userId?.equals(this._id);
            },
            message: 'defaultWorkflowId must belong to this user'
        }
    },
    
    workflowCount: {
        type: Number,
        default: 0,
        min: 0
    },
    
    lastActiveWorkflowId: {
        type: Schema.Types.ObjectId,
        ref: 'Workflow',
        sparse: true
    }
}, {
    timestamps: true,
    collection: 'users',
    strict: false // Permettre les champs additionnels
});

// ⭐ PHASE 1: Indexes pour multi-workflows
UserSchema.index({ email: 1, defaultWorkflowId: 1 });
UserSchema.index({ _id: 1, defaultWorkflowId: 1 });

// Middleware: Hash password avant sauvegarde
UserSchema.pre('save', async function (next) {
    if (!this.isModified('password')) return next();

    // SOLID: Utiliser bcrypt.rounds depuis config centralisée
    const salt = await bcrypt.genSalt(config.bcrypt.rounds);
    this.password = await bcrypt.hash(this.password, salt);
    next();
});

// Méthode: Vérifier mot de passe
UserSchema.methods.comparePassword = async function (candidatePassword: string): Promise<boolean> {
    if (!this.password) {
        return false;
    }

    return bcrypt.compare(candidatePassword, this.password);
};

export const User = mongoose.model<IUser>('User', UserSchema);
