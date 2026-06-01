import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { V2AgentNode } from '../../components/V2AgentNode';
import { resetBosRunHydrationCache } from '../../services/bosRunProjectionService';
import { toolRepository } from '../../services/toolRepository';
import { LLMCapability, LLMProvider, RobotId, type Agent, type ChatMessage } from '../../types';
import type { UserFunction } from '../../types/function.types';
import { resetV2AgentNodeHarness } from '../harnesses/v2AgentNodeHarness';

const mockCreateAdapter = jest.fn();
const mockEnqueueEntry = jest.fn();

let v2AgentNodeHarness = resetV2AgentNodeHarness();
let runtimeStoreState: Record<string, unknown> = v2AgentNodeHarness.runtimeStore;
let designStoreState: Record<string, unknown> = v2AgentNodeHarness.designStore;
let functionStoreState: { functions: UserFunction[] } = v2AgentNodeHarness.functionStore;
let nodeMessages: Record<string, ChatMessage[]>;

jest.mock('../../services/toolRepository', () => ({
    toolRepository: {
        loadFunctionRunByExecutionId: jest.fn(),
    }
}));

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
    MaximizeIcon: () => null,
}));

jest.mock('../../components/modals/ConfirmationModal', () => ({
    ConfirmationModal: () => null,
}));

jest.mock('../../components/panels/WebSearchGroundingPanel', () => ({
    WebSearchGroundingPanel: () => null,
}));

jest.mock('../../components/workflow/ToolCallBlock', () => ({
    ToolCallBlock: () => <div data-testid="tool-call-block" />,
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
    useRuntimeStore: jest.fn((selector?: (state: Record<string, unknown>) => unknown) => {
        const state = require('../harnesses/v2AgentNodeHarness').getV2AgentNodeHarness().runtimeStore;
        return selector ? selector(state) : state;
    }),
}));

jest.mock('../../stores/useDesignStore', () => {
    const actual = jest.requireActual('../../stores/useDesignStore');

    return {
        ...actual,
        useDesignStore: jest.fn((selector?: (state: Record<string, unknown>) => unknown) => {
            const state = require('../harnesses/v2AgentNodeHarness').getV2AgentNodeHarness().designStore;
            return selector ? selector(state) : state;
        }),
    };
});

jest.mock('../../stores/useFunctionStore', () => ({
    useFunctionStore: jest.fn((selector?: (state: { functions: UserFunction[] }) => unknown) => {
        const state = require('../harnesses/v2AgentNodeHarness').getV2AgentNodeHarness().functionStore;
        return selector ? selector(state) : state;
    }),
}));

jest.mock('../../contexts/WorkflowCanvasContext', () => ({
    useWorkflowCanvasContext: jest.fn(() => require('../harnesses/v2AgentNodeHarness').getV2AgentNodeHarness().workflowCanvasContext),
}));

jest.mock('../../services/llmService', () => ({
    generateContent: jest.fn(),
    generateContentStream: jest.fn(),
    generateContentWithWebSearchGrounding: jest.fn(),
}));

