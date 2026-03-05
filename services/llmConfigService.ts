/**
 * 🎯 SERVICE LAYER: LLM Config Persistence
 * 
 * Pattern: Strategy Pattern + Dependency Inversion
 * Responsabilité: Router les appels de persistance LLM Config
 *   - Si utilisateur authentifié → API backend
 *   - Si utilisateur invité → localStorage
 * 
 * Usage: Jamais appelé directement par les composants
 * Les composants utilisent le hook useLLMConfigs à la place
 */

import { ILLMConfigUI } from '../types';
import { getBackendUrl } from '../config/api.config';
import { GUEST_STORAGE_KEYS } from '../utils/guestDataUtils';

export interface LLMConfigServiceOptions {
  useApi?: boolean; // true = backend, false = localStorage
  token?: string;   // JWT token si useApi=true
}

// ============================================================================
// PARTIE 1: STOCKAGE LOCALSTORAGE (Guest)
// ============================================================================

// ⭐ J4.4: Use centralized key from guestDataUtils to ensure consistency
const STORAGE_KEY = GUEST_STORAGE_KEYS.LLM_CONFIGS;

function getLocalConfigs(): ILLMConfigUI[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return [];
    
    const configs = JSON.parse(data) as ILLMConfigUI[];
    
    // ⭐ J4.4.3: Ensure apiKey is populated from apiKeyPlaintext for backward compatibility
    return configs.map(config => ({
      ...config,
      apiKey: config.apiKey || config.apiKeyPlaintext || ''
    }));
  } catch (error) {
    console.error('[LLMConfigService] localStorage.getItem failed:', error);
    return [];
  }
}

function saveLocalConfigs(configs: ILLMConfigUI[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(configs));
  } catch (error) {
    console.error('[LLMConfigService] localStorage.setItem failed:', error);
    throw new Error('Impossible de sauvegarder les configs LLM localement');
  }
}

// ============================================================================
// PARTIE 2: API BACKEND (Authenticated)
// ============================================================================

async function apiRequest(
  endpoint: string,
  method: 'GET' | 'POST' | 'DELETE',
  token: string,
  body?: any
): Promise<any> {
  const options: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    }
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`${getBackendUrl()}${endpoint}`, options);

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(
      errorData.error || `API Error: ${response.status} ${response.statusText}`
    );
  }

  return response.json();
}

// ============================================================================
// PARTIE 3: EXPORTED SERVICE FUNCTIONS
// ============================================================================

/**
 * Récupère toutes les configs LLM de l'utilisateur
 */
export async function getAllLLMConfigs(
  options: LLMConfigServiceOptions
): Promise<ILLMConfigUI[]> {
  if (options.useApi && options.token) {
    // Backend API
    try {
      const response = await apiRequest('/api/llm-configs', 'GET', options.token);
      return response;
    } catch (error) {
      throw error;
    }
  } else {
    // localStorage (Guest)
    const local = getLocalConfigs();
    return local;
  }
}

/**
 * Récupère une config LLM spécifique par provider
 */
export async function getLLMConfig(
  provider: string,
  options: LLMConfigServiceOptions
): Promise<ILLMConfigUI | null> {
  if (options.useApi && options.token) {
    // Backend API
    try {
      const response = await apiRequest(
        `/api/llm-configs/${provider}`,
        'GET',
        options.token
      );
      return response;
    } catch (error) {
      if ((error as Error).message.includes('404')) {
        return null;
      }
      throw error;
    }
  } else {
    // localStorage (Guest)
    const configs = getLocalConfigs();
    return configs.find(c => c.provider === provider) || null;
  }
}

/**
 * Crée ou met à jour une config LLM
 * Supports both cloud providers (apiKey) and local providers (localEndpoint)
 */
