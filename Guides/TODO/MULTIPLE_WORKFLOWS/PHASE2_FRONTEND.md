# PHASE 2 - Frontend Implementation Guide

**Destinataire**: Agent Codeur-Spécialiste (Frontend) & Designer UX  
**Dépendance**: Phase 1 Backend MUST be complete  
**Durée estimée**: 3-4 jours  

---

## 1. Store Updates - useDesignStore

### Task 1.1: Extend useDesignStore Interface

**Fichier**: `stores/useDesignStore.ts` - TOP of file

**ADD to DesignStore interface**:
```typescript
interface DesignStore {
  // ✅ EXISTING FIELDS (DO NOT MODIFY)
  agents: Agent[];
  agentInstances: AgentInstance[];
  nodes: V2WorkflowNode[];
  edges: V2WorkflowEdge[];
  
  // ⭐ NEW FIELDS
  workflows: IWorkflow[];                    // List of user workflows
  currentWorkflowId: string | null;          // Active workflow ID
  isLoadingWorkflows: boolean;
  workflowLoadError: string | null;
  
  // ⭐ NEW ACTIONS
  setWorkflows: (workflows: IWorkflow[]) => void;
  setCurrentWorkflowId: (id: string | null) => void;
  selectWorkflow: (workflowId: string) => Promise<void>;
  createWorkflow: (name: string, desc?: string) => Promise<IWorkflow>;
  updateWorkflow: (workflowId: string, name: string, desc?: string) => Promise<IWorkflow>;
  deleteWorkflow: (workflowId: string) => Promise<void>;
  loadUserWorkflows: () => Promise<void>;
  
  // ⭐ UTILITIES
  getActiveWorkflow: () => IWorkflow | undefined;
  getWorkflowStats: (id: string) => { agentCount: number; nodeCount: number };
}
```

### Task 1.2: Implement Store Methods

**Fichier**: `stores/useDesignStore.ts` - In create() function

**Initial State**:
```typescript
export const useDesignStore = create<DesignStore>((set, get) => ({
  // ... existing initial state ...
  
  // ⭐ NEW
  workflows: [],
  currentWorkflowId: null,
  isLoadingWorkflows: false,
  workflowLoadError: null,
  
  // Rest of implementation below...
}));
```

**Setters**:
```typescript
setWorkflows: (workflows: IWorkflow[]) => set({ workflows }),

setCurrentWorkflowId: (id: string | null) => set({ currentWorkflowId: id }),
```

**loadUserWorkflows Action**:
```typescript
loadUserWorkflows: async () => {
  set({ isLoadingWorkflows: true, workflowLoadError: null });
  try {
    const response = await fetch('/api/workflows', {
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('authToken')}`
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to load workflows: ${response.statusText}`);
    }
    
    const workflows = await response.json();
    
    // Auto-select first active or first available
    const activeOne = workflows.find((w: IWorkflow) => w.isActive);
    const toSelect = activeOne || workflows[0];
    
    set({
      workflows,
      currentWorkflowId: toSelect?._id || null,
      isLoadingWorkflows: false
    });
    
    return workflows;
    
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    set({
      workflowLoadError: msg,
      isLoadingWorkflows: false
    });
    throw error;
  }
},
```

**selectWorkflow Action**:
```typescript
selectWorkflow: async (workflowId: string) => {
  set({ isLoadingWorkflows: true, workflowLoadError: null });
  try {
    const response = await fetch(`/api/workflows/${workflowId}/select`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('authToken')}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Cannot select workflow: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    // Atomically update design store with new workflow data
    set({
      currentWorkflowId: workflowId,
      agentInstances: data.reloadedData.agents || [],
      nodes: data.reloadedData.nodes || [],
      edges: data.reloadedData.edges || [],
      isLoadingWorkflows: false
    });
    
    // ⭐ IMPORTANT: Reset runtime store separately (call from App.tsx)
    // This clears chat messages, execution state, etc
    
    return data;
    
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    set({ workflowLoadError: msg, isLoadingWorkflows: false });
    throw error;
  }
},
```

