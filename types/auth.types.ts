/**
 * @file types/auth.types.ts
 * @description Authentication domain types (TypeScript interfaces)
 * @domain Design Domain - Authentication & Security
 */

/**
 * Représente un utilisateur authentifié
 */
export interface User {
    id: string;
    email: string;
    role: string;
    isActive?: boolean;
}

/**
 * Tokens JWT retournés par /api/auth/login ou /api/auth/register
 */
export interface JWTTokens {
    accessToken: string;
    refreshToken: string;
}

/**
 * Réponse d'authentification complète
 */
export interface AuthResponse {
    user: User;
    accessToken: string;
    refreshToken: string;
}

/**
 * Données d'authentification persistées en localStorage
 */
export interface StoredAuthData {
    user: User;
    accessToken: string;
    refreshToken: string;
}

/**
 * Type du contexte d'authentification
 */
export interface AuthContextType {
    // État
    user: User | null;
    accessToken: string | null;
    refreshToken: string | null;
    isAuthenticated: boolean;
    isLoading: boolean;
    error: string | null;

    // LLM API Keys (J4.2) - Session-only storage
    llmApiKeys: LLMApiKey[] | null;

    // Actions
    login: (email: string, password: string) => Promise<void>;
    register: (email: string, password: string) => Promise<void>;
    logout: () => void;
    refreshAccessToken: () => Promise<void>;
    clearError: () => void;
}

/**
 * Énumération des états de chargement
 */
export enum AuthLoadingState {
    INITIALIZING = 'initializing',
    HYDRATING = 'hydrating',
    IDLE = 'idle',
    LOGGING_IN = 'logging-in',
    REGISTERING = 'registering',
    REFRESHING = 'refreshing'
}

/**
 * Credentials pour login
 */
export interface LoginCredentials {
    email: string;
    password: string;
}

/**
 * Credentials pour register
 */
export interface RegisterCredentials {
    email: string;
    password: string;
    confirmPassword?: string;
}

/**
 * Represents a decrypted LLM API key/endpoint from the server
 * Stored ONLY in memory (no localStorage)
 * 
 * DUAL STORAGE MODEL:
 * - Cloud providers (OpenAI, Anthropic, etc): Use apiKey (encrypted on server)
 * - Local providers (LMStudio, Jan, Ollama): Use localEndpoint (plaintext URL)
 */
export interface LLMApiKey {
    provider: string;
    apiKey?: string; // For cloud providers (encrypted server-side)
    localEndpoint?: string; // For local providers (e.g., http://localhost:3928)
    capabilities?: {
        [key: string]: boolean;
    };
    enabled: boolean;
    hasApiKey?: boolean; // Flag: config has API key stored
    hasLocalEndpoint?: boolean; // Flag: config has local endpoint stored
    isLocalProvider?: boolean; // Flag: provider is local (not cloud)
    needsReconfig?: boolean; // Flag: encryption mismatch, key needs re-entry
}

/**
 * Response from server for LLM API keys
 */
export interface LLMApiKeysResponse {
    keys: LLMApiKey[];
}
