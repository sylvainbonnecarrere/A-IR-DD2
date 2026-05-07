import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { V2AgentNode } from '../../components/V2AgentNode';
import { LLMProvider, RobotId, type Agent } from '../../types';
import type { UserFunction } from '../../types/function.types';
import { runAgentLoop } from '../../services/llm/AgentLoop';

const mockPersistInstanceWebSearchParams = jest.fn();
const mockUpdateInstanceConfig = jest.fn();

let runtimeStoreState: Record<string, unknown>;
let designStoreState: Record<string, unknown>;
let functionStoreState: { functions: UserFunction[]; loadFunctions: (workflowId?: string) => Promise<void> };

jest.mock('reactflow', () => ({
  Handle: () => null,
  Position: { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' },
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
  useLocalization: () => ({
    t: (key: string, fallbackOrParams?: string | Record<string, string | number>) => (
      typeof fallbackOrParams === 'string' ? fallbackOrParams : key
    ),
  }),
}));

jest.mock('../../hooks/useJournalQueue', () => ({
  useJournalQueue: () => ({ enqueueEntry: jest.fn() }),
}));

jest.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ accessToken: 'token-123' }),
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
  useFunctionStore: jest.fn((selector?: (state: { functions: UserFunction[]; loadFunctions: (workflowId?: string) => Promise<void> }) => unknown) => (
    selector ? selector(functionStoreState) : functionStoreState
  )),
}));

jest.mock('../../contexts/WorkflowCanvasContext', () => ({
  useWorkflowCanvasContext: () => ({
    navigationHandler: { navigateToNode: jest.fn() },
    onDeleteNode: jest.fn(),
    onToggleNodeMinimize: jest.fn(),
    onUpdateNodePosition: jest.fn(),
    onOpenImagePanel: jest.fn(),
    onOpenImageModificationPanel: jest.fn(),
    onOpenVideoPanel: jest.fn(),
    onOpenMapsPanel: jest.fn(),
    onOpenFullscreen: jest.fn(),
  }),
}));

jest.mock('../../services/llmService', () => ({}));
jest.mock('../../services/adapters/AdapterFactory', () => ({ createAdapter: jest.fn() }));
jest.mock('../../services/llm/AgentLoop', () => ({ runAgentLoop: jest.fn() }));
jest.mock('../../utils/toolExecutor', () => ({ executeTool: jest.fn() }));
jest.mock('../../services/runtimeConfigResolver', () => ({
  resolveAgentRuntimeConfig: jest.fn(() => ({ provider: LLMProvider.OpenAI, model: 'gpt-4o-mini' })),
  resolveHistoryRuntimeConfig: jest.fn(() => null),
}));
jest.mock('../../services/bosRunProjectionService', () => ({
  buildBosHydrationFingerprint: jest.fn(() => ''),
  hydrateToolMessagesFromPersistedRuns: jest.fn(async (messages) => messages),
}));
jest.mock('../../services/webSearchParamsConfigService', () => ({
  persistInstanceWebSearchParams: (...args: unknown[]) => mockPersistInstanceWebSearchParams(...args),
}));

