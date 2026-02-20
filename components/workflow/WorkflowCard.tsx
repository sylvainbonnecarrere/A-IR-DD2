import React, { useEffect, useState } from 'react';
import { useDesignStore } from '@/stores/useDesignStore';
import { useLocalization } from '@/hooks/useLocalization';

/**
 * Workflow Interface for type safety
 */
interface Workflow {
  _id: string;
  userId: string;
  name: string;
  description?: string;
  isActive: boolean;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface WorkflowCardProps {
  workflow: Workflow;
  isActive: boolean;
  isDeleting?: boolean;
  isEditing?: boolean;
  isLastWorkflow?: boolean; // ⭐ Can't delete if last remaining
  canDelete?: boolean;      // ⭐ Disable if active or last
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

const WorkflowCard: React.FC<WorkflowCardProps> = ({
  workflow,
  isActive,
  isDeleting,
  isEditing,
  isLastWorkflow = false,
  canDelete = true,
  onSelect,
  onEdit,
  onDelete
}) => {
  const { t } = useLocalization();
  const { getWorkflowStats } = useDesignStore();
  
  const [stats, setStats] = useState({ agentInstanceCount: 0, nodeCount: 0 });
  const [loadingStats, setLoadingStats] = useState(true);
  
  useEffect(() => {
    const fetchStats = async () => {
      try {
        setLoadingStats(true);
        const result = await getWorkflowStats(workflow._id);
        if (result) {
          setStats(result);
        }
      } catch (err) {
        console.error('Failed to load stats:', err);
      } finally {
        setLoadingStats(false);
      }
    };
    
    fetchStats();
  }, [workflow._id, getWorkflowStats]);
  
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
        {!isEditing && (
          <button
            onClick={onEdit}
            className="text-gray-500 hover:text-yellow-400 transition-colors flex-shrink-0 opacity-60 hover:opacity-100"
            title={t('workflow_card_edit_tooltip')}
            aria-label={t('workflow_card_edit_tooltip')}
          >
            ✎
          </button>
        )}
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
          <span>{t('workflow_card_agents')}: {loadingStats ? '...' : stats.agentInstanceCount}</span>
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
        
        {/* Edit Button */}
        <button
          onClick={onEdit}
          disabled={isDeleting || isEditing}
          className="px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 transition-colors"
          title={t('workflow_card_edit_tooltip')}
        >
          ✏️
        </button>
        
        {/* Delete Button - RÈGLE MÉTIER: Can't delete last or active */}
        {!workflow.isDefault && (
          <button
            onClick={onDelete}
            disabled={isDeleting || !canDelete || isLastWorkflow}
            className={`px-3 py-2 rounded text-white transition-all ${
              !canDelete || isLastWorkflow
                ? 'bg-red-900 opacity-50 cursor-not-allowed'
                : 'bg-red-600 hover:bg-red-700'
            }`}
            title={
              isLastWorkflow
                ? t('error_cannot_delete_last_workflow')
                : isActive
                  ? t('error_cannot_delete_active_workflow')
                  : t('workflow_card_delete')
            }
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