**createWorkflow Action**:
```typescript
createWorkflow: async (name: string, desc?: string) => {
  try {
    const response = await fetch('/api/workflows', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('authToken')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name,
        description: desc
      })
    });
    
    if (!response.ok) {
      throw new Error('Failed to create workflow');
    }
    
    const newWorkflow = await response.json();
    const state = get();
    
    // Add to list
    set({ workflows: [...state.workflows, newWorkflow] });
    
    return newWorkflow;
    
  } catch (error) {
    throw error;
  }
},

**updateWorkflow Action** (NEW):
```typescript
updateWorkflow: async (workflowId: string, name: string, desc?: string) => {
  try {
    const response = await fetch(`/api/workflows/${workflowId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('authToken')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name,
        description: desc
      })
    });
    
    if (!response.ok) {
      throw new Error('Failed to update workflow');
    }
    
    const updatedWorkflow = await response.json();
    const state = get();
    
    // Update in list
    const updated = state.workflows.map(w => 
      w._id === workflowId ? updatedWorkflow : w
    );
    set({ workflows: updated });
    
    return updatedWorkflow;
    
  } catch (error) {
    throw error;
  }
},
```
```

**deleteWorkflow Action**:
```typescript
deleteWorkflow: async (workflowId: string) => {
  try {
    const response = await fetch(`/api/workflows/${workflowId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('authToken')}`
      }
    });
    
    if (!response.ok) {
      throw new Error(await response.text());
    }
    
    const state = get();
    const remaining = state.workflows.filter(w => w._id !== workflowId);
    
    // Auto-select another if deleted was active
    let newActive = state.currentWorkflowId;
    if (newActive === workflowId && remaining.length > 0) {
      newActive = remaining[0]._id;
    }
    
    set({
      workflows: remaining,
      currentWorkflowId: newActive
    });
    
  } catch (error) {
    throw error;
  }
},
```

**Utility Functions**:
```typescript
getActiveWorkflow: () => {
  const state = get();
  return state.workflows.find(w => w._id === state.currentWorkflowId);
},

getWorkflowStats: (id: string) => {
  const state = get();
  const agents = state.agentInstances.filter(a => a.workflowId === id).length;
  const nodes = state.nodes.filter(n => n.data?.workflowId === id).length;
  return { agentCount: agents, nodeCount: nodes };
},
```

---

## 2. Components - New Components

### Task 2.1: Create BosWorkflowManagementPage

**Fichier**: `components/BosWorkflowManagementPage.tsx` (CREATE NEW)

**Template**:
```tsx
import React, { useEffect, useState } from 'react';
import { useDesignStore } from '../stores/useDesignStore';
import { useAuth } from '../contexts/AuthContext';
import { useLocalization } from '../hooks/useLocalization';
import { WorkflowCard } from './workflow/WorkflowCard';
import { CreerWorkflowDialog } from './modals/CreerWorkflowDialog';

const BosWorkflowManagementPage: React.FC = () => {
  const { isAuthenticated, user } = useAuth();
  const { t } = useLocalization();
  const {
    workflows,
    currentWorkflowId,
    isLoadingWorkflows,
    selectWorkflow,
    createWorkflow,
    updateWorkflow,
    deleteWorkflow,
    loadUserWorkflows
  } = useDesignStore();
  
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingWorkflowId, setEditingWorkflowId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  useEffect(() => {
    if (isAuthenticated) {
      loadUserWorkflows().catch(() => {});
    }
  }, [isAuthenticated]);
  
  const handleSelect = async (workflowId: string) => {
    try {
      setError(null);
      await selectWorkflow(workflowId);
      // Optional: navigate to /bos/dashboard or /workflow
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error selecting workflow');
    }
  };
  
  const handleCreate = async (name: string, desc: string) => {
    try {
      setError(null);
      await createWorkflow(name, desc);
      // Show notification
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error creating workflow');
    }
  };
  
  const handleEdit = async (workflowId: string, name: string, desc: string) => {
    try {
      setError(null);
      await updateWorkflow(workflowId, name, desc);
      setEditingWorkflowId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error updating workflow');
    }
  };
  
  const handleDelete = async (workflowId: string) => {
    if (workflows.length === 1) {
      setError(t('error_cannot_delete_last_workflow'));
      return;
    }
    
    if (!window.confirm(t('workflow_card_confirm_delete'))) {
      return;
    }
    
    setIsDeleting(workflowId);
    try {
      setError(null);
      await deleteWorkflow(workflowId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error deleting workflow');
    } finally {
      setIsDeleting(null);
    }
  };
  
  // RENDER
  if (!isAuthenticated) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-900">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-yellow-400 mb-4">
            {t('nav_guest_message')}
          </h2>
          <p className="text-gray-400">
            {t('nav_connect_for_workflows')}
          </p>
        </div>
      </div>
    );
  }
  
  return (
    <div className="h-full flex flex-col bg-gray-900 text-gray-100">
      {/* Header */}
      <div className="p-6 border-b border-gray-700 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-yellow-400">
            {t('page_bos_manage_workflows_title')}
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            {t('page_bos_manage_workflows_description')}
          </p>
        </div>
        <button
          onClick={() => setShowCreateDialog(true)}
          className="px-4 py-2 bg-yellow-500 text-black rounded hover:bg-yellow-400 font-medium"
        >
          ✨ {t('nav_create_workflow')}
        </button>
      </div>
      
      {/* Error Message */}
      {error && (
        <div className="p-4 bg-red-900/30 border-l-4 border-red-500 text-red-200 m-4">
          {error}
        </div>
      )}
      
      {/* Loading State */}
      {isLoadingWorkflows && !workflows.length ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-gray-400">Chargement des workflows...</div>
        </div>
      ) : null}
      
      {/* Workflows Grid */}
      <div className="flex-1 overflow-auto p-6">
        {workflows.length === 0 ? (
          <div className="text-center text-gray-400">
            Aucun workflow trouvé. Cliquez sur "Créer nouveau workflow" pour commencer.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {workflows.map((workflow) => (
              <WorkflowCard
                key={workflow._id}
                workflow={workflow}
                isActive={workflow._id === currentWorkflowId}
                isDeleting={isDeleting === workflow._id}
                isEditing={editingWorkflowId === workflow._id}
                onSelect={() => handleSelect(workflow._id)}
                onEdit={() => setEditingWorkflowId(workflow._id)}
                onDelete={() => handleDelete(workflow._id)}
              />
            ))}
          </div>
        )}
      </div>
      
      {/* Create Dialog */}
      <CreerWorkflowDialog
        isOpen={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        onCreate={handleCreate}
      />
      
      {/* Edit Dialog */}
      {editingWorkflowId && (
        <EditWorkflowDialog
          isOpen={true}
          workflow={workflows.find(w => w._id === editingWorkflowId)}
          onClose={() => setEditingWorkflowId(null)}
          onSave={handleEdit}
        />
      )}
    </div>
  );
};

