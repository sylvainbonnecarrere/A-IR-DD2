/**
 * @file auth.types.ts
 * @description Type definitions for Authentication Context
 * @domain Design Domain - Authentication
 */

import { LLMConfig, LocalLLMProfile } from '../../types';

/**
 * User data stored in auth context and localStorage
 */
export interface User {
    id: string;
    email: string;
    role?: 'user' | 'admin';
    isActive?: boolean;
}

/**
 * LLM API Key data structure (J4.2 - NOW WITH LOCAL PROVIDER SUPPORT)
 * DUAL MODEL:
 * - Cloud providers (OpenAI, Anthropic): Use apiKey (encrypted on backend)
 * - Local providers (LMStudio, Jan, Ollama): Use localEndpoint (plaintext URL)
 */
export interface LLMApiKey {
    provider: string;
    apiKey?: string; // Decrypted API key from backend (cloud providers)
    localEndpoint?: string; // Plaintext endpoint URL (local providers)
    enabled: boolean;
    capabilities?: Record<string, boolean>;
    hasApiKey?: boolean; // Flag: has API key configured
    hasLocalEndpoint?: boolean; // Flag: has local endpoint configured
    isLocalProvider?: boolean; // Flag: provider is local (not cloud)
    needsReconfig?: boolean; // True when decryption failed (encryption key mismatch)
}

/**
 * Response from /api/llm/get-all-api-keys
 */
export interface LLMApiKeysResponse {
    keys: LLMApiKey[];
}

/**
 * Auth response from login/register endpoints
 */
export interface AuthResponse {
    user: User;
    accessToken: string;
    refreshToken: string;
}

/**
 * Auth data stored in localStorage
 */
export interface StoredAuthData {
    user: User;
    accessToken: string;
    refreshToken: string;
}

/**
 * Auth loading state
 */
export interface AuthLoadingState {
    isLoading: boolean;
}

/**
 * Main Authentication Context Type
 */
export interface AuthContextType {
    // State
    user: User | null;
    accessToken: string | null;
    refreshToken: string | null;
    isAuthenticated: boolean;
    isLoading: boolean;
    error: string | null;
    llmApiKeys: LLMApiKey[] | null; // J4.2: Session-only API keys
    runtimeLLMConfigs: LLMConfig[];
    localLLMProfiles: LocalLLMProfile[];

    // Methods
    login: (email: string, password: string) => Promise<void>;
    register: (email: string, password: string) => Promise<void>;
    logout: () => void;
    refreshAccessToken: () => Promise<void>;
    clearError: () => void;
    refreshLLMApiKeys: () => Promise<void>; // ⭐ J4.6: Refetch keys after config changes
    refreshRuntimeConfigState: () => Promise<void>;
}
