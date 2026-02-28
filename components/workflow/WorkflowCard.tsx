import React, { useEffect, useState } from 'react';
import { useDesignStore } from '@/stores/useDesignStore';
import { useLocalization } from '@/hooks/useLocalization';
import { Button, Card } from '@/components/UI';
import { EditIcon, TrashIcon } from '@/components/Icons';

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

/**
 * WorkflowCard — Aligned with ArchiPrototypingPage card UX pattern.
 * Uses <Card>, <Button variant="ghost">, <EditIcon>, <TrashIcon> from design system.
 * Edit/Delete icons positioned top-right (absolute), same as Archi prototype cards.
 */
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

  const isDeleteDisabled = isDeleting || !canDelete || isLastWorkflow;
  
  return (
    <Card
      className={`p-4 relative transition-colors ${
        isActive
          ? 'border-yellow-500 bg-yellow-900/20'
          : 'hover:border-yellow-500/50'
      }`}
    >
      {/* ⭐ Action Icons — top-right, same pattern as ArchiPrototypingPage */}
      <div className="absolute top-2 right-2 flex space-x-1">
        {!isEditing && (
          <Button
            variant="ghost"
            className="p-1 h-6 w-6 text-gray-400 hover:text-yellow-400"
            onClick={onEdit}
            title={t('workflow_card_edit_tooltip')}
            aria-label={t('workflow_card_edit_tooltip')}
          >
            <EditIcon width={14} height={14} />
          </Button>
        )}
        <Button
          variant="ghost"
          className={`p-1 h-6 w-6 ${
            isDeleteDisabled
              ? 'text-gray-600 cursor-not-allowed opacity-50'
              : 'text-gray-400 hover:text-red-400'
          }`}
          onClick={onDelete}
          disabled={isDeleteDisabled}
          title={
            isLastWorkflow
              ? t('error_cannot_delete_last_workflow')
              : isActive
                ? t('error_cannot_delete_active_workflow')
                : t('workflow_card_delete')
          }
          aria-label={t('workflow_card_delete')}
        >
          {isDeleting
            ? <span className="animate-spin text-xs">⏳</span>
            : <TrashIcon width={14} height={14} />
          }
        </Button>
      </div>

      {/* Content — right padding to avoid icon overlap, same as Archi */}
      <div className="pr-12">
        <h3 className={`font-semibold text-lg mb-1 truncate ${
          isActive ? 'text-yellow-300' : 'text-white'
        }`}>
          {workflow.name}
        </h3>
        {workflow.description && (
          <p className="text-xs text-gray-400 mb-3 truncate">
            {workflow.description}
          </p>
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
      
      {/* Select / Active Button — full width */}
      <Button
        variant={isActive ? 'secondary' : 'primary'}
        className={`w-full text-sm ${
          isActive
            ? 'bg-yellow-500 text-black cursor-default hover:bg-yellow-500'
            : 'bg-yellow-500 text-black hover:bg-yellow-400'
        }`}
        onClick={onSelect}
        disabled={isActive}
      >
        {isActive ? t('workflow_card_active') : t('workflow_card_select')}
      </Button>
      
      {/* Default Badge */}
      {workflow.isDefault && (
        <div className="mt-3 pt-3 border-t border-yellow-400/30 text-center">
          <span className="text-xs text-yellow-400 font-semibold">
            ⭐ {t('workflow_card_default')}
          </span>
        </div>
      )}
    </Card>
  );
};

export default WorkflowCard;
