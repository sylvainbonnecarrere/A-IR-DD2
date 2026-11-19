import React from 'react';

import { ShieldAlertIcon } from '../Icons';

import { useLocalization } from '../../hooks/useLocalization';

import { useInstanceRunStatus } from '../../hooks/useWorkflowRuntimeState';

import { FUNCTION_RUN_ACTIVE_STATUSES, FUNCTION_RUN_QUARANTINE_STATUSES, type FunctionRunStatus } from '../../types/function.types';

interface RunStatusBadgeProps {
  /** agentInstanceId du nœud (data.agentInstance.id). */
  instanceId?: string | null;
  /** Représentation compacte (nœud minimisé) : pastille seule, sans libellé. */
  compact?: boolean;
  className?: string;
  /** Clic sur le badge : quarantaine -> Reset & Relance, sinon détail du run. */
  onOpenRunDetail?: (runId: string) => void;
  onOpenResetAndRelaunch?: (runId: string) => void;
}

const STATUS_COLOR_CLASSES: Record<string, string> = {
  queued: 'bg-blue-400',
  running: 'bg-blue-400 animate-pulse',
  completed: 'bg-green-500',
  failed: 'bg-red-500',
  stopped: 'bg-gray-400',
  timed_out: 'bg-gray-400',
  worker_lost: 'bg-orange-500 animate-pulse',
  quarantined: 'bg-orange-500 animate-pulse',
};

/**
 * ⭐ US-J7-13 — Pastille de statut du run d'un nœud agent.
 * Fidèle dans les 3 représentations du bloc (minimisée / normale / agrandie) :
 * mêmes couleurs/états partout, rendue dans le shell (toujours visible même
 * minimisé). Sans run connu (`empty`), aucun badge n'est rendu.
 */
export const RunStatusBadge: React.FC<RunStatusBadgeProps> = ({
  instanceId,
  compact = false,
  className = '',
  onOpenRunDetail,
  onOpenResetAndRelaunch,
}) => {
  const { t } = useLocalization();
  const runStatus = useInstanceRunStatus(instanceId);

  if (!runStatus) {
    return null;
  }

  const { runId, status, lockHeld } = runStatus;
  const isQuarantine = lockHeld || FUNCTION_RUN_QUARANTINE_STATUSES.includes(status as FunctionRunStatus);
  const isActive = FUNCTION_RUN_ACTIVE_STATUSES.includes(status as FunctionRunStatus);
  const colorClass = STATUS_COLOR_CLASSES[status] ?? 'bg-gray-500';
  const statusLabel = t(`workflow.status.${status}`, status);
  const tooltip = `${t('workflow.badge.tooltip')}: ${statusLabel}${lockHeld ? ` — 🔒 ${t('workflow.runs.lockHeld')}` : ''}`;

  const handleClick = () => {
    if (isQuarantine && onOpenResetAndRelaunch) {
      onOpenResetAndRelaunch(runId);
      return;
    }
    onOpenRunDetail?.(runId);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      title={tooltip}
      aria-label={tooltip}
      data-testid="node-run-status-badge"
      data-run-id={runId}
      data-status={status}
      className={`flex items-center gap-1.5 rounded-full px-1.5 py-0.5 bg-gray-900/80 border border-gray-700 hover:border-cyan-400/60 transition-colors ${className}`}
    >
      <span aria-hidden="true" className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${colorClass}`} />
      {isQuarantine ? <ShieldAlertIcon className="w-3 h-3 text-orange-400 flex-shrink-0" /> : null}
      {!compact ? (
        <span className={`text-[10px] leading-none font-medium ${isActive ? 'text-blue-300' : isQuarantine ? 'text-orange-300' : 'text-gray-300'}`}>
          {statusLabel}
        </span>
      ) : null}
    </button>
  );
};
