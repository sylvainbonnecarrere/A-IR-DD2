// Configuration centralisée des endpoints API
// Source de vérité unique pour l'URL du backend.
// Toutes les couches (apiClient, services, hooks, composants) DOIVENT importer depuis ce fichier.

/**
 * ⭐ API_BASE_URL — Single Source of Truth
 *
 * Résolution (par priorité) :
 *   1. import.meta.env.VITE_API_URL  — définie dans .env / .env.local (Vite injecte à build-time)
 *   2. Fallback : 'http://localhost:3001'
 *
 * NOTE : import.meta.env est le mécanisme natif Vite.
 *        process.env.REACT_APP_* est un pattern CRA, non supporté par Vite.
 */
export const API_BASE_URL: string =
  (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3001';

/**
 * getBackendUrl() — Alias fonctionnel pour compatibilité arrière.
 * Retourne toujours API_BASE_URL.
 */
export const getBackendUrl = (): string => API_BASE_URL;

/**
 * @deprecated Utiliser API_BASE_URL directement.
 */
export const BACKEND_URL: string = API_BASE_URL;

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
