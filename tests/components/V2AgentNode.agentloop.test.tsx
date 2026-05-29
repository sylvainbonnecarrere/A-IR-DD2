import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { V2AgentNode } from '../../components/V2AgentNode';
import { LLMCapability, LLMProvider, RobotId, type Agent } from '../../types';
import type { UserFunction } from '../../types/function.types';

const mockRunAgentLoop = jest.fn();
const mockCreateAdapter = jest.fn();
const mockAddNodeMessage = jest.fn();
const mockSetNodeExecuting = jest.fn();
const mockEnqueueEntry = jest.fn();
const mockLoadFunctions = jest.fn();
const mockExecuteAgentToolCall = jest.fn();
const llmServiceMocks = jest.requireMock('../../services/llmService') as { generateContent: jest.Mock; generateContentStream: jest.Mock };
const textUtilsMocks = jest.requireMock('../../utils/textUtils') as { countChars: jest.Mock; countTokens: jest.Mock; countWords: jest.Mock; countSentences: jest.Mock; countMessages: jest.Mock };
const runtimeConfigResolverMocks = jest.requireMock('../../services/runtimeConfigResolver') as { resolveHistoryRuntimeConfig: jest.Mock };

let runtimeStoreState: Record<string, unknown>;
let designStoreState: Record<string, unknown>;
let functionStoreState: { functions: UserFunction[]; loadFunctions: (workflowId?: string) => Promise<void> };
let workflowCanvasContextState: Record<string, unknown>;

const agentInstance = {
    id: 'instance-1',
    prototypeId: 'agent-1',
    workflowId: 'wf-1',
    name: 'Archi instance',
    position: { x: 0, y: 0 },
    configuration_json: undefined,
} as any;

jest.mock('reactflow', () => ({
    Handle: () => null,
    Position: { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' },
}));

jest.mock('../../components/UI', () => ({
    Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
        <button {...props}>{children}</button>
    ),
}));

jest.mock('../../components/Icons', () => ({
    CloseIcon: () => null,
    EditIcon: () => null,
    SendIcon: () => null,
    UploadIcon: () => null,
    ImageIcon: () => null,
    ErrorIcon: () => null,
    ExpandIcon: () => null,
    HistorySynthesisIcon: (props: React.HTMLAttributes<HTMLDivElement>) => <div data-testid="history-synthesis-icon" {...props} />,
    MaximizeIcon: () => null,
}));

jest.mock('../../components/modals/ConfirmationModal', () => ({
    ConfirmationModal: () => null,
}));

jest.mock('../../components/panels/WebSearchGroundingPanel', () => ({
    WebSearchGroundingPanel: () => null,
}));

jest.mock('../../components/workflow/ToolCallBlock', () => ({
    ToolCallBlock: () => null,
}));

jest.mock('../../hooks/useLocalization', () => ({
    useLocalization: jest.fn(() => ({
        t: (key: string) => key,
    })),
}));

jest.mock('../../hooks/useJournalQueue', () => ({
    useJournalQueue: jest.fn(() => ({
        enqueueEntry: mockEnqueueEntry,
    })),
}));

jest.mock('../../hooks/useAuth', () => ({
    useAuth: jest.fn(() => ({
        accessToken: 'token-123',
    })),
}));

jest.mock('../../stores/useRuntimeStore', () => ({
    useRuntimeStore: jest.fn((selector?: (state: Record<string, unknown>) => unknown) => (
        selector ? selector(runtimeStoreState) : runtimeStoreState
    )),
}));

jest.mock('../../stores/useDesignStore', () => {
    const actual = jest.requireActual('../../stores/useDesignStore');

    return {
        ...actual,
        useDesignStore: jest.fn((selector?: (state: Record<string, unknown>) => unknown) => (
            selector ? selector(designStoreState) : designStoreState
        )),
    };
});

jest.mock('../../stores/useFunctionStore', () => ({
    useFunctionStore: Object.assign(
        jest.fn((selector?: (state: { functions: UserFunction[]; loadFunctions: (workflowId?: string) => Promise<void> }) => unknown) => (
            selector ? selector(functionStoreState) : functionStoreState
        )),
        {
            getState: () => functionStoreState,
        }
    ),
}));

jest.mock('../../contexts/WorkflowCanvasContext', () => ({
    useWorkflowCanvasContext: jest.fn(() => workflowCanvasContextState),
}));

