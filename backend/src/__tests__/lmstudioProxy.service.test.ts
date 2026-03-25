import { LMSTUDIO_CONFIG } from '../config/lmstudio.config';
import { fetchChatCompletion, fetchWithTimeout, isEndpointAllowed, streamChatCompletion } from '../services/lmstudioProxy.service';

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
            `Request timeout exceeded after ${LMSTUDIO_CONFIG.STREAM_FIRST_BYTE_TIMEOUT_MS}ms`
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
            `Request timeout exceeded after ${LMSTUDIO_CONFIG.CHAT_COMPLETION_TIMEOUT_MS}ms`
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

        await expect(probePromise).rejects.toThrow('Request timeout exceeded after 5000ms');
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