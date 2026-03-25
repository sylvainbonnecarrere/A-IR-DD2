import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { V2AgentNode } from '../../components/V2AgentNode';
import { LLMCapability, LLMProvider, RobotId, type Agent } from '../../types';
import type { UserFunction } from '../../types/function.types';

const mockRunAgentLoop = jest.fn();
const mockCreateAdapter = jest.fn();
const mockAddNodeMessage = jest.fn();
const mockSetNodeExecuting = jest.fn();
const mockEnqueueEntry = jest.fn();

let runtimeStoreState: Record<string, unknown>;
let designStoreState: Record<string, unknown>;
let functionStoreState: { functions: UserFunction[] };

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

jest.mock('../../stores/useDesignStore', () => ({
    useDesignStore: jest.fn((selector?: (state: Record<string, unknown>) => unknown) => (
        selector ? selector(designStoreState) : designStoreState
    )),
}));

jest.mock('../../stores/useFunctionStore', () => ({
    useFunctionStore: jest.fn((selector?: (state: { functions: UserFunction[] }) => unknown) => (
        selector ? selector(functionStoreState) : functionStoreState
    )),
}));

jest.mock('../../contexts/WorkflowCanvasContext', () => ({
    useWorkflowCanvasContext: jest.fn(() => ({
        navigationHandler: null,
        onDeleteNode: jest.fn(),
        onToggleNodeMinimize: jest.fn(),
        onUpdateNodePosition: jest.fn(),
        onOpenImagePanel: jest.fn(),
        onOpenImageModificationPanel: jest.fn(),
        onOpenVideoPanel: jest.fn(),
        onOpenMapsPanel: jest.fn(),
        onOpenFullscreen: jest.fn(),
    })),
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

jest.mock('../../utils/fileUtils', () => ({
    fileToBase64: jest.fn(),
    fileToText: jest.fn(),
}));

jest.mock('../../utils/toolExecutor', () => ({
    executeTool: jest.fn(),
}));

jest.mock('../../utils/textUtils', () => ({
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

        runtimeStoreState = {
            getIsNodeMinimized: jest.fn(() => false),
            getNodeMessages: jest.fn(() => []),
            addNodeMessage: mockAddNodeMessage,
            setNodeMessages: jest.fn(),
            isNodeExecuting: jest.fn(() => false),
            setNodeExecuting: mockSetNodeExecuting,
            setImagePanelOpen: jest.fn(),
            setImageModificationPanelOpen: jest.fn(),
            setFullscreenImage: jest.fn(),
            setFullscreenChatNodeId: jest.fn(),
            llmConfigs: [],
            localLLMProfiles: [],
        };

        designStoreState = {
            agentInstances: [agentInstance],
            selectAgent: jest.fn(),
        };

        functionStoreState = {
            functions: [
                createFunction(),
                createFunction({
                    _id: 'legacy-disabled',
                    toolId: 'tool.disabled',
                    name: 'Disabled Tool',
                    isEnabled: false,
                }),
            ],
        };

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

    it('passes enabled functions to AgentLoop and projects tool log plus final response into runtime messages', async () => {
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
});