jest.mock('../../services/llmService', () => ({
    generateContent: jest.fn(),
    generateContentStream: jest.fn(),
}));

jest.mock('../../services/adapters/AdapterFactory', () => ({
    createAdapter: (...args: unknown[]) => mockCreateAdapter(...args),
}));

jest.mock('../../services/llm/AgentLoop', () => ({
    runAgentLoop: (...args: unknown[]) => mockRunAgentLoop(...args),
}));

jest.mock('../../services/agentToolExecution', () => ({
    executeAgentToolCall: (...args: unknown[]) => mockExecuteAgentToolCall(...args),
    parseToolCallArguments: (value: unknown) => {
        if (typeof value === 'string') {
            return JSON.parse(value);
        }

        return value;
    },
}));

jest.mock('../../utils/fileUtils', () => ({
    fileToBase64: jest.fn(),
    fileToText: jest.fn(),
}));

jest.mock('../../utils/toolExecutor', () => ({
    executeTool: jest.fn(),
}));

jest.mock('../../utils/textUtils', () => ({
    countChars: jest.fn(() => 0),
    countTokens: jest.fn(() => 0),
    countWords: jest.fn(() => 0),
    countSentences: jest.fn(() => 0),
    countMessages: jest.fn(() => 0),
}));

jest.mock('../../utils/llmProviderUtils', () => ({
    isLLMConfigured: jest.fn(() => true),
    isLocalProvider: jest.fn(() => false),
}));

jest.mock('../../services/runtimeConfigResolver', () => ({
    resolveAgentRuntimeConfig: jest.fn(() => ({
        config: { provider: LLMProvider.Gemini, apiKey: 'test-key' },
        credential: 'test-key',
    })),
    resolveHistoryRuntimeConfig: jest.fn(() => ({
        config: null,
        credential: null,
    })),
}));

jest.mock('../../services/bosRunProjectionService', () => ({
    buildBosHydrationFingerprint: jest.fn(() => ''),
    hydrateToolMessagesFromPersistedRuns: jest.fn(async (messages: unknown) => messages),
}));

const createFunction = (overrides: Partial<UserFunction> = {}): UserFunction => ({
    _id: 'legacy-weather',
    toolId: 'tool.weather',
    name: 'Weather Tool',
    description: 'Returns weather data',
    language: 'python',
    origin: 'custom',
    userId: 'user-1',
    workflowId: 'wf-1',
    inputSchema: {},
    outputSchema: {},
    codePath: 'tools/weather.py',
    resolvedCodePath: 'tools/weather.py',
    codePathRoot: 'workspace_source',
    codeInline: 'def run(context, args):\n    return {"ok": True}',
    dependencies: [],
    isEnabled: true,
    isReadonly: false,
    version: 3,
    versionTag: 'v3',
    tags: ['weather'],
    createdAt: '2026-03-23T10:00:00.000Z',
    updatedAt: '2026-03-23T10:00:00.000Z',
    ...overrides,
});

const baseAgent: Agent = {
    id: 'agent-1',
    name: 'Archi Agent',
    role: 'Operator',
    systemPrompt: 'Use tools when relevant',
    llmProvider: LLMProvider.Gemini,
    model: 'gemini-2.5-flash',
    capabilities: [LLMCapability.Chat, LLMCapability.FunctionCalling],
    tools: [],
    functionIds: ['legacy-weather'],
    toolSelections: [{ toolId: 'tool.weather' }],
    creator_id: RobotId.Archi,
    created_at: '2026-03-23T10:00:00.000Z',
    updated_at: '2026-03-23T10:00:00.000Z',
};

