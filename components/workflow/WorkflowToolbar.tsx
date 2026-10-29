import React, { useEffect, useState } from 'react';
import { PlayIcon, PauseIcon, StopIcon, DownloadIcon,
         CheckCircleIcon, ExclamationTriangleIcon, CogIcon } from '../Icons';
import { useWorkflowStore } from '../../stores/useWorkflowStore';
import { useDesignStore } from '../../stores/useDesignStore';
import { useLocalization } from '../../hooks/useLocalization';
import WorkflowRunService from '../../services/workflowRunService';
import { resolveRuntimeActionPolicy } from '../../services/runtimeActionPolicy';
import type { FunctionRunRecord } from '../../types/function.types';

interface WorkflowToolbarProps {
  className?: string;
}

export const WorkflowToolbar: React.FC<WorkflowToolbarProps> = ({ className = '' }) => {
  const { t } = useLocalization();
  const {
    currentWorkflow,
    execution,
    executeWorkflow,
    pauseExecution,
    stopExecution,
    toggleConfigPanel,
    isConfigPanelOpen
  } = useWorkflowStore();
  const nodes = useDesignStore((state) => state.nodes);
  const edges = useDesignStore((state) => state.edges);

  const [serverRunStatus, setServerRunStatus] = useState<FunctionRunRecord['status'] | null>(null);
  const [validationWarnings, setValidationWarnings] = useState<string[]>([]);
  const [showValidation, setShowValidation] = useState(false);

  useEffect(() => {
    let isCancelled = false;

    const syncStatus = async () => {
      if (!currentWorkflow?.id) {
        setServerRunStatus(null);
        return;
      }

      try {
        const response = await WorkflowRunService.listWorkflowRuns(currentWorkflow.id, {
          limit: 1,
          sortBy: 'createdAt',
          sortOrder: 'desc',
        });

        if (!isCancelled) {
          setServerRunStatus(response.items[0]?.status ?? null);
        }
      } catch (error) {
        if (!isCancelled) {
          setServerRunStatus(null);
        }
        console.warn('[WorkflowToolbar] Unable to fetch workflow run status:', error);
      }
    };

    syncStatus();
    return () => {
      isCancelled = true;
    };
  }, [currentWorkflow?.id]);
  
  // Validate workflow before execution
  const validateWorkflow = (): string[] => {
    const warnings: string[] = [];
    
    if (!currentWorkflow) {
      warnings.push(t('workflow.validation.noWorkflow'));
      return warnings;
    }
    
    if (nodes.length === 0) {
      warnings.push(t('workflow.validation.noNodes'));
    }
    
    // Check for disconnected nodes
    const connectedNodes = new Set<string>();
    edges.forEach(edge => {
      connectedNodes.add(edge.source);
      connectedNodes.add(edge.target);
    });
    
    const disconnectedNodes = nodes.filter(node => 
      !connectedNodes.has(node.id) && nodes.length > 1
    );
    
    if (disconnectedNodes.length > 0) {
      warnings.push(t('workflow.validation.disconnectedNodes').replace('{count}', disconnectedNodes.length.toString()));
    }
    
    // Check for cycles (basic check)
    const hasStartNode = nodes.some(node => 
      !edges.some(edge => edge.target === node.id)
    );
    
    if (!hasStartNode && nodes.length > 0) {
      warnings.push(t('workflow.validation.noStartNode'));
    }
    
    return warnings;
  };
  
  const effectiveRunStatus = execution?.status ?? serverRunStatus ?? null;
  const runtimeActionPolicy = resolveRuntimeActionPolicy({
    status: effectiveRunStatus,
    hasWorkflow: Boolean(currentWorkflow),
    hasNodes: nodes.length > 0,
    isLoading: false,
    isOffline: false,
    isPartial: false,
  });

  const handleExecute = async () => {
    const warnings = validateWorkflow();
    setValidationWarnings(warnings);

    if (warnings.length > 0) {
      setShowValidation(true);
      return;
    }

    await executeWorkflow();
    const refreshed = await WorkflowRunService.listWorkflowRuns(currentWorkflow!.id, {
      limit: 1,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });
    setServerRunStatus(refreshed.items[0]?.status ?? null);
  };
  
  const exportWorkflow = () => {
    if (!currentWorkflow) return;
    
    const dataStr = JSON.stringify({ ...currentWorkflow, nodes, edges }, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = `${currentWorkflow.name.replace(/[^a-z0-9]/gi, '_')}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };
  
  const getExecutionStatus = () => {
    if (!effectiveRunStatus) return null;

    switch (effectiveRunStatus) {
      case 'running':
        return (
          <div className="flex items-center gap-2 text-blue-600">
            <div className="w-2 h-2 bg-blue-600 rounded-full animate-pulse"></div>
            <span className="text-sm">{t('workflow.status.running')}</span>
          </div>
        );
      case 'completed':
        return (
          <div className="flex items-center gap-2 text-green-600">
            <CheckCircleIcon className="w-4 h-4" />
            <span className="text-sm">{t('workflow.status.completed')}</span>
          </div>
        );
      case 'failed':
        return (
          <div className="flex items-center gap-2 text-red-600">
            <ExclamationTriangleIcon className="w-4 h-4" />
            <span className="text-sm">{t('workflow.status.failed')}</span>
          </div>
        );
      case 'paused':
        return (
          <div className="flex items-center gap-2 text-yellow-600">
            <PauseIcon className="w-4 h-4" />
            <span className="text-sm">{t('workflow.status.paused')}</span>
          </div>
        );
      default:
        return null;
    }
  };
  
  const isExecuting = effectiveRunStatus === 'running';
  const canExecute = runtimeActionPolicy.canLaunch;
  const canStop = runtimeActionPolicy.canStop;
  const canResume = runtimeActionPolicy.canResume;
  
  return (
    <div className={`bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 ${className}`}>
      <div className="flex items-center justify-between h-12 px-4">
        {/* Left Section - Workflow Info */}
        <div className="flex items-center gap-4">
          <div className="text-sm">
            <span className="text-gray-500 dark:text-gray-400">
              {t('workflow.current')}:
            </span>
            <span className="ml-2 font-medium text-gray-900 dark:text-gray-100">
              {currentWorkflow?.name || t('workflow.noWorkflow')}
            </span>
          </div>
          
          {getExecutionStatus()}
        </div>
        
        {/* Center Section - Execution Controls */}
        <div className="flex items-center gap-2">
          {canResume ? (
            <button
              onClick={handleExecute}
              disabled={!canResume}
              className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium bg-green-600 hover:bg-green-700 text-white transition-colors duration-200"
              title={t('workflow.resume') || 'Reprendre'}
            >
              <PlayIcon className="w-4 h-4" />
              {t('workflow.resume') || 'Reprendre'}
            </button>
          ) : (
            <button
              onClick={handleExecute}
              disabled={!canExecute}
              className={`
                flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium
                transition-colors duration-200
                ${canExecute
                  ? 'bg-green-600 hover:bg-green-700 text-white'
                  : 'bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-gray-400 cursor-not-allowed'
                }
              `}
              title={t('workflow.execute')}
            >
              <PlayIcon className="w-4 h-4" />
              {t('workflow.execute')}
            </button>
          )}

          {(canStop || isExecuting) && (
            <>
              <button
                onClick={pauseExecution}
                disabled={!canStop && !isExecuting}
                className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium
                         bg-yellow-600 hover:bg-yellow-700 text-white transition-colors duration-200 disabled:cursor-not-allowed disabled:bg-gray-500"
                title={t('workflow.pause')}
              >
                <PauseIcon className="w-4 h-4" />
                {t('workflow.pause')}
              </button>

              <button
                onClick={stopExecution}
                disabled={!canStop && !isExecuting}
                className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium
                         bg-red-600 hover:bg-red-700 text-white transition-colors duration-200 disabled:cursor-not-allowed disabled:bg-gray-500"
                title={t('workflow.stop')}
              >
                <StopIcon className="w-4 h-4" />
                {t('workflow.stop')}
              </button>
            </>
          )}
        </div>
        
        {/* Right Section - File Operations */}
        <div className="flex items-center gap-2">
          <button
            onClick={exportWorkflow}
            disabled={!currentWorkflow}
            className={`
              flex items-center gap-2 px-2 py-1.5 rounded-md text-sm
              transition-colors duration-200
              ${currentWorkflow
                ? 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                : 'text-gray-400 dark:text-gray-600 cursor-not-allowed'
              }
            `}
            title={t('workflow.export')}
          >
            <DownloadIcon className="w-4 h-4" />
          </button>
          
          <div className="w-px h-6 bg-gray-300 dark:bg-gray-600 mx-2"></div>
          
          <button
            onClick={toggleConfigPanel}
            className={`
              flex items-center gap-2 px-2 py-1.5 rounded-md text-sm
              transition-colors duration-200
              ${isConfigPanelOpen
                ? 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100'
                : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
              }
            `}
            title={t('workflow.config')}
          >
            <CogIcon className="w-4 h-4" />
          </button>
        </div>
      </div>
      
      {/* Validation Warnings */}
      {showValidation && validationWarnings.length > 0 && (
        <div className="border-t border-gray-200 dark:border-gray-700 bg-yellow-50 dark:bg-yellow-900/20">
          <div className="px-4 py-3">
            <div className="flex items-start gap-3">
              <ExclamationTriangleIcon className="w-5 h-5 text-yellow-600 dark:text-yellow-400 mt-0.5" />
              <div className="flex-1">
                <h4 className="text-sm font-medium text-yellow-800 dark:text-yellow-200 mb-2">
                  {t('workflow.validation.warnings')}
                </h4>
                <ul className="text-sm text-yellow-700 dark:text-yellow-300 space-y-1">
                  {validationWarnings.map((warning, index) => (
                    <li key={index} className="flex items-start gap-2">
                      <span className="w-1 h-1 bg-yellow-600 dark:bg-yellow-400 rounded-full mt-2"></span>
                      {warning}
                    </li>
                  ))}
                </ul>
              </div>
              <button
                onClick={() => setShowValidation(false)}
                className="text-yellow-600 dark:text-yellow-400 hover:text-yellow-800 dark:hover:text-yellow-200
                         transition-colors duration-200"
              >
                ×
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};