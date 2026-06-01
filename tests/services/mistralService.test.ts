import { TextDecoder, TextEncoder } from 'util';
import { ReadableStream } from 'stream/web';
import { generateContentStream } from '../../services/mistralService';
import { createTestChatMessage } from '../builders/domainBuilders';

describe('mistralService tool transcript normalization', () => {
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

    const createDoneResponse = (): Response => {
        const encoder = new TextEncoder();

        return {
            ok: true,
            body: new ReadableStream({
                start(controller) {
                    controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                    controller.close();
                },
            }),
        } as unknown as Response;
    };

    const captureRequestBody = async (history: Parameters<typeof generateContentStream>[3]) => {
        global.fetch = jest.fn(async () => createDoneResponse()) as typeof fetch;

        for await (const _chunk of generateContentStream(
            'mistral-test-key',
            'mistral-small-latest',
            'system',
            history,
            undefined,
            undefined,
        )) {
            // Exhaust the stream to force request execution.
        }

        const [, requestInit] = (global.fetch as jest.Mock).mock.calls[0];
        return JSON.parse(String(requestInit?.body));
    };

    it('keeps only the canonical tool_result as native tool role when an assistant tool call precedes it', async () => {
        const requestBody = await captureRequestBody([
            createTestChatMessage({
                id: 'msg-user-1',
                sender: 'user',
                text: 'Dis bonjour a Sylvain',
                timestamp: new Date('2026-06-01T09:00:00.000Z'),
            }),
            createTestChatMessage({
                id: 'msg-agent-1',
                sender: 'agent',
                text: '',
                toolCalls: [{
                    id: 'call-1',
                    name: 'hello_test',
                    arguments: '{"name":"Sylvain"}',
                }],
                timestamp: new Date('2026-06-01T09:00:01.000Z'),
            }),
            createTestChatMessage({
                id: 'msg-tool-1',
                sender: 'tool',
                text: 'hello_test({"name":"Sylvain"})',
                toolName: 'hello_test',
                timestamp: new Date('2026-06-01T09:00:02.000Z'),
            }),
            createTestChatMessage({
                id: 'msg-tool-result-1',
                sender: 'tool_result',
                text: '{"message":"Bonjour Sylvain"}',
                toolCallId: 'call-1',
                toolName: 'hello_test',
                timestamp: new Date('2026-06-01T09:00:03.000Z'),
            }),
            createTestChatMessage({
                id: 'msg-user-2',
                sender: 'user',
                text: 'Et ensuite ?',
                timestamp: new Date('2026-06-01T09:00:04.000Z'),
            }),
        ]);

        expect(requestBody.messages).toEqual(expect.arrayContaining([
            expect.objectContaining({
                role: 'assistant',
                tool_calls: [expect.objectContaining({ id: 'call-1' })],
            }),
            expect.objectContaining({
                role: 'tool',
                tool_call_id: 'call-1',
                name: 'hello_test',
                content: '{"message":"Bonjour Sylvain"}',
            }),
        ]));
        expect(requestBody.messages.filter((message: { role: string }) => message.role === 'tool')).toHaveLength(1);
        expect(JSON.stringify(requestBody.messages)).not.toContain('hello_test({"name":"Sylvain"})');
    });

    it('downgrades orphan tool results to user text context instead of sending an invalid native tool role', async () => {
        const requestBody = await captureRequestBody([
            createTestChatMessage({
                id: 'msg-user-1',
                sender: 'user',
                text: 'Dis bonjour a Sylvain',
                timestamp: new Date('2026-06-01T09:10:00.000Z'),
            }),
            createTestChatMessage({
                id: 'msg-tool-result-legacy',
                sender: 'tool_result',
                text: '{"message":"Bonjour Sylvain"}',
                toolCallId: 'legacy-call-1',
                toolName: 'hello_test',
                timestamp: new Date('2026-06-01T09:10:01.000Z'),
            }),
            createTestChatMessage({
                id: 'msg-user-2',
                sender: 'user',
                text: 'Relance une nouvelle action',
                timestamp: new Date('2026-06-01T09:10:02.000Z'),
            }),
        ]);

        expect(requestBody.messages).not.toEqual(expect.arrayContaining([
            expect.objectContaining({
                role: 'tool',
                tool_call_id: 'legacy-call-1',
            }),
        ]));
        expect(requestBody.messages).toEqual(expect.arrayContaining([
            expect.objectContaining({
                role: 'user',
                content: expect.stringContaining('[TOOL RESULT: hello_test]'),
            }),
        ]));
    });
});