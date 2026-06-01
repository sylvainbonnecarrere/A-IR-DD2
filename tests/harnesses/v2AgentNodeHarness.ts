import { createTestAgent, createTestAgentInstance } from '../builders/domainBuilders';
import {
  createDesignStoreTestState,
  createFunctionStoreTestState,
  createRuntimeStoreTestState,
  type DesignStoreTestState,
  type FunctionStoreTestState,
  type RuntimeStoreTestState,
} from '../builders/storeStateBuilders';
import type { Agent, AgentInstance } from '../../types';

export interface V2AgentNodeHarnessState {
  runtimeStore: RuntimeStoreTestState;
  designStore: DesignStoreTestState;
  functionStore: FunctionStoreTestState;
  workflowCanvasContext: Record<string, unknown>;
}

interface ResetV2AgentNodeHarnessOptions {
  runtimeStore?: Partial<RuntimeStoreTestState>;
  designStore?: Partial<DesignStoreTestState>;
  functionStore?: Partial<FunctionStoreTestState>;
  workflowCanvasContext?: Record<string, unknown>;
  agent?: Agent;
  agentInstance?: AgentInstance;
}

let v2AgentNodeHarnessState: V2AgentNodeHarnessState;

export function resetV2AgentNodeHarness(
  options: ResetV2AgentNodeHarnessOptions = {},
): V2AgentNodeHarnessState {
  const agent = options.agent ?? createTestAgent();
  const agentInstance = options.agentInstance ?? createTestAgentInstance({
    prototypeId: agent.id,
    workflowId: 'wf-1',
  });

  v2AgentNodeHarnessState = {
    runtimeStore: createRuntimeStoreTestState({
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
      ...options.runtimeStore,
    }),
    designStore: createDesignStoreTestState({
      agents: options.designStore?.agents ?? [agent],
      agentInstances: options.designStore?.agentInstances ?? [agentInstance],
      selectAgent: jest.fn(),
      updateInstanceConfig: jest.fn(),
      ...options.designStore,
    }),
    functionStore: createFunctionStoreTestState({
      functions: [],
      ...options.functionStore,
    }),
    workflowCanvasContext: {
      navigationHandler: null,
      onDeleteNode: jest.fn(),
      onToggleNodeMinimize: jest.fn(),
      onUpdateNodePosition: jest.fn(),
      onOpenImagePanel: jest.fn(),
      onOpenImageModificationPanel: jest.fn(),
      onOpenVideoPanel: jest.fn(),
      onOpenMapsPanel: jest.fn(),
      onOpenFullscreen: jest.fn(),
      ...options.workflowCanvasContext,
    },
  };

  return v2AgentNodeHarnessState;
}

export function getV2AgentNodeHarness(): V2AgentNodeHarnessState {
  if (!v2AgentNodeHarnessState) {
    return resetV2AgentNodeHarness();
  }

  return v2AgentNodeHarnessState;
}