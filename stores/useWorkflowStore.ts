import { create } from 'zustand';
import { RobotId } from '../types';
import { BaseWorkflowNodeData } from '../components/workflow/BaseWorkflowNode';

// Enhanced types for Workflow Editor
export interface WorkflowNode {
  id: string;
  type: 'archi' | 'com' | 'phil' | 'tim' | 'bos';
  position: { x: number; y: number };
  data: BaseWorkflowNodeData;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  type?: 'default' | 'success' | 'error' | 'conditional';
  data?: {
    label?: string;
    condition?: string;
  };
}

export interface Workflow {
  id: string;
  name: string;
  description?: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  variables: Record<string, any>;
  created_at: string;
  updated_at: string;
  creator_id: RobotId;
  // ⭐ NEW: Server-synced properties
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
  status: 'running' | 'completed' | 'failed' | 'paused';
  startedAt: string;
  completedAt?: string;
  currentNodeId?: string;
  results: Record<string, any>;
  errors: Record<string, Error>;
}

interface WorkflowStore {
  // Current Workflow State
  currentWorkflow: Workflow | null;
  workflows: Workflow[];
  
  // Execution State
  execution: WorkflowExecution | null;
  
  // UI State
  selectedNodeId: string | null;
  isPaletteOpen: boolean;
  isConfigPanelOpen: boolean;
  
  // ⭐ ÉTAPE 3: Persistence State (Règle 4.5.2 Dev_rules.md)
  isDirty: boolean;                    // True if local state differs from server
  lastSynced: Date | null;             // Last successful sync timestamp
  syncVersion: number;                 // MongoDB __v for conflict detection
  pendingChanges: string[];            // List of pending change types
  
  // Workflow Management
  createWorkflow: (name: string, creatorId: RobotId) => string;
  loadWorkflow: (id: string) => void;
  saveWorkflow: () => void;
  deleteWorkflow: (id: string) => void;
  updateWorkflowMeta: (updates: Partial<Pick<Workflow, 'name' | 'description'>>) => void;
  
  // ⭐ SELF-HEALING: Hydration from server (with real MongoDB ID)
  hydrateWorkflowFromServer: (workflowData: {
    id: string;
    name: string;
    description?: string;
    isDefault?: boolean;
    isActive?: boolean;
    canvasState?: { zoom: number; panX: number; panY: number };
  }) => void;
  
  // ⭐ Getter for current workflow ID (for persistence)
  getCurrentWorkflowId: () => string | null;
  
  // ⭐ ÉTAPE 3: Dirty State Management
  markDirty: (changeType?: string) => void;
  markClean: (newVersion?: number) => void;
  getSyncStatus: () => { isDirty: boolean; lastSynced: Date | null; pendingCount: number };
  
  // Node Management
  addNode: (node: Omit<WorkflowNode, 'id'>) => string;
  updateNode: (id: string, updates: Partial<WorkflowNode>) => void;
  deleteNode: (id: string) => void;
  duplicateNode: (id: string) => string;
  
  // Edge Management
  addEdge: (edge: Omit<WorkflowEdge, 'id'>) => string;
  updateEdge: (id: string, updates: Partial<WorkflowEdge>) => void;
  deleteEdge: (id: string) => void;
  
  // Selection & UI
  selectNode: (id: string | null) => void;
  togglePalette: () => void;
  toggleConfigPanel: () => void;
  
  // Execution
  executeWorkflow: () => Promise<string>;
  pauseExecution: () => void;
  stopExecution: () => void;
  
  // Persistence
  loadFromLocalStorage: () => void;
  saveToLocalStorage: () => void;
  
  // ⭐ ÉTAPE 2.2: Reset complet pour wipe à la connexion
  resetAll: () => void;
}

