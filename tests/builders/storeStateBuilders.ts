import { RobotId, type Agent, type AgentInstance, type ChatMessage, type LLMConfig, type V2WorkflowNode } from '../../types';
import type { UserFunction } from '../../types/function.types';

type ExtraState = Record<string, unknown>;

export type RuntimeStoreTestState = ExtraState & {
  llmConfigs: LLMConfig[];
  localLLMProfiles: unknown[];
  nodeMessages: Record<string, ChatMessage[]>;
  updateLLMConfigs: jest.Mock<void, [LLMConfig[]]>;
  updateLocalLLMProfiles: jest.Mock<void, [unknown[]]>;
  setNavigationHandler: jest.Mock;
  addNodeMessage: jest.Mock;
  setNodeMessages: jest.Mock<void, [string, ChatMessage[]]>;
  getNodeMessages: jest.Mock<ChatMessage[], [string]>;
  resetForWorkflowSwitch: jest.Mock;
  resetAll: jest.Mock;
};

export type DesignStoreTestState = ExtraState & {
  agents: Agent[];
  validateWorkflowIntegrity: jest.Mock<{ fixedCount: number }, []>;
  cleanupOrphanedInstances: jest.Mock<number, []>;
  addAgentInstance: jest.Mock;
  deleteNode: jest.Mock;
  deleteAgentInstance: jest.Mock;
  hydrateFromServer: jest.Mock;
  setCurrentWorkflowId: jest.Mock;
  updateInstanceId: jest.Mock;
  updateAgentInstance: jest.Mock;
  updateAgentId: jest.Mock;
  addNode: jest.Mock;
  updateNode: jest.Mock;
  agentInstances: AgentInstance[];
  nodes: Array<V2WorkflowNode | Record<string, unknown>>;
  workflows: Array<Record<string, unknown>>;
  currentWorkflowId: string;
  currentRobotId: RobotId | string;
  resetAll: jest.Mock;
  loadUserWorkflows: jest.Mock<Promise<void>, []>;
  getResolvedInstance: jest.Mock;
};

export type WorkflowStoreTestState = ExtraState & {
  hydrateWorkflowFromServer: jest.Mock;
  getCurrentWorkflowId: jest.Mock<string, []>;
  resetAll: jest.Mock;
};

export type FunctionStoreTestState = ExtraState & {
  functions: UserFunction[];
  loadFunctions: jest.Mock<Promise<void>, [string?]>;
  resetStore: jest.Mock;
};

export function createRuntimeStoreTestState(
  overrides: Partial<RuntimeStoreTestState> = {},
): RuntimeStoreTestState {
  const state = {
    llmConfigs: overrides.llmConfigs ?? [],
    localLLMProfiles: overrides.localLLMProfiles ?? [],
    nodeMessages: overrides.nodeMessages ?? {},
    updateLLMConfigs: overrides.updateLLMConfigs ?? jest.fn((configs: LLMConfig[]) => {
      state.llmConfigs = configs;
    }),
    updateLocalLLMProfiles: overrides.updateLocalLLMProfiles ?? jest.fn((profiles: unknown[]) => {
      state.localLLMProfiles = profiles;
    }),
    setNavigationHandler: overrides.setNavigationHandler ?? jest.fn(),
    addNodeMessage: overrides.addNodeMessage ?? jest.fn(),
    setNodeMessages: overrides.setNodeMessages ?? jest.fn((nodeId: string, messages: ChatMessage[]) => {
      state.nodeMessages[nodeId] = messages;
    }),
    getNodeMessages: overrides.getNodeMessages ?? jest.fn((nodeId: string) => state.nodeMessages[nodeId] || []),
    resetForWorkflowSwitch: overrides.resetForWorkflowSwitch ?? jest.fn(),
    resetAll: overrides.resetAll ?? jest.fn(),
    ...overrides,
  } satisfies RuntimeStoreTestState;

  return state;
}

export function createDesignStoreTestState(
  overrides: Partial<DesignStoreTestState> = {},
): DesignStoreTestState {
  return {
    agents: overrides.agents ?? [],
    validateWorkflowIntegrity: overrides.validateWorkflowIntegrity ?? jest.fn(() => ({ fixedCount: 0 })),
    cleanupOrphanedInstances: overrides.cleanupOrphanedInstances ?? jest.fn(() => 0),
    addAgentInstance: overrides.addAgentInstance ?? jest.fn(),
    deleteNode: overrides.deleteNode ?? jest.fn(),
    deleteAgentInstance: overrides.deleteAgentInstance ?? jest.fn(),
    hydrateFromServer: overrides.hydrateFromServer ?? jest.fn(),
    setCurrentWorkflowId: overrides.setCurrentWorkflowId ?? jest.fn(),
    updateInstanceId: overrides.updateInstanceId ?? jest.fn(),
    updateAgentInstance: overrides.updateAgentInstance ?? jest.fn(),
    updateAgentId: overrides.updateAgentId ?? jest.fn(),
    addNode: overrides.addNode ?? jest.fn(),
    updateNode: overrides.updateNode ?? jest.fn(),
    agentInstances: overrides.agentInstances ?? [],
    nodes: overrides.nodes ?? [],
    workflows: overrides.workflows ?? [],
    currentWorkflowId: overrides.currentWorkflowId ?? 'workflow-1',
    currentRobotId: overrides.currentRobotId ?? RobotId.Bos,
    resetAll: overrides.resetAll ?? jest.fn(),
    loadUserWorkflows: overrides.loadUserWorkflows ?? jest.fn().mockResolvedValue(undefined),
    getResolvedInstance: overrides.getResolvedInstance ?? jest.fn(() => null),
    ...overrides,
  } satisfies DesignStoreTestState;
}

export function createWorkflowStoreTestState(
  overrides: Partial<WorkflowStoreTestState> = {},
): WorkflowStoreTestState {
  return {
    hydrateWorkflowFromServer: overrides.hydrateWorkflowFromServer ?? jest.fn(),
    getCurrentWorkflowId: overrides.getCurrentWorkflowId ?? jest.fn(() => 'workflow-1'),
    resetAll: overrides.resetAll ?? jest.fn(),
    ...overrides,
  } satisfies WorkflowStoreTestState;
}

export function createFunctionStoreTestState(
  overrides: Partial<FunctionStoreTestState> = {},
): FunctionStoreTestState {
  return {
    functions: overrides.functions ?? [],
    loadFunctions: overrides.loadFunctions ?? jest.fn().mockResolvedValue(undefined),
    resetStore: overrides.resetStore ?? jest.fn(),
    ...overrides,
  } satisfies FunctionStoreTestState;
}