describe('V2AgentNode AgentLoop integration', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
            configurable: true,
            value: jest.fn(),
        });
        jest.spyOn(console, 'warn').mockImplementation(() => {});

        const executingNodeIds = new Set<string>();

        runtimeStoreState = {
            getIsNodeMinimized: jest.fn(() => false),
            getNodeMessages: jest.fn(() => []),
            getNodeInvisibleHistorySummary: jest.fn(() => null),
            addNodeMessage: mockAddNodeMessage,
            setNodeInvisibleHistorySummary: jest.fn(),
            setNodeMessages: jest.fn(),
            isNodeExecuting: jest.fn((nodeId: string) => executingNodeIds.has(nodeId)),
            setNodeExecuting: jest.fn((nodeId: string, isExecuting: boolean) => {
                mockSetNodeExecuting(nodeId, isExecuting);
                if (isExecuting) {
                    executingNodeIds.add(nodeId);
                    return;
                }

                executingNodeIds.delete(nodeId);
            }),
            setImagePanelOpen: jest.fn(),
            setImageModificationPanelOpen: jest.fn(),
            setFullscreenImage: jest.fn(),
            setFullscreenChatNodeId: jest.fn(),
            llmConfigs: [],
            localLLMProfiles: [],
        };

        textUtilsMocks.countChars.mockReturnValue(0);
        textUtilsMocks.countTokens.mockReturnValue(0);
        textUtilsMocks.countWords.mockReturnValue(0);
        textUtilsMocks.countSentences.mockReturnValue(0);
        textUtilsMocks.countMessages.mockReturnValue(0);
        llmServiceMocks.generateContent.mockResolvedValue({ text: 'Résumé invisible' });
        runtimeConfigResolverMocks.resolveHistoryRuntimeConfig.mockReturnValue({
            config: null,
            credential: null,
        });

        designStoreState = {
            agentInstances: [agentInstance],
            selectAgent: jest.fn(),
        };

        workflowCanvasContextState = {
            navigationHandler: null,
            onDeleteNode: jest.fn(),
            onToggleNodeMinimize: jest.fn(),
            onUpdateNodePosition: jest.fn(),
            onOpenImagePanel: jest.fn(),
            onOpenImageModificationPanel: jest.fn(),
            onOpenVideoPanel: jest.fn(),
            onOpenMapsPanel: jest.fn(),
            onOpenFullscreen: jest.fn(),
        };

        functionStoreState = {
            functions: [
                createFunction(),
                createFunction({
                    _id: 'legacy-extra',
                    toolId: 'tool.extra',
                    name: 'Extra Tool',
                    isEnabled: true,
                }),
                createFunction({
                    _id: 'legacy-disabled',
                    toolId: 'tool.disabled',
                    name: 'Disabled Tool',
                    isEnabled: false,
                }),
            ],
            loadFunctions: mockLoadFunctions,
        };

        mockLoadFunctions.mockImplementation(async () => undefined);

        mockCreateAdapter.mockReturnValue({ provider: LLMProvider.Gemini });
        mockRunAgentLoop.mockResolvedValue({
            finalResponse: 'All done',
            iterations: 2,
            toolCallLog: [
                {
                    id: 'tool-msg-1',
                    toolId: 'tool.weather',
                    functionId: 'legacy-weather',
                    functionName: 'Weather Tool',
                    arguments: { city: 'Paris' },
                    result: { ok: true },
                    status: 'success',
                    durationMs: 18,
                    executionId: 'exec-1',
                    runner: 'docker_sandbox',
                    artifacts: [{ path: 'output/report.json', kind: 'json' }],
                    timestamp: new Date('2026-03-23T10:00:00.000Z'),
                },
            ],
        });
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('toggles minimize without requesting any position update', () => {
        render(
            <V2AgentNode
                id="node-1"
                selected={false}
                xPos={0}
                yPos={0}
                zIndex={1}
                dragging={false}
                data={{
                    robotId: 'archi',
                    label: 'Archi',
                    agent: baseAgent,
                    workflowId: 'wf-1',
                    agentInstance,
                }}
                type="default"
                isConnectable={true}
            />
        );

        fireEvent.click(screen.getByTitle('minimize'));

        expect(workflowCanvasContextState.onToggleNodeMinimize).toHaveBeenCalledWith('node-1');
        expect(workflowCanvasContextState.onUpdateNodePosition).not.toHaveBeenCalled();
    });

    it('toggles restore without requesting any position update', () => {
        runtimeStoreState = {
            ...runtimeStoreState,
            getIsNodeMinimized: jest.fn(() => true),
        };

        render(
            <V2AgentNode
                id="node-1"
                selected={false}
                xPos={0}
                yPos={0}
                zIndex={1}
                dragging={false}
                data={{
                    robotId: 'archi',
                    label: 'Archi',
                    agent: baseAgent,
                    workflowId: 'wf-1',
                    agentInstance,
                }}
                type="default"
                isConnectable={true}
            />
        );

        fireEvent.click(screen.getByTitle('restore_size'));

        expect(workflowCanvasContextState.onToggleNodeMinimize).toHaveBeenCalledWith('node-1');
        expect(workflowCanvasContextState.onUpdateNodePosition).not.toHaveBeenCalled();
    });

    it('passes only the agent-selected enabled functions to AgentLoop and projects tool log plus final response into runtime messages', async () => {
        render(
            <V2AgentNode
                id="node-1"
                selected={false}
                xPos={0}
                yPos={0}
                zIndex={1}
                dragging={false}
                data={{
                    robotId: 'archi',
                    label: 'Archi',
                    agent: baseAgent,
                    workflowId: 'wf-1',
                    agentInstance,
                }}
                type="default"
                isConnectable={true}
            />
        );

        fireEvent.change(screen.getByPlaceholderText('type_message_placeholder'), {
            target: { value: 'Check Paris weather' },
        });
        fireEvent.submit(screen.getByPlaceholderText('type_message_placeholder').closest('form')!);

        await waitFor(() => {
            expect(mockRunAgentLoop).toHaveBeenCalledTimes(1);
        });

        expect(mockRunAgentLoop).toHaveBeenCalledWith(
            expect.anything(),
            [
                expect.objectContaining({
                    sender: 'user',
                    text: 'Check Paris weather',
                }),
            ],
            [
                expect.objectContaining({
                    _id: 'legacy-weather',
                    toolId: 'tool.weather',
                    isEnabled: true,
                }),
            ],
            'Use tools when relevant',
            expect.objectContaining({
                authToken: 'token-123',
                onEvent: expect.any(Function),
            })
        );

        expect(mockRunAgentLoop.mock.calls[0][2]).toHaveLength(1);

        expect(mockAddNodeMessage).toHaveBeenCalledWith(
            'node-1',
            expect.objectContaining({
                sender: 'user',
                text: 'Check Paris weather',
            })
        );

        expect(mockAddNodeMessage).toHaveBeenCalledWith(
            'node-1',
            expect.objectContaining({
                id: 'tool-msg-1',
                sender: 'tool',
                toolCallRecord: expect.objectContaining({
                    toolId: 'tool.weather',
                    functionId: 'legacy-weather',
                    executionId: 'exec-1',
                    artifacts: [{ path: 'output/report.json', kind: 'json' }],
                }),
            })
        );

        expect(mockAddNodeMessage).toHaveBeenCalledWith(
            'node-1',
            expect.objectContaining({
                sender: 'agent',
                text: 'All done',
            })
        );

        expect(mockEnqueueEntry).toHaveBeenCalledWith(
            'wf-1',
            'instance-1',
            'chat',
            expect.objectContaining({
                role: 'user',
                content: 'Check Paris weather',
            })
        );
    });

    it('continues the native provider flow after a tool result even when Chat is not explicitly enabled', async () => {
        const nodeMessages: Record<string, any[]> = {};

        runtimeStoreState = {
            ...runtimeStoreState,
            getNodeMessages: jest.fn((nodeId: string) => nodeMessages[nodeId] ?? []),
            addNodeMessage: jest.fn((nodeId: string, message: any) => {
                nodeMessages[nodeId] = [...(nodeMessages[nodeId] ?? []), message];
            }),
            setNodeMessages: jest.fn((nodeId: string, messages: any[]) => {
                nodeMessages[nodeId] = messages;
            }),
        };

        const nativeToolAgent: Agent = {
            ...baseAgent,
            capabilities: [LLMCapability.FunctionCalling],
        };

        mockCreateAdapter.mockReturnValue(null);
        mockExecuteAgentToolCall.mockResolvedValue({
            executedArguments: { city: 'Paris' },
            result: { summary: 'Paris weather: sun' },
            executionId: 'exec-native-1',
            runner: 'docker_sandbox',
            exitCode: 0,
            failureKind: undefined,
            artifacts: undefined,
        });
        llmServiceMocks.generateContentStream
            .mockImplementationOnce(async function* () {
                yield {
                    response: {
                        toolCalls: [{ id: 'tool-call-1', name: 'Weather Tool', arguments: JSON.stringify({ city: 'Paris' }) }],
                    },
                };
            })
            .mockImplementationOnce(async function* () {
                yield {
                    response: {
                        text: 'Paris is sunny',
                    },
                };
            });

        render(
            <V2AgentNode
                id="node-1"
                selected={false}
                xPos={0}
                yPos={0}
                zIndex={1}
                dragging={false}
                data={{
                    robotId: 'archi',
                    label: 'Archi',
                    agent: nativeToolAgent,
                    workflowId: 'wf-1',
                    agentInstance,
                }}
                type="default"
                isConnectable={true}
            />
        );

        fireEvent.change(screen.getByPlaceholderText('type_message_placeholder'), {
            target: { value: 'Check Paris weather' },
        });
        fireEvent.submit(screen.getByPlaceholderText('type_message_placeholder').closest('form')!);

        await waitFor(() => {
            expect(mockExecuteAgentToolCall).toHaveBeenCalledTimes(1);
            expect(llmServiceMocks.generateContentStream).toHaveBeenCalledTimes(2);
        });

        expect(llmServiceMocks.generateContentStream.mock.calls[1][4]).toEqual(expect.arrayContaining([
            expect.objectContaining({
                sender: 'user',
                text: expect.stringContaining('tool_results_context'),
            }),
        ]));
        expect(nodeMessages['node-1']).toEqual(expect.arrayContaining([
            expect.objectContaining({
                sender: 'agent',
                text: 'Paris is sunny',
            }),
        ]));
    });

    it('reloads the function catalog on demand when the initial local tool scope is empty', async () => {
        functionStoreState.functions = [];
        mockLoadFunctions.mockImplementation(async () => {
            functionStoreState.functions = [createFunction()];
        });

        render(
            <V2AgentNode
                id="node-1"
                selected={false}
                xPos={0}
                yPos={0}
                zIndex={1}
                dragging={false}
                data={{
                    robotId: 'archi',
                    label: 'Archi',
                    agent: baseAgent,
                    workflowId: 'wf-1',
                    agentInstance,
                }}
                type="default"
                isConnectable={true}
            />
        );

        fireEvent.change(screen.getByPlaceholderText('type_message_placeholder'), {
            target: { value: 'Trigger lazy load' },
        });
        fireEvent.submit(screen.getByPlaceholderText('type_message_placeholder').closest('form')!);

        await waitFor(() => {
            expect(mockLoadFunctions).toHaveBeenCalledWith('wf-1');
        });

        await waitFor(() => {
            expect(mockRunAgentLoop).toHaveBeenCalledTimes(1);
        });

        expect(mockRunAgentLoop.mock.calls[0][2]).toEqual([
            expect.objectContaining({ toolId: 'tool.weather' })
        ]);
    });

    it('fails visibly when configured tools remain unresolved after catalog reload', async () => {
        functionStoreState.functions = [];
        mockLoadFunctions.mockImplementation(async () => undefined);

        render(
            <V2AgentNode
                id="node-1"
                selected={false}
                xPos={0}
                yPos={0}
                zIndex={1}
                dragging={false}
                data={{
                    robotId: 'archi',
                    label: 'Archi',
                    agent: baseAgent,
                    workflowId: 'wf-1',
                    agentInstance,
                }}
                type="default"
                isConnectable={true}
            />
        );

        fireEvent.change(screen.getByPlaceholderText('type_message_placeholder'), {
            target: { value: 'Still unresolved' },
        });
        fireEvent.submit(screen.getByPlaceholderText('type_message_placeholder').closest('form')!);

        await waitFor(() => {
            expect(mockLoadFunctions).toHaveBeenCalledWith('wf-1');
        });

        expect(mockRunAgentLoop).not.toHaveBeenCalled();
        expect(mockAddNodeMessage).toHaveBeenCalledWith(
            'node-1',
            expect.objectContaining({
                sender: 'agent',
                isError: true,
                text: expect.stringContaining('[Erreur configuration outils]'),
            })
        );
    });

    it('renders a terminal local llm error message from AgentLoop without leaving the card silent', async () => {
        mockRunAgentLoop.mockResolvedValueOnce({
            finalResponse: '[Erreur LLM] LMStudio request timeout exceeded after 600000ms',
            iterations: 1,
            toolCallLog: [],
            finishReason: 'error',
            terminalError: {
                code: 'timeout',
                message: 'LMStudio request timeout exceeded after 600000ms',
                retryable: false,
                provider: LLMProvider.LMStudio,
                model: 'local-model',
            },
        });

        render(
            <V2AgentNode
                id="node-1"
                selected={false}
                xPos={0}
                yPos={0}
                zIndex={1}
                dragging={false}
                data={{
                    robotId: 'archi',
                    label: 'Archi',
                    agent: baseAgent,
                    workflowId: 'wf-1',
                    agentInstance,
                }}
                type="default"
                isConnectable={true}
            />
        );

        fireEvent.change(screen.getByPlaceholderText('type_message_placeholder'), {
            target: { value: 'Trigger timeout' },
        });
        fireEvent.submit(screen.getByPlaceholderText('type_message_placeholder').closest('form')!);

        await waitFor(() => {
            expect(mockRunAgentLoop).toHaveBeenCalledTimes(1);
        });

        expect(mockAddNodeMessage).toHaveBeenCalledWith(
            'node-1',
            expect.objectContaining({
                sender: 'agent',
                text: '[Erreur LLM] LMStudio request timeout exceeded after 600000ms',
                isError: true,
            })
        );
    });

    it('adds both tool and tool_result messages for a traced local tool execution', async () => {
        mockRunAgentLoop.mockResolvedValueOnce({
            finalResponse: 'Recherche terminee',
            iterations: 2,
            finishReason: 'stop',
            traceLog: ['llm.parse.tool_call.xml'],
            toolCallLog: [
                {
                    id: 'tool-msg-42',
                    toolId: 'tool.web',
                    functionId: 'legacy-web',
                    functionName: 'web_search_py',
                    arguments: { query: 'meteo paris demain', language: 'fr' },
                    result: {
                        query: 'meteo paris demain',
                        normalized_query: 'météo et températures minimales et maximales à Paris le 30/04/2026',
                        total_results: 1,
                        reranked_sources: [
                            {
                                title: 'Meteo Paris',
                                url: 'https://meteo.example/paris-demain',
                                relevance_score: 9,
                                critical_fragment: 'Paris demain 8°C 17°C'
                            }
                        ],
                        verified_fragments: [
                            {
                                url: 'https://meteo.example/paris-demain',
                                relevance_score: 9,
                                critical_fragment: 'Paris demain 8°C 17°C'
                            }
                        ],
                        trace: {
                            queries: [
                                { query: 'meteo paris demain', status: 'completed' }
                            ],
                            selected_sources: [
                                { title: 'Meteo Paris', url: 'https://meteo.example/paris-demain' }
                            ]
                        }
                    },
                    status: 'success',
                    durationMs: 44,
                    executionId: 'exec-web-42',
                    runner: 'docker_sandbox',
                    timestamp: new Date('2026-04-01T10:00:00.000Z'),
                },
            ],
        });

        render(
            <V2AgentNode
                id="node-1"
                selected={false}
                xPos={0}
                yPos={0}
                zIndex={1}
                dragging={false}
                data={{
                    robotId: 'archi',
                    label: 'Archi',
                    agent: baseAgent,
                    workflowId: 'wf-1',
                    agentInstance,
                }}
                type="default"
                isConnectable={true}
            />
        );

        fireEvent.change(screen.getByPlaceholderText('type_message_placeholder'), {
            target: { value: 'Cherche la meteo de demain' },
        });
        fireEvent.submit(screen.getByPlaceholderText('type_message_placeholder').closest('form')!);

        await waitFor(() => {
            expect(mockRunAgentLoop).toHaveBeenCalledTimes(1);
        });

        expect(mockAddNodeMessage).toHaveBeenCalledWith(
            'node-1',
            expect.objectContaining({
                sender: 'tool',
                text: expect.stringContaining('web_search_py'),
            })
        );

        expect(mockAddNodeMessage).toHaveBeenCalledWith(
            'node-1',
            expect.objectContaining({
                sender: 'tool_result',
                text: expect.stringContaining('executionId=exec-web-42'),
                toolName: 'web_search_py',
            })
        );

        expect(mockAddNodeMessage).toHaveBeenCalledWith(
            'node-1',
            expect.objectContaining({
                sender: 'tool_result',
                text: expect.stringContaining('planned_queries=1'),
                toolName: 'web_search_py',
            })
        );

        expect(mockAddNodeMessage).toHaveBeenCalledWith(
            'node-1',
            expect.objectContaining({
                sender: 'tool_result',
                text: expect.stringContaining('primary_source=https://meteo.example/paris-demain'),
                toolName: 'web_search_py',
            })
        );

        expect(mockAddNodeMessage).toHaveBeenCalledWith(
            'node-1',
            expect.objectContaining({
                sender: 'tool_result',
                text: expect.stringContaining('reranked_sources=1'),
                toolName: 'web_search_py',
            })
        );

        expect(mockAddNodeMessage).toHaveBeenCalledWith(
            'node-1',
            expect.objectContaining({
                sender: 'tool_result',
                text: expect.stringContaining('primary_relevance_score=9'),
                toolName: 'web_search_py',
            })
        );

        expect(mockAddNodeMessage).toHaveBeenCalledWith(
            'node-1',
            expect.objectContaining({
                sender: 'tool_result',
                text: expect.stringContaining('primary_fragment=Paris demain 8°C 17°C'),
                toolName: 'web_search_py',
            })
        );
    });

    it('shows a tool message immediately on local tool_call_start before the final response is added', async () => {
        const nodeMessages: Record<string, any[]> = { 'node-1': [] };

        runtimeStoreState.getNodeMessages = jest.fn((nodeId: string) => nodeMessages[nodeId] ?? []);
        runtimeStoreState.addNodeMessage = jest.fn((nodeId: string, message: any) => {
            nodeMessages[nodeId] = [...(nodeMessages[nodeId] ?? []), message];
        });
        runtimeStoreState.setNodeMessages = jest.fn((nodeId: string, nextMessages: any[]) => {
            nodeMessages[nodeId] = nextMessages;
        });

        mockRunAgentLoop.mockImplementationOnce(async (_adapter, _history, _functions, _systemPrompt, options) => {
            const toolCall = {
                id: 'tool-hello-1',
                name: 'hello_test',
                arguments: { user_name: 'Syl' },
                raw: '<tool_call>{"name":"hello_test","arguments":{"user_name":"Syl"}}</tool_call>',
                confidence: 0.95,
            };

            const toolCallRecord = {
                id: 'tool-hello-1',
                toolId: 'tool.hello',
                functionId: 'legacy-hello',
                functionName: 'hello_test',
                arguments: { user_name: 'Syl' },
                result: { result: 'Ton nom, Syl, est maintenant enregistré dans ma mémoire' },
                status: 'success',
                durationMs: 12,
                executionId: 'exec-hello-1',
                runner: 'docker_sandbox',
                timestamp: new Date('2026-04-01T10:00:00.000Z'),
            };

            options.onEvent?.({ type: 'tool_call_start', iteration: 1, toolCall });

            expect(nodeMessages['node-1']).toEqual(expect.arrayContaining([
                expect.objectContaining({
                    sender: 'tool',
                    toolName: 'hello_test',
                    status: 'executing_tool',
                    text: expect.stringContaining('user_name'),
                })
            ]));

            options.onEvent?.({ type: 'tool_call_done', iteration: 1, toolCall, toolResult: toolCallRecord.result, toolCallRecord });

            return {
                finalResponse: 'Nom enregistré.',
                iterations: 2,
                finishReason: 'stop',
                toolCallLog: [toolCallRecord],
            };
        });

        render(
            <V2AgentNode
                id="node-1"
                selected={false}
                xPos={0}
                yPos={0}
                zIndex={1}
                dragging={false}
                data={{
                    robotId: 'archi',
                    label: 'Archi',
                    agent: baseAgent,
                    workflowId: 'wf-1',
                    agentInstance,
                }}
                type="default"
                isConnectable={true}
            />
        );

        fireEvent.change(screen.getByPlaceholderText('type_message_placeholder'), {
            target: { value: 'Bonjour, je suis Syl' },
        });
        fireEvent.submit(screen.getByPlaceholderText('type_message_placeholder').closest('form')!);

        await waitFor(() => {
            expect(nodeMessages['node-1']).toEqual(expect.arrayContaining([
                expect.objectContaining({
                    sender: 'tool',
                    toolCallRecord: expect.objectContaining({
                        id: 'tool-hello-1',
                        functionName: 'hello_test',
                        executionId: 'exec-hello-1',
                    }),
                }),
                expect.objectContaining({
                    sender: 'agent',
                    text: 'Nom enregistré.',
                })
            ]));
        });

        expect(mockEnqueueEntry).toHaveBeenCalledWith(
            'wf-1',
            'instance-1',
            'tool_invocation',
            expect.objectContaining({
                messageId: 'toolinv:tool-hello-1:started',
                toolCallId: 'tool-hello-1',
                toolName: 'hello_test',
                phase: 'started',
            })
        );

        expect(mockEnqueueEntry).toHaveBeenCalledWith(
            'wf-1',
            'instance-1',
            'tool_invocation',
            expect.objectContaining({
                messageId: 'toolinv:tool-hello-1:completed',
                toolCallId: 'tool-hello-1',
                toolName: 'hello_test',
                executionId: 'exec-hello-1',
                phase: 'completed',
                toolId: 'tool.hello',
                functionId: 'legacy-hello',
            })
        );
    });

    it('renders a visible error when AgentLoop reports an empty local response without tool calls', async () => {
        mockRunAgentLoop.mockResolvedValueOnce({
            finalResponse: '[Erreur LLM] Le modele local a retourne une reponse vide sans appel d\'outil.',
            iterations: 1,
            toolCallLog: [],
            finishReason: 'error',
            terminalError: {
                code: 'empty_response',
                message: 'Le modele local a retourne une reponse vide sans appel d\'outil.',
                retryable: false,
                provider: LLMProvider.LMStudio,
                model: 'unknown',
            },
        });

        render(
            <V2AgentNode
                id="node-1"
                selected={false}
                xPos={0}
                yPos={0}
                zIndex={1}
                dragging={false}
                data={{
                    robotId: 'archi',
                    label: 'Archi',
                    agent: baseAgent,
                    workflowId: 'wf-1',
                    agentInstance,
                }}
                type="default"
                isConnectable={true}
            />
        );

        fireEvent.change(screen.getByPlaceholderText('type_message_placeholder'), {
            target: { value: 'Search the web' },
        });
        fireEvent.submit(screen.getByPlaceholderText('type_message_placeholder').closest('form')!);

        await waitFor(() => {
            expect(mockRunAgentLoop).toHaveBeenCalledTimes(1);
        });

        expect(mockAddNodeMessage).toHaveBeenCalledWith(
            'node-1',
            expect.objectContaining({
                sender: 'agent',
                text: '[Erreur LLM] Le modele local a retourne une reponse vide sans appel d\'outil.',
                isError: true,
            })
        );
    });

    it('shows the synthesis icon in the chat loader while a history summary is being prepared for the turn', async () => {
        let resolveSummary: ((value: { text: string }) => void) | null = null;
        const summaryPromise = new Promise<{ text: string }>((resolve) => {
            resolveSummary = resolve;
        });

        const agentWithHistory: Agent = {
            ...baseAgent,
            historyConfig: {
                enabled: true,
                llmProvider: LLMProvider.Gemini,
                model: 'gemini-2.0-flash',
                role: 'Summarizer',
                systemPrompt: 'Summarize previous turns only',
                limits: { char: 1, word: 1000, token: 1000, sentence: 1000, message: 1000 },
                enabledLimits: { char: true, word: false, token: false, sentence: false, message: false },
            },
        };

        runtimeStoreState.getNodeMessages = jest.fn(() => ([
            {
                id: 'prior-visible-msg',
                sender: 'agent',
                text: 'Historique visible',
                timestamp: new Date('2026-03-23T10:00:00.000Z'),
            },
        ]));
        runtimeConfigResolverMocks.resolveHistoryRuntimeConfig.mockReturnValue({
            config: { provider: LLMProvider.Gemini, enabled: true, apiKey: 'summary-key' },
            credential: 'summary-key',
        });
        textUtilsMocks.countChars.mockReturnValue(10);
        llmServiceMocks.generateContent.mockReturnValue(summaryPromise);

        render(
            <V2AgentNode
                id="node-1"
                selected={false}
                xPos={0}
                yPos={0}
                zIndex={1}
                dragging={false}
                data={{
                    robotId: 'archi',
                    label: 'Archi',
                    agent: agentWithHistory,
                    workflowId: 'wf-1',
                    agentInstance,
                }}
                type="default"
                isConnectable={true}
            />
        );

        const historyTextarea = screen.getByPlaceholderText('type_message_placeholder') as HTMLTextAreaElement;
        fireEvent.change(historyTextarea, {
            target: { value: 'Bonjour synthese' },
        });
        expect(historyTextarea.value).toBe('Bonjour synthese');
        fireEvent.submit(historyTextarea.closest('form')!);

        await waitFor(() => {
            expect(screen.getByText('agentNode_history_summarizing')).toBeInTheDocument();
            expect(screen.getByTestId('history-synthesis-icon')).toBeInTheDocument();
        });

        await act(async () => {
            resolveSummary?.({ text: 'Résumé invisible' });
            await Promise.resolve();
        });
    });
});