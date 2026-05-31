import { LLMProvider, LLMCapability } from './types';
import { detectAvailableModels, type LMStudioModelInfo } from './services/lmStudioService';

// ===========================
// ENRICHED MODEL STRUCTURE
// ===========================
export interface LLMModelDefinition {
    id: string;
    name: string;
    capabilities: LLMCapability[];
    recommended?: boolean;
    description?: string;
    isDynamic?: boolean; // 🔌 Modèle détecté dynamiquement depuis LMStudio
    contextWindow?: number; // Taille du contexte (tokens)
}

// ===========================
// DYNAMIC MODELS CACHE
// ===========================
interface DynamicModelsCache {
    models: LLMModelDefinition[];
    timestamp: number;
    endpoint: string;
}

let lmStudioCache: DynamicModelsCache | null = null;
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes
// In-flight deduplication: if multiple callers request models simultaneously before the
// first resolves, they all share the same promise instead of each making an HTTP call.
let lmStudioPendingFetch: Promise<LLMModelDefinition[]> | null = null;
let lmStudioPendingEndpoint: string | null = null;

/**
 * Helper: Get capabilities for a specific LLM provider and model
 * Used when LLM provider/model changes to recalculate capabilities
 */
export const getCapabilitiesForLLM = (provider: LLMProvider, modelId: string): LLMCapability[] =>
    getModelCapabilities(provider, modelId);

