import mongoose, { Document, Schema } from 'mongoose';
import { encrypt, decrypt } from '../utils/encryption';

export interface ILLMConfig extends Document {
    userId: mongoose.Types.ObjectId;
    provider: string;
    enabled: boolean;
    apiKeyEncrypted?: string;           // For providers with API keys (OpenAI, Google, etc)
    localEndpoint?: string;              // For local providers (LMStudio, Jan, Ollama) - NOT encrypted
    capabilities: Record<string, boolean>;
    createdAt: Date;
    updatedAt: Date;
    getDecryptedApiKey(): string;
    setApiKey(plainKey: string): void;
    getLocalEndpoint(): string;
    setLocalEndpoint(endpoint: string): void;
    hasApiKey(): boolean;
    hasLocalEndpoint(): boolean;
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
        required: false // Optional: added via setApiKey()
    },
    localEndpoint: {
        type: String,
        required: false, // Optional: for local providers (LMStudio, Jan, Ollama)
        trim: true       // Remove whitespace
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

// Method: Decrypt API key
LLMConfigSchema.methods.getDecryptedApiKey = function (): string {
    // Guard: If no encrypted key stored, return empty
    if (!this.apiKeyEncrypted || this.apiKeyEncrypted.trim() === '') {
        console.warn(`[LLMConfig] ⚠️ No apiKeyEncrypted for provider ${this.provider} (user ${this.userId})`);
        return '';
    }
    return decrypt(this.apiKeyEncrypted, this.userId.toString());
};

// Method: Encrypt and store API key
LLMConfigSchema.methods.setApiKey = function (plainKey: string): void {
    if (!plainKey || plainKey.trim() === '') {
        this.apiKeyEncrypted = '';
        return;
    }

    this.apiKeyEncrypted = encrypt(plainKey, this.userId.toString());
};

// Method: Get local endpoint (NOT encrypted - it's a public URL)
LLMConfigSchema.methods.getLocalEndpoint = function (): string {
    return this.localEndpoint || '';
};

// Method: Set local endpoint (NO encryption)
LLMConfigSchema.methods.setLocalEndpoint = function (endpoint: string): void {
    this.localEndpoint = endpoint || '';
};

// Method: Check if has API key
LLMConfigSchema.methods.hasApiKey = function (): boolean {
    return !!this.apiKeyEncrypted;
};

// Method: Check if has local endpoint
LLMConfigSchema.methods.hasLocalEndpoint = function (): boolean {
    return !!this.localEndpoint;
};

export const LLMConfig = mongoose.model<ILLMConfig>('LLMConfig', LLMConfigSchema);
