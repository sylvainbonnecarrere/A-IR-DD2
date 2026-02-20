import React, { useEffect, useState } from 'react';
import { useDesignStore } from '@/stores/useDesignStore';
import { useAuth } from '@/contexts/AuthContext';
import { useLocalization } from '@/hooks/useLocalization';
import WorkflowCard from '@/components/workflow/WorkflowCard';
import CreerWorkflowDialog from '@/components/modals/CreerWorkflowDialog';
import EditWorkflowDialog from '@/components/modals/EditWorkflowDialog';

/**
 * BOS Workflow Management Page
 * Allows user to create, select, edit, and delete multiple workflows
 * PHASE 2: Multiple Workflows Feature
 */
const BosWorkflowManagementPage: React.FC = () => {
  const { t } = useLocalization();
  const { isAuthenticated } = useAuth();
  
  // ⭐ DIAGNOSTIC: Log component lifecycle
  console.log('[BosWorkflows] Component rendered', {
    isAuthenticated,
    timestamp: new Date().toISOString()
  });
  
  // Store hooks
  const {
    workflows,
    currentWorkflowId,
    isLoadingWorkflows,
    workflowLoadError,
    selectWorkflow,
    createWorkflow,
    updateWorkflow,
    deleteWorkflow,
    loadUserWorkflows
  } = useDesignStore();
  
  console.log('[BosWorkflows] Store state:', {
    workflowsCount: workflows?.length || 0,
    isLoadingWorkflows,
    hasError: !!workflowLoadError,
    timestamp: new Date().toISOString()
  });
  
  // Local state
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingWorkflowId, setEditingWorkflowId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasLoadedWorkflows, setHasLoadedWorkflows] = useState(false);
  
  // ⭐ PHASE 2.3 - ROBUST LOADING: Load workflows exactly once when page mounts and user is authenticated
  useEffect(() => {
    console.log('[BosWorkflows] useEffect triggered', {
      isAuthenticated,
      hasLoadedWorkflows,
      timestamp: new Date().toISOString()
    });
    
    if (!isAuthenticated) {
      console.log('[BosWorkflows] ❌ User not authenticated, skipping load', {
        isAuthenticated,
        timestamp: new Date().toISOString()
      });
      return;
    }
    
    if (hasLoadedWorkflows) {
      console.log('[BosWorkflows] ✅ Already loaded in this session, skipping');
      return;
    }
    
    console.log('[BosWorkflows] ✅ Starting workflow load for authenticated user', {
      isAuthenticated,
      timestamp: new Date().toISOString()
    });
    setHasLoadedWorkflows(true);
    
    const loadWorkflows = async () => {
      try {
        console.log('[BosWorkflows] ⏳ Calling loadUserWorkflows()...');
        await loadUserWorkflows();
        console.log('[BosWorkflows] ✅ loadUserWorkflows() completed successfully');
      } catch (error) {
        console.error('[BosWorkflows] ❌ loadUserWorkflows() failed:', error);
        // Error is already in store.workflowLoadError
      }
    };
    
    // Load with small delay to ensure hydration
    const timer = setTimeout(() => {
      console.log('[BosWorkflows] Executing load after 50ms delay...');
      loadWorkflows();
    }, 50);
    
    return () => {
      console.log('[BosWorkflows] Cleanup: useEffect unmounting');
      clearTimeout(timer);
    };
  }, [isAuthenticated, hasLoadedWorkflows, loadUserWorkflows]);
  
  const handleSelect = async (workflowId: string) => {
    try {
      setError(null);
      await selectWorkflow(workflowId);
      // Optional: navigate to workflow canvas
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : t('notification_workflow_error');
      setError(errorMsg);
    }
  };
  
  const handleCreate = async (name: string, description: string) => {
    try {
      setError(null);
      await createWorkflow(name, description);
      setShowCreateDialog(false);
      // Show success notification
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : t('notification_workflow_error');
      setError(errorMsg);
    }
  };
  
  const handleEdit = async (workflowId: string, name: string, description: string) => {
    try {
      setError(null);
      await updateWorkflow(workflowId, name, description);
      setEditingWorkflowId(null);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : t('notification_workflow_error');
      setError(errorMsg);
    }
  };
  
  const handleDelete = async (workflowId: string) => {
    // ⭐ RÈGLE MÉTIER: Toujours avoir au minimum 1 workflow par défaut
    
    // 1️⃣ Empêcher la suppression du dernier workflow
    if (workflows.length === 1) {
      setError(t('error_cannot_delete_last_workflow'));
      return;
    }
    
    // 2️⃣ Empêcher la suppression du workflow ACTUELLEMENT ACTIF (UX: user may not realize impact)
    if (workflowId === currentWorkflowId) {
      setError(t('error_cannot_delete_active_workflow'));
      return;
    }
    
    // 3️⃣ Confirmation utilisateur
    if (!window.confirm(t('workflow_card_confirm_delete'))) {
      return;
    }
    
    setIsDeleting(workflowId);
    try {
      setError(null);
      await deleteWorkflow(workflowId);
      
      // ✅ LOG: Workflow supprimé avec succès
      // Optional: show success notification
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : t('notification_workflow_error');
      setError(errorMsg);
      console.error('Error deleting workflow:', err);
    } finally {
      setIsDeleting(null);
    }
  };
  
  // If not authenticated, show guest message
  if (!isAuthenticated) {
    console.warn('[BosWorkflows] ❌ RENDERING: Not authenticated - showing guest message', {
      isAuthenticated,
      workflowsCount: workflows.length,
      workflowLoadError,
      isLoadingWorkflows,
      timestamp: new Date().toISOString()
    });
    
    return (
      <div className="h-full flex items-center justify-center bg-gray-900">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-yellow-400 mb-4">
            ⚠️ {t('nav_guest_message')}
          </h2>
          <p className="text-gray-400">
            {t('nav_connect_for_workflows')}
          </p>
          <p className="text-gray-500 text-xs mt-4">
            (isAuthenticated={String(isAuthenticated)}, workflows={workflows.length}, loading={String(isLoadingWorkflows)})
          </p>
        </div>
      </div>
    );
  }
  
  console.log('[BosWorkflows] ✅ RENDERING: Authenticated - showing workflow page', {
    workflowsCount: workflows.length,
    currentWorkflowId,
    isLoadingWorkflows,
    workflowLoadError,
    hasLoadedWorkflows,
    timestamp: new Date().toISOString()
  });
  
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
          className="px-4 py-2 bg-yellow-500 text-black rounded hover:bg-yellow-400 font-medium transition-colors"
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
      
      {/* API Error Message */}
      {workflowLoadError && (
        <div className="p-4 bg-red-900/30 border-l-4 border-red-500 text-red-200 m-4">
          {t('error_load_workflows')}: {workflowLoadError}
        </div>
      )}
      
      {/* Loading State */}
      {isLoadingWorkflows && !workflows.length ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-gray-400 animate-pulse">
            {t('loading')}...
          </div>
        </div>
      ) : null}
      
      {/* Workflows Grid */}
      <div className="flex-1 overflow-auto p-6">
        {workflows.length === 0 ? (
          <div className="text-center text-gray-400">
            {(() => {
              const msg = isLoadingWorkflows 
                ? '⏳ Loading workflows...' 
                : workflowLoadError 
                  ? `❌ Error: ${workflowLoadError}` 
                  : '📭 No workflows found';
              
              console.log('[BosWorkflows] Rendering empty state:', {
                msg,
                workflowsCount: workflows.length,
                isLoadingWorkflows,
                hasError: !!workflowLoadError,
                timestamp: new Date().toISOString()
              });
              
              return (
                <>
                  <p>{msg}</p>
                  <p className="text-sm mt-2">{t('click_create_to_start')}</p>
                </>
              );
            })()}
          </div>
        ) : (
          (() => {
            console.log('[BosWorkflows] Rendering workflows grid:', {
              workflowsCount: workflows.length,
              workflows: workflows.map(w => ({ id: w._id, name: w.name })),
              timestamp: new Date().toISOString()
            });
            
            return (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {workflows.map((workflow) => {
                  // ⭐ RÈGLE MÉTIER: Calculate deletion constraints
                  const isLastWorkflow = workflows.length === 1;
                  const isActiveWorkflow = workflow._id === currentWorkflowId;
                  const canDelete = !isLastWorkflow && !isActiveWorkflow;
                  
                  return (
                    <WorkflowCard
                      key={workflow._id}
                      workflow={workflow}
                      isActive={isActiveWorkflow}
                      isDeleting={isDeleting === workflow._id}
                      isEditing={editingWorkflowId === workflow._id}
                      isLastWorkflow={isLastWorkflow}
                      canDelete={canDelete}
                      onSelect={() => handleSelect(workflow._id)}
                      onEdit={() => setEditingWorkflowId(workflow._id)}
                      onDelete={() => handleDelete(workflow._id)}
                    />
                  );
                })}
              </div>
            );
          })()
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
          workflow={workflows.find(w => w._id === editingWorkflowId)!}
          onClose={() => setEditingWorkflowId(null)}
          onSave={handleEdit}
        />
      )}
    </div>
  );
};

export default BosWorkflowManagementPage;
