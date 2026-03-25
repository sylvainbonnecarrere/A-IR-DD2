import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { V2AgentNode } from '../../components/V2AgentNode';
import { LLMCapability, LLMProvider, RobotId, type Agent, type ChatMessage, type ToolCallRecord } from '../../types';

const mockSetNodeMessages = jest.fn();
const mockHydrateToolMessagesFromPersistedRuns = jest.fn();
const mockBuildBosHydrationFingerprint = jest.fn();

let runtimeStoreState: Record<string, unknown>;
let designStoreState: Record<string, unknown>;

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
        enqueueJournalEntry: jest.fn(),
    })),
}));

jest.mock('../../hooks/useAuth', () => ({
    useAuth: jest.fn(() => ({
        accessToken: null,
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
    useFunctionStore: jest.fn((selector?: (state: { functions: unknown[] }) => unknown) => (
        selector ? selector({ functions: [] }) : { functions: [] }
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

jest.mock('../../services/llmService', () => ({}));
jest.mock('../../services/adapters/AdapterFactory', () => ({ createAdapter: jest.fn() }));
jest.mock('../../services/llm/AgentLoop', () => ({ runAgentLoop: jest.fn() }));
jest.mock('../../utils/fileUtils', () => ({ fileToBase64: jest.fn(), fileToText: jest.fn() }));
jest.mock('../../utils/toolExecutor', () => ({ executeTool: jest.fn() }));
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
    resolveAgentRuntimeConfig: jest.fn(() => ({ isConfigured: true })),
    resolveHistoryRuntimeConfig: jest.fn(() => ({ isEnabled: false })),
}));

jest.mock('../../services/bosRunProjectionService', () => ({
    buildBosHydrationFingerprint: (...args: unknown[]) => mockBuildBosHydrationFingerprint(...args),
    hydrateToolMessagesFromPersistedRuns: (...args: unknown[]) => mockHydrateToolMessagesFromPersistedRuns(...args),
}));

const baseAgent: Agent = {
    id: 'agent-1',
    name: 'Bos Agent',
    role: 'Supervisor',
    systemPrompt: 'Observe tool runs',
    llmProvider: LLMProvider.Gemini,
    model: 'gemini-2.5-flash',
    capabilities: [LLMCapability.Chat, LLMCapability.FunctionCalling],
    tools: [],
    creator_id: RobotId.Bos,
    created_at: '2026-03-23T10:00:00.000Z',
    updated_at: '2026-03-23T10:00:00.000Z',
};

const persistedToolCall: ToolCallRecord = {
    id: 'tool-call-1',
    toolId: 'tool.weather',
    functionId: 'legacy-weather',
    functionName: 'Weather Tool',
    arguments: { city: 'Paris' },
    result: { ok: true },
    status: 'success',
    executionId: 'exec-1',
    timestamp: new Date('2026-03-23T10:00:00.000Z'),
};

describe('V2AgentNode Bos hydration', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
            configurable: true,
            value: jest.fn(),
        });

        const messages: ChatMessage[] = [
            {
                id: 'msg-tool-1',
                sender: 'tool',
                text: 'Tool call pending hydration',
                toolCallRecord: persistedToolCall,
            },
        ];

        const hydratedMessages: ChatMessage[] = [
            {
                ...messages[0],
                toolCallRecord: {
                    ...persistedToolCall,
                    artifacts: [{ path: 'output/report.json', kind: 'json' }],
                },
            },
        ];

        runtimeStoreState = {
            getIsNodeMinimized: jest.fn(() => false),
            getNodeMessages: jest.fn(() => messages),
            addNodeMessage: jest.fn(),
            setNodeMessages: mockSetNodeMessages,
            isNodeExecuting: jest.fn(() => false),
            setNodeExecuting: jest.fn(),
            setImagePanelOpen: jest.fn(),
            setImageModificationPanelOpen: jest.fn(),
            setFullscreenImage: jest.fn(),
            setFullscreenChatNodeId: jest.fn(),
            llmConfigs: [],
            localLLMProfiles: [],
        };

        designStoreState = {
            agentInstances: [],
            selectAgent: jest.fn(),
        };

        mockBuildBosHydrationFingerprint
            .mockReturnValueOnce('fingerprint:before')
            .mockReturnValueOnce('fingerprint:after');
        mockHydrateToolMessagesFromPersistedRuns.mockResolvedValue(hydratedMessages);
    });

    it('rehydrates persisted tool runs and projects them back into the runtime store on mount', async () => {
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
                    agent: baseAgent,
                }}
                type="default"
                isConnectable={true}
            />
        );

        await waitFor(() => {
            expect(mockHydrateToolMessagesFromPersistedRuns).toHaveBeenCalledTimes(1);
            expect(mockSetNodeMessages).toHaveBeenCalledWith(
                'node-1',
                expect.arrayContaining([
                    expect.objectContaining({
                        toolCallRecord: expect.objectContaining({
                            executionId: 'exec-1',
                            artifacts: [{ path: 'output/report.json', kind: 'json' }],
                        }),
                    }),
                ])
            );
        });
    });
});