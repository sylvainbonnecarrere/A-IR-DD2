import { LMSTUDIO_CONFIG } from '../config/lmstudio.config';
import { fetchChatCompletion, fetchWithTimeout, isEndpointAllowed, LMStudioProxyError, openChatCompletionStream, streamChatCompletion } from '../services/lmstudioProxy.service';

describe('lmstudioProxy.service local generation timeouts', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
        global.fetch = originalFetch;
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    it('keeps streaming first-byte timeout above 120s for slow local models', async () => {
        jest.useFakeTimers();

        global.fetch = jest.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
                reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
            });
        })) as typeof fetch;

        const streamPromise = streamChatCompletion('http://localhost:11434', {
            model: 'ministral-3:8b',
            messages: [{ role: 'user', content: 'hello' }],
            stream: true,
        } as any).next();

        jest.advanceTimersByTime(120001);
        await Promise.resolve();

        let settled = false;
        void streamPromise.then(
            () => { settled = true; },
            () => { settled = true; }
        );
        await Promise.resolve();

        expect(settled).toBe(false);

        jest.advanceTimersByTime(LMSTUDIO_CONFIG.STREAM_FIRST_BYTE_TIMEOUT_MS - 120001);

        await expect(streamPromise).rejects.toThrow(
            `LMStudio request timeout exceeded after ${LMSTUDIO_CONFIG.STREAM_FIRST_BYTE_TIMEOUT_MS}ms`
        );
    });

    it('uses the dedicated long timeout for non-streaming local completions', async () => {
        jest.useFakeTimers();

        global.fetch = jest.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
                reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
            });
        })) as typeof fetch;

        const completionPromise = fetchChatCompletion('http://localhost:11434', {
            model: 'ministral-3:8b',
            messages: [{ role: 'user', content: 'hello' }],
            stream: false,
        } as any);

        jest.advanceTimersByTime(120001);
        await Promise.resolve();

        let settled = false;
        void completionPromise.then(
            () => { settled = true; },
            () => { settled = true; }
        );
        await Promise.resolve();

        expect(settled).toBe(false);

        jest.advanceTimersByTime(LMSTUDIO_CONFIG.CHAT_COMPLETION_TIMEOUT_MS - 120001);

        await expect(completionPromise).rejects.toThrow(
            `LMStudio request timeout exceeded after ${LMSTUDIO_CONFIG.CHAT_COMPLETION_TIMEOUT_MS}ms`
        );
    });

    it('allows overriding the non-streaming local completion timeout for hidden web-search calls', async () => {
        jest.useFakeTimers();

        global.fetch = jest.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
                reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
            });
        })) as typeof fetch;

        const completionPromise = fetchChatCompletion('http://localhost:11434', {
            model: 'ministral-3:8b',
            messages: [{ role: 'user', content: 'hello' }],
            stream: false,
        } as any, 120000);

        jest.advanceTimersByTime(120000);

        await expect(completionPromise).rejects.toThrow(
            'LMStudio request timeout exceeded after 120000ms'
        );
    });

    it('still keeps short safety timeouts for generic probe helpers', async () => {
        jest.useFakeTimers();

        global.fetch = jest.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
                reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
            });
        })) as typeof fetch;

        const probePromise = fetchWithTimeout('http://localhost:11434/v1/models', { method: 'GET' }, 5000);
        jest.advanceTimersByTime(5000);

        await expect(probePromise).rejects.toThrow('LMStudio request timeout exceeded after 5000ms');
    });

    it('classifies undici headers timeout as a structured proxy timeout', async () => {
        global.fetch = jest.fn(async () => {
            throw Object.assign(new Error('Headers Timeout Error'), {
                code: 'UND_ERR_HEADERS_TIMEOUT'
            });
        }) as typeof fetch;

        await expect(openChatCompletionStream('http://localhost:11434', {
            model: 'ministral-3:8b',
            messages: [{ role: 'user', content: 'hello' }],
            stream: true,
        } as any)).rejects.toMatchObject<Partial<LMStudioProxyError>>({
            name: 'LMStudioProxyError',
            code: 'timeout',
            statusCode: 504
        });
    });

    it('performs handshake before exposing the stream session', async () => {
        const encoder = new TextEncoder();

        global.fetch = jest.fn(async () => new Response(new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(encoder.encode('data: {"chunk":1}\n\n'));
                controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                controller.close();
            }
        }), { status: 200 })) as typeof fetch;

        const session = await openChatCompletionStream('http://localhost:11434', {
            model: 'ministral-3:8b',
            messages: [{ role: 'user', content: 'hello' }],
            stream: true,
        } as any);

        const streamedChunks: string[] = [];
        for await (const chunk of session.stream()) {
            streamedChunks.push(chunk);
        }

        expect(session.firstChunk).toBe('data: {"chunk":1}\n\n');
        expect(streamedChunks).toEqual(['data: [DONE]\n\n']);
    });

    it('accepts private-network LMStudio endpoints but still rejects public endpoints', () => {
        expect(isEndpointAllowed('http://192.168.56.1:1234')).toBe(true);
        expect(isEndpointAllowed('http://172.20.10.5:1234')).toBe(true);
        expect(isEndpointAllowed('http://10.0.0.12:11434')).toBe(true);
        expect(isEndpointAllowed('http://8.8.8.8:1234')).toBe(false);
        expect(isEndpointAllowed('https://example.com:1234')).toBe(false);
        expect(isEndpointAllowed('http://192.168.56.1:1234/v1/chat/completions')).toBe(false);
    });
});