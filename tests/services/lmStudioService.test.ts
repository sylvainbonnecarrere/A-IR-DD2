import { TextDecoder, TextEncoder } from 'util';
import { ReadableStream } from 'stream/web';
import { generateContent, generateContentStream } from '../../services/lmStudioService';
import type { ChatMessage } from '../../types';

describe('lmStudioService local runtime transport', () => {
    const originalFetch = global.fetch;
    const originalTextDecoder = global.TextDecoder;

    beforeAll(() => {
        Object.assign(global, { TextDecoder });
    });

    afterEach(() => {
        global.fetch = originalFetch;
        jest.restoreAllMocks();
    });

    afterAll(() => {
        Object.assign(global, { TextDecoder: originalTextDecoder });
    });

    it('routes streaming local requests through the backend proxy with the resolved endpoint', async () => {
        const ssePayload = 'data: {"choices":[{"delta":{"content":"Bonjour"}}]}\n\n' +
            'data: {"choices":[{"finish_reason":"stop"}]}\n\n';

        const encoder = new TextEncoder();
        global.fetch = jest.fn(async () => ({
            ok: true,
            body: new ReadableStream({
                start(controller) {
                    controller.enqueue(encoder.encode(ssePayload));
                    controller.close();
                },
            }),
        } as Response)) as typeof fetch;

        const chunks = [] as Array<{ response?: { text?: string }; isComplete?: boolean }>;
        for await (const chunk of generateContentStream(
            'http://localhost:11434',
            'llama3.1',
            'system',
            [],
            undefined,
            undefined,
            undefined
        )) {
            chunks.push(chunk as { response?: { text?: string }; isComplete?: boolean });
        }

        expect(global.fetch).toHaveBeenCalledTimes(1);
        const [url, requestInit] = (global.fetch as jest.Mock).mock.calls[0];
        expect(String(url)).toBe('http://localhost:3001/api/lmstudio/chat/completions');
        expect(requestInit).toEqual(expect.objectContaining({
            method: 'POST',
            headers: expect.objectContaining({
                'Content-Type': 'application/json',
                'User-Agent': 'A-IR-DD2/1.0',
            }),
        }));
        expect(JSON.parse(String(requestInit?.body))).toEqual(expect.objectContaining({
            endpoint: 'http://localhost:11434',
            model: 'llama3.1',
            stream: true,
        }));
        expect(chunks).toEqual(expect.arrayContaining([
            expect.objectContaining({ response: { text: 'Bonjour' }, isComplete: false }),
            expect.objectContaining({ isComplete: true }),
        ]));
    });

    it('routes non-streaming local requests through the backend proxy with the resolved endpoint', async () => {
        global.fetch = jest.fn(async () => ({
            ok: true,
            json: async () => ({
                choices: [{ message: { content: 'Salut' } }],
            }),
        } as Response)) as typeof fetch;

        const result = await generateContent(
            'http://localhost:1234',
            'mistral-local',
            'system',
            [],
            undefined,
            undefined,
            undefined
        );

        expect(result).toEqual({ text: 'Salut' });
        expect(global.fetch).toHaveBeenCalledTimes(1);
        const [url, requestInit] = (global.fetch as jest.Mock).mock.calls[0];
        expect(String(url)).toBe('http://localhost:3001/api/lmstudio/chat/completions');
        expect(JSON.parse(String(requestInit?.body))).toEqual(expect.objectContaining({
            endpoint: 'http://localhost:1234',
            model: 'mistral-local',
            stream: false,
        }));
    });

    it('serializes emulated tool results as user messages instead of native tool-role messages', async () => {
        global.fetch = jest.fn(async () => ({
            ok: true,
            json: async () => ({
                choices: [{ message: { content: 'Salut' } }],
            }),
        } as Response)) as typeof fetch;

        const history: ChatMessage[] = [
            {
                id: 'msg-user-1',
                sender: 'user',
                text: 'Quelle meteo a Paris ?',
                timestamp: new Date('2026-03-25T10:00:00.000Z'),
            },
            {
                id: 'msg-agent-1',
                sender: 'agent',
                text: '',
                timestamp: new Date('2026-03-25T10:00:05.000Z'),
            },
            {
                id: 'msg-tool-1',
                sender: 'tool_result',
                text: '{"temperature":21}',
                toolName: 'weather',
                toolCallId: 'exec-1',
                timestamp: new Date('2026-03-25T10:00:06.000Z'),
            },
        ];

        await generateContent(
            'http://localhost:11434',
            'ministral-3:8b',
            'system',
            history,
            undefined,
            undefined,
            undefined
        );

        const [, requestInit] = (global.fetch as jest.Mock).mock.calls[0];
        const body = JSON.parse(String(requestInit?.body));

        expect(body.messages).toEqual(expect.arrayContaining([
            expect.objectContaining({
                role: 'user',
                content: expect.stringContaining('[TOOL RESULT: weather]'),
            }),
        ]));
        expect(body.messages).not.toEqual(expect.arrayContaining([
            expect.objectContaining({ role: 'tool' }),
        ]));
    });

    it('surfaces backend 403 details instead of reporting an unknown error', async () => {
        global.fetch = jest.fn(async () => ({
            ok: false,
            status: 403,
            statusText: 'Forbidden',
            json: async () => ({
                error: 'Endpoint forbidden',
                details: 'Only localhost, loopback, Docker host, or private-network endpoints are allowed for local LLM access.',
            }),
        } as Response)) as typeof fetch;

        await expect(generateContent(
            'http://8.8.8.8:1234',
            'qwen/qwen3.5-9b',
            'system',
            [],
            undefined,
            undefined,
            undefined
        )).rejects.toThrow(
            'LMStudio API error (http://8.8.8.8:1234): 403 - Endpoint forbidden'
        );
    });

    it('forwards the authenticated session token to the backend LMStudio proxy when provided', async () => {
        global.fetch = jest.fn(async () => ({
            ok: true,
            json: async () => ({
                choices: [{ message: { content: 'Salut' } }],
            }),
        } as Response)) as typeof fetch;

        await generateContent(
            'http://localhost:1337',
            'jan-model',
            'system',
            [],
            undefined,
            undefined,
            undefined,
            'jwt-token-123'
        );

        const [, requestInit] = (global.fetch as jest.Mock).mock.calls[0];
        expect(requestInit).toEqual(expect.objectContaining({
            headers: expect.objectContaining({
                Authorization: 'Bearer jwt-token-123',
            }),
        }));
    });
});