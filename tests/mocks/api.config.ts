const API_BASE_URL = process.env.VITE_API_URL || 'http://localhost:3001';

export { API_BASE_URL };

export const getBackendUrl = (): string => API_BASE_URL;

export const BACKEND_URL: string = API_BASE_URL;

export const API_ENDPOINTS = {
    backend: {
        health: '/api/health',
    },
    lmstudio: {
        health: '/api/lmstudio/health',
        models: '/api/lmstudio/models',
        chat: '/api/lmstudio/chat/completions',
        detectEndpoint: '/api/lmstudio/detect-endpoint',
    },
} as const;

export function buildBackendUrl(endpoint: string, queryParams?: Record<string, string>): string {
    const url = new URL(endpoint, getBackendUrl());

    if (queryParams) {
        Object.entries(queryParams).forEach(([key, value]) => {
            url.searchParams.append(key, value);
        });
    }

    return url.toString();
}

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