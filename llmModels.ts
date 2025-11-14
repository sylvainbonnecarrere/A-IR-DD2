import { LLMProvider, LLMCapability } from './types';

// ===========================
// ENRICHED MODEL STRUCTURE
// ===========================
export interface LLMModelDefinition {
    id: string;
    name: string;
    capabilities: LLMCapability[];
    recommended?: boolean;
    description?: string;
}

export const LLM_MODELS_DETAILED: Record<LLMProvider, LLMModelDefinition[]> = {
    [LLMProvider.Gemini]: [
        {
            id: 'gemini-2.5-flash',
            name: 'Gemini 2.5 Flash',
            capabilities: [
                LLMCapability.Chat,
                LLMCapability.FileUpload,
                LLMCapability.ImageGeneration,
                LLMCapability.ImageModification,
                LLMCapability.FunctionCalling,
                LLMCapability.WebSearch,
                LLMCapability.VideoGeneration,
                LLMCapability.MapsGrounding,
                LLMCapability.WebSearchGrounding
            ],
            recommended: true,
            description: 'Multimodal: chat, images, video generation, maps & web grounding'
        },
    ],
    [LLMProvider.OpenAI]: [
        {
            id: 'gpt-4o',
            name: 'GPT-4 Omni',
            capabilities: [LLMCapability.Chat, LLMCapability.FileUpload, LLMCapability.ImageGeneration, LLMCapability.ImageModification, LLMCapability.FunctionCalling],
            recommended: true,
            description: 'Fast, intelligent, multimodal, function calling'
        },
        {
            id: 'gpt-4-turbo',
            name: 'GPT-4 Turbo',
            capabilities: [LLMCapability.Chat, LLMCapability.FileUpload, LLMCapability.FunctionCalling],
        },
        {
            id: 'gpt-3.5-turbo',
            name: 'GPT-3.5 Turbo',
            capabilities: [LLMCapability.Chat, LLMCapability.FunctionCalling],
        },
    ],
    [LLMProvider.Mistral]: [
        {
            id: 'codestral-latest',
            name: 'Codestral Latest',
            capabilities: [LLMCapability.Chat, LLMCapability.FunctionCalling, LLMCapability.CodeSpecialization],
            description: 'Specialized for code generation'
        },
        {
            id: 'devstral-small-latest',
            name: 'Devstral Small',
            capabilities: [LLMCapability.Chat, LLMCapability.FunctionCalling, LLMCapability.CodeSpecialization],
        },
        {
            id: 'devstral-medium-latest',
            name: 'Devstral Medium',
            capabilities: [LLMCapability.Chat, LLMCapability.FunctionCalling, LLMCapability.CodeSpecialization],
        },
        {
            id: 'mistral-large-latest',
            name: 'Mistral Large',
            capabilities: [LLMCapability.Chat, LLMCapability.FileUpload, LLMCapability.FunctionCalling, LLMCapability.Embedding],
            recommended: true,
        },
        {
            id: 'mistral-small-latest',
            name: 'Mistral Small',
            capabilities: [LLMCapability.Chat, LLMCapability.FunctionCalling],
        },
        {
            id: 'open-mistral-nemo',
            name: 'Open Mistral Nemo',
            capabilities: [LLMCapability.Chat, LLMCapability.FunctionCalling],
        },
    ],
    [LLMProvider.Anthropic]: [
        {
            id: 'claude-3-5-sonnet-20240620',
            name: 'Claude 3.5 Sonnet',
            capabilities: [LLMCapability.Chat, LLMCapability.FileUpload, LLMCapability.FunctionCalling, LLMCapability.CacheOptimization],
            recommended: true,
            description: 'Latest and most intelligent'
        },
        {
            id: 'claude-3-opus-20240229',
            name: 'Claude 3 Opus',
            capabilities: [LLMCapability.Chat, LLMCapability.FileUpload, LLMCapability.FunctionCalling],
        },
        {
            id: 'claude-3-sonnet-20240229',
            name: 'Claude 3 Sonnet',
            capabilities: [LLMCapability.Chat, LLMCapability.FileUpload, LLMCapability.FunctionCalling],
        },
        {
            id: 'claude-3-haiku-20240307',
            name: 'Claude 3 Haiku',
            capabilities: [LLMCapability.Chat, LLMCapability.FunctionCalling],
        },
    ],
    [LLMProvider.Grok]: [
        {
            id: 'grok-1.5',
            name: 'Grok 1.5',
            capabilities: [LLMCapability.Chat, LLMCapability.FileUpload, LLMCapability.FunctionCalling],
            recommended: true,
            description: 'Vision capabilities'
        },
        {
            id: 'grok-1.5-lora',
            name: 'Grok 1.5 LoRA',
            capabilities: [LLMCapability.Chat, LLMCapability.FunctionCalling],
        },
        {
            id: 'grok-1',
            name: 'Grok 1',
            capabilities: [LLMCapability.Chat, LLMCapability.FunctionCalling],
        },
    ],
    [LLMProvider.Perplexity]: [
        {
            id: 'llama-3-sonar-small-32k-chat',
            name: 'Llama 3 Sonar Small Chat',
            capabilities: [LLMCapability.Chat, LLMCapability.FunctionCalling],
        },
        {
            id: 'llama-3-sonar-small-32k-online',
            name: 'Llama 3 Sonar Small Online',
            capabilities: [LLMCapability.Chat, LLMCapability.FunctionCalling, LLMCapability.WebSearch],
        },
        {
            id: 'llama-3-sonar-large-32k-chat',
            name: 'Llama 3 Sonar Large Chat',
            capabilities: [LLMCapability.Chat, LLMCapability.FunctionCalling],
        },
        {
            id: 'llama-3-sonar-large-32k-online',
            name: 'Llama 3 Sonar Large Online',
            capabilities: [LLMCapability.Chat, LLMCapability.FunctionCalling, LLMCapability.WebSearch],
            recommended: true,
            description: 'With web search'
        },
    ],
    [LLMProvider.Qwen]: [
        {
            id: 'qwen-max',
            name: 'Qwen Max',
            capabilities: [LLMCapability.Chat, LLMCapability.FileUpload, LLMCapability.FunctionCalling],
            recommended: true,
        },
        {
            id: 'qwen-plus',
            name: 'Qwen Plus',
            capabilities: [LLMCapability.Chat, LLMCapability.FileUpload, LLMCapability.FunctionCalling],
        },
        {
            id: 'qwen-vl-plus',
            name: 'Qwen VL Plus',
            capabilities: [LLMCapability.Chat, LLMCapability.FileUpload, LLMCapability.FunctionCalling, LLMCapability.OCR],
            description: 'Vision model'
        },
    ],
    [LLMProvider.Kimi]: [
        {
            id: 'moonshot-v1-128k',
            name: 'Moonshot v1 128k',
            capabilities: [LLMCapability.Chat, LLMCapability.FunctionCalling],
            recommended: true,
        },
        {
            id: 'moonshot-v1-32k',
            name: 'Moonshot v1 32k',
            capabilities: [LLMCapability.Chat, LLMCapability.FunctionCalling],
        },
        {
            id: 'moonshot-v1-8k',
            name: 'Moonshot v1 8k',
            capabilities: [LLMCapability.Chat, LLMCapability.FunctionCalling],
        },
    ],
    [LLMProvider.DeepSeek]: [
        {
            id: 'deepseek-reasoner',
            name: 'DeepSeek Reasoner',
            capabilities: [LLMCapability.Chat, LLMCapability.FunctionCalling, LLMCapability.Reasoning],
            recommended: true,
            description: 'R1 Reasoning model'
        },
        {
            id: 'deepseek-chat',
            name: 'DeepSeek Chat',
            capabilities: [LLMCapability.Chat, LLMCapability.FunctionCalling],
            description: 'V3.2-Exp general purpose'
        },
        {
            id: 'deepseek-coder',
            name: 'DeepSeek Coder',
            capabilities: [LLMCapability.Chat, LLMCapability.FunctionCalling, LLMCapability.CodeSpecialization],
            description: 'Specialized for coding'
        },
    ],
    [LLMProvider.LMStudio]: [
        {
            id: 'qwen2.5-coder-7b',
            name: 'Qwen 2.5 Coder 7B',
            capabilities: [LLMCapability.Chat, LLMCapability.FunctionCalling, LLMCapability.CodeSpecialization, LLMCapability.LocalDeployment],
            recommended: true,
            description: 'Alibaba coding specialist'
        },
        {
            id: 'gemma3-8b-instruct',
            name: 'Gemma 3 8B Instruct',
            capabilities: [LLMCapability.Chat, LLMCapability.FunctionCalling, LLMCapability.LocalDeployment],
            description: 'Google general purpose'
        },
        {
            id: 'gemma3-2b-instruct',
            name: 'Gemma 3 2B Instruct',
            capabilities: [LLMCapability.Chat, LLMCapability.FunctionCalling, LLMCapability.LocalDeployment],
            description: 'Efficient edge model'
        },
        {
            id: 'llama-3.2-1b',
            name: 'Llama 3.2 1B',
            capabilities: [LLMCapability.Chat, LLMCapability.LocalDeployment],
            description: 'Meta efficient model'
        },
        {
            id: 'llama-3.2-3b',
            name: 'Llama 3.2 3B',
            capabilities: [LLMCapability.Chat, LLMCapability.FunctionCalling, LLMCapability.LocalDeployment],
            description: 'Meta balanced model'
        },
    ],
    [LLMProvider.ArcLLM]: [
        {
            id: 'arc-video-v1',
            name: 'Arc Video Model v1',
            capabilities: [LLMCapability.VideoGeneration],
            recommended: true,
            description: '🎬 Génération de vidéos haute qualité à partir de prompts et images'
        },
        {
            id: 'arc-grounding-v1',
            name: 'Arc Grounding Model v1',
            capabilities: [LLMCapability.Chat, LLMCapability.MapsGrounding, LLMCapability.WebSearchGrounding],
            recommended: true,
            description: '🔍 Recherche temps réel avec Maps et Web Search'
        },
    ],
};

// Backward compatibility: Export simple string[] structure
export const LLM_MODELS: Record<LLMProvider, string[]> = Object.fromEntries(
    Object.entries(LLM_MODELS_DETAILED).map(([provider, models]) => [
        provider,
        models.map(m => m.id)
    ])
) as Record<LLMProvider, string[]>;

// Helper: Get model details
export const getModelDetails = (provider: LLMProvider, modelId: string): LLMModelDefinition | undefined => {
    return LLM_MODELS_DETAILED[provider]?.find(m => m.id === modelId);
};

// Helper: Get model capabilities
export const getModelCapabilities = (provider: LLMProvider, modelId: string): LLMCapability[] => {
    const model = getModelDetails(provider, modelId);
    return model?.capabilities || [];
};