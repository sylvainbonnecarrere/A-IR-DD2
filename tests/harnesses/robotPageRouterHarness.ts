import {
  createDesignStoreTestState,
  createFunctionStoreTestState,
  createRuntimeStoreTestState,
  createWorkflowStoreTestState,
  type DesignStoreTestState,
  type FunctionStoreTestState,
  type RuntimeStoreTestState,
  type WorkflowStoreTestState,
} from '../builders/storeStateBuilders';

export interface RobotPageRouterHarnessState {
  runtimeStore: RuntimeStoreTestState;
  designStore: DesignStoreTestState;
  workflowStore: WorkflowStoreTestState;
  functionStore: FunctionStoreTestState;
}

interface ResetRobotPageRouterHarnessOptions {
  runtimeStore?: Partial<RuntimeStoreTestState>;
  designStore?: Partial<DesignStoreTestState>;
  workflowStore?: Partial<WorkflowStoreTestState>;
  functionStore?: Partial<FunctionStoreTestState>;
}

let robotPageRouterHarnessState: RobotPageRouterHarnessState;

export function resetRobotPageRouterHarness(
  options: ResetRobotPageRouterHarnessOptions = {},
): RobotPageRouterHarnessState {
  robotPageRouterHarnessState = {
    runtimeStore: createRuntimeStoreTestState({
      getIsNodeMinimized: jest.fn(() => false),
      getNodeMessages: jest.fn((_nodeId: string) => []),
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
      ...options.runtimeStore,
    }),
    designStore: createDesignStoreTestState(options.designStore),
    workflowStore: createWorkflowStoreTestState(options.workflowStore),
    functionStore: createFunctionStoreTestState(options.functionStore),
  };

  return robotPageRouterHarnessState;
}

export function getRobotPageRouterHarness(): RobotPageRouterHarnessState {
  if (!robotPageRouterHarnessState) {
    return resetRobotPageRouterHarness();
  }

  return robotPageRouterHarnessState;
}