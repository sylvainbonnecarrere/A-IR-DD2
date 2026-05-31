import { LocalLLMAdapter } from '../../services/adapters/LocalLLMAdapter';
import { LLMProvider } from '../../types';
import { generateContentStream } from '../../services/lmStudioService';

jest.mock('../../services/lmStudioService', () => ({
    generateContentStream: jest.fn(),
}));

describe('LocalLLMAdapter terminal error contract', () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    it('returns a structured terminal error when local streaming fails', async () => {
        (generateContentStream as jest.Mock).mockImplementation(async function* () {
            throw new Error('LMStudio stream error [timeout] {"timeoutMs":600000}: LMStudio request timeout exceeded after 600000ms');
        });

        const adapter = new LocalLLMAdapter(LLMProvider.LMStudio, {
            endpoint: 'http://localhost:1234',
            model: 'local-model',
        });

        const response = await adapter.complete({
            messages: [],
            functions: [],
            systemPrompt: 'system',
        });

        expect(response).toEqual(expect.objectContaining({
            content: '',
            finishReason: 'error',
            terminalError: expect.objectContaining({
                code: 'timeout',
                retryable: false,
                provider: LLMProvider.LMStudio,
                model: 'local-model',
            }),
        }));
    });

    it('extracts a hello_test tool call from a strict local protocol response', async () => {
        (generateContentStream as jest.Mock).mockImplementation(async function* () {
            yield {
                response: {
                    text: '<tool_call>{"name":"hello_test","arguments":{"name":"Sylvain"}}</tool_call>'
                }
            };
        });

        const adapter = new LocalLLMAdapter(LLMProvider.LMStudio, {
            endpoint: 'http://localhost:1234',
            model: 'local-model',
        });

        const response = await adapter.complete({
            messages: [],
            functions: [
                {
                    id: 'tool-hello',
                    name: 'hello_test',
                    description: 'Greets the named user',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            name: { type: 'string' }
                        },
                        required: ['name']
                    },
                    isEnabled: true,
                }
            ],
            systemPrompt: 'system',
        });

        expect(response.finishReason).toBe('tool_calls');
        expect(response.parseTrace).toEqual(expect.objectContaining({
            status: 'tool_call',
            strategy: 'xml',
        }));
        expect(response.toolCalls).toEqual([
            expect.objectContaining({
                name: 'hello_test',
                arguments: { name: 'Sylvain' },
            }),
        ]);
    });

    it('extracts a web_search_py tool call from a strict local protocol response', async () => {
        (generateContentStream as jest.Mock).mockImplementation(async function* () {
            yield {
                response: {
                    text: '<tool_call>{"name":"web_search_py","arguments":{"query":"meteo paris demain","language":"fr"}}</tool_call>'
                }
            };
        });

        const adapter = new LocalLLMAdapter(LLMProvider.LMStudio, {
            endpoint: 'http://localhost:1234',
            model: 'local-model',
        });

        const response = await adapter.complete({
            messages: [],
            functions: [
                {
                    id: 'tool-web',
                    name: 'web_search_py',
                    description: 'Searches the web',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            query: { type: 'string' },
                            language: { type: 'string' }
                        },
                        required: ['query']
                    },
                    isEnabled: true,
                }
            ],
            systemPrompt: 'system',
        });

        expect(response.finishReason).toBe('tool_calls');
        expect(response.toolCalls).toEqual([
            expect.objectContaining({
                name: 'web_search_py',
                arguments: { query: 'meteo paris demain', language: 'fr' },
            }),
        ]);
    });

    it('returns a typed terminal error when the model emits a malformed tool_call block', async () => {
        (generateContentStream as jest.Mock).mockImplementation(async function* () {
            yield {
                response: {
                    text: '<tool_call>{"name":"web_search_py","arguments":</tool_call>'
                }
            };
        });

        const adapter = new LocalLLMAdapter(LLMProvider.LMStudio, {
            endpoint: 'http://localhost:1234',
            model: 'local-model',
        });

        const response = await adapter.complete({
            messages: [],
            functions: [],
            systemPrompt: 'system',
        });

        expect(response.finishReason).toBe('error');
        expect(response.terminalError).toEqual(expect.objectContaining({
            code: 'invalid_tool_call',
            model: 'local-model',
        }));
    });
});