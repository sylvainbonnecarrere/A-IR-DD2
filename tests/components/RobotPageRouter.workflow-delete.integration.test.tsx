import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { RobotPageRouter } from '../../components/RobotPageRouter';
import { LLMProvider, RobotId, type Agent, type AgentInstance } from '../../types';
import type { UserFunction } from '../../types/function.types';

let designStoreState: Record<string, any>;
let workflowStoreState: Record<string, any>;
let runtimeStoreState: Record<string, any>;
let functionStoreState: {
  functions: UserFunction[];
  loadFunctions: jest.Mock<Promise<void>, [string?]>;
};

jest.mock('reactflow', () => {
  const React = require('react');

  return {
    __esModule: true,
    default: ({ children, nodes = [], nodeTypes = {} }: { children?: React.ReactNode; nodes?: any[]; nodeTypes?: Record<string, React.ComponentType<any>> }) => (
      <div data-testid="workflow-canvas-root">
        {nodes.map((node) => {
          const NodeComponent = nodeTypes[node.type];
          if (!NodeComponent) {
            return null;
          }

          return (
            <div key={node.id} data-testid={`workflow-node-${node.id}`}>
              <NodeComponent
                id={node.id}
                data={node.data}
                selected={false}
                dragging={false}
                zIndex={0}
                isConnectable
                type={node.type}
                xPos={node.position?.x ?? 0}
                yPos={node.position?.y ?? 0}
              />
            </div>
          );
        })}
        {children}
      </div>
    ),
    Background: () => null,
    Controls: () => null,
    MiniMap: () => null,
    Handle: () => null,
    ReactFlowProvider: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    ConnectionMode: { Strict: 'strict' },
    Position: { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' },
    addEdge: jest.fn((connection: unknown, edges: unknown[]) => edges),
    useNodesState: jest.fn((initialNodes: unknown[]) => React.useState(initialNodes)),
    useEdgesState: jest.fn((initialEdges: unknown[]) => React.useState(initialEdges)),
    useReactFlow: jest.fn(() => ({
      getZoom: jest.fn(() => 1),
      getViewport: jest.fn(() => ({ x: 0, y: 0, zoom: 1 })),
      getNode: jest.fn(() => null),
      setCenter: jest.fn(),
    })),
  };
});

jest.mock('../../hooks/useLocalization', () => ({
  useLocalization: () => ({
    t: (key: string, fallbackOrParams?: string | Record<string, string | number>) => (
      typeof fallbackOrParams === 'string' ? fallbackOrParams : key
    ),
  }),
}));

jest.mock('../../hooks/useDayNightTheme', () => ({
  useDayNightTheme: () => ({
    backgroundGradient: 'linear-gradient(#000, #111)',
    particleColors: ['#00ffff'],
    primaryColor: '#00ffff',
    timeOfDay: 'night',
  }),
}));

jest.mock('../../hooks/useAutoSave', () => ({
  useAutoSave: () => ({
    status: 'idle',
    lastSavedAt: null,
    error: null,
    isEnabled: false,
  }),
}));

jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: false }),
}));

jest.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ accessToken: 'token-123' }),
}));

jest.mock('../../stores/useRuntimeStore', () => ({
  useRuntimeStore: Object.assign((selector?: (state: Record<string, any>) => unknown) => (
    selector ? selector(runtimeStoreState) : runtimeStoreState
  ), {
    getState: () => runtimeStoreState,
  }),
}));

jest.mock('../../stores/useDesignStore', () => {
  const actual = jest.requireActual('../../stores/useDesignStore');

  return {
    ...actual,
    useDesignStore: Object.assign((selector?: (state: Record<string, any>) => unknown) => (
      selector ? selector(designStoreState) : designStoreState
    ), {
      getState: () => designStoreState,
    }),
  };
});

jest.mock('../../stores/useWorkflowStore', () => ({
  useWorkflowStore: Object.assign((selector?: (state: Record<string, any>) => unknown) => (
    selector ? selector(workflowStoreState) : workflowStoreState
  ), {
    getState: () => workflowStoreState,
  }),
}));

jest.mock('../../stores/useFunctionStore', () => ({
  useFunctionStore: Object.assign((selector?: (state: typeof functionStoreState) => unknown) => (
    selector ? selector(functionStoreState) : functionStoreState
  ), {
    getState: () => functionStoreState,
  }),
}));

jest.mock('../../components/OptimizedWorkflowBackground', () => ({
  OptimizedWorkflowBackground: () => null,
}));

jest.mock('../../components/modals/PrototypeEditConfirmationModal', () => ({
  PrototypeEditConfirmationModal: () => null,
}));

jest.mock('../../components/modals/AgentFormModal', () => ({
  AgentFormModal: () => null,
}));

jest.mock('../../components/SavePrototypeButton', () => ({
  SavePrototypeButton: () => null,
}));

