// Configuration centralisée des endpoints API
// Le frontend appelle le backend proxy, qui appelle ensuite LMStudio

/**
 * URL du backend proxy
 * En production, utiliser la variable d'environnement VITE_BACKEND_URL
 * ⭐ CRITICAL: Use process.env instead of import.meta.env to avoid Jest parse errors
 * Vite handles process.env.VITE_* replacement in browser builds
 */
export const getBackendUrl = (): string => {
  // process.env.VITE_BACKEND_URL is replaced by Vite in browser builds
  // In tests/Node, it falls back to localhost
  return (process.env.VITE_BACKEND_URL as string) || 'http://localhost:3001';
};

// Deprecated: Use getBackendUrl() instead. Kept for backward compatibility in some edge cases.
export const BACKEND_URL = 'http://localhost:3001';

/**
 * ⭐ API_BASE_URL: Simple constant for backward compatibility
 * For dynamic behavior, use getBackendUrl() instead
 */
export const API_BASE_URL = 'http://localhost:3001';

/**
 * Endpoints du backend proxy
 */
export const API_ENDPOINTS = {
    // Backend health check
    backend: {
        health: '/api/health',
    },

    // LMStudio proxy routes
    lmstudio: {
        health: '/api/lmstudio/health',
        models: '/api/lmstudio/models',
        chat: '/api/lmstudio/chat/completions',
        detectEndpoint: '/api/lmstudio/detect-endpoint',
    },

    // Python tools execution (existant)
    pythonTools: {
        execute: '/api/execute-python-tool',
    },
} as const;

/**
 * Construire une URL complète vers le backend
 */
export function buildBackendUrl(endpoint: string, queryParams?: Record<string, string>): string {
    const url = new URL(endpoint, getBackendUrl());

    if (queryParams) {
        Object.entries(queryParams).forEach(([key, value]) => {
            url.searchParams.append(key, value);
        });
    }

    return url.toString();
}

/**
 * Construire une URL pour le proxy LMStudio avec endpoint optionnel
 */
export function buildLMStudioProxyUrl(
    route: keyof typeof API_ENDPOINTS.lmstudio,
    lmstudioEndpoint?: string
): string {
    const endpoint = API_ENDPOINTS.lmstudio[route];

    if (lmstudioEndpoint) {
        return buildBackendUrl(endpoint, { endpoint: lmstudioEndpoint });
    }

    return buildBackendUrl(endpoint);
}