const generateId = () => `wf_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

export const useWorkflowStore = create<WorkflowStore>((set, get) => ({
  // Initial State
  currentWorkflow: null,
  workflows: [],
  execution: null,
  selectedNodeId: null,
  isPaletteOpen: true,
  isConfigPanelOpen: false,
  
  // ⭐ ÉTAPE 3: Persistence State Initial
  isDirty: false,
  lastSynced: null,
  syncVersion: 0,
  pendingChanges: [],
  
  // ⭐ ÉTAPE 3: Dirty State Actions
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
  
  // ⭐ SELF-HEALING: Hydrate workflow from server (with real MongoDB ID)
  hydrateWorkflowFromServer: (workflowData) => {
    const now = new Date().toISOString();
    
    // Create or update the currentWorkflow with server data
    const hydratedWorkflow: Workflow = {
      id: workflowData.id, // ⭐ CRITICAL: Real MongoDB ObjectId
      name: workflowData.name,
      description: workflowData.description || '',
      nodes: [], // Will be populated separately
      edges: [], // Will be populated separately
      variables: {},
      created_at: now,
      updated_at: now,
      creator_id: RobotId.Archi,
      isDefault: workflowData.isDefault,
      isActive: workflowData.isActive,
      canvasState: workflowData.canvasState
    };
    
    set({
      currentWorkflow: hydratedWorkflow,
      isDirty: false,
      lastSynced: new Date()
    });
    
    console.log('[useWorkflowStore] Hydrated workflow from server:', {
      id: workflowData.id,
      name: workflowData.name,
      isDefault: workflowData.isDefault
    });
  },
  
  // ⭐ Getter for current workflow ID (for persistence service)
  getCurrentWorkflowId: () => {
    return get().currentWorkflow?.id || null;
  },
  
  // Workflow Management
  createWorkflow: (name: string, creatorId: RobotId) => {
    const id = generateId();
    const now = new Date().toISOString();
    
    const newWorkflow: Workflow = {
      id,
      name,
      description: '',
      nodes: [],
      edges: [],
      variables: {},
      created_at: now,
      updated_at: now,
      creator_id: creatorId
    };
    
    set((state) => ({
      workflows: [...state.workflows, newWorkflow],
      currentWorkflow: newWorkflow
    }));
    
    get().saveToLocalStorage();
    return id;
  },
  
  loadWorkflow: (id: string) => {
    const workflow = get().workflows.find(w => w.id === id);
    if (workflow) {
      set({ currentWorkflow: workflow });
    }
  },
  
  saveWorkflow: () => {
    const { currentWorkflow, workflows } = get();
    if (!currentWorkflow) return;
    
    const updatedWorkflow = {
      ...currentWorkflow,
      updated_at: new Date().toISOString()
    };
    
    set({
      currentWorkflow: updatedWorkflow,
      workflows: workflows.map(w => w.id === updatedWorkflow.id ? updatedWorkflow : w)
    });
    
    get().saveToLocalStorage();
  },
  
  deleteWorkflow: (id: string) => {
    set((state) => ({
      workflows: state.workflows.filter(w => w.id !== id),
      currentWorkflow: state.currentWorkflow?.id === id ? null : state.currentWorkflow
    }));
    get().saveToLocalStorage();
  },
  
  updateWorkflowMeta: (updates) => {
    const { currentWorkflow } = get();
    if (!currentWorkflow) return;
    
    const updatedWorkflow = { ...currentWorkflow, ...updates };
    set({ currentWorkflow: updatedWorkflow });
    get().saveWorkflow();
  },
  
  // Node Management
  addNode: (nodeData) => {
    const { currentWorkflow } = get();
    if (!currentWorkflow) return '';
    
    const id = generateId();
    const newNode: WorkflowNode = { ...nodeData, id };
    
    set({
      currentWorkflow: {
        ...currentWorkflow,
        nodes: [...currentWorkflow.nodes, newNode]
      }
    });
    
    get().saveWorkflow();
    return id;
  },
  
  updateNode: (id: string, updates) => {
    const { currentWorkflow } = get();
    if (!currentWorkflow) return;
    
    set({
      currentWorkflow: {
        ...currentWorkflow,
        nodes: currentWorkflow.nodes.map(node => 
          node.id === id ? { ...node, ...updates } : node
        )
      }
    });
    
    get().saveWorkflow();
  },
  
  deleteNode: (id: string) => {
    const { currentWorkflow } = get();
    if (!currentWorkflow) return;
    
    // Delete node and all connected edges
    set({
      currentWorkflow: {
        ...currentWorkflow,
        nodes: currentWorkflow.nodes.filter(node => node.id !== id),
        edges: currentWorkflow.edges.filter(edge => 
          edge.source !== id && edge.target !== id
        )
      },
      selectedNodeId: get().selectedNodeId === id ? null : get().selectedNodeId
    });
    
    get().saveWorkflow();
  },
  
  duplicateNode: (id: string) => {
    const { currentWorkflow } = get();
    if (!currentWorkflow) return '';
    
    const originalNode = currentWorkflow.nodes.find(n => n.id === id);
    if (!originalNode) return '';
    
    const newId = generateId();
    const duplicatedNode: WorkflowNode = {
      ...originalNode,
      id: newId,
      position: {
        x: originalNode.position.x + 50,
        y: originalNode.position.y + 50
      },
      data: {
        ...originalNode.data,
        label: `${originalNode.data.label} (Copy)`
      }
    };
    
    set({
      currentWorkflow: {
        ...currentWorkflow,
        nodes: [...currentWorkflow.nodes, duplicatedNode]
      }
    });
    
    get().saveWorkflow();
    return newId;
  },
  
  // Edge Management
  addEdge: (edgeData) => {
    const { currentWorkflow } = get();
    if (!currentWorkflow) return '';
    
    const id = generateId();
    const newEdge: WorkflowEdge = { ...edgeData, id };
    
    set({
      currentWorkflow: {
        ...currentWorkflow,
        edges: [...currentWorkflow.edges, newEdge]
      }
    });
    
    get().saveWorkflow();
    return id;
  },
  
  updateEdge: (id: string, updates) => {
    const { currentWorkflow } = get();
    if (!currentWorkflow) return;
    
    set({
      currentWorkflow: {
        ...currentWorkflow,
        edges: currentWorkflow.edges.map(edge => 
          edge.id === id ? { ...edge, ...updates } : edge
        )
      }
    });
    
    get().saveWorkflow();
  },
  
  deleteEdge: (id: string) => {
    const { currentWorkflow } = get();
    if (!currentWorkflow) return;
    
    set({
      currentWorkflow: {
        ...currentWorkflow,
        edges: currentWorkflow.edges.filter(edge => edge.id !== id)
      }
    });
    
    get().saveWorkflow();
  },
  
  // Selection & UI
  selectNode: (id) => {
    set({ selectedNodeId: id });
  },
  
  togglePalette: () => {
    set(state => ({ isPaletteOpen: !state.isPaletteOpen }));
  },
  
  toggleConfigPanel: () => {
    set(state => ({ isConfigPanelOpen: !state.isConfigPanelOpen }));
  },
  
  // Execution (Mock implementation for now)
  executeWorkflow: async () => {
    const { currentWorkflow } = get();
    if (!currentWorkflow) return '';
    
    const executionId = generateId();
    const execution: WorkflowExecution = {
      id: executionId,
      workflowId: currentWorkflow.id,
      status: 'running',
      startedAt: new Date().toISOString(),
      results: {},
      errors: {}
    };
    
    set({ execution });
    
    // Mock execution - in real implementation this would call the backend
    setTimeout(() => {
      set({
        execution: {
          ...execution,
          status: 'completed',
          completedAt: new Date().toISOString()
        }
      });
    }, 3000);
    
    return executionId;
  },
  
  pauseExecution: () => {
    const { execution } = get();
    if (execution && execution.status === 'running') {
      set({
        execution: { ...execution, status: 'paused' }
      });
    }
  },
  
  stopExecution: () => {
    set({ execution: null });
  },
  
  // Persistence
  loadFromLocalStorage: () => {
    try {
      const saved = localStorage.getItem('workflow-editor-data');
      if (saved) {
        const { workflows, currentWorkflowId } = JSON.parse(saved);
        const currentWorkflow = workflows.find((w: Workflow) => w.id === currentWorkflowId);
        
        set({
          workflows,
          currentWorkflow: currentWorkflow || null
        });
      }
    } catch (error) {
      console.error('Failed to load workflow data:', error);
    }
  },
  
  saveToLocalStorage: () => {
    try {
      const { workflows, currentWorkflow } = get();
      const data = {
        workflows,
        currentWorkflowId: currentWorkflow?.id || null
      };
      localStorage.setItem('workflow-editor-data', JSON.stringify(data));
    } catch (error) {
      console.error('Failed to save workflow data:', error);
    }
  },
  
  // ⭐ CRITICAL SECURITY: Reset ALL workflow state (including persistence state)
  resetAll: () => set({
    currentWorkflow: null,
    workflows: [],
    execution: null,
    selectedNodeId: null,
    isPaletteOpen: true,
    isConfigPanelOpen: false,
    // ⭐ ÉTAPE 3: Reset persistence state
    isDirty: false,
    lastSynced: null,
    syncVersion: 0,
    pendingChanges: []
  })
}));