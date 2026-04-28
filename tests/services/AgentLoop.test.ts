import { runAgentLoop } from '../../services/llm/AgentLoop';
import type { ILLMAdapter, LLMResponse } from '../../services/adapters/ILLMAdapter';
import { LLMProvider } from '../../types';
import type { ToolRegistryReadModel } from '../../types/function.types';

describe('AgentLoop canonical tool registry convergence', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
        global.fetch = originalFetch;
        jest.restoreAllMocks();
    });

    it('executes sandbox runs with canonical toolId and legacy functionId compatibility payload', async () => {
        const adapterResponses: LLMResponse[] = [
            {
                content: 'Calling tool',
                finishReason: 'tool_calls',
                toolCalls: [
                    {
                        name: 'demo_tool',
                        arguments: { city: 'Paris' },
                        raw: '<tool_call />'
                    }
                ]
            },
            {
                content: 'Done',
                finishReason: 'stop'
            }
        ];

        const adapter: ILLMAdapter = {
            provider: LLMProvider.LMStudio,
            supportsNativeToolCalling: false,
            complete: jest.fn(async () => adapterResponses.shift() as LLMResponse)
        };

        global.fetch = jest.fn(async () => ({
            ok: true,
            json: async () => ({
                success: true,
                output: { ok: true },
                durationMs: 12,
                executionId: 'exec-1',
                runner: 'docker_sandbox',
                metadata: {
                    artifacts: [{ path: 'output/report.json', kind: 'json' }]
                }
            })
        } as any)) as typeof fetch;

        const tools: ToolRegistryReadModel[] = [
            {
                id: 'tool-123',
                legacyFunctionId: 'fn-legacy-123',
                name: 'demo_tool',
                description: 'Demo tool',
                inputSchema: { type: 'object' },
                isEnabled: true,
                versionTag: 'v3',
                versionNumber: 3,
                workspaceId: 'ws-1'
            }
        ];

        const result = await runAgentLoop(
            adapter,
            [
                {
                    id: 'msg-1',
                    sender: 'user',
                    text: 'Run the demo tool',
                    timestamp: new Date('2026-03-19T12:00:00.000Z')
                }
            ],
            tools,
            'system'
        );

        expect(result.finalResponse).toBe('Done');
        expect(result.toolCallLog).toEqual([
            expect.objectContaining({
                toolId: 'tool-123',
                functionId: 'fn-legacy-123',
                executionId: 'exec-1'
            })
        ]);

        expect(global.fetch).toHaveBeenCalledTimes(1);
        const [, requestInit] = (global.fetch as jest.Mock).mock.calls[0];
        expect(JSON.parse(String(requestInit?.body))).toEqual(expect.objectContaining({
            functionId: 'fn-legacy-123',
            toolSelection: {
                toolId: 'tool-123',
                versionRef: {
                    versionTag: 'v3',
                    versionNumber: 3,
                    workspaceId: 'ws-1'
                }
            }
        }));
    });

    it('acceptance: executes hello_test once and returns the follow-up answer', async () => {
        const adapterResponses: LLMResponse[] = [
            {
                content: '',
                finishReason: 'tool_calls',
                toolCalls: [
                    {
                        name: 'hello_test',
                        arguments: { name: 'Sylvain' },
                        raw: '<tool_call />',
                        confidence: 0.95,
                    }
                ]
            },
            {
                content: 'Ton nom est maintenant enregistré dans ma mémoire.',
                finishReason: 'stop'
            }
        ];

        const requestLog: Array<{ messages: any[] }> = [];

        const adapter: ILLMAdapter = {
            provider: LLMProvider.LMStudio,
            supportsNativeToolCalling: false,
            complete: jest.fn(async (request) => {
                requestLog.push({ messages: request.messages });
                return adapterResponses.shift() as LLMResponse;
            })
        };

        global.fetch = jest.fn(async () => ({
            ok: true,
            json: async () => ({
                success: true,
                output: { result: 'Ton nom est maintenant enregistré dans ma mémoire.' },
                durationMs: 15,
                executionId: 'exec-hello-1',
                runner: 'docker_sandbox',
                metadata: {}
            })
        } as any)) as typeof fetch;

        const tools: ToolRegistryReadModel[] = [
            {
                id: 'tool-hello',
                legacyFunctionId: 'fn-hello',
                name: 'hello_test',
                description: 'Greets the named user',
                inputSchema: { type: 'object' },
                isEnabled: true,
                versionTag: 'v1',
                versionNumber: 1,
                workspaceId: 'ws-hello'
            }
        ];

        const result = await runAgentLoop(
            adapter,
            [
                {
                    id: 'msg-hello',
                    sender: 'user',
                    text: 'Bonjour, je m\'appelle Sylvain',
                    timestamp: new Date('2026-04-01T09:00:00.000Z')
                }
            ],
            tools,
            'system'
        );

        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(result.finalResponse).toBe('Ton nom est maintenant enregistré dans ma mémoire.');
        expect(result.toolCallLog[0]).toEqual(expect.objectContaining({
            functionName: 'hello_test',
            executionId: 'exec-hello-1',
            status: 'success',
        }));
        expect(requestLog).toHaveLength(2);
        expect(requestLog[1].messages).toEqual(expect.arrayContaining([
            expect.objectContaining({
                sender: 'tool_result',
                text: expect.stringContaining('post_tool_contract'),
            })
        ]));
        expect(requestLog[1].messages).toEqual(expect.arrayContaining([
            expect.objectContaining({
                sender: 'tool_result',
                text: expect.stringContaining('Do not greet the user again.'),
            })
        ]));
    });

    it('blocks repeated deterministic tool failures for the same tool signature', async () => {
        const adapterResponses: LLMResponse[] = [
            {
                content: 'Calling native tool',
                finishReason: 'tool_calls',
                toolCalls: [
                    {
                        name: 'web_search_py',
                        arguments: { query: 'meteo demain', language: 'fr' },
                        raw: '<tool_call />'
                    }
                ]
            },
            {
                content: 'Retrying same tool',
                finishReason: 'tool_calls',
                toolCalls: [
                    {
                        name: 'web_search_py',
                        arguments: { query: 'meteo demain', language: 'fr' },
                        raw: '<tool_call />'
                    }
                ]
            }
        ];

        const adapter: ILLMAdapter = {
            provider: LLMProvider.LMStudio,
            supportsNativeToolCalling: false,
            complete: jest.fn(async () => adapterResponses.shift() as LLMResponse)
        };

        global.fetch = jest.fn(async () => ({
            ok: false,
            json: async () => ({
                error: 'Provisionnement plateforme requis avant execution.',
                errorDetails: {
                    code: 'PLATFORM_PROVISION_REQUIRED',
                    subsystem: 'build_preparation',
                    retryable: false,
                }
            })
        } as any)) as typeof fetch;

        const tools: ToolRegistryReadModel[] = [
            {
                id: 'tool-native',
                legacyFunctionId: 'fn-native',
                name: 'web_search_py',
                description: 'Native web search',
                inputSchema: { type: 'object' },
                isEnabled: true,
                versionTag: 'v1',
                versionNumber: 1,
                workspaceId: null
            }
        ];

        const result = await runAgentLoop(
            adapter,
            [
                {
                    id: 'msg-1',
                    sender: 'user',
                    text: 'Cherche la meteo',
                    timestamp: new Date('2026-03-29T12:00:00.000Z')
                }
            ],
            tools,
            'system'
        );

        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(result.toolCallLog).toHaveLength(2);
        expect(result.toolCallLog[0]).toEqual(expect.objectContaining({
            status: 'error',
            errorCode: 'PLATFORM_PROVISION_REQUIRED',
            errorSubsystem: 'build_preparation',
            deterministicFailure: true,
        }));
        expect(result.toolCallLog[1]).toEqual(expect.objectContaining({
            status: 'error',
            duplicateSuppressed: true,
            deterministicFailure: true,
            errorCode: 'PLATFORM_PROVISION_REQUIRED',
        }));
        expect(result.finalResponse).toContain("[Arrêt de sécurité]");
    });

    it('stops a qa-style fourfold retry storm on web_search_py after the first deterministic provisioning failure', async () => {
        const repeatedToolCall = {
            name: 'web_search_py',
            arguments: {
                query: 'météo demain prévision temps',
                num_results: 5,
                language: 'fr',
                safe_search: true,
            },
            raw: '<tool_call />'
        };

        const adapterResponses: LLMResponse[] = [
            {
                content: 'Tentative 1',
                finishReason: 'tool_calls',
                toolCalls: [repeatedToolCall]
            },
            {
                content: 'Tentative 2',
                finishReason: 'tool_calls',
                toolCalls: [repeatedToolCall]
            },
            {
                content: 'Tentative 3',
                finishReason: 'tool_calls',
                toolCalls: [repeatedToolCall]
            },
            {
                content: 'Tentative 4',
                finishReason: 'tool_calls',
                toolCalls: [repeatedToolCall]
            }
        ];

        const adapter: ILLMAdapter = {
            provider: LLMProvider.LMStudio,
            supportsNativeToolCalling: false,
            complete: jest.fn(async () => adapterResponses.shift() as LLMResponse)
        };

        global.fetch = jest.fn(async () => ({
            ok: false,
            json: async () => ({
                error: 'This native tool version declares dependencies and requires platform provisioning before sandbox execution.',
                errorDetails: {
                    code: 'PLATFORM_PROVISION_REQUIRED',
                    subsystem: 'build_preparation',
                    retryable: false,
                }
            })
        } as any)) as typeof fetch;

        const tools: ToolRegistryReadModel[] = [
            {
                id: 'tool-web-search',
                legacyFunctionId: 'fn-web-search',
                name: 'web_search_py',
                description: 'Native web search',
                inputSchema: { type: 'object' },
                isEnabled: true,
                versionTag: 'v1',
                versionNumber: 1,
                workspaceId: null
            }
        ];

        const result = await runAgentLoop(
            adapter,
            [
                {
                    id: 'msg-qa-web-search',
                    sender: 'user',
                    text: 'Cherche la météo de demain',
                    timestamp: new Date('2026-03-29T13:00:00.000Z')
                }
            ],
            tools,
            'system'
        );

        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(result.toolCallLog).toHaveLength(2);
        expect(result.toolCallLog[0]).toEqual(expect.objectContaining({
            functionName: 'web_search_py',
            status: 'error',
            errorCode: 'PLATFORM_PROVISION_REQUIRED',
            errorSubsystem: 'build_preparation',
            deterministicFailure: true,
        }));
        expect(result.toolCallLog[1]).toEqual(expect.objectContaining({
            functionName: 'web_search_py',
            status: 'error',
            errorCode: 'PLATFORM_PROVISION_REQUIRED',
            errorSubsystem: 'build_preparation',
            deterministicFailure: true,
            duplicateSuppressed: true,
        }));
        expect(result.finalResponse).toContain('[Arrêt de sécurité]');
        expect(adapter.complete).toHaveBeenCalledTimes(2);
    });

    it('deduplicates identical tool calls emitted in the same iteration', async () => {
        const adapterResponses: LLMResponse[] = [
            {
                content: 'Calling tool twice',
                finishReason: 'tool_calls',
                toolCalls: [
                    {
                        name: 'demo_tool',
                        arguments: { city: 'Paris' },
                        raw: '<tool_call />'
                    },
                    {
                        name: 'demo_tool',
                        arguments: { city: 'Paris' },
                        raw: '<tool_call />'
                    }
                ]
            },
            {
                content: 'Done',
                finishReason: 'stop'
            }
        ];

        const adapter: ILLMAdapter = {
            provider: LLMProvider.LMStudio,
            supportsNativeToolCalling: false,
            complete: jest.fn(async () => adapterResponses.shift() as LLMResponse)
        };

        global.fetch = jest.fn(async () => ({
            ok: true,
            json: async () => ({
                success: true,
                output: { ok: true },
                durationMs: 12,
                executionId: 'exec-1',
                runner: 'docker_sandbox',
                metadata: {}
            })
        } as any)) as typeof fetch;

        const tools: ToolRegistryReadModel[] = [
            {
                id: 'tool-123',
                legacyFunctionId: 'fn-legacy-123',
                name: 'demo_tool',
                description: 'Demo tool',
                inputSchema: { type: 'object' },
                isEnabled: true,
                versionTag: 'v3',
                versionNumber: 3,
                workspaceId: 'ws-1'
            }
        ];

        const result = await runAgentLoop(
            adapter,
            [
                {
                    id: 'msg-1',
                    sender: 'user',
                    text: 'Run the demo tool',
                    timestamp: new Date('2026-03-19T12:00:00.000Z')
                }
            ],
            tools,
            'system'
        );

        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(result.toolCallLog).toHaveLength(2);
        expect(result.toolCallLog[0].status).toBe('success');
        expect(result.toolCallLog[1]).toEqual(expect.objectContaining({
            status: 'success',
            duplicateSuppressed: true,
        }));
    });

    it('returns a structured terminal loop result when the local adapter fails', async () => {
        const adapter: ILLMAdapter = {
            provider: LLMProvider.LMStudio,
            supportsNativeToolCalling: false,
            complete: jest.fn(async () => ({
                content: '',
                finishReason: 'error',
                rawContent: 'LMStudio request timeout exceeded after 600000ms',
                terminalError: {
                    code: 'timeout',
                    message: 'LMStudio request timeout exceeded after 600000ms',
                    retryable: false,
                    provider: LLMProvider.LMStudio,
                    model: 'local-model',
                }
            }))
        };

        const result = await runAgentLoop(
            adapter,
            [
                {
                    id: 'msg-1',
                    sender: 'user',
                    text: 'Run something',
                    timestamp: new Date('2026-03-31T12:00:00.000Z')
                }
            ],
            [],
            'system'
        );

        expect(result).toEqual(expect.objectContaining({
            finalResponse: '[Erreur LLM] LMStudio request timeout exceeded after 600000ms',
            finishReason: 'error',
            terminalError: expect.objectContaining({
                code: 'timeout',
                model: 'local-model',
            }),
        }));
    });

    it('returns a visible terminal error when the local adapter emits an empty response without tool calls', async () => {
        const adapter: ILLMAdapter = {
            provider: LLMProvider.LMStudio,
            supportsNativeToolCalling: false,
            complete: jest.fn(async () => ({
                content: '   ',
                finishReason: 'stop',
                rawContent: '',
            }))
        };

        const result = await runAgentLoop(
            adapter,
            [
                {
                    id: 'msg-1',
                    sender: 'user',
                    text: 'Search the web',
                    timestamp: new Date('2026-03-31T12:00:00.000Z')
                }
            ],
            [],
            'system'
        );

        expect(result).toEqual(expect.objectContaining({
            finalResponse: '[Erreur LLM] Le modele local a retourne une reponse vide sans appel d\'outil.',
            finishReason: 'error',
            terminalError: expect.objectContaining({
                code: 'empty_response',
                provider: LLMProvider.LMStudio,
            }),
        }));
    });

    it('falls back to web_search_py when the local model returns empty for an explicit web request', async () => {
        const adapterResponses: LLMResponse[] = [
            {
                content: '   ',
                finishReason: 'stop',
                rawContent: '',
            },
            {
                content: 'Voici la synthese finale.',
                finishReason: 'stop',
            }
        ];

        const adapter: ILLMAdapter = {
            provider: LLMProvider.LMStudio,
            supportsNativeToolCalling: false,
            complete: jest.fn(async () => adapterResponses.shift() as LLMResponse)
        };

        global.fetch = jest.fn(async () => ({
            ok: true,
            json: async () => ({
                success: true,
                output: { results: [{ title: 'Meteo Paris', url: 'https://meteo.example/paris' }] },
                durationMs: 18,
                executionId: 'exec-web-fallback',
                runner: 'docker_sandbox',
                metadata: {}
            })
        } as any)) as typeof fetch;

        const result = await runAgentLoop(
            adapter,
            [
                {
                    id: 'msg-1',
                    sender: 'user',
                    text: 'En consultant internet, donne moi la meteo sur Paris pour demain',
                    timestamp: new Date('2026-04-28T12:00:00.000Z')
                }
            ],
            [
                {
                    id: 'tool-web',
                    legacyFunctionId: 'fn-web',
                    name: 'web_search_py',
                    description: 'Native web search',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            query: { type: 'string' },
                            language: { type: 'string' }
                        },
                        required: ['query']
                    },
                    isEnabled: true,
                    versionTag: 'v1',
                    versionNumber: 1,
                    workspaceId: null
                }
            ],
            'system'
        );

        expect(global.fetch).toHaveBeenCalledTimes(1);
        const [, requestInit] = (global.fetch as jest.Mock).mock.calls[0];
        expect(JSON.parse(String(requestInit?.body))).toEqual(expect.objectContaining({
            functionId: 'fn-web',
            testArgs: {
                query: 'En consultant internet, donne moi la meteo sur Paris pour demain',
                language: 'fr'
            }
        }));
        expect(result.finalResponse).toBe('Voici la synthese finale.');
        expect(result.traceLog).toContain('llm.empty_response_fallback.web_search_py');
        expect(result.toolCallLog[0]).toEqual(expect.objectContaining({
            functionName: 'web_search_py',
            status: 'success',
            executionId: 'exec-web-fallback'
        }));
    });
});