import mongoose, { Document, Schema } from 'mongoose';
import { encrypt, decrypt } from '../utils/encryption';

export interface ILLMConfig extends Document {
    userId: mongoose.Types.ObjectId;
    provider: string;
    enabled: boolean;
    apiKeyEncrypted: string;
    capabilities: Record<string, boolean>;
    createdAt: Date;
    updatedAt: Date;
    getDecryptedApiKey(): string;
    setApiKey(plainKey: string): void;
}

const LLMConfigSchema = new Schema<ILLMConfig>({
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    provider: {
        type: String,
        required: true,
        trim: true,
        enum: [
            'Gemini',
            'OpenAI',
            'Mistral',
            'Anthropic',
            'Grok',
            'Perplexity',
            'Qwen',
            'Kimi K2',
            'DeepSeek',
            'LLM local (on premise)',
            'Arc-LLM'
        ]
    },
    enabled: {
        type: Boolean,
        default: true
    },
    apiKeyEncrypted: {
        type: String,
        required: false // Optionnel: ajouté via setApiKey()
    },
    capabilities: {
        type: Schema.Types.Mixed,
        default: {}
    }
}, {
    timestamps: true,
    collection: 'llm_configs'
});

// Unique constraint: 1 config par provider par user
LLMConfigSchema.index({ userId: 1, provider: 1 }, { unique: true });
// Index simple pour filtrage enabled (listing configs actives)
LLMConfigSchema.index({ enabled: 1 });

// Méthode: Déchiffrer API key
LLMConfigSchema.methods.getDecryptedApiKey = function (): string {
    // ⭐ GUARD: Si pas de clé chiffrée stockée, retourner vide
    if (!this.apiKeyEncrypted || this.apiKeyEncrypted.trim() === '') {
        console.warn(`[LLMConfig] ⚠️ No apiKeyEncrypted for provider ${this.provider} (user ${this.userId})`);
        return '';
    }
    return decrypt(this.apiKeyEncrypted, this.userId.toString());
};

// Méthode: Chiffrer et stocker API key
LLMConfigSchema.methods.setApiKey = function (plainKey: string): void {
    this.apiKeyEncrypted = encrypt(plainKey, this.userId.toString());
};

export const LLMConfig = mongoose.model<ILLMConfig>('LLMConfig', LLMConfigSchema);