jest.mock('../../components/AutoSaveIndicator', () => ({
  AutoSaveIndicator: () => null,
}));

jest.mock('../../components/modals/BosMediaModal', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('../../components/modals/ConfirmationModal', () => ({
  ConfirmationModal: ({ isOpen, title, confirmText, onConfirm, onCancel }: any) => (
    isOpen ? (
      <div data-testid="delete-confirm-modal">
        <div>{title}</div>
        <button type="button" data-testid="confirm-delete-button" onClick={onConfirm}>
          {confirmText}
        </button>
        <button type="button" data-testid="cancel-delete-button" onClick={onCancel}>
          cancel
        </button>
      </div>
    ) : null
  ),
}));

jest.mock('../../components/panels/WebSearchGroundingPanel', () => ({
  WebSearchGroundingPanel: () => null,
}));

jest.mock('../../components/workflow/ToolCallBlock', () => ({
  ToolCallBlock: () => null,
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
  persistInstanceWebSearchParams: jest.fn(),
}));
jest.mock('../../hooks/useAgentJournalPersistence', () => ({
  useAgentJournalPersistence: () => ({
    persistJournalEntry: jest.fn(),
    persistToolInvocation: jest.fn(),
    resetToolInvocationDedup: jest.fn(),
  }),
}));

describe('RobotPageRouter BOS/canvas delete integration', () => {
  const baseAgent: Agent = {
    id: 'agent-1',
    name: 'Bos Agent',
    role: 'Supervisor',
    systemPrompt: 'Prompt',
    llmProvider: LLMProvider.OpenAI,
    model: 'gpt-4o-mini',
    capabilities: [],
    tools: [],
    toolSelections: [],
    creator_id: RobotId.Bos,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };

  const baseInstance: AgentInstance = {
    id: 'instance-1',
    prototypeId: 'agent-1',
    name: 'Bos Agent Instance',
    position: { x: 10, y: 20 },
    workflowId: 'wf-1',
    isMinimized: false,
    isMaximized: false,
    configuration_json: {
      role: 'Supervisor',
      model: 'gpt-4o-mini',
      llmProvider: LLMProvider.OpenAI,
      systemPrompt: 'Prompt',
      tools: [],
      toolSelections: [],
      capabilities: [],
      outputConfig: {
        enabled: false,
        format: 'json',
      },
      historyConfig: {
        enabled: false,
        llmProvider: LLMProvider.OpenAI,
        model: 'gpt-4o-mini',
        role: 'Supervisor',
        systemPrompt: 'History prompt',
        limits: {
          char: 0,
          word: 0,
          token: 0,
          sentence: 0,
          message: 0,
        },
        enabledLimits: {
          char: false,
          word: false,
          token: false,
          sentence: false,
          message: false,
        },
      },
      position: { x: 10, y: 20 },
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
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
      getNodePendingAttachment: jest.fn(() => null),
      setNodePendingAttachment: jest.fn(),
      clearNodePendingAttachment: jest.fn(),
      getNodeInvisibleHistorySummary: jest.fn(() => null),
      setNodeInvisibleHistorySummary: jest.fn(),
      llmConfigs: [],
      localLLMProfiles: [],
      setFullscreenChatNodeId: jest.fn(),
    };

    designStoreState = {
      agents: [baseAgent],
      agentInstances: [baseInstance],
      nodes: [
        {
          id: 'node-instance-1',
          type: 'agent',
          position: { x: 10, y: 20 },
          data: {
            robotId: RobotId.Bos,
            label: 'Bos Agent Instance',
            agent: baseAgent,
            agentInstance: baseInstance,
            workflowId: 'wf-1',
          },
        },
      ],
      workflows: [
        {
          _id: 'wf-1',
          name: 'Workflow Alpha',
        },
      ],
      currentWorkflowId: 'wf-1',
      getResolvedInstance: jest.fn(() => ({ instance: baseInstance, prototype: baseAgent })),
      selectAgent: jest.fn(),
      updateInstanceConfig: jest.fn(),
    };

    workflowStoreState = {
      getCurrentWorkflowId: jest.fn(() => 'wf-1'),
    };

    functionStoreState = {
      functions: [],
      loadFunctions: jest.fn().mockResolvedValue(undefined),
    };
  });

  it('propagates a real BOS workflow node delete click from the canvas UI to the delete callback', async () => {
    const onDeleteNode = jest.fn();

    render(
      <RobotPageRouter
        currentPath="/bos/dashboard"
        llmConfigs={[]}
        agents={[baseAgent]}
        onDeleteNode={onDeleteNode}
      />,
    );

    const node = await screen.findByTestId('workflow-node-node-instance-1');
    fireEvent.click(within(node).getByRole('button', { name: 'confirm_delete' }));

    expect(await screen.findByTestId('delete-confirm-modal')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('confirm-delete-button'));

    await waitFor(() => expect(onDeleteNode).toHaveBeenCalledWith('node-instance-1'));
  });
});