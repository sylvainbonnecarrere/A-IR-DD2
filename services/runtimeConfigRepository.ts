import { ILLMConfigUI, LLMCapability, LLMConfig, LLMProvider } from '../types';

interface RuntimeConfigSource {
    provider: string;
    enabled?: boolean;
    apiKey?: string;
    localEndpoint?: string;
    capabilities?: Record<string, boolean>;
    hasApiKey?: boolean;
    hasLocalEndpoint?: boolean;
    isLocalProvider?: boolean;
    needsReconfig?: boolean;
}

export const INITIAL_RUNTIME_LLM_CONFIGS: LLMConfig[] = [
    { provider: LLMProvider.Gemini, enabled: false, apiKey: '', capabilities: { [LLMCapability.Chat]: true, [LLMCapability.FileUpload]: true, [LLMCapability.ImageGeneration]: true, [LLMCapability.ImageModification]: true, [LLMCapability.WebSearch]: true, [LLMCapability.URLAnalysis]: true, [LLMCapability.FunctionCalling]: true, [LLMCapability.OutputFormatting]: true, [LLMCapability.VideoGeneration]: true, [LLMCapability.MapsGrounding]: true, [LLMCapability.WebSearchGrounding]: true } },
    { provider: LLMProvider.OpenAI, enabled: false, apiKey: '', capabilities: { [LLMCapability.Chat]: true, [LLMCapability.FileUpload]: true, [LLMCapability.ImageGeneration]: true, [LLMCapability.FunctionCalling]: true, [LLMCapability.OutputFormatting]: true } },
    { provider: LLMProvider.Mistral, enabled: false, apiKey: '', capabilities: { [LLMCapability.Chat]: true, [LLMCapability.FileUpload]: true, [LLMCapability.FunctionCalling]: true, [LLMCapability.OutputFormatting]: true, [LLMCapability.Embedding]: true, [LLMCapability.OCR]: true } },
    { provider: LLMProvider.Anthropic, enabled: false, apiKey: '', capabilities: { [LLMCapability.Chat]: true, [LLMCapability.FileUpload]: true, [LLMCapability.FunctionCalling]: true, [LLMCapability.OutputFormatting]: true } },
    { provider: LLMProvider.Grok, enabled: false, apiKey: '', capabilities: { [LLMCapability.Chat]: true, [LLMCapability.FileUpload]: true, [LLMCapability.FunctionCalling]: true, [LLMCapability.OutputFormatting]: true } },
    { provider: LLMProvider.Perplexity, enabled: false, apiKey: '', capabilities: { [LLMCapability.Chat]: true, [LLMCapability.FunctionCalling]: true, [LLMCapability.OutputFormatting]: true, [LLMCapability.WebSearch]: true } },
    { provider: LLMProvider.Qwen, enabled: false, apiKey: '', capabilities: { [LLMCapability.Chat]: true, [LLMCapability.FileUpload]: true, [LLMCapability.FunctionCalling]: true, [LLMCapability.OutputFormatting]: true } },
    { provider: LLMProvider.Kimi, enabled: false, apiKey: '', capabilities: { [LLMCapability.Chat]: true, [LLMCapability.FunctionCalling]: true, [LLMCapability.OutputFormatting]: true } },
    { provider: LLMProvider.DeepSeek, enabled: false, apiKey: '', capabilities: { [LLMCapability.Chat]: true, [LLMCapability.FunctionCalling]: true, [LLMCapability.OutputFormatting]: true, [LLMCapability.Reasoning]: true, [LLMCapability.CacheOptimization]: true } },
    { provider: LLMProvider.LMStudio, enabled: false, localEndpoint: '', capabilities: { [LLMCapability.Chat]: true, [LLMCapability.FunctionCalling]: true, [LLMCapability.OutputFormatting]: true, [LLMCapability.Embedding]: false, [LLMCapability.CodeSpecialization]: false } },
];

function mergeCapabilities(
    baseCapabilities: LLMConfig['capabilities'],
    incomingCapabilities?: Record<string, boolean>
): LLMConfig['capabilities'] {
    if (!incomingCapabilities) {
        return baseCapabilities;
    }

    return Object.keys(baseCapabilities).reduce((acc, capabilityKey) => {
        const capability = capabilityKey as LLMCapability;
        acc[capability] = capabilityKey in incomingCapabilities
            ? incomingCapabilities[capabilityKey]
            : baseCapabilities[capability];
        return acc;
    }, {} as LLMConfig['capabilities']);
}

function mergeSourceIntoDefaults(sources: RuntimeConfigSource[]): LLMConfig[] {
    const byProvider = new Map(sources.map(source => [source.provider?.trim() || '', source]));

    return INITIAL_RUNTIME_LLM_CONFIGS.map(initialConfig => {
        const source = byProvider.get(initialConfig.provider?.trim() || '');
        if (!source) {
            return initialConfig;
        }

        return {
            ...initialConfig,
            enabled: source.enabled ?? initialConfig.enabled,
            apiKey: source.apiKey ?? initialConfig.apiKey,
            localEndpoint: source.localEndpoint ?? initialConfig.localEndpoint,
            hasApiKey: source.hasApiKey ?? !!source.apiKey,
            hasLocalEndpoint: source.hasLocalEndpoint ?? !!source.localEndpoint,
            isLocalProvider: source.isLocalProvider ?? initialConfig.isLocalProvider,
            needsReconfig: source.needsReconfig ?? false,
            capabilities: mergeCapabilities(initialConfig.capabilities, source.capabilities),
        };
    });
}

export function buildRuntimeConfigsFromUiConfigs(configs: ILLMConfigUI[]): LLMConfig[] {
    return mergeSourceIntoDefaults(configs.map(config => ({
        provider: config.provider,
        enabled: config.enabled,
        apiKey: config.apiKey || config.apiKeyPlaintext,
        localEndpoint: config.localEndpoint,
        capabilities: config.capabilities,
        hasApiKey: config.hasApiKey,
        hasLocalEndpoint: config.hasLocalEndpoint,
    })));
}

export function buildRuntimeConfigsFromApiKeys(keys: RuntimeConfigSource[] | null | undefined): LLMConfig[] {
    if (!keys || keys.length === 0) {
        return INITIAL_RUNTIME_LLM_CONFIGS;
    }

    return mergeSourceIntoDefaults(keys);
}

export function mapRuntimeConfigsToUiConfigs(configs: LLMConfig[]): ILLMConfigUI[] {
    const now = new Date().toISOString();
    return configs.map(config => ({
        id: `runtime-${config.provider}`,
        provider: config.provider,
        enabled: config.enabled,
        capabilities: Object.entries(config.capabilities || {}).reduce((acc, [key, value]) => {
            acc[key] = !!value;
            return acc;
        }, {} as Record<string, boolean>),
        hasApiKey: config.hasApiKey ?? !!config.apiKey,
        hasLocalEndpoint: config.hasLocalEndpoint ?? !!config.localEndpoint,
        createdAt: now,
        updatedAt: now,
        apiKey: config.apiKey,
        localEndpoint: config.localEndpoint,
    }));
}