export default BosWorkflowManagementPage;
```

### Task 2.2: Create WorkflowCard Component

**Fichier**: `components/workflow/WorkflowCard.tsx` (CREATE NEW)

```tsx
import React, { useEffect, useState } from 'react';
import { IWorkflow } from '../../types';
import { useLocalization } from '../../hooks/useLocalization';

interface WorkflowCardProps {
  workflow: IWorkflow;
  isActive: boolean;
  isDeleting?: boolean;
  isEditing?: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

const WorkflowCard: React.FC<WorkflowCardProps> = ({
  workflow,
  isActive,
  isDeleting,
  isEditing,
  onSelect,
  onEdit,
  onDelete
}) => {
  const { t } = useLocalization();
  const [stats, setStats] = useState({ agentCount: 0, nodeCount: 0 });
  const [loadingStats, setLoadingStats] = useState(true);
  
  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch(`/api/workflows/${workflow._id}/stats`, {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken')}` }
        });
        if (res.ok) {
          const data = await res.json();
          setStats({
            agentCount: data.agentInstanceCount,
            nodeCount: data.nodeCount
          });
        }
      } catch (err) {
        console.error('Failed to load stats:', err);
      } finally {
        setLoadingStats(false);
      }
    };
    
    fetchStats();
  }, [workflow]);
  
  const formatDate = (date: Date | string) => {
    return new Date(date).toLocaleDateString('fr-FR');
  };
  
  return (
    <div className={`
      p-5 rounded-lg border-2 transition-all transform hover:scale-105
      ${isActive
        ? 'bg-yellow-500/20 border-yellow-400 shadow-[0 0 15px rgba(234,179,8,0.4)]'
        : 'bg-gray-800/50 border-gray-600 hover:border-yellow-400/50'
      }
    `}>
      {/* Header with Edit Icon */}
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex-1">
          <h3 className={`text-lg font-semibold ${isActive ? 'text-yellow-300' : 'text-white'}`}>
            {workflow.name}
          </h3>
          {workflow.description && (
            <p className="text-sm text-gray-400 mt-1 line-clamp-2">
              {workflow.description}
            </p>
          )}
        </div>
        {/* Edit Icon - Discrete pencil next to name */}
        <button
          onClick={onEdit}
          className="text-gray-500 hover:text-yellow-400 transition-colors flex-shrink-0 opacity-60 hover:opacity-100"
          title={t('workflow_card_edit_tooltip')}
          aria-label={t('workflow_card_edit_tooltip')}
        >
          ✎
        </button>
      </div>
      
      {/* Stats */}
      <div className="grid grid-cols-2 gap-2 mb-4 text-xs text-gray-400 bg-gray-900/40 p-3 rounded">
        <div className="flex items-center gap-1">
          <span>📅</span>
          <span>{t('workflow_card_created')}: {formatDate(workflow.createdAt)}</span>
        </div>
        <div className="flex items-center gap-1">
          <span>✏️</span>
          <span>{t('workflow_card_modified')}: {formatDate(workflow.updatedAt)}</span>
        </div>
        <div className="flex items-center gap-1">
          <span>🤖</span>
          <span>{t('workflow_card_agents')}: {loadingStats ? '...' : stats.agentCount}</span>
        </div>
        <div className="flex items-center gap-1">
          <span>🔗</span>
          <span>{t('workflow_card_nodes')}: {loadingStats ? '...' : stats.nodeCount}</span>
        </div>
      </div>
      
      {/* Buttons */}
      <div className="flex gap-2">
        <button
          onClick={onSelect}
          disabled={isActive}
          className={`flex-1 px-3 py-2 rounded font-medium transition-all ${
            isActive
              ? 'bg-yellow-500 text-black cursor-default'
              : 'bg-yellow-500 text-black hover:bg-yellow-400'
          }`}
        >
          {isActive ? t('workflow_card_active') : t('workflow_card_select')}
        </button>
        
        {!workflow.isDefault && (
          <button
            onClick={onDelete}
            disabled={isDeleting}
            className="px-3 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
            title={t('workflow_card_delete')}
          >
            {isDeleting ? '⏳' : '🗑️'}
          </button>
        )}
      </div>
      
      {/* Default Badge */}
      {workflow.isDefault && (
        <div className="mt-3 pt-3 border-t border-yellow-400/30 text-center">
          <span className="text-xs text-yellow-400 font-semibold">
            ⭐ {t('workflow_card_default')}
          </span>
        </div>
      )}
    </div>
  );
};

