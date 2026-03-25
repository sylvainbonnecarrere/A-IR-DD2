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
});