export async function upsertLLMConfig(
  provider: string,
  data: {
    apiKey?: string; // For cloud providers
    localEndpoint?: string; // For local providers
    enabled: boolean;
    capabilities?: Record<string, boolean>;
  },
  options: LLMConfigServiceOptions
): Promise<ILLMConfigUI> {
  if (options.useApi && options.token) {
    // Backend API
    try {
      const response = await apiRequest(
        '/api/llm-configs',
        'POST',
        options.token,
        {
          provider,
          ...data
        }
      );
      return response;
    } catch (error) {
      console.error('[LLMConfigService] upsertLLMConfig API failed:', error);
      throw error;
    }
  } else {
    // localStorage (Guest)
    const configs = getLocalConfigs();
    const index = configs.findIndex(c => c.provider === provider);

    const newConfig: ILLMConfigUI = {
      id: index >= 0 ? configs[index].id : `local_${Date.now()}`,
      provider,
      enabled: data.enabled,
      capabilities: data.capabilities || {},
      hasApiKey: !!data.apiKey, // Flag: has API key
      createdAt: index >= 0 ? configs[index].createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      // ⚠️ IMPORTANT: localStorage ne chiffre PAS les clés/endpoints
      // C'est un mode "guest" non-sécurisé. Les vrais utilisateurs utilisent l'API.
      apiKeyPlaintext: data.apiKey,
      apiKey: data.apiKey,
      // NEW: Support local endpoint (plaintext URL storage)
      localEndpoint: data.localEndpoint,
      hasLocalEndpoint: !!data.localEndpoint
    };

    if (index >= 0) {
      configs[index] = newConfig;
    } else {
      configs.push(newConfig);
    }

    saveLocalConfigs(configs);
    return newConfig;
  }
}

/**
 * Supprime une config LLM
 */
export async function deleteLLMConfig(
  provider: string,
  options: LLMConfigServiceOptions
): Promise<void> {
  if (options.useApi && options.token) {
    // Backend API
    try {
      await apiRequest(
        `/api/llm-configs/${provider}`,
        'DELETE',
        options.token
      );
    } catch (error) {
      console.error('[LLMConfigService] deleteLLMConfig API failed:', error);
      throw error;
    }
  } else {
    // localStorage (Guest)
    const configs = getLocalConfigs();
    const filtered = configs.filter(c => c.provider !== provider);
    saveLocalConfigs(filtered);
  }
}

/**
 * Valide qu'un provider est configuré et actif
 */
export async function validateProvider(
  provider: string,
  options: LLMConfigServiceOptions
): Promise<{
  valid: boolean;
  enabled: boolean;
  hasApiKey: boolean;
  capabilities: Record<string, boolean>;
}> {
  if (options.useApi && options.token) {
    // Backend API
    try {
      return await apiRequest(
        '/api/llm/validate-provider',
        'POST',
        options.token,
        { provider }
      );
    } catch (error) {
      console.error('[LLMConfigService] validateProvider API failed:', error);
      throw error;
    }
  } else {
    // localStorage (Guest)
    const config = getLocalConfigs().find(c => c.provider === provider);
    return {
      valid: !!config && config.enabled && config.hasApiKey,
      enabled: config?.enabled || false,
      hasApiKey: config?.hasApiKey || false,
      capabilities: config?.capabilities || {}
    };
  }
}

/**
 * Récupère une API key déchiffrée (Backend only)
 * ⚠️ IMPORTANT: Cette fonction ne fonctionne QUE en mode authentifié
 * Elle n'est pas disponible en mode localStorage (guest)
 */
export async function getDecryptedApiKey(
  provider: string,
  token: string
): Promise<string> {
  if (!token) {
    throw new Error('getDecryptedApiKey requires authentication');
  }

  try {
    const response = await apiRequest(
      '/api/llm/get-api-key',
      'POST',
      token,
      { provider }
    );
    return response.apiKey;
  } catch (error) {
    console.error('[LLMConfigService] getDecryptedApiKey failed:', error);
    throw error;
  }
}

/**
 * Récupère TOUTES les API keys déchiffrées des providers actifs
 * ⚠️ IMPORTANT: Backend only - Appelé une fois au login
 */
export async function getAllDecryptedApiKeys(token: string): Promise<
  Array<{
    provider: string;
    apiKey: string;
    capabilities: Record<string, boolean>;
    enabled: boolean;
  }>
> {
  if (!token) {
    throw new Error('getAllDecryptedApiKeys requires authentication');
  }

  try {
    return await apiRequest(
      '/api/llm/get-all-api-keys',
      'POST',
      token
    );
  } catch (error) {
    console.error('[LLMConfigService] getAllDecryptedApiKeys failed:', error);
    throw error;
  }
}

/**
 * Effacer toutes les configs locales (au logout)
 */
export function clearLocalConfigs(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.error('[LLMConfigService] clearLocalConfigs failed:', error);
  }
}
