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

    it('forwards hidden privateContext separately from visible tool arguments', async () => {
        const adapterResponses: LLMResponse[] = [
            {
                content: 'Calling web search',
                finishReason: 'tool_calls',
                toolCalls: [
                    {
                        name: 'web_search_py',
                        arguments: { query: 'meteo paris demain' },
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
                durationMs: 9,
                executionId: 'exec-hidden-1',
                runner: 'docker_sandbox',
                metadata: {}
            })
        } as any)) as typeof fetch;

        const tools: ToolRegistryReadModel[] = [
            {
                id: 'tool-web',
                legacyFunctionId: 'fn-web',
                name: 'web_search_py',
                description: 'Native web search',
                inputSchema: { type: 'object' },
                isEnabled: true,
                versionTag: 'v1',
                versionNumber: 1,
                workspaceId: null,
            }
        ];

        const result = await runAgentLoop(
            adapter,
            [
                {
                    id: 'msg-web',
                    sender: 'user',
                    text: 'cherche la meteo de paris demain',
                    timestamp: new Date('2026-04-01T09:00:00.000Z')
                }
            ],
            tools,
            'system',
            {
                prepareToolExecution: ({ toolCall }) => ({
                    args: toolCall.arguments,
                    privateContext: {
                        web_search: {
                            auth: { bearerToken: 'jwt-token' },
                            llm: { provider: 'LLM local (on premise)', model: 'local-model' }
                        }
                    }
                })
            }
        );

        expect(result.finalResponse).toBe('Done');
        expect(result.toolCallLog[0]).toEqual(expect.objectContaining({
            arguments: { query: 'meteo paris demain' },
            executionId: 'exec-hidden-1'
        }));

        const [, requestInit] = (global.fetch as jest.Mock).mock.calls[0];
        expect(JSON.parse(String(requestInit?.body))).toEqual(expect.objectContaining({
            testArgs: { query: 'meteo paris demain' },
            privateContext: {
                web_search: {
                    auth: { bearerToken: 'jwt-token' },
                    llm: { provider: 'LLM local (on premise)', model: 'local-model' }
                }
            }
        }));
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

    it('stops immediately after a deterministic web_search_py transform failure instead of retrying a second mutated web search', async () => {
        const adapterResponses: LLMResponse[] = [
            {
                content: 'Tentative 1',
                finishReason: 'tool_calls',
                toolCalls: [
                    {
                        name: 'web_search_py',
                        arguments: {
                            query: 'prévisions météo demain Paris',
                            num_results: 5,
                            language: 'fr',
                            safe_search: true,
                        },
                        raw: '<tool_call />'
                    }
                ]
            },
            {
                content: 'Tentative 2',
                finishReason: 'tool_calls',
                toolCalls: [
                    {
                        name: 'web_search_py',
                        arguments: {
                            query: 'météo demain Paris',
                            num_results: 5,
                            language: 'fr',
                            safe_search: true,
                        },
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
            ok: true,
            json: async () => ({
                success: true,
                output: {
                    results: [],
                    query: 'prévisions météo demain Paris',
                    normalized_query: '',
                    total_results: 0,
                    error: {
                        step: 'build_search_plan',
                        type: 'ValueError',
                        message: 'QUERY_TRANSFORMATION_FAILED: {"error":"LMStudio API error: 400 - {\\"error\\":\\"Error rendering prompt with jinja template: \\\\\\\"No user query found in messages.\\\\\\\"\\"}"}'
                    }
                },
                durationMs: 42,
                executionId: 'exec-web-transform-failure',
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
                    text: 'Donne moi les prévisions météo pour demain à Paris',
                    timestamp: new Date('2026-04-30T12:00:00.000Z')
                }
            ],
            [
                {
                    id: 'tool-web',
                    legacyFunctionId: 'fn-web',
                    name: 'web_search_py',
                    description: 'Native web search',
                    inputSchema: { type: 'object' },
                    isEnabled: true,
                    versionTag: 'v1',
                    versionNumber: 1,
                    workspaceId: null
                }
            ],
            'system'
        );

        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(adapter.complete).toHaveBeenCalledTimes(1);
        expect(result.finishReason).toBe('error');
        expect(result.finalResponse).toContain('QUERY_TRANSFORMATION_FAILED');
        expect(result.traceLog).toContain('tool.web_search_py.blocking_failure');
        expect(result.toolCallLog).toHaveLength(1);
        expect(result.toolCallLog[0]).toEqual(expect.objectContaining({
            functionName: 'web_search_py',
            status: 'error',
            errorCode: 'QUERY_TRANSFORMATION_FAILED',
            deterministicFailure: true,
        }));
    });

    it('stops immediately after a timeout-based QUERY_TRANSFORMATION_FAILED instead of issuing a second web_search_py call', async () => {
        const adapterResponses: LLMResponse[] = [
            {
                content: 'Tentative 1',
                finishReason: 'tool_calls',
                toolCalls: [
                    {
                        name: 'web_search_py',
                        arguments: {
                            query: 'météo demain Paris',
                            num_results: 5,
                            language: 'fr',
                            safe_search: true,
                        },
                        raw: '<tool_call />'
                    }
                ]
            },
            {
                content: 'Tentative 2',
                finishReason: 'tool_calls',
                toolCalls: [
                    {
                        name: 'web_search_py',
                        arguments: {
                            query: 'météo demain Paris',
                            num_results: 5,
                            language: 'fr',
                            safe_search: true,
                        },
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
            ok: true,
            json: async () => ({
                success: true,
                output: {
                    results: [],
                    query: 'météo demain Paris',
                    normalized_query: '',
                    total_results: 0,
                    error: {
                        step: 'build_search_plan',
                        type: 'TimeoutError',
                        message: 'QUERY_TRANSFORMATION_FAILED: Timeout hidden LLM après 120s.'
                    }
                },
                durationMs: 120000,
                executionId: 'exec-web-timeout-transform-failure',
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
                    text: 'Quelle sera la météo demain à Paris ?',
                    timestamp: new Date('2026-04-30T12:00:00.000Z')
                }
            ],
            [
                {
                    id: 'tool-web',
                    legacyFunctionId: 'fn-web',
                    name: 'web_search_py',
                    description: 'Native web search',
                    inputSchema: { type: 'object' },
                    isEnabled: true,
                    versionTag: 'v1',
                    versionNumber: 1,
                    workspaceId: null
                }
            ],
            'system'
        );

        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(adapter.complete).toHaveBeenCalledTimes(1);
        expect(result.finishReason).toBe('error');
        expect(result.finalResponse).toContain('QUERY_TRANSFORMATION_FAILED');
        expect(result.traceLog).toContain('tool.web_search_py.blocking_failure');
        expect(result.toolCallLog).toHaveLength(1);
        expect(result.toolCallLog[0]).toEqual(expect.objectContaining({
            functionName: 'web_search_py',
            status: 'error',
            errorCode: 'QUERY_TRANSFORMATION_FAILED',
            deterministicFailure: false,
        }));
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

    it('falls back to web_search_py when the local model returns empty for the QA weather phrasing', async () => {
        const adapterResponses: LLMResponse[] = [
            {
                content: '   ',
                finishReason: 'stop',
                rawContent: '',
            },
            {
                content: 'Demain à Paris, le temps sera nuageux avec éclaircies.',
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
                executionId: 'exec-web-weather-fallback',
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
                    text: 'Quel temps fera t il demain à Paris ?',
                    timestamp: new Date('2026-04-29T22:43:21.073Z')
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
                query: 'Quel temps fera t il demain à Paris ?',
                language: 'fr'
            }
        }));
        expect(result.finalResponse).toBe('Demain à Paris, le temps sera nuageux avec éclaircies.');
        expect(result.traceLog).toContain('llm.empty_response_fallback.web_search_py');
        expect(result.toolCallLog[0]).toEqual(expect.objectContaining({
            functionName: 'web_search_py',
            status: 'success',
            executionId: 'exec-web-weather-fallback'
        }));
    });

    it('falls back to web_search_py when the local model returns empty for the QA movie phrasing', async () => {
        const adapterResponses: LLMResponse[] = [
            {
                content: '   ',
                finishReason: 'stop',
                rawContent: '',
            },
            {
                content: 'Voici quelques films français à voir en ce moment.',
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
                output: { results: [{ title: 'Films français en salle', url: 'https://cinema.example/france' }] },
                durationMs: 24,
                executionId: 'exec-web-movie-fallback',
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
                    text: 'Quels films français aller voir en ce moment ?',
                    timestamp: new Date('2026-04-30T08:00:00.000Z')
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
                query: 'Quels films français aller voir en ce moment ?',
                language: 'fr'
            }
        }));
        expect(result.finalResponse).toBe('Voici quelques films français à voir en ce moment.');
        expect(result.traceLog).toContain('llm.empty_response_fallback.web_search_py');
        expect(result.toolCallLog[0]).toEqual(expect.objectContaining({
            functionName: 'web_search_py',
            status: 'success',
            executionId: 'exec-web-movie-fallback'
        }));
    });

    it('returns a grounded fallback summary when the local model goes empty after a successful web_search_py tool result', async () => {
        const adapterResponses: LLMResponse[] = [
            {
                content: '',
                finishReason: 'tool_calls',
                toolCalls: [
                    {
                        name: 'web_search_py',
                        arguments: { query: 'Donne moi la météo pour demain à Paris', language: 'fr' },
                        raw: '<tool_call />'
                    }
                ]
            },
            {
                content: '   ',
                finishReason: 'stop',
                rawContent: '',
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
                output: {
                    query: 'Donne moi la météo pour demain à Paris',
                    normalized_query: 'météo et températures minimales et maximales à Paris le 30/04/2026',
                    total_results: 1,
                    results: [
                        {
                            title: 'Météo Paris demain',
                            url: 'https://weather.example/paris-demain',
                            snippet: 'Prévision pour demain à Paris avec températures minimales et maximales.'
                        }
                    ],
                    trace: {
                        queries: [
                            { query: 'meteo paris demain', status: 'completed' }
                        ],
                        selected_sources: [
                            {
                                title: 'Météo Paris demain',
                                url: 'https://weather.example/paris-demain'
                            }
                        ]
                    }
                },
                durationMs: 42,
                executionId: 'exec-web-qa-1',
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
                    text: 'Donne moi la météo pour demain à Paris',
                    timestamp: new Date('2026-04-29T09:00:00.000Z')
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

        expect(result.finishReason).toBe('stop');
        expect(result.finalResponse).toContain('J\'ai bien exécuté la recherche web');
        expect(result.finalResponse).toContain('météo et températures minimales et maximales à Paris le 30/04/2026');
        expect(result.finalResponse).toContain('https://weather.example/paris-demain');
        expect(result.finalResponse).not.toContain('[Erreur LLM]');
        expect(result.traceLog).toContain('llm.empty_response_after_tool_result_fallback.web_search_py');
    });
});