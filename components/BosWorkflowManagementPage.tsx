import React, { useEffect, useState, useCallback } from 'react';
import { useDesignStore } from '@/stores/useDesignStore';
import { useAuth } from '@/contexts/AuthContext';
import { useLocalization } from '@/hooks/useLocalization';
import WorkflowCard from '@/components/workflow/WorkflowCard';
import BosMediaModal from '@/components/modals/BosMediaModal';
import CreerWorkflowDialog from '@/components/modals/CreerWorkflowDialog';
import EditWorkflowDialog from '@/components/modals/EditWorkflowDialog';

/**
 * BOS Workflow Management Page
 * Allows user to create, select, edit, and delete multiple workflows
 * PHASE 2: Multiple Workflows Feature
 * 
 * ⭐ Architecture: App.tsx is the primary orchestrator for loadUserWorkflows().
 * This page only retries on user action (retry button) to avoid race conditions.
 */
const BosWorkflowManagementPage: React.FC = () => {
  const { t } = useLocalization();
  const { isAuthenticated } = useAuth();
  
  // Store hooks
  const {
    workflows,
    currentWorkflowId,
    isLoadingWorkflows,
    workflowLoadError,
    createWorkflow,
    updateWorkflow,
    deleteWorkflow,
    loadUserWorkflows
  } = useDesignStore();
  
  // Local state
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showMediaModal, setShowMediaModal] = useState(false);
  const [editingWorkflowId, setEditingWorkflowId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [switchSuccess, setSwitchSuccess] = useState<string | null>(null);
  const activeWorkflow = workflows.find((workflow) => workflow._id === currentWorkflowId) ?? workflows[0] ?? null;
  
  /**
   * ⭐ V5: Observer pattern — Listen for workflow switch results from App.tsx
   * App.tsx dispatches 'workflow:switch:success' or 'workflow:switch:error'
   * after switchToWorkflow() completes.
   */
  useEffect(() => {
    const handleSwitchError = (event: Event) => {
      const { error: errorMsg } = (event as CustomEvent).detail;
      setError(errorMsg || t('notification_workflow_error'));
      setSwitchSuccess(null);
    };
    
    const handleSwitchSuccess = (event: Event) => {
      const { workflowId } = (event as CustomEvent).detail;
      const switchedWorkflow = workflows.find(w => w._id === workflowId);
      setSwitchSuccess(switchedWorkflow?.name || workflowId);
      setError(null);
      // Auto-clear success message after 3s
      const timer = setTimeout(() => setSwitchSuccess(null), 3000);
      return () => clearTimeout(timer);
    };
    
    window.addEventListener('workflow:switch:error', handleSwitchError);
    window.addEventListener('workflow:switch:success', handleSwitchSuccess);
    return () => {
      window.removeEventListener('workflow:switch:error', handleSwitchError);
      window.removeEventListener('workflow:switch:success', handleSwitchSuccess);
    };
  }, [t, workflows]);
  
  /**
   * ⭐ V4 FIX: App.tsx is the primary loader for workflows via its own useEffect.
   * This page only loads as a FALLBACK if App.tsx didn't load them yet
   * (e.g., user navigated to BOS page before hydration completed).
   * Hydration guard prevents race with App.tsx.
   */
  useEffect(() => {
    if (!isAuthenticated) return;
    
    // If App.tsx already loaded workflows, nothing to do
    if (workflows.length > 0 || isLoadingWorkflows) return;
    
    // If there's already an error, don't auto-retry (user can click retry button)
    if (workflowLoadError) return;

    // ⭐ J4: Garde anti-race condition — attendre la fin de l'hydratation
    const isHydrating = sessionStorage.getItem('_arc_hydrating') === 'true';
    if (isHydrating) {
      // Retry check after hydration likely completes
      const retryTimer = setTimeout(() => {
        // Force re-evaluation by triggering a React re-render
        setError(null);
      }, 500);
      return () => clearTimeout(retryTimer);
    }
    
    // Fallback load — App.tsx should have loaded, but in case it didn't
    const timer = setTimeout(async () => {
      try {
        await loadUserWorkflows();
      } catch (err) {
        console.warn('[BosWorkflows] Fallback load failed:', err);
      }
    }, 200);
    
    return () => clearTimeout(timer);
  }, [isAuthenticated, workflows.length, isLoadingWorkflows, workflowLoadError, loadUserWorkflows]);
  
  /**
   * ⭐ V4: Manual retry handler for user-triggered reload
   */
  const handleRetryLoad = useCallback(async () => {
    setError(null);
    try {
      await loadUserWorkflows();
    } catch (err) {
      console.error('[BosWorkflows] Manual retry failed:', err);
    }
  }, [loadUserWorkflows]);
  
  /**
   * ⭐ V5: Simplified — dispatchEvent is synchronous and never throws.
   * Error handling is done via Observer pattern (workflow:switch:error event).
   */
  const handleSelect = (workflowId: string) => {
    setError(null);
    setSwitchSuccess(null);
    // ⭐ V2: Dispatch custom event avec workflowName pour l'overlay Bos
    const workflow = workflows.find(w => w._id === workflowId);
    window.dispatchEvent(new CustomEvent('workflow:switch', { 
      detail: { workflowId, workflowName: workflow?.name || 'Workflow' } 
    }));
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
  
  const handleEdit = async (workflowId: string, name: string, description: string, isDefault?: boolean) => {
    try {
      setError(null);
      await updateWorkflow(workflowId, name, description, isDefault);
      setEditingWorkflowId(null);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : t('notification_workflow_error');
      setError(errorMsg);
    }
  };
  
  const handleDelete = async (workflowId: string) => {
    // ⭐ RÈGLE MÉTIER: Toujours avoir au minimum 1 workflow par défaut
    
    // 1️⃣ Empêcher la suppression du dernier workflow
    if (workflows.length <= 1) {
      setError(t('workflow_delete_last_error') || 'Impossible de supprimer le dernier workflow');
      return;
    }
    
    // 2️⃣ Confirmation utilisateur
    if (!window.confirm(t('workflow_delete_confirm') || 'Êtes-vous sûr de vouloir supprimer ce workflow ?')) {
      return;
    }

    // ⭐ V2: Déterminer si un auto-switch sera nécessaire AVANT la suppression
    const wasActiveWorkflow = (workflowId === currentWorkflowId);
    
    setIsDeleting(workflowId);
    try {
      setError(null);
      await deleteWorkflow(workflowId);
      
      // ⭐ V2: Si on a supprimé le workflow actif, switcher vers le premier restant
      if (wasActiveWorkflow) {
        const remaining = useDesignStore.getState().workflows;
        if (remaining.length > 0) {
          const target = remaining[0];
          window.dispatchEvent(new CustomEvent('workflow:switch', {
            detail: { workflowId: target._id, workflowName: target.name }
          }));
        }
      }
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
    return (
      <div className="h-full flex items-center justify-center bg-gray-900">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-yellow-400 mb-4">
            ⚠️ {t('nav_guest_message')}
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
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setShowMediaModal(true)}
            disabled={!activeWorkflow}
            className="px-4 py-2 rounded border border-cyan-500/40 bg-cyan-500/10 text-cyan-100 hover:bg-cyan-500/20 font-medium transition-colors disabled:cursor-not-allowed disabled:border-gray-700 disabled:bg-gray-800 disabled:text-gray-500"
          >
            {t('bos_media_button', 'Media BOS')}
          </button>
          <button
            onClick={() => setShowCreateDialog(true)}
            className="px-4 py-2 bg-yellow-500 text-black rounded hover:bg-yellow-400 font-medium transition-colors"
          >
            {t('nav_create_workflow')}
          </button>
        </div>
      </div>
      
      {/* Error Message */}
      {error && (
        <div className="p-4 bg-red-900/30 border-l-4 border-red-500 text-red-200 m-4">
          {error}
        </div>
      )}
      
      {/* ⭐ V5: Success Feedback after workflow switch */}
      {switchSuccess && (
        <div className="p-4 bg-green-900/30 border-l-4 border-green-500 text-green-200 m-4 transition-opacity">
          ✅ Workflow « {switchSuccess} » {t('workflow_card_active').toLowerCase()}
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
          <div className="text-center text-gray-400 py-12">
            {isLoadingWorkflows ? (
              <p className="animate-pulse">⏳ {t('loading')}...</p>
            ) : workflowLoadError ? (
              <div>
                <p className="text-red-400 mb-4">❌ {t('error_load_workflows')}: {workflowLoadError}</p>
                <button
                  onClick={handleRetryLoad}
                  className="px-4 py-2 bg-yellow-500 text-black rounded hover:bg-yellow-400 font-medium transition-colors"
                >
                  🔄 {t('retry') || 'Réessayer'}
                </button>
              </div>
            ) : (
              <>
                <p>📭 {t('no_workflows_found') || 'Aucun workflow trouvé'}</p>
                <p className="text-sm mt-2">{t('click_create_to_start')}</p>
              </>
            )}
          </div>
        ) : (
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
          totalWorkflows={workflows.length}
          onClose={() => setEditingWorkflowId(null)}
          onSave={handleEdit}
        />
      )}

      <BosMediaModal
        isOpen={showMediaModal}
        workflowId={activeWorkflow?._id ?? null}
        workflowName={activeWorkflow?.name ?? null}
        onClose={() => setShowMediaModal(false)}
      />
    </div>
  );
};

export default BosWorkflowManagementPage;
