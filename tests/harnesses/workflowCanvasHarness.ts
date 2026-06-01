import {
  createDesignStoreTestState,
  createWorkflowStoreTestState,
  type DesignStoreTestState,
  type WorkflowStoreTestState,
} from '../builders/storeStateBuilders';

export interface WorkflowCanvasHarnessState {
  designStore: DesignStoreTestState;
  workflowStore: WorkflowStoreTestState;
  renderedNodes: Record<string, unknown>[];
  capturedOnNodesChange: ((changes: unknown[]) => void) | null;
  capturedOnNodeDragStop: ((event: unknown, node: Record<string, unknown>) => void) | null;
  capturedWorkflowCanvasContextValue: Record<string, any> | null;
}

interface ResetWorkflowCanvasHarnessOptions {
  designStore?: Partial<DesignStoreTestState>;
  workflowStore?: Partial<WorkflowStoreTestState>;
  renderedNodes?: Record<string, unknown>[];
}

let workflowCanvasHarnessState: WorkflowCanvasHarnessState;

export function resetWorkflowCanvasHarness(
  options: ResetWorkflowCanvasHarnessOptions = {},
): WorkflowCanvasHarnessState {
  workflowCanvasHarnessState = {
    designStore: createDesignStoreTestState(options.designStore),
    workflowStore: createWorkflowStoreTestState(options.workflowStore),
    renderedNodes: options.renderedNodes ?? [],
    capturedOnNodesChange: null,
    capturedOnNodeDragStop: null,
    capturedWorkflowCanvasContextValue: null,
  };

  return workflowCanvasHarnessState;
}

export function getWorkflowCanvasHarness(): WorkflowCanvasHarnessState {
  if (!workflowCanvasHarnessState) {
    return resetWorkflowCanvasHarness();
  }

  return workflowCanvasHarnessState;
}