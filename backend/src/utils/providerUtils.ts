/**
 * Utility helpers for LLM Provider detection and normalization
 * 
 * Used throughout the app to:
 * 1. Detect if a provider is local (LLM local on premise) vs cloud (API keys)
 * 2. Normalize provider strings for comparison
 * 3. Type-safe provider checks
 */

export enum ProviderType {
    CLOUD = 'CLOUD',      // Has API key (OpenAI, Google, etc)
    LOCAL = 'LOCAL'       // Has local endpoint (LLM local on premise - supports any local LLM like LMStudio, Ollama, Jan, etc)
}

// Providers that use local endpoints (NOT API keys)
const LOCAL_PROVIDER_NAMES = [
    'LLM local (on premise)'
];

// Providers that use API keys
const CLOUD_PROVIDER_NAMES = [
    'Gemini',
    'OpenAI',
    'Mistral',
    'Anthropic',
    'Grok',
    'Perplexity',
    'Qwen',
    'Kimi K2',
    'DeepSeek',
    'Arc-LLM'
];

/**
 * Normalize provider string for comparison
 * - Convert to string
 * - Trim whitespace
 * 
 * @param provider Province string or enum
 * @returns Normalized provider string
 */
export function normalizeProvider(provider?: string): string {
    if (!provider) return '';
    return String(provider).trim();
}

/**
 * Determine provider type (CLOUD or LOCAL)
 * 
 * @param provider Provider name
 * @returns ProviderType enum
 */
export function getProviderType(provider?: string): ProviderType {
    if (!provider) return ProviderType.CLOUD; // Default to cloud
    
    const normalized = normalizeProvider(provider);
    
    if (LOCAL_PROVIDER_NAMES.includes(normalized)) {
        return ProviderType.LOCAL;
    }
    
    return ProviderType.CLOUD;
}

/**
 * Check if provider is local (uses endpoint, not API key)
 * 
 * @param provider Provider name
 * @returns true if provider is local (LMStudio, Jan, Ollama)
 */
export function isLocalProvider(provider?: string): boolean {
    return getProviderType(provider) === ProviderType.LOCAL;
}

/**
 * Check if provider is cloud (uses API key)
 * 
 * @param provider Provider name
 * @returns true if provider is cloud (uses API key)
 */
export function isCloudProvider(provider?: string): boolean {
    return getProviderType(provider) === ProviderType.CLOUD;
}

/**
 * Specialized checks for specific providers
 */
export const isLMStudio = (provider?: string): boolean =>
    normalizeProvider(provider) === normalizeProvider('LLM local (on premise)');

export const isOpenAI = (provider?: string): boolean =>
    normalizeProvider(provider) === normalizeProvider('OpenAI');

export const isGemini = (provider?: string): boolean =>
    normalizeProvider(provider) === normalizeProvider('Gemini');

export const isAnthropic = (provider?: string): boolean =>
    normalizeProvider(provider) === normalizeProvider('Anthropic');

export const isArcLLM = (provider?: string): boolean =>
    normalizeProvider(provider) === normalizeProvider('Arc-LLM');

/**
 * Get list of all local provider names
 * @returns Array of local provider names
 */
export function getLocalProviderNames(): string[] {
    return [...LOCAL_PROVIDER_NAMES];
}

/**
 * Get list of all cloud provider names
 * @returns Array of cloud provider names
 */
export function getCloudProviderNames(): string[] {
    return [...CLOUD_PROVIDER_NAMES];
}