describe('V2AgentNode web search params entrypoint', () => {
  const agent: Agent = {
    id: 'agent-1',
    name: 'Archi Agent',
    role: 'Architect',
    systemPrompt: 'Prompt',
    llmProvider: LLMProvider.OpenAI,
    model: 'gpt-4o-mini',
    capabilities: [],
    toolSelections: [{ toolId: 'tool.web-search' }],
    creator_id: RobotId.Archi,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };

  beforeEach(() => {
    mockPersistInstanceWebSearchParams.mockReset().mockResolvedValue(undefined);
    mockUpdateInstanceConfig.mockReset();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: jest.fn(),
    });

    runtimeStoreState = {
      getIsNodeMinimized: jest.fn(() => false),
      getNodeMessages: jest.fn(() => []),
      addNodeMessage: jest.fn(),
      setNodeMessages: jest.fn(),
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
      agentInstances: [
        {
          id: 'instance-1',
          prototypeId: 'agent-1',
          workflowId: 'wf-1',
          name: 'Archi instance',
          position: { x: 0, y: 0 },
          isMinimized: false,
          isMaximized: false,
          configuration_json: {
            role: 'Architect',
            model: 'gpt-4o-mini',
            llmProvider: LLMProvider.OpenAI,
            systemPrompt: 'Prompt',
            tools: [],
            toolSelections: [{ toolId: 'tool.web-search' }],
            position: { x: 0, y: 0 },
            webSearchParams: undefined,
          },
        },
      ],
      selectAgent: jest.fn(),
      updateInstanceConfig: mockUpdateInstanceConfig,
    };

    functionStoreState = {
      functions: [
        {
          _id: 'fn-1',
          toolId: 'tool.web-search',
          name: 'web_search_py',
          description: 'Web search',
          language: 'python',
          origin: 'native',
          userId: null,
          workflowId: null,
          inputSchema: {},
          outputSchema: {},
          codePath: null,
          codeInline: null,
          dependencies: [],
          isEnabled: true,
          isReadonly: true,
          version: 1,
          tags: [],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      loadFunctions: jest.fn(async () => undefined),
    };

    (runAgentLoop as jest.Mock).mockReset().mockResolvedValue({
      finalResponse: 'ok',
      toolCallLog: [],
      iterations: 1,
      finishReason: 'stop',
    });
  });

  it('shows the globe button and opens the params modal for web_search_py', async () => {
    const view = render(
      <V2AgentNode
        id="node-1"
        selected={false}
        xPos={0}
        yPos={0}
        dragging={false}
        zIndex={1}
        data={{ robotId: RobotId.Archi, label: 'Archi', agent, agentInstance: designStoreState.agentInstances[0] as any }}
      />
    );

    fireEvent.click(screen.getByTitle("Paramètres Web Search de l'agent"));

    expect(screen.getByText(/Paramètres Web Search de l'agent/)).toBeInTheDocument();

    fireEvent.click(screen.getByText('Enregistrer'));

    await waitFor(() => {
      expect(mockPersistInstanceWebSearchParams).toHaveBeenCalled();
      expect(mockUpdateInstanceConfig).toHaveBeenCalled();
    });
  });

  it('loads the function catalog on mount so the globe button appears when web_search_py is selected', async () => {
    const loadFunctions = jest.fn(async () => {
      functionStoreState.functions = [
        {
          _id: 'fn-1',
          toolId: 'tool.web-search',
          name: 'web_search_py',
          description: 'Web search',
          language: 'python',
          origin: 'native',
          userId: null,
          workflowId: null,
          inputSchema: {},
          outputSchema: {},
          codePath: null,
          codeInline: null,
          dependencies: [],
          isEnabled: true,
          isReadonly: true,
          version: 1,
          tags: [],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ];
    });

    functionStoreState = {
      functions: [],
      loadFunctions,
    };

    const view = render(
      <V2AgentNode
        id="node-1"
        selected={false}
        xPos={0}
        yPos={0}
        dragging={false}
        zIndex={1}
        data={{ robotId: RobotId.Archi, label: 'Archi', agent, agentInstance: designStoreState.agentInstances[0] as any }}
      />
    );

    await waitFor(() => {
      expect(loadFunctions).toHaveBeenCalledWith('wf-1');
    });

    view.rerender(
      <V2AgentNode
        id="node-1"
        selected={false}
        xPos={0}
        yPos={0}
        dragging={false}
        zIndex={1}
        data={{ robotId: RobotId.Archi, label: 'Archi', agent, agentInstance: designStoreState.agentInstances[0] as any }}
      />
    );

    expect(screen.getByTitle("Paramètres Web Search de l'agent")).toBeInTheDocument();
  });

});