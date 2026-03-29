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
});