jest.mock('../../services/adapters/AdapterFactory', () => ({
    createAdapter: (...args: unknown[]) => mockCreateAdapter(...args),
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

const mockedToolRepository = toolRepository as jest.Mocked<typeof toolRepository>;

const agentInstance = {
    id: 'instance-1',
    prototypeId: 'agent-1',
    workflowId: 'wf-1',
    name: 'Archi instance',
    position: { x: 0, y: 0 },
    configuration_json: undefined,
} as any;

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

describe('V2AgentNode AgentLoop persisted run bridge', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        resetBosRunHydrationCache();
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
            configurable: true,
            value: jest.fn(),
        });
        jest.spyOn(console, 'warn').mockImplementation(() => {});

        nodeMessages = { 'node-1': [] };

        v2AgentNodeHarness = resetV2AgentNodeHarness({
            runtimeStore: {
                getIsNodeMinimized: jest.fn(() => false),
                getNodeMessages: jest.fn((nodeId: string) => nodeMessages[nodeId] ?? []),
                addNodeMessage: jest.fn((nodeId: string, message: ChatMessage) => {
                    nodeMessages[nodeId] = [...(nodeMessages[nodeId] ?? []), message];
                }),
                setNodeMessages: jest.fn((nodeId: string, messages: ChatMessage[]) => {
                    nodeMessages[nodeId] = messages;
                }),
                isNodeExecuting: jest.fn(() => false),
                setNodeExecuting: jest.fn(),
                setImagePanelOpen: jest.fn(),
                setImageModificationPanelOpen: jest.fn(),
                setFullscreenImage: jest.fn(),
                setFullscreenChatNodeId: jest.fn(),
                llmConfigs: [],
                localLLMProfiles: [],
            },
            designStore: {
                agents: [],
                agentInstances: [agentInstance],
                selectAgent: jest.fn(),
            },
            functionStore: {
                functions: [createFunction()],
            },
        });
        runtimeStoreState = v2AgentNodeHarness.runtimeStore;
        designStoreState = v2AgentNodeHarness.designStore;
        functionStoreState = v2AgentNodeHarness.functionStore;

        mockCreateAdapter.mockReturnValue({
            provider: LLMProvider.Gemini,
            supportsNativeToolCalling: false,
            complete: jest.fn()
                .mockResolvedValueOnce({
                    content: '',
                    toolCalls: [{ name: 'Weather Tool', arguments: { city: 'Paris' } }],
                    finishReason: 'tool_calls',
                })
                .mockResolvedValueOnce({
                    content: 'Paris is sunny',
                    toolCalls: [],
                    finishReason: 'stop',
                }),
        });

        mockedToolRepository.loadFunctionRunByExecutionId.mockImplementation(() => new Promise(() => undefined) as any);

        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                success: true,
                output: { temperature: 21 },
                stdout: 'ok',
                stderr: '',
                durationMs: 18,
                executionId: 'exec-1',
                runner: 'docker_sandbox',
                exitCode: 0,
                metadata: {
                    exitCode: 0,
                },
            }),
        } as Response) as jest.Mock;
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('bridges AgentLoop execution to persisted-run rehydration after frontend reread', async () => {
        const { unmount } = render(
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
            expect(global.fetch).toHaveBeenCalledTimes(1);
        });

        const initialMessages = nodeMessages['node-1'];
        const toolMessage = initialMessages.find((message) => message.sender === 'tool');
        const agentMessage = initialMessages.find((message) => message.sender === 'agent');
        const userMessage = initialMessages.find((message) => message.sender === 'user');

        expect(userMessage).toEqual(expect.objectContaining({
            text: 'Check Paris weather',
        }));
        expect(toolMessage).toEqual(expect.objectContaining({
            toolCallRecord: expect.objectContaining({
                executionId: 'exec-1',
                toolId: 'tool.weather',
                functionId: 'legacy-weather',
                artifacts: undefined,
            }),
        }));
        expect(agentMessage).toEqual(expect.objectContaining({
            text: 'Paris is sunny',
        }));

        expect(global.fetch).toHaveBeenCalledWith(
            expect.stringContaining('/api/sandbox/run'),
            expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({
                    Authorization: 'Bearer token-123',
                }),
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
        expect(mockEnqueueEntry).toHaveBeenCalledWith(
            'wf-1',
            'instance-1',
            'chat',
            expect.objectContaining({
                role: 'agent',
                content: 'Paris is sunny',
            })
        );

        unmount();

        resetBosRunHydrationCache();
        mockedToolRepository.loadFunctionRunByExecutionId.mockReset();
        mockedToolRepository.loadFunctionRunByExecutionId.mockResolvedValue({
            data: {
                executionId: 'exec-1',
                status: 'completed',
                runtime: 'python',
                runner: 'docker_sandbox',
                launchContext: 'workflow_run',
                createdAt: '2026-03-23T10:00:00.000Z',
                updatedAt: '2026-03-23T10:00:30.000Z',
                timing: { durationMs: 42 },
                outputs: {
                    artifacts: [{ path: 'output/report.json', kind: 'json' }],
                },
            },
        } as any);

        render(
            <V2AgentNode
                id="node-1"
                selected={false}
                xPos={0}
                yPos={0}
                zIndex={1}
                dragging={false}
                data={{
                    robotId: 'bos',
                    label: 'Bos',
                    agent: { ...baseAgent, creator_id: RobotId.Bos, name: 'Bos Agent' },
                    workflowId: 'wf-1',
                    agentInstance,
                }}
                type="default"
                isConnectable={true}
            />
        );

        await waitFor(() => {
            expect(mockedToolRepository.loadFunctionRunByExecutionId).toHaveBeenCalledWith('exec-1', 'tool.weather');
            expect((runtimeStoreState.setNodeMessages as jest.Mock)).toHaveBeenCalledWith(
                'node-1',
                expect.arrayContaining([
                    expect.objectContaining({
                        toolCallRecord: expect.objectContaining({
                            executionId: 'exec-1',
                            durationMs: 18,
                            persistedRunStatus: 'completed',
                            artifacts: [{ path: 'output/report.json', kind: 'json' }],
                        }),
                    }),
                ])
            );
        });

        const hydratedToolMessage = nodeMessages['node-1'].find((message) => message.sender === 'tool');
        expect(hydratedToolMessage).toEqual(expect.objectContaining({
            toolCallRecord: expect.objectContaining({
                executionId: 'exec-1',
                persistedRunStatus: 'completed',
                artifacts: [{ path: 'output/report.json', kind: 'json' }],
            }),
        }));
    });
});