/**
 * Frontend LLM Provider Utilities
 * SOLID Single Responsibility: Credential & Config Validation
 */

// Provider classification
const LOCAL_PROVIDERS = ['LLM local (on premise)'];

/**
 * Detect if a provider is local (self-hosted)
 */
export const isLocalProvider = (provider: string): boolean => {
  if (!provider) return false;
  const normalized = (provider || '').trim();
  return LOCAL_PROVIDERS.some(p => p.trim().toLowerCase() === normalized.toLowerCase());
};

/**
 * Detect if a provider is LMStudio specifically
 */
export const isLMStudio = (provider: string): boolean => 
  (provider || '').trim().toLowerCase() === 'llm local (on premise)';

/**
 * Get label for input field based on provider type
 */
export const getInputLabel = (provider: string): string => {
  return isLocalProvider(provider) ? 'Endpoint' : 'API Key';
};

/**
 * Get placeholder for input field based on provider type
 */
export const getInputPlaceholder = (provider: string): string => {
  if (isLMStudio(provider)) return 'http://localhost:PORT';
  return isLocalProvider(provider) ? 'http://localhost:PORT' : 'YOUR_API_KEY';
};

/**
 * Get input type based on provider type
 */
export const getInputType = (provider: string): 'text' | 'password' => {
  return isLocalProvider(provider) ? 'text' : 'password';
};

/**
 * Get helper text for specific providers
 */
export const getProviderHelperText = (provider: string): string => {
  if (isLMStudio(provider)) {
    return 'URL de l\'endpoint LLM local (ex: http://localhost:1234)';
  }
  
  return '';
};

/**
 * Validates if an LLM config is properly configured
 * - Config must be enabled
 * - Local providers: must have non-empty, non-masked localEndpoint
 * - Cloud providers: must have non-empty, non-masked apiKey
 */
export const isLLMConfigured = (config: any, provider: string): boolean => {
  if (!config || !config.enabled) return false;

  if (isLocalProvider(provider)) {
    const endpoint = config.localEndpoint || '';
    return endpoint.length > 0 && !endpoint.includes('•');
  } else {
    const apiKey = config.apiKey || '';
    return apiKey.length > 0 && !apiKey.includes('•');
  }
};

/**
 * Gets the effective credential for a provider
 * - Local: returns localEndpoint
 * - Cloud: returns apiKey
 */
export const getEffectiveCredential = (config: any, provider: string): string => {
  if (!config) return '';
  return isLocalProvider(provider) ? (config.localEndpoint || '') : (config.apiKey || '');
};
