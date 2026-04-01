// Service de proxy sécurisé pour LMStudio
import { LMSTUDIO_CONFIG } from '../config/lmstudio.config';
import { isAllowedLocalEndpoint, LOCAL_ENDPOINT_POLICY_ERROR } from '../utils/localEndpointPolicy';
import type {
    LMStudioHealthResponse,
    LMStudioModelsListResponse,
    ChatCompletionRequest
} from '../types/lmstudio.types';

type LMStudioProxyErrorCode = 'endpoint_not_allowed' | 'timeout' | 'bad_status' | 'upstream_unreachable' | 'stream_aborted';

interface LMStudioProxyErrorOptions {
    statusCode: number;
    endpoint: string;
    details?: Record<string, unknown>;
    cause?: unknown;
}

export class LMStudioProxyError extends Error {
    readonly code: LMStudioProxyErrorCode;
    readonly statusCode: number;
    readonly endpoint: string;
    readonly details?: Record<string, unknown>;

    constructor(code: LMStudioProxyErrorCode, message: string, options: LMStudioProxyErrorOptions) {
        super(message);
        this.name = 'LMStudioProxyError';
        this.code = code;
        this.statusCode = options.statusCode;
        this.endpoint = options.endpoint;
        this.details = options.details;

        if (options.cause !== undefined) {
            (this as Error & { cause?: unknown }).cause = options.cause;
        }
    }
}

export interface LMStudioStreamSession {
    readonly firstChunk: string | null;
    stream(): AsyncGenerator<string, void, unknown>;
}

function isHeadersTimeoutError(error: unknown): boolean {
    const source = error as { code?: string; cause?: { code?: string }; message?: string } | undefined;
    const message = source?.message?.toLowerCase() ?? '';
    return source?.code === 'UND_ERR_HEADERS_TIMEOUT'
        || source?.cause?.code === 'UND_ERR_HEADERS_TIMEOUT'
        || message.includes('headers timeout')
        || message.includes('und_err_headers_timeout');
}

function isAbortTimeoutError(error: unknown): boolean {
    return error instanceof Error && error.name === 'AbortError';
}

function normalizeProxyError(error: unknown, endpoint: string, timeout: number): LMStudioProxyError {
    if (error instanceof LMStudioProxyError) {
        return error;
    }

    if (isAbortTimeoutError(error) || isHeadersTimeoutError(error)) {
        return new LMStudioProxyError('timeout', `LMStudio request timeout exceeded after ${timeout}ms`, {
            statusCode: 504,
            endpoint,
            details: { timeoutMs: timeout },
            cause: error
        });
    }

    const message = error instanceof Error ? error.message : 'LMStudio upstream request failed';
    return new LMStudioProxyError('upstream_unreachable', message, {
        statusCode: 502,
        endpoint,
        cause: error
    });
}

function buildBadStatusError(endpoint: string, status: number, responseText: string): LMStudioProxyError {
    return new LMStudioProxyError('bad_status', `LMStudio upstream returned HTTP ${status}`, {
        statusCode: 502,
        endpoint,
        details: {
            upstreamStatus: status,
            upstreamBody: responseText
        }
    });
}

function buildEndpointNotAllowedError(endpoint: string): LMStudioProxyError {
    return new LMStudioProxyError('endpoint_not_allowed', `Endpoint not allowed. ${LOCAL_ENDPOINT_POLICY_ERROR}`, {
        statusCode: 403,
        endpoint
    });
}

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
        if (isAbortTimeoutError(error)) {
            throw new LMStudioProxyError('timeout', `LMStudio request timeout exceeded after ${timeout}ms`, {
                statusCode: 504,
                endpoint: url,
                details: { timeoutMs: timeout },
                cause: error
            });
        }
        if (isHeadersTimeoutError(error)) {
            throw new LMStudioProxyError('timeout', `LMStudio request timeout exceeded after ${timeout}ms`, {
                statusCode: 504,
                endpoint: url,
                details: { timeoutMs: timeout, reason: 'headers_timeout' },
                cause: error
            });
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
        throw buildEndpointNotAllowedError(endpoint);
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
    const session = await openChatCompletionStream(endpoint, requestBody);

    if (session.firstChunk) {
        yield session.firstChunk;
    }

    yield* session.stream();
}

export async function openChatCompletionStream(
    endpoint: string,
    requestBody: ChatCompletionRequest
): Promise<LMStudioStreamSession> {
    // Validation whitelist
    if (!isEndpointAllowed(endpoint)) {
        throw buildEndpointNotAllowedError(endpoint);
    }

    // Convert system messages for Mistral compatibility
    const processedBody = {
        ...requestBody,
        messages: convertSystemMessages(requestBody.messages)
    };

    const upstreamUrl = `${endpoint}/v1/chat/completions`;

    try {
        const response = await fetchWithTimeout(
            upstreamUrl,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...processedBody, stream: true })
            },
            LMSTUDIO_CONFIG.STREAM_FIRST_BYTE_TIMEOUT_MS
        );

        if (!response.ok) {
            const errorText = await response.text().catch(() => response.statusText);
            throw buildBadStatusError(endpoint, response.status, errorText);
        }

        const reader = response.body?.getReader();
        if (!reader) {
            throw new LMStudioProxyError('stream_aborted', 'LMStudio response body reader not available', {
                statusCode: 502,
                endpoint
            });
        }

        const decoder = new TextDecoder();
        let firstChunk: string | null = null;

        try {
            const firstRead = await reader.read();
            if (!firstRead.done && firstRead.value) {
                firstChunk = decoder.decode(firstRead.value, { stream: true });
            }
        } catch (error) {
            throw normalizeProxyError(error, endpoint, LMSTUDIO_CONFIG.STREAM_FIRST_BYTE_TIMEOUT_MS);
        }

        return {
            firstChunk,
            async *stream(): AsyncGenerator<string, void, unknown> {
                try {
                    while (true) {
                        let nextChunk: ReadableStreamReadResult<Uint8Array>;

                        try {
                            nextChunk = await reader.read();
                        } catch (error) {
                            throw normalizeProxyError(error, endpoint, LMSTUDIO_CONFIG.STREAM_FIRST_BYTE_TIMEOUT_MS);
                        }

                        if (nextChunk.done) {
                            break;
                        }

                        if (nextChunk.value) {
                            yield decoder.decode(nextChunk.value, { stream: true });
                        }
                    }
                } finally {
                    reader.releaseLock();
                }
            }
        };
    } catch (error) {
        throw normalizeProxyError(error, endpoint, LMSTUDIO_CONFIG.STREAM_FIRST_BYTE_TIMEOUT_MS);
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
