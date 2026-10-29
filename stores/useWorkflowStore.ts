import { create } from 'zustand';
import WorkflowRunService from '../services/workflowRunService';
import type { FunctionRunRecord } from '../types/function.types';

// Metadata and run state only: nodes and edges live exclusively in useDesignStore (V2 source of truth).
export interface Workflow {
  id: string;
  name: string;
  description?: string;
  isDefault?: boolean;
  isActive?: boolean;
  canvasState?: {
    zoom: number;
    panX: number;
    panY: number;
  };
}

export interface WorkflowExecution {
  id: string;
  workflowId: string;
  status: FunctionRunRecord['status'] | 'paused';
  startedAt: string;
  completedAt?: string;
  currentNodeId?: string;
  results: Record<string, any>;
  errors: Record<string, Error>;
}

interface WorkflowStore {
  currentWorkflow: Workflow | null;
  execution: WorkflowExecution | null;
  isConfigPanelOpen: boolean;

  // Persistence state (Dev_rules 4.5.2)
  isDirty: boolean;
  lastSynced: Date | null;
  syncVersion: number;
  pendingChanges: string[];

  hydrateWorkflowFromServer: (workflowData: {
    id: string;
    name: string;
    description?: string;
    isDefault?: boolean;
    isActive?: boolean;
    canvasState?: { zoom: number; panX: number; panY: number };
  }) => void;
  getCurrentWorkflowId: () => string | null;

  markDirty: (changeType?: string) => void;
  markClean: (newVersion?: number) => void;
  getSyncStatus: () => { isDirty: boolean; lastSynced: Date | null; pendingCount: number };

  toggleConfigPanel: () => void;

  executeWorkflow: () => Promise<string>;
  pauseExecution: () => Promise<void>;
  stopExecution: () => Promise<void>;

  resetAll: () => void;
}

export const useWorkflowStore = create<WorkflowStore>((set, get) => ({
  currentWorkflow: null,
  execution: null,
  isConfigPanelOpen: false,

  isDirty: false,
  lastSynced: null,
  syncVersion: 0,
  pendingChanges: [],

  markDirty: (changeType?: string) => {
    set((state) => ({
      isDirty: true,
      pendingChanges: changeType
        ? [...new Set([...state.pendingChanges, changeType])]
        : state.pendingChanges
    }));
  },

  markClean: (newVersion?: number) => {
    set({
      isDirty: false,
      lastSynced: new Date(),
      syncVersion: newVersion ?? get().syncVersion + 1,
      pendingChanges: []
    });
  },

  getSyncStatus: () => {
    const state = get();
    return {
      isDirty: state.isDirty,
      lastSynced: state.lastSynced,
      pendingCount: state.pendingChanges.length
    };
  },

  hydrateWorkflowFromServer: (workflowData) => {
    set({
      currentWorkflow: {
        id: workflowData.id,
        name: workflowData.name,
        description: workflowData.description || '',
        isDefault: workflowData.isDefault,
        isActive: workflowData.isActive,
        canvasState: workflowData.canvasState
      },
      isDirty: false,
      lastSynced: new Date()
    });
  },

  getCurrentWorkflowId: () => get().currentWorkflow?.id || null,

  toggleConfigPanel: () => {
    set(state => ({ isConfigPanelOpen: !state.isConfigPanelOpen }));
  },

  // Execution backed by the canonical V2 workflow run API
  executeWorkflow: async () => {
    const { currentWorkflow } = get();
    if (!currentWorkflow) return '';

    try {
      const result = await WorkflowRunService.launchRun({ workflowId: currentWorkflow.id });
      const execution: WorkflowExecution = {
        id: result.executionId,
        workflowId: currentWorkflow.id,
        status: result.status as FunctionRunRecord['status'],
        startedAt: new Date().toISOString(),
        results: {},
        errors: {}
      };

      set({ execution });
      return result.executionId;
    } catch (error) {
      console.error('[useWorkflowStore] Failed to launch workflow run:', error);
      throw error;
    }
  },

  pauseExecution: async () => {
    const { execution } = get();
    if (!execution) return;

    try {
      await WorkflowRunService.cancelRun(execution.id);
      set({
        execution: { ...execution, status: 'stopped' }
      });
    } catch (error) {
      console.error('[useWorkflowStore] Failed to stop workflow run:', error);
      throw error;
    }
  },

  stopExecution: async () => {
    const { execution } = get();
    if (!execution) return;

    try {
      await WorkflowRunService.cancelRun(execution.id);
      set({
        execution: { ...execution, status: 'stopped' }
      });
    } catch (error) {
      console.error('[useWorkflowStore] Failed to cancel workflow run:', error);
      throw error;
    }
  },

  resetAll: () => set({
    currentWorkflow: null,
    execution: null,
    isConfigPanelOpen: false,
    isDirty: false,
    lastSynced: null,
    syncVersion: 0,
    pendingChanges: []
  })
}));
