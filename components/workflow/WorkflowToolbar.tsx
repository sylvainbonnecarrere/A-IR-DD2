import React, { useCallback, useEffect, useMemo, useState } from 'react';

import {
  PlayIcon,
  StopIcon,
  DownloadIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  CogIcon,
  ShieldAlertIcon,
  RefreshCwIcon,
  HistoryIcon,
} from '../Icons';

import { useWorkflowStore } from '../../stores/useWorkflowStore';

import { useDesignStore } from '../../stores/useDesignStore';

import { useLocalization } from '../../hooks/useLocalization';

import { useNotificationsOptional } from '../../contexts/NotificationContext';

import WorkflowRunService from '../../services/workflowRunService';

import { resolveRuntimeActionPolicy } from '../../services/runtimeActionPolicy';

import { useWorkflowRunStatus, useWorkflowRunSync } from '../../hooks/useWorkflowRuntimeState';

import { useRunCommandModals } from '../../hooks/useRunCommandModals';

import type { FunctionRunStatus } from '../../types/function.types';

interface WorkflowToolbarProps {
  className?: string;
}

// ⭐ Retour graphique 2026-11-19 : la connexion n'est plus une ligne/bandeau sous le header
// mais une diode (LED) placée DEVANT « workflow actuel », avec bulle explicative au survol.
// La diode reflète le canal temps réel (WebSocket), pas l'état du serveur API.
const CONNECTION_LED_CLASSES: Record<string, string> = {
  connected: 'bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.8)]',
  reconnecting: 'bg-yellow-400 animate-pulse',
  degraded: 'bg-yellow-400 animate-pulse',
  offline: 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.8)]',
};

const STATUS_ICON: Partial<Record<string, React.ReactNode>> = {
  completed: <CheckCircleIcon className="w-4 h-4" />,
  failed: <ExclamationTriangleIcon className="w-4 h-4" />,
  worker_lost: <ShieldAlertIcon className="w-4 h-4" />,
  quarantined: <ShieldAlertIcon className="w-4 h-4" />,
};

/**
 * ⭐ US-J7-13 — Barre de commandes V2 de la carte workflow.
 * - montée uniquement sur les pages carte (bosDashboard / bosSupervision), en flux layout ;
 * - graphe lu dans `useDesignStore` (source unique), état run dans `useRuntimeStore`
 *   (REST autoritaire + événements temps réel filtrés par workflowId) ;
 * - commandes : Lancer / Annuler (confirmation) / Relancer (nouveau run via retry) /
 *   Reset & Relance (fence-and-retry, quarantaine) — jamais de Pause/Reprendre ;
 * - diode de connexion (vert/rouge/ambre) + bulle au survol, placée avant le nom du workflow ;
 * - résultats de commandes en toast flottant haut-droite (style page Connexions API), jamais de bandeau inline ;
 * - commandes désactivées hors ligne/partiel.
 */
