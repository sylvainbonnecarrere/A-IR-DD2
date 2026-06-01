import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { V2AgentNode } from '../../components/V2AgentNode';
import { LLMProvider, RobotId, type Agent } from '../../types';
import type { UserFunction } from '../../types/function.types';
import { runAgentLoop } from '../../services/llm/AgentLoop';
import { createTestAgentInstance, createToolSelection } from '../builders/domainBuilders';
import { resetV2AgentNodeHarness } from '../harnesses/v2AgentNodeHarness';

const mockPersistInstanceWebSearchParams = jest.fn();
const mockUpdateInstanceConfig = jest.fn();

let v2AgentNodeHarness = resetV2AgentNodeHarness();
let runtimeStoreState: Record<string, unknown> = v2AgentNodeHarness.runtimeStore;
let designStoreState: Record<string, unknown> = v2AgentNodeHarness.designStore;
let functionStoreState: { functions: UserFunction[]; loadFunctions: (workflowId?: string) => Promise<void> } = v2AgentNodeHarness.functionStore;

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
  useFunctionStore: jest.fn((selector?: (state: { functions: UserFunction[]; loadFunctions: (workflowId?: string) => Promise<void> }) => unknown) => {
    const state = require('../harnesses/v2AgentNodeHarness').getV2AgentNodeHarness().functionStore;
    return selector ? selector(state) : state;
  }),
}));

jest.mock('../../contexts/WorkflowCanvasContext', () => ({
  useWorkflowCanvasContext: () => require('../harnesses/v2AgentNodeHarness').getV2AgentNodeHarness().workflowCanvasContext,
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

    v2AgentNodeHarness = resetV2AgentNodeHarness({
      runtimeStore: {
        getIsNodeMinimized: jest.fn(() => false),
        getNodeMessages: jest.fn((_nodeId: string) => []),
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
      },
      agent,
      agentInstance: createTestAgentInstance({
        id: 'instance-1',
        prototypeId: 'agent-1',
        workflowId: 'wf-1',
        name: 'Archi instance',
        configuration_json: {
          role: 'Architect',
          model: 'gpt-4o-mini',
          llmProvider: LLMProvider.OpenAI,
          systemPrompt: 'Prompt',
          tools: [],
          toolSelections: [createToolSelection({ toolId: 'tool.web-search' })],
          position: { x: 0, y: 0 },
          webSearchParams: undefined,
        },
      }),
      designStore: {
        updateInstanceConfig: mockUpdateInstanceConfig,
      },
      functionStore: {
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
      },
      workflowCanvasContext: {
        navigationHandler: { navigateToNode: jest.fn() },
      },
    });

    runtimeStoreState = v2AgentNodeHarness.runtimeStore;
    designStoreState = v2AgentNodeHarness.designStore;
    functionStoreState = v2AgentNodeHarness.functionStore;

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
        type="customAgent"
        selected={false}
        xPos={0}
        yPos={0}
        dragging={false}
        zIndex={1}
        isConnectable={true}
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
    v2AgentNodeHarness.functionStore = functionStoreState as typeof v2AgentNodeHarness.functionStore;

    const view = render(
      <V2AgentNode
        id="node-1"
        type="customAgent"
        selected={false}
        xPos={0}
        yPos={0}
        dragging={false}
        zIndex={1}
        isConnectable={true}
        data={{ robotId: RobotId.Archi, label: 'Archi', agent, agentInstance: designStoreState.agentInstances[0] as any }}
      />
    );

    await waitFor(() => {
      expect(loadFunctions).toHaveBeenCalledWith('wf-1');
    });

    view.rerender(
      <V2AgentNode
        id="node-1"
        type="customAgent"
        selected={false}
        xPos={0}
        yPos={0}
        dragging={false}
        zIndex={1}
        isConnectable={true}
        data={{ robotId: RobotId.Archi, label: 'Archi', agent, agentInstance: designStoreState.agentInstances[0] as any }}
      />
    );

    expect(screen.getByTitle("Paramètres Web Search de l'agent")).toBeInTheDocument();
  });

  it('recovers the globe button when the prototype is rehydrated from the store after an initially stale node payload', async () => {
    const staleNodeAgent: Agent = {
      ...agent,
      toolSelections: [],
      functionIds: [],
    };
    const inheritedInstance = {
      ...(designStoreState.agentInstances[0] as any),
      toolSelections: [],
      configuration_json: {
        ...(designStoreState.agentInstances[0] as any).configuration_json,
        toolSelections: [],
      },
    };

    designStoreState.agents = [];
    designStoreState.agentInstances = [inheritedInstance];
    v2AgentNodeHarness.designStore = designStoreState as typeof v2AgentNodeHarness.designStore;

    const view = render(
      <V2AgentNode
        id="node-1"
        type="customAgent"
        selected={false}
        xPos={0}
        yPos={0}
        dragging={false}
        zIndex={1}
        isConnectable={true}
        data={{ robotId: RobotId.Archi, label: 'Archi', agent: staleNodeAgent, agentInstance: inheritedInstance }}
      />
    );

    expect(screen.queryByTitle("Paramètres Web Search de l'agent")).not.toBeInTheDocument();

    designStoreState.agents = [agent];
    v2AgentNodeHarness.designStore = designStoreState as typeof v2AgentNodeHarness.designStore;

    view.rerender(
      <V2AgentNode
        id="node-1"
        type="customAgent"
        selected
        xPos={0}
        yPos={0}
        dragging={false}
        zIndex={1}
        isConnectable={true}
        data={{ robotId: RobotId.Archi, label: 'Archi', agent: staleNodeAgent, agentInstance: inheritedInstance }}
      />
    );

    expect(screen.getByTitle("Paramètres Web Search de l'agent")).toBeInTheDocument();
  });

});