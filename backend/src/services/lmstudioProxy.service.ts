// Service de proxy sécurisé pour LMStudio
import { LMSTUDIO_CONFIG } from '../config/lmstudio.config';
import { isAllowedLocalEndpoint, LOCAL_ENDPOINT_POLICY_ERROR } from '../utils/localEndpointPolicy';
import type {
    LMStudioHealthResponse,
    LMStudioModelsListResponse,
    ChatCompletionRequest
} from '../types/lmstudio.types';

/**
 * Validation endpoint contre politique locale partagée.
 */
export function isEndpointAllowed(endpoint: string): boolean {
    return isAllowedLocalEndpoint(endpoint);
}

/**
 * Fetch avec timeout pour éviter les requêtes bloquées
 */
export async function fetchWithTimeout(
    url: string,
    options: RequestInit,
    timeout: number = LMSTUDIO_CONFIG.TIMEOUT_MS
): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        return response;
    } catch (error) {
        clearTimeout(timeoutId);
        if (error instanceof Error && error.name === 'AbortError') {
            throw new Error(`Request timeout exceeded after ${timeout}ms`);
        }
        throw error;
    }
}

/**
 * Convert system messages to user/assistant pairs for Mistral compatibility
 * Mistral models reject messages with 'system' role
 */
export function convertSystemMessages(messages: any[]): any[] {
    const converted: any[] = [];

    for (const msg of messages) {
        if (msg.role === 'system') {
            // Convert system message to user + assistant pair
            converted.push({
                role: 'user',
                content: msg.content
            });
            converted.push({
                role: 'assistant',
                content: 'Understood. I will follow these instructions.'
            });
        } else {
            converted.push(msg);
        }
    }

    return converted;
}

/**
 * Health check du serveur LMStudio
 * Vérifie la disponibilité et le nombre de modèles chargés
 */
export async function checkLMStudioHealth(
    endpoint: string
): Promise<LMStudioHealthResponse> {
    // Validation whitelist
    if (!isEndpointAllowed(endpoint)) {
        return {
            healthy: false,
            error: `Endpoint not allowed. ${LOCAL_ENDPOINT_POLICY_ERROR}`
        };
    }

    try {
        const response = await fetchWithTimeout(
            `${endpoint}/v1/models`,
            {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' }
            },
            LMSTUDIO_CONFIG.DETECTION_TIMEOUT_MS
        );

        if (!response.ok) {
            return {
                healthy: false,
                error: `HTTP ${response.status}: ${response.statusText}`
            };
        }

        const data: LMStudioModelsListResponse = await response.json();

        return {
            healthy: true,
            endpoint,
            models: data.data?.length || 0
        };
    } catch (error) {
        return {
            healthy: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}

/**
 * Récupération de la liste des modèles disponibles
 */
export async function fetchLMStudioModels(
    endpoint: string
): Promise<LMStudioModelsListResponse> {
    // Validation whitelist
    if (!isEndpointAllowed(endpoint)) {
        throw new Error(`Endpoint not allowed. ${LOCAL_ENDPOINT_POLICY_ERROR}`);
    }

    try {
        const response = await fetchWithTimeout(
            `${endpoint}/v1/models`,
            {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' }
            }
        );

        if (!response.ok) {
            const errorText = await response.text().catch(() => response.statusText);
            throw new Error(`LMStudio API error: ${response.status} - ${errorText}`);
        }

        const data: LMStudioModelsListResponse = await response.json();
        return data;
    } catch (error) {
        if (error instanceof Error) {
            throw error;
        }
        throw new Error('Failed to fetch models from LMStudio');
    }
}

/**
 * Auto-détection de l'endpoint LMStudio disponible
 * Teste les endpoints de découverte dans l'ordre
 */
export async function detectAvailableEndpoint(): Promise<string> {
    const errors: string[] = [];

     for (const endpoint of LMSTUDIO_CONFIG.DISCOVERY_ENDPOINTS) {
        try {
            const health = await checkLMStudioHealth(endpoint);

            if (health.healthy) {
                console.log(`[LMStudio Proxy] Detected available endpoint: ${endpoint} (${health.models} models)`);
                return endpoint;
            }

            if (health.error) {
                errors.push(`${endpoint}: ${health.error}`);
            }
        } catch (error) {
            errors.push(`${endpoint}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    console.warn('[LMStudio Proxy] No server detected. Tried:', errors.join('; '));
    throw new Error(
        'No LMStudio server detected. Please start LM Studio, Jan, or Ollama on a supported port.'
    );
}

/**
 * Streaming de chat completion
 * Génère un async generator pour streaming SSE
 */
export async function* streamChatCompletion(
    endpoint: string,
    requestBody: ChatCompletionRequest
): AsyncGenerator<string, void, unknown> {
    // Validation whitelist
    if (!isEndpointAllowed(endpoint)) {
        throw new Error(`Endpoint not allowed. ${LOCAL_ENDPOINT_POLICY_ERROR}`);
    }

    // Convert system messages for Mistral compatibility
    const processedBody = {
        ...requestBody,
        messages: convertSystemMessages(requestBody.messages)
    };

    try {
        const response = await fetchWithTimeout(
            `${endpoint}/v1/chat/completions`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...processedBody, stream: true })
            },
            LMSTUDIO_CONFIG.STREAM_FIRST_BYTE_TIMEOUT_MS
        );

        if (!response.ok) {
            const errorText = await response.text().catch(() => response.statusText);
            throw new Error(`LMStudio streaming error: ${response.status} - ${errorText}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
            throw new Error('Response body reader not available');
        }

        const decoder = new TextDecoder();

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                yield chunk; // Stream vers frontend
            }
        } finally {
            reader.releaseLock();
        }
    } catch (error) {
        if (error instanceof Error) {
            throw error;
        }
        throw new Error('Streaming failed');
    }
}

/**
 * Chat completion non-streaming (synchrone)
 */
export async function fetchChatCompletion(
    endpoint: string,
    requestBody: ChatCompletionRequest
): Promise<any> {
    // Validation whitelist
    if (!isEndpointAllowed(endpoint)) {
        throw new Error(`Endpoint not allowed. ${LOCAL_ENDPOINT_POLICY_ERROR}`);
    }

    // Convert system messages for Mistral compatibility
    const processedBody = {
        ...requestBody,
        messages: convertSystemMessages(requestBody.messages)
    };

    try {
        const response = await fetchWithTimeout(
            `${endpoint}/v1/chat/completions`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...processedBody, stream: false })
            },
            LMSTUDIO_CONFIG.CHAT_COMPLETION_TIMEOUT_MS
        );

        if (!response.ok) {
            const errorText = await response.text().catch(() => response.statusText);
            throw new Error(`LMStudio API error: ${response.status} - ${errorText}`);
        }

        return await response.json();
    } catch (error) {
        if (error instanceof Error) {
            throw error;
        }
        throw new Error('Chat completion failed');
    }
}