export const LLM_MODELS_DETAILED: Record<LLMProvider, LLMModelDefinition[]> = {
    [LLMProvider.Gemini]: [
        {
            id: 'gemini-2.5-flash',
            name: 'Gemini 2.5 Flash',
            capabilities: [
                LLMCapability.Chat,
                LLMCapability.FileUpload,
                LLMCapability.URLAnalysis,
                LLMCapability.ImageGeneration,
                LLMCapability.ImageModification,
                LLMCapability.FunctionCalling,
                LLMCapability.OutputFormatting,
                LLMCapability.WebSearch,
                LLMCapability.VideoGeneration,
                LLMCapability.MapsGrounding
            ],
            description: 'Multimodal: chat, images, video, maps & web grounding'
        },
        {
            id: 'gemini-2.5-flash-lite',
            name: 'Gemini 2.5 Flash Lite',
            capabilities: [
                LLMCapability.Chat,
                LLMCapability.FileUpload,
                LLMCapability.FunctionCalling,
                LLMCapability.MapsGrounding,
                LLMCapability.WebSearchGrounding
            ],
            description: 'Lightweight multimodal model with grounding'
        },
        {
            id: 'gemini-2.5-pro',
            name: 'Gemini 2.5 Pro',
            capabilities: [
                LLMCapability.Chat,
                LLMCapability.FileUpload,
                LLMCapability.URLAnalysis,
                LLMCapability.ImageGeneration,
                LLMCapability.ImageModification,
                LLMCapability.FunctionCalling,
                LLMCapability.OutputFormatting,
                LLMCapability.WebSearch,
                LLMCapability.VideoGeneration,
                LLMCapability.MapsGrounding,
                LLMCapability.WebSearchGrounding,
                LLMCapability.Reasoning
            ],
            recommended: true,
            description: '🧠 Advanced reasoning model with thinking levels (1M context)'
        },
        {
            id: 'imagen-3.0-generate-001',
            name: 'Imagen 3.0',
            capabilities: [
                LLMCapability.ImageGeneration
            ],
            description: '🎨 Specialized image generation model'
        },
        {
            id: 'veo-001',
            name: 'Veo',
            capabilities: [
                LLMCapability.VideoGeneration
            ],
            description: '🎬 Specialized video generation model'
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
            capabilities: [LLMCapability.Chat, LLMCapability.FunctionCalling, LLMCapability.Embedding],
            recommended: true,
            description: 'Flagship reasoning model with embeddings support'
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
        {
            id: 'pixtral-large-latest',
            name: 'Pixtral Large',
            capabilities: [LLMCapability.Chat, LLMCapability.FileUpload, LLMCapability.FunctionCalling, LLMCapability.OCR],
            recommended: true,
            description: 'Multimodal vision model for image analysis'
        },
        {
            id: 'pixtral-12b-latest',
            name: 'Pixtral 12B',
            capabilities: [LLMCapability.Chat, LLMCapability.FileUpload, LLMCapability.FunctionCalling, LLMCapability.OCR],
            description: 'Lightweight multimodal vision model'
        },
        {
            id: 'mistral-small-2506',
            name: 'Mistral Small Vision',
            capabilities: [LLMCapability.Chat, LLMCapability.FileUpload, LLMCapability.FunctionCalling, LLMCapability.OCR],
            description: 'Small model with vision capabilities'
        },
    ],
    [LLMProvider.Anthropic]: [
        {
            id: 'claude-sonnet-4-5-20250929',
            name: 'Claude Sonnet 4.5',
            capabilities: [
                LLMCapability.Chat,
                LLMCapability.FileUpload,
                LLMCapability.PDFSupport,
                LLMCapability.FunctionCalling,
                LLMCapability.ExtendedThinking,
                LLMCapability.StructuredOutputs,
                LLMCapability.WebFetchTool,
                LLMCapability.WebSearchToolAnthropic
            ],
            recommended: true,
            description: 'Latest flagship with extended thinking & advanced tools (200K context)'
        },
        {
            id: 'claude-haiku-4-5-20251001',
            name: 'Claude Haiku 4.5',
            capabilities: [
                LLMCapability.Chat,
                LLMCapability.FileUpload,
                LLMCapability.PDFSupport,
                LLMCapability.FunctionCalling,
                LLMCapability.WebFetchTool,
                LLMCapability.WebSearchToolAnthropic
            ],
            description: 'Fast & efficient with web tools (200K context)'
        },
        {
            id: 'claude-opus-4-5-20251101',
            name: 'Claude Opus 4.5',
            capabilities: [
                LLMCapability.Chat,
                LLMCapability.FileUpload,
                LLMCapability.PDFSupport,
                LLMCapability.FunctionCalling,
                LLMCapability.ExtendedThinking,
                LLMCapability.StructuredOutputs,
                LLMCapability.WebFetchTool,
                LLMCapability.WebSearchToolAnthropic
            ],
            recommended: true,
            description: 'Most capable model with full feature set (200K context)'
        },
        {
            id: 'claude-opus-4-1-20250805',
            name: 'Claude Opus 4.1',
            capabilities: [
                LLMCapability.Chat,
                LLMCapability.FileUpload,
                LLMCapability.PDFSupport,
                LLMCapability.FunctionCalling,
                LLMCapability.StructuredOutputs
            ],
            description: 'Stable version with core features (200K context)'
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
            id: 'kimi-k2-thinking',
            name: 'Kimi K2 Thinking',
            capabilities: [LLMCapability.Chat, LLMCapability.FunctionCalling, LLMCapability.Reasoning],
            recommended: true,
            description: '🧠 Specialized model for deep reasoning, mathematical proofs, research analysis, and multi-step problem solving (256K context)'
        },
        {
            id: 'kimi-k2-0905',
            name: 'Kimi K2 0905',
            capabilities: [LLMCapability.Chat, LLMCapability.FunctionCalling],
            description: 'Enhanced model with extended context window (256K tokens)'
        },
        {
            id: 'kimi-k2',
            name: 'Kimi K2',
            capabilities: [LLMCapability.Chat, LLMCapability.FunctionCalling],
            description: 'Primary model for general chat completions (128K tokens)'
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
            id: 'mistral-3:8b',
            name: 'Mistral 3 8B',
            capabilities: [LLMCapability.Chat, LLMCapability.FunctionCalling, LLMCapability.Embedding],
            recommended: true,
            description: 'Mistral 3 8B quantized model for local deployment',
        },
        {
            id: 'qwen2.5-coder-7b',
            name: 'Qwen 2.5 Coder 7B',
            capabilities: [LLMCapability.Chat, LLMCapability.FunctionCalling, LLMCapability.CodeSpecialization],
            recommended: true,
            description: 'Alibaba coding specialist'
        },
        {
            id: 'mistral-7b-instruct-v0.2',
            name: 'Mistral 7B Instruct v0.2',
            capabilities: [LLMCapability.Chat, LLMCapability.FunctionCalling, LLMCapability.Embedding],
            recommended: true,
            description: 'Mistral AI open source 7B instruct model v0.2'
        },
        {
            id: 'mistral-7b-instruct-v0.3',
            name: 'Mistral 7B Instruct v0.3',
            capabilities: [LLMCapability.Chat, LLMCapability.FunctionCalling, LLMCapability.Embedding],
            recommended: true,
            description: 'Mistral AI open source 7B instruct model v0.3'
        },
        {
            id: 'mistral-small-3.1',
            name: 'Mistral Small 3.1',
            capabilities: [LLMCapability.Chat, LLMCapability.FunctionCalling, LLMCapability.OutputFormatting, LLMCapability.Embedding],
            description: 'Mistral Small v25.03 for local deployment'
        },
        {
            id: 'mistral-large-3.1',
            name: 'Mistral Large 3.1',
            capabilities: [LLMCapability.Chat, LLMCapability.FunctionCalling, LLMCapability.OutputFormatting, LLMCapability.Embedding, LLMCapability.Reasoning],
            recommended: true,
            description: 'Mistral Large flagship model for complex tasks'
        },
        {
            id: 'gemma3-8b-instruct',
            name: 'Gemma 3 8B Instruct',
            capabilities: [LLMCapability.Chat, LLMCapability.FunctionCalling],
            description: 'Google general purpose'
        },
        {
            id: 'gemma3-2b-instruct',
            name: 'Gemma 3 2B Instruct',
            capabilities: [LLMCapability.Chat, LLMCapability.FunctionCalling],
            description: 'Efficient edge model'
        },
        {
            id: 'llama-3.2-1b',
            name: 'Llama 3.2 1B',
            capabilities: [LLMCapability.Chat],
            description: 'Meta efficient model'
        },
        {
            id: 'llama-3.2-3b',
            name: 'Llama 3.2 3B',
            capabilities: [LLMCapability.Chat, LLMCapability.FunctionCalling],
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

// ===========================
// DYNAMIC LMSTUDIO MODELS
// ===========================

/**
 * Map LMStudioModelInfo capabilities to LLMCapability[]
 */
const mapLMStudioCapabilities = (info: LMStudioModelInfo): LLMCapability[] => {
    const capabilities: LLMCapability[] = [LLMCapability.Chat];

    if (info.capabilities.functionCalling) capabilities.push(LLMCapability.FunctionCalling);
    if (info.capabilities.reasoning) capabilities.push(LLMCapability.Reasoning);
    if (info.capabilities.codeSpecialization) capabilities.push(LLMCapability.CodeSpecialization);
    if (info.capabilities.multimodal) {
        capabilities.push(LLMCapability.FileUpload);
        capabilities.push(LLMCapability.OCR);
    }
    if (info.capabilities.jsonMode) capabilities.push(LLMCapability.OutputFormatting);

    return capabilities;
};

/**
 * Convert LMStudioModelInfo to LLMModelDefinition
 */
const convertLMStudioModel = (info: LMStudioModelInfo): LLMModelDefinition => {
    return {
        id: info.id,
        name: `${info.name} 🔌`,
        capabilities: mapLMStudioCapabilities(info),
        description: `${info.description} (Local)`,
        isDynamic: true,
        contextWindow: info.contextWindow,
        recommended: info.available && info.type === 'coding'
    };
};

/**
 * Fetch dynamic models from LMStudio with caching
 */
export const fetchLMStudioDynamicModels = async (endpoint?: string): Promise<LLMModelDefinition[]> => {
    const currentEndpoint = endpoint || 'http://localhost:1234';

    // Check cache validity
    if (lmStudioCache &&
        lmStudioCache.endpoint === currentEndpoint &&
        Date.now() - lmStudioCache.timestamp < CACHE_TTL) {
        return lmStudioCache.models;
    }

    // In-flight deduplication: return existing promise if same endpoint is already being fetched
    // This prevents the "cache stampede" where N simultaneous callers all see cache=null and all make HTTP requests
    if (lmStudioPendingFetch && lmStudioPendingEndpoint === currentEndpoint) {
        return lmStudioPendingFetch;
    }

    lmStudioPendingEndpoint = currentEndpoint;
    lmStudioPendingFetch = (async () => {
        try {
            const detectedModels = await detectAvailableModels({ endpoint: currentEndpoint });

            const dynamicModels = detectedModels
                .filter(m => m.available)
                .map(convertLMStudioModel);

            // Update cache
            lmStudioCache = {
                models: dynamicModels,
                timestamp: Date.now(),
                endpoint: currentEndpoint
            };

            return dynamicModels;
        } catch (error) {
            console.warn('[LMStudio] Failed to fetch dynamic models:', error);
            return [];
        } finally {
            lmStudioPendingFetch = null;
            lmStudioPendingEndpoint = null;
        }
    })();

    return lmStudioPendingFetch;
};

/**
 * Invalidate LMStudio cache (force refresh)
 */
export const invalidateLMStudioCache = (): void => {
    lmStudioCache = null;
    lmStudioPendingFetch = null;
    lmStudioPendingEndpoint = null;
};

/**
 * Get merged models: Static + Dynamic (dynamic models take priority)
 */
export const getLMStudioMergedModels = async (endpoint?: string): Promise<LLMModelDefinition[]> => {
    const staticModels = LLM_MODELS_DETAILED[LLMProvider.LMStudio];
    const dynamicModels = await fetchLMStudioDynamicModels(endpoint);

    if (dynamicModels.length === 0) {
        // Fallback to static models if dynamic fetch fails
        return staticModels;
    }

    // Merge: Dynamic models first (with 🔌), then static models not in dynamic
    const dynamicIds = new Set(dynamicModels.map(m => m.id));
    const uniqueStaticModels = staticModels.filter(m => !dynamicIds.has(m.id));

    return [...dynamicModels, ...uniqueStaticModels];
};