export const WorkflowToolbar: React.FC<WorkflowToolbarProps> = ({ className = '' }) => {
  const { t } = useLocalization();
  const {
    currentWorkflow,
    execution,
    executeWorkflow,
    toggleConfigPanel,
    isConfigPanelOpen,
  } = useWorkflowStore();
  const nodes = useDesignStore((state) => state.nodes);
  const edges = useDesignStore((state) => state.edges);
  const currentWorkflowId = useDesignStore((state) => state.currentWorkflowId);
  const workflows = useDesignStore((state) => state.workflows);

  const workflowId = currentWorkflowId ?? currentWorkflow?.id ?? null;
  const workflowName = useMemo(() => {
    if (workflowId) {
      const match = workflows.find((workflow) => workflow._id === workflowId);
      if (match?.name) return match.name;
    }
    return currentWorkflow?.name ?? null;
  }, [currentWorkflow?.name, workflowId, workflows]);

  const { refresh } = useWorkflowRunSync(workflowId);
  const { runId: latestRunId, status: runtimeStatus, lockHeld, syncState, connectionState } = useWorkflowRunStatus(workflowId);
  const commandModals = useRunCommandModals(workflowId, refresh);

  // ⭐ Retour graphique 2026-11-19 : les avertissements de validation passent en toast éphémère
  // haut-droite (warning), plus de panneau inline qui prend de la place sous le header.
  const notifications = useNotificationsOptional();
  const [isLaunching, setIsLaunching] = useState(false);

  // Le statut REST/temps réel est autoritaire ; `execution` (store workflow) sert de repli local.
  // ('paused' legacy est ramené à 'stopped' : aucune sémantique de pause côté contrat V2.)
  const executionStatus = execution?.status === 'paused' ? 'stopped' as const : execution?.status as FunctionRunStatus | undefined;
  const effectiveRunStatus: FunctionRunStatus | null = (runtimeStatus as FunctionRunStatus | null) ?? executionStatus ?? null;

  const isOffline = connectionState === 'offline';
  const isPartial = connectionState === 'degraded' || connectionState === 'reconnecting';
  const isLoading = syncState === 'loading';
  const isError = syncState === 'error';

  const runtimeActionPolicy = resolveRuntimeActionPolicy({
    status: effectiveRunStatus,
    hasWorkflow: Boolean(workflowId),
    hasNodes: nodes.length > 0,
    isLoading,
    isOffline,
    isPartial,
    isError,
    lockHeld,
  });

  // Validate workflow before execution
  const validateWorkflow = useCallback((): string[] => {
    const warnings: string[] = [];

    if (!workflowId) {
      warnings.push(t('workflow.validation.noWorkflow'));
      return warnings;
    }

    if (nodes.length === 0) {
      warnings.push(t('workflow.validation.noNodes'));
    }

    const connectedNodes = new Set<string>();
    edges.forEach((edge) => {
      connectedNodes.add(edge.source);
      connectedNodes.add(edge.target);
    });

    const disconnectedNodes = nodes.filter((node) => !connectedNodes.has(node.id) && nodes.length > 1);
    if (disconnectedNodes.length > 0) {
      warnings.push(t('workflow.validation.disconnectedNodes', { count: disconnectedNodes.length }));
    }

    const hasStartNode = nodes.some((node) => !edges.some((edge) => edge.target === node.id));
    if (!hasStartNode && nodes.length > 0) {
      warnings.push(t('workflow.validation.noStartNode'));
    }

    return warnings;
  }, [edges, nodes, t, workflowId]);

  const handleExecute = useCallback(async () => {
    const warnings = validateWorkflow();
    if (warnings.length > 0) {
      // toast éphémère haut-droite (même style que la page Connexions API), la carte n'est pas déplacée
      notifications?.addNotification({
        type: 'warning',
        title: t('workflow.validation.warnings'),
        message: warnings.join('\n'),
        duration: 8000,
      });
      return;
    }

    setIsLaunching(true);
    try {
      if (currentWorkflow) {
        await executeWorkflow();
      } else if (workflowId) {
        await WorkflowRunService.launchRun({ workflowId });
      }
      refresh();
    } catch (error) {
      console.warn('[WorkflowToolbar] Unable to launch workflow run:', error);
      refresh();
    } finally {
      setIsLaunching(false);
    }
  }, [currentWorkflow, executeWorkflow, refresh, validateWorkflow, workflowId, notifications, t]);

  const exportWorkflow = () => {
    if (!workflowId || !workflowName) return;

    const dataStr = JSON.stringify({ id: workflowId, name: workflowName, nodes, edges }, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);

    const link = document.createElement('a');
    link.href = url;
    link.download = `${workflowName.replace(/[^a-z0-9]/gi, '_')}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const statusLabel = effectiveRunStatus
    ? t(`workflow.status.${effectiveRunStatus}`, String(effectiveRunStatus))
    : (syncState === 'loading' ? t('workflow.states.loading') : t('workflow.states.empty'));

  const statusToneClass = effectiveRunStatus === 'running' || effectiveRunStatus === 'queued'
    ? 'text-blue-400'
    : effectiveRunStatus === 'completed'
      ? 'text-green-400'
      : effectiveRunStatus === 'failed'
        ? 'text-red-400'
        : effectiveRunStatus === 'worker_lost' || effectiveRunStatus === 'quarantined' || lockHeld
          ? 'text-orange-400'
          : 'text-gray-400';

  const ledClass = CONNECTION_LED_CLASSES[connectionState] ?? CONNECTION_LED_CLASSES.offline;
  const connectionLabel = t(`workflow.connection.${connectionState}`, connectionState);
  const connectionLedLabel = `${t('workflow.connectionLed.label')}: ${connectionLabel}`;

  const activeRunId = latestRunId;

  return (
    <div
      className={`bg-gray-900 border-b border-gray-700 ${className}`}
      data-testid="workflow-toolbar"
      data-workflow-id={workflowId ?? undefined}
    >
      <div className="flex items-center justify-between h-12 px-4 gap-4">
        {/* Left Section - Workflow Info + statut run (role="status") */}
        <div className="flex items-center gap-4 min-w-0">
          {/* Diode de connexion temps réel + bulle explicative au survol (pas le serveur API) */}
          <span
            className="relative inline-flex items-center group flex-shrink-0"
            role="status"
            aria-live="polite"
            aria-label={connectionLedLabel}
            data-testid="workflow-connection-led"
            data-connection={connectionState}
          >
            <span aria-hidden="true" className={`w-2.5 h-2.5 rounded-full ${ledClass}`} />
            <span
              className="pointer-events-none absolute left-0 top-full mt-1.5 z-50 hidden w-72 rounded-md border border-gray-700 bg-gray-900/95 px-3 py-2 text-xs leading-snug text-gray-200 shadow-lg group-hover:block group-focus-within:block"
              data-testid="workflow-connection-bubble"
            >
              <span className="font-semibold text-gray-100">{t('workflow.connectionLed.title')}</span>{' '}{connectionLabel}. {t('workflow.connectionLed.hint')}
            </span>
          </span>
          <div className="text-sm truncate">
            <span className="text-gray-500">{t('workflow.current')}:</span>
            <span className="ml-2 font-medium text-yellow-400 truncate" title={workflowName ?? undefined} data-testid="workflow-current-name">{workflowName || t('workflow.noWorkflow')}</span>
          </div>
          <div
            className="flex items-center gap-2 min-w-0"
            role="status"
            aria-live="polite"
            data-testid="workflow-run-status"
            data-status={effectiveRunStatus ?? 'empty'}
          >
            {effectiveRunStatus ? (
              <>
                <span aria-hidden="true" className={statusToneClass}>
                  {STATUS_ICON[effectiveRunStatus] ?? <span className="w-2 h-2 rounded-full bg-current inline-block animate-pulse" />}
                </span>
                <span className={`text-sm truncate ${statusToneClass}`}>{statusLabel}</span>
                {lockHeld ? <span className="text-xs text-orange-300 font-medium">🔒 {t('workflow.runs.lockHeld')}</span> : null}
              </>
            ) : (
              <span className="text-sm text-gray-500">{statusLabel}</span>
            )}
          </div>
          {/* Succès/erreur de commande : toasts flottants (voir useRunCommandModals), aucun bandeau inline qui déplacerait la carte. */}
        </div>

        {/* Center Section - Commandes V2 */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleExecute}
            disabled={!runtimeActionPolicy.canLaunch || isLaunching}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors duration-200 ${
              runtimeActionPolicy.canLaunch && !isLaunching
                ? 'bg-green-600 hover:bg-green-700 text-white'
                : 'bg-gray-700 text-gray-500 cursor-not-allowed'
            }`}
            title={t('workflow.execute')}
          >
            <PlayIcon className="w-4 h-4" />
            {t('workflow.execute')}
          </button>

          {runtimeActionPolicy.canCancel && activeRunId ? (
            <button
              type="button"
              onClick={() => commandModals.requestCancel(activeRunId)}
              disabled={commandModals.isSubmitting}
              className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium bg-red-600 hover:bg-red-700 text-white transition-colors duration-200 disabled:cursor-not-allowed disabled:bg-gray-600"
              title={t('workflow.cancel')}
            >
              <StopIcon className="w-4 h-4" />
              {t('workflow.cancel')}
            </button>
          ) : null}

          {runtimeActionPolicy.canRelaunch && activeRunId ? (
            <button
              type="button"
              onClick={() => void commandModals.relaunch(activeRunId)}
              disabled={commandModals.isSubmitting}
              className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium bg-indigo-600 hover:bg-indigo-700 text-white transition-colors duration-200 disabled:cursor-not-allowed disabled:bg-gray-600"
              title={t('workflow.relaunch')}
            >
              <RefreshCwIcon className="w-4 h-4" />
              {t('workflow.relaunch')}
            </button>
          ) : null}

          {runtimeActionPolicy.canResetAndRelaunch && activeRunId ? (
            <button
              type="button"
              onClick={() => commandModals.requestResetAndRelaunch(activeRunId)}
              disabled={commandModals.isSubmitting}
              className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium bg-orange-600 hover:bg-orange-700 text-white transition-colors duration-200 disabled:cursor-not-allowed disabled:bg-gray-600"
              title={t('workflow.resetAndRelaunch.title')}
              data-testid="reset-and-relaunch-button"
            >
              <ShieldAlertIcon className="w-4 h-4" />
              {t('workflow.resetAndRelaunch.title')}
            </button>
          ) : null}
        </div>

        {/* Right Section - Historique + opérations fichier */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={commandModals.openRunHistory}
            disabled={!workflowId}
            className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-gray-300 hover:bg-gray-800 transition-colors duration-200 disabled:cursor-not-allowed disabled:text-gray-600"
            title={t('workflow.runs.open')}
            aria-label={t('workflow.runs.open')}
          >
            <HistoryIcon className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={exportWorkflow}
            disabled={!workflowId}
            className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-gray-300 hover:bg-gray-800 transition-colors duration-200 disabled:cursor-not-allowed disabled:text-gray-600"
            title={t('workflow.export')}
          >
            <DownloadIcon className="w-4 h-4" />
          </button>
          <div className="w-px h-6 bg-gray-700 mx-2"></div>
          <button
            type="button"
            onClick={toggleConfigPanel}
            className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors duration-200 ${
              isConfigPanelOpen ? 'bg-gray-700 text-gray-100' : 'text-gray-300 hover:bg-gray-800'
            }`}
            title={t('workflow.config')}
          >
            <CogIcon className="w-4 h-4" />
          </button>
        </div>
      </div>

      {commandModals.modals}
    </div>
  );
};

export default WorkflowToolbar;
