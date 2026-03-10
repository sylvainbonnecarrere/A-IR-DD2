import mongoose, { Document, Schema } from 'mongoose';

export interface ILocalLLMProfile extends Document {
    userId: mongoose.Types.ObjectId;
    name: string;           // User-defined name, e.g. "Ollama - Code", "LMStudio - Chat"
    endpoint: string;       // e.g. "http://localhost:11434" — NOT encrypted (public URL)
    capabilities: Record<string, boolean>;
    enabled: boolean;
    detectedModel?: string; // Model ID returned by last successful capability detection
    createdAt: Date;
    updatedAt: Date;
}

const LocalLLMProfileSchema = new Schema<ILocalLLMProfile>({
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    name: {
        type: String,
        required: true,
        trim: true,
        minlength: 1,
        maxlength: 100
    },
    endpoint: {
        type: String,
        required: true,
        trim: true
    },
    capabilities: {
        type: Schema.Types.Mixed,
        default: {}
    },
    enabled: {
        type: Boolean,
        default: true
    },
    detectedModel: {
        type: String,
        trim: true,
        default: null
    }
}, {
    timestamps: true,
    collection: 'local_llm_profiles'
});

// Prevent duplicate profile names per user (leading userId field also serves listing queries)
LocalLLMProfileSchema.index({ userId: 1, name: 1 }, { unique: true });

export const LocalLLMProfile = mongoose.model<ILocalLLMProfile>('LocalLLMProfile', LocalLLMProfileSchema);