export default WorkflowCard;
```

### Task 2.3: Create CreerWorkflowDialog

**Fichier**: `components/modals/CreerWorkflowDialog.tsx` (CREATE NEW)

```tsx
import React, { useState } from 'react';
import { useLocalization } from '../../hooks/useLocalization';

interface CreerWorkflowDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (name: string, description: string) => Promise<void>;
}

const CreerWorkflowDialog: React.FC<CreerWorkflowDialogProps> = ({
  isOpen,
  onClose,
  onCreate
}) => {
  const { t } = useLocalization();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  
  const handleCreate = async () => {
    if (!name.trim()) {
      setError(t('dialog_workflow_name_required'));
      return;
    }
    
    setIsCreating(true);
    setError('');
    
    try {
      await onCreate(name, description);
      setName('');
      setDescription('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsCreating(false);
    }
  };
  
  if (!isOpen) return null;
  
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-800 border border-gray-600 rounded-lg p-6 w-96 shadow-xl">
        {/* Header */}
        <h2 className="text-xl font-bold text-yellow-400 mb-4">
          {t('dialog_create_workflow_title')}
        </h2>
        
        {/* Form */}
        <div className="space-y-4">
          {/* Name Input */}
          <div>
            <label className="block text-sm font-medium text-yellow-300 mb-2">
              {t('dialog_workflow_name')} *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Mon workflow..."
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white focus:border-yellow-400 focus:outline-none"
              disabled={isCreating}
            />
          </div>
          
          {/* Description Input */}
          <div>
            <label className="block text-sm font-medium text-yellow-300 mb-2">
              {t('dialog_workflow_description')} (optionnel)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('dialog_workflow_description_placeholder')}
              rows={3}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white focus:border-yellow-400 focus:outline-none resize-none"
              disabled={isCreating}
            />
          </div>
          
          {/* Error Message */}
          {error && (
            <div className="p-3 bg-red-900/30 border border-red-500 rounded text-red-200 text-sm">
              {error}
            </div>
          )}
        </div>
        
        {/* Buttons */}
        <div className="flex gap-2 mt-6">
          <button
            onClick={onClose}
            disabled={isCreating}
            className="flex-1 px-4 py-2 text-gray-300 hover:text-white hover:bg-gray-700 rounded disabled:opacity-50"
          >
            {t('dialog_workflow_cancel_button')}
          </button>
          <button
            onClick={handleCreate}
            disabled={isCreating || !name.trim()}
            className="flex-1 px-4 py-2 bg-yellow-500 text-black rounded hover:bg-yellow-400 font-medium disabled:opacity-50"
          >
            {isCreating ? t('dialog_workflow_creating') : t('dialog_workflow_create_button')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CreerWorkflowDialog;
```

---

## 3. Navigation & Routing Updates

### Task 3.1: Update robotNavigation.ts

**Fichier**: `data/robotNavigation.ts`

Find BOS nestedItems array and ADD:

```typescript
{
  id: RobotId.Bos,
  name: 'bos_manage_workflows',
  iconComponent: FolderOpenIcon,  // Import from components/Icons
  path: '/bos/workflows/manage',
  description: 'bos_manage_workflows_desc'
}
```

**Example (find this section)**:
```typescript
{
  id: RobotId.Bos,
  name: 'robot_bos_name',
  iconComponent: MonitoringIcon,
  path: '/bos/dashboard',
  description: 'robot_bos_description',
  nestedItems: [
    { id: RobotId.Bos, name: 'nav_dashboard', ... },
    { id: RobotId.Bos, name: 'bos_monitoring_live', ... },
    // ... other items ...
    // ⭐ ADD HERE:
    {
      id: RobotId.Bos,
      name: 'bos_manage_workflows',
      iconComponent: FolderOpenIcon,
      path: '/bos/workflows/manage',
      description: 'bos_manage_workflows_desc'
    }
  ]
}
```

### Task 3.2: Update RobotPageRouter.tsx

**Fichier**: `components/RobotPageRouter.tsx`

**ADD import at top**:
```typescript
import { BosWorkflowManagementPage } from './BosWorkflowManagementPage';
```

**ADD routing logic before final return statement**:

Find where `/workflow` is rendered and ADD:

```typescript
// BOS - Workflow Management Page (NEW)
if (currentPath.startsWith('/bos/workflows/manage')) {
  return (
    <div className="h-full">
      <BosWorkflowManagementPage />
    </div>
  );
}
```

**Full example section**:
```typescript
// Com - API Connections (existing)
if (currentPath.startsWith('/com/connections')) {
  return <ComConnectionsPage llmConfigs={llmConfigs} />;
}

// ⭐ NEW - BOS Workflow Management
if (currentPath.startsWith('/bos/workflows/manage')) {
  return <BosWorkflowManagementPage />;
}

// BOS/others - Workflow Canvas (default)
if (currentPath.startsWith('/bos')) {
  return (
    <WorkflowPage
      robotName={t('page_bos_supervision_title')}
      description={t('page_bos_supervision_description')}
      // ... rest of props
    />
  );
}
```

---

## 4. App.tsx Integration

### Task 4.1: Load Workflows on AuthContext Change

**Fichier**: `App.tsx`

**Find where workflows/agents load and ADD**:

```typescript
// Pseudo-code - adapt to your actual useEffect
useEffect(() => {
  if (isAuthenticated && accessToken) {
    // Load workflows
    useDesignStore.getState().loadUserWorkflows()
      .then(() => {
        // Auto-select active workflow
        const activeWf = useDesignStore.getState().workflows
          .find(w => w.isActive);
        if (activeWf) {
          useDesignStore.getState().selectWorkflow(activeWf._id);
        }
      })
      .catch(err => {
        console.error('Failed to load workflows:', err);
        // Show error notification
      });
  } else if (!isAuthenticated) {
    // Guest mode - reset
    useRuntimeStore.getState().resetAll();
    useDesignStore.getState().setWorkflows([]);
  }
}, [isAuthenticated, accessToken]);
```

### Task 4.2: Reset Runtime Store on Workflow Select

**Fichier**: `App.tsx` or create hook

**When workflow is selected, clear runtime state**:

```typescript
// After useDesignStore.selectWorkflow() succeeds:
const handleWorkflowSelect = async (workflowId: string) => {
  try {
    await useDesignStore.getState().selectWorkflow(workflowId);
    
    // ⭐ CRITICAL: Reset runtime state
    useRuntimeStore.getState().resetAll();
    
    // Navigate to workflow canvas or BOS dashboard
    // navigate('/bos/dashboard'); or navigate('/workflow');
    
  } catch (err) {
    showNotification('error', 'Failed to switch workflow');
  }
};
```

---

## 5. i18n Translations

### Task 5.1: Add All Keys

**Fichier**: `i18n/fr.ts` (and all other languages: en.ts, de.ts, etc)

**ADD these keys**:

```typescript
// ============ MULTIPLE WORKFLOWS ============

// BOS Menu Items
bos_manage_workflows: "Gérer ses workflows",
bos_manage_workflows_desc: "Créer, sélectionner et gérer multiples workflows",

// Pages
page_bos_manage_workflows_title: "Gérer vos workflows",
page_bos_manage_workflows_description: "Créez et basculez entre plusieurs workflows",

// Buttons & Navigation
nav_create_workflow: "Créer nouveau workflow",
nav_guest_message: "Utilisateur invité, workflow de démonstration",
nav_connect_for_workflows: "Connectez-vous pour gérer plusieurs workflows",

// WorkflowCard
workflow_card_created: "Créé",
workflow_card_modified: "Modifié",
workflow_card_agents: "Agents",
workflow_card_nodes: "Nœuds",
workflow_card_select: "Sélectionner",
workflow_card_delete: "Supprimer",
workflow_card_active: "Workflow actif",
workflow_card_default: "Workflow par défaut",
workflow_card_confirm_delete: "Êtes-vous sûr? Cette action supprimera le workflow et TOUS ses contenus (agents, notes, journaux). Cette action est irréversible.",

// CreerWorkflowDialog
dialog_create_workflow_title: "Créer un nouveau workflow",
dialog_workflow_name: "Nom du workflow",
dialog_workflow_name_required: "Le nom du workflow est requis",
dialog_workflow_description: "Description (optionnel)",
dialog_workflow_description_placeholder: "Décrivez votre workflow...",
dialog_workflow_create_button: "Créer",
dialog_workflow_cancel_button: "Annuler",
dialog_workflow_creating: "Création...",

// Notifications
notification_workflow_created: "Workflow créé avec succès",
notification_workflow_selected: "Workflow sélectionné",
notification_workflow_deleted: "Workflow supprimé",
notification_workflow_error: "Erreur lors de l'opération sur le workflow",

// Errors
error_cannot_delete_last_workflow: "Impossible de supprimer le seul workflow",
error_workflow_not_found: "Workflow non trouvé",
error_load_workflows: "Erreur lors du chargement des workflows",

// Edit Workflow Functionality
workflow_card_edit_tooltip: "Modifier ce workflow (nom et description)",
dialog_edit_workflow_title: "Modifier le workflow",
dialog_workflow_name_placeholder: "Nom du workflow",
dialog_workflow_save_button: "Enregistrer les modifications",
dialog_workflow_saving: "Enregistrement...",
```

**Translate for**: en.ts, de.ts, es.ts, pt.ts, ua.ts (following existing patterns)

---

## 6. Testing Frontend

### Task 6.1: Component Tests

**Fichier**: `tests/components/BosWorkflowManagement.test.tsx` (CREATE NEW)

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BosWorkflowManagementPage from '../components/BosWorkflowManagementPage';
import { useAuth } from '../contexts/AuthContext';
import { useDesignStore } from '../stores/useDesignStore';

jest.mock('../contexts/AuthContext');
jest.mock('../stores/useDesignStore');

describe('BosWorkflowManagementPage', () => {
  
  test('Guest user sees message', () => {
    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: false
    });
    
    render(<BosWorkflowManagementPage />);
    
    expect(screen.getByText(/Utilisateur invité/i)).toBeInTheDocument();
  });
  
  test('Authenticated user sees workflows list', async () => {
    const mockWorkflows = [
      { _id: '1', name: 'Workflow 1', isActive: true, isDefault: true },
      { _id: '2', name: 'Workflow 2', isActive: false, isDefault: false }
    ];
    
    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true
    });
    (useDesignStore as jest.Mock).mockReturnValue({
      workflows: mockWorkflows,
      loadUserWorkflows: jest.fn()
    });
    
    render(<BosWorkflowManagementPage />);
    
    await waitFor(() => {
      expect(screen.getByText('Workflow 1')).toBeInTheDocument();
      expect(screen.getByText('Workflow 2')).toBeInTheDocument();
    });
  });
  
  test('Click create workflow opens dialog', () => {
    (useAuth as jest.Mock).mockReturnValue({ isAuthenticated: true });
    (useDesignStore as jest.Mock).mockReturnValue({
      workflows: []
    });
    
    render(<BosWorkflowManagementPage />);
    
    fireEvent.click(screen.getByText(/Créer nouveau workflow/i));
    
    expect(screen.getByText(/Créer un nouveau workflow/i)).toBeInTheDocument();
  });
});
```

### Task 6.2: Integration Tests

**Fichier**: `tests/integration/MultipleWorkflows.integration.test.tsx` (CREATE NEW)

```typescript
describe('Multiple Workflows - Integration', () => {
  
  test('User workflow lifecycle', async () => {
    // 1. Sign up
    const signupRes = await fetch('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email: 'test@example.com', password: 'pass' })
    });
    const token = (await signupRes.json()).token;
    
    // 2. Load workflows
    const listRes = await fetch('/api/workflows', {
      headers: { Authorization: `Bearer ${token}` }
    });
    const workflows = await listRes.json();
    
    expect(workflows.length).toBe(1);
    expect(workflows[0].isDefault).toBe(true);
    
    // 3. Create new workflow
    const createRes = await fetch('/api/workflows', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Workflow' })
    });
    const newWf = await createRes.json();
    
    expect(newWf.isActive).toBe(false);
    
    // 4. Select new workflow
    const selectRes = await fetch(`/api/workflows/${newWf._id}/select`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    const selected = await selectRes.json();
    
    expect(selected.workflow.isActive).toBe(true);
    
    // 5. Delete old workflow
    const deleteRes = await fetch(`/api/workflows/${workflows[0]._id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
    
    expect(deleteRes.ok).toBe(true);
  });
});
```

---

## 7. Verification Checklist

- [ ] useDesignStore extended with workflow methods
- [ ] BosWorkflowManagementPage component created & functional (with edit dialog)
- [ ] WorkflowCard component styled (BOS yellow/gold theme) with edit icon ✎
- [ ] EditWorkflowDialog created for editing workflow name/description
- [ ] CreerWorkflowDialog functional
- [ ] robotNavigation.ts updated with new BOS item
- [ ] RobotPageRouter.tsx routing working
- [ ] App.tsx integrates workflow loading
- [ ] Runtime store resets on workflow select
- [ ] All i18n keys added (FR + all languages)
- [ ] Guest mode works (no workflows shown)
- [ ] All component tests passing
- [ ] All integration tests passing
- [ ] No console errors/warnings
- [ ] Responsive design (PC breakpoints)
- [ ] Loading states smooth
- [ ] Error messages clear

---

**Next Step**: QA & Full System Testing (Phase 3)
