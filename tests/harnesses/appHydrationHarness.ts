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

export interface AppHydrationHarnessState {
  runtimeStore: RuntimeStoreTestState;
  designStore: DesignStoreTestState;
  workflowStore: WorkflowStoreTestState;
  functionStore: FunctionStoreTestState;
  autoSignalWorkflowCanvasReady: boolean;
  documentVisibilityState: DocumentVisibilityState;
}

let appHydrationHarnessState: AppHydrationHarnessState;

export function resetAppHydrationHarness(): AppHydrationHarnessState {
  appHydrationHarnessState = {
    runtimeStore: createRuntimeStoreTestState(),
    designStore: createDesignStoreTestState(),
    workflowStore: createWorkflowStoreTestState(),
    functionStore: createFunctionStoreTestState(),
    autoSignalWorkflowCanvasReady: true,
    documentVisibilityState: 'visible',
  };

  return appHydrationHarnessState;
}

export function getAppHydrationHarness(): AppHydrationHarnessState {
  if (!appHydrationHarnessState) {
    return resetAppHydrationHarness();
  }

  return appHydrationHarnessState;
}