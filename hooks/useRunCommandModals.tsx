import React, { useCallback, useMemo, useState } from 'react';

import WorkflowRunService, { newIdempotencyKey, RunCommandError } from '../services/workflowRunService';

import { useLocalization } from './useLocalization';

import { useNotificationsOptional } from '../contexts/NotificationContext';

import { useRuntimeStore } from '../stores/useRuntimeStore';

import { ConfirmCancelRunModal, ResetAndRelaunchModal, RunDetailModal, RunHistoryModal } from '../components/modals/RunCommandModals';

import type { FunctionRunRecord, RunCommandErrorCode } from '../types/function.types';

export interface RunCommandModalsApi {
  /** Ouvre la modale de confirmation avant annulation. */
  requestCancel: (runId: string) => void;
  /** Ouvre la modale Reset & Relance (run en quarantaine / verrou tenu). */
  requestResetAndRelaunch: (runId: string) => void;
  /** Relance = nouveau run via `retry` (run terminal non-quarantaine). */
  relaunch: (runId: string) => Promise<void>;
  openRunDetail: (runId: string) => void;
  openRunHistory: () => void;
  closeRunHistory: () => void;
  isHistoryOpen: boolean;
  /** Erreur de commande à afficher (état serveur conservé, jamais masqué). */
  actionErrorCode: RunCommandErrorCode | string | null;
  clearActionError: () => void;
  /** Message de succès (toast léger dans la zone statut). */
  successMessageKey: string | null;
  isSubmitting: boolean;
  modals: React.ReactNode;
}

/**
 * ⭐ US-J7-13 — Commandes de run V2 (Lancer/Annuler/Relancer/Reset & Relance) :
 * modales accessibles + appels au contrat serveur + rafraîchissement de l'état.
 * Aucune erreur serveur n'est masquée : le code contrat est exposé et l'état
 * affiché reste celui du serveur (REST autoritaire via `onRefresh`).
 */
const EMPTY_RUNS: FunctionRunRecord[] = [];

export const useRunCommandModals = (
  workflowId: string | null | undefined,
  onRefresh: () => void,
): RunCommandModalsApi => {
  const { t } = useLocalization();
  // ⭐ Retour graphique 2026-11-19 : résultats de commandes en toast flottant haut-droite
  // (style page Connexions API : vert succès / rouge erreur), jamais de bandeau inline qui déplacerait la carte.
  const notifications = useNotificationsOptional();

  const runs = useRuntimeStore((state) => (workflowId ? state.workflowRuns[workflowId] ?? EMPTY_RUNS : EMPTY_RUNS));
  const runLockHeld = useRuntimeStore((state) => state.runLockHeld);

  const [cancelTargetId, setCancelTargetId] = useState<string | null>(null);
  const [resetTargetId, setResetTargetId] = useState<string | null>(null);
  const [detailRunId, setDetailRunId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionErrorCode, setActionErrorCode] = useState<RunCommandErrorCode | string | null>(null);
  const [resetErrorCode, setResetErrorCode] = useState<RunCommandErrorCode | string | null>(null);
  const [successMessageKey, setSuccessMessageKey] = useState<string | null>(null);

  const toastSuccess = useCallback((messageKey: string) => {
    setSuccessMessageKey(messageKey);
    notifications?.addNotification({ type: 'success', title: t('workflow.notifications.commandSent'), message: t(messageKey), duration: 4000 });
  }, [notifications, t]);

  const toastError = useCallback((code: string) => {
    notifications?.addNotification({ type: 'error', title: t('workflow.actionError'), message: code, duration: 6000 });
  }, [notifications, t]);

  const requestCancel = useCallback((runId: string) => {
    setActionErrorCode(null);
    setSuccessMessageKey(null);
    setCancelTargetId(runId);
  }, []);

  const requestResetAndRelaunch = useCallback((runId: string) => {
    setActionErrorCode(null);
    setSuccessMessageKey(null);
    setResetErrorCode(null);
    setResetTargetId(runId);
  }, []);

  const confirmCancel = useCallback(async () => {
    if (!cancelTargetId) return;
    setIsSubmitting(true);
    try {
      await WorkflowRunService.cancelRun(cancelTargetId);
      toastSuccess('workflow.cancelRun.success');
      setCancelTargetId(null);
      onRefresh();
    } catch (error) {
      const commandError = error instanceof RunCommandError ? error : null;
      // 409 RUN_NOT_CANCELLABLE etc. : l'état serveur reste affiché tel quel + toast d'erreur.
      const code = commandError?.code ?? 'RUN_COMMAND_FAILED';
      setActionErrorCode(code);
      toastError(code);
      setCancelTargetId(null);
      onRefresh();
    } finally {
      setIsSubmitting(false);
    }
  }, [cancelTargetId, onRefresh, toastSuccess, toastError]);

  const confirmResetAndRelaunch = useCallback(async () => {
    if (!workflowId || !resetTargetId) return;
    setIsSubmitting(true);
    setResetErrorCode(null);
    try {
      // 202 = nouveau run créé ; 200 = rejeu idempotent (même effet visuel).
      await WorkflowRunService.fenceAndRetry(workflowId, resetTargetId, newIdempotencyKey());
      toastSuccess('workflow.resetAndRelaunch.success');
      setResetTargetId(null);
      onRefresh();
    } catch (error) {
      const commandError = error instanceof RunCommandError ? error : null;
      // 409 / 504 : message localisé dans la modale, état serveur conservé.
      setResetErrorCode(commandError?.code ?? 'FENCE_AND_RETRY_FAILED');
      if (commandError?.code === 'FENCING_TIMEOUT_ESCALATED') {
        setActionErrorCode('FENCING_TIMEOUT_ESCALATED'); // alerte critique persistée côté serveur
        toastError('FENCING_TIMEOUT_ESCALATED');
      }
      onRefresh();
    } finally {
      setIsSubmitting(false);
    }
  }, [workflowId, resetTargetId, onRefresh, toastSuccess, toastError]);

  const relaunch = useCallback(async (runId: string) => {
    if (!runId) return;
    setIsSubmitting(true);
    setActionErrorCode(null);
    setSuccessMessageKey(null);
    try {
      await WorkflowRunService.retryRun(runId, newIdempotencyKey());
      toastSuccess('workflow.relaunchSuccess');
      onRefresh();
    } catch (error) {
      const commandError = error instanceof RunCommandError ? error : null;
      const code = commandError?.code ?? 'RUN_COMMAND_FAILED';
      setActionErrorCode(code);
      toastError(code);
      onRefresh();
    } finally {
      setIsSubmitting(false);
    }
  }, [onRefresh, toastSuccess, toastError]);

  const openRunDetail = useCallback((runId: string) => setDetailRunId(runId), []);
  const openRunHistory = useCallback(() => setHistoryOpen(true), []);
  const closeRunHistory = useCallback(() => setHistoryOpen(false), []);
  const clearActionError = useCallback(() => setActionErrorCode(null), []);

  const detailRun: FunctionRunRecord | null = useMemo(
    () => (detailRunId ? runs.find((run) => run.executionId === detailRunId) ?? null : null),
    [detailRunId, runs],
  );

  const modals = (
    <>
      <ConfirmCancelRunModal
        isOpen={cancelTargetId !== null}
        runId={cancelTargetId}
        isSubmitting={isSubmitting}
        onConfirm={confirmCancel}
        onCancel={() => setCancelTargetId(null)}
      />
      <ResetAndRelaunchModal
        isOpen={resetTargetId !== null}
        runId={resetTargetId}
        lockHeld={resetTargetId ? runLockHeld[resetTargetId] === true : false}
        isSubmitting={isSubmitting}
        errorCode={resetErrorCode}
        onConfirm={confirmResetAndRelaunch}
        onCancel={() => { setResetTargetId(null); setResetErrorCode(null); }}
      />
      <RunDetailModal
        isOpen={detailRunId !== null}
        run={detailRun}
        onClose={() => setDetailRunId(null)}
      />
      <RunHistoryModal
        isOpen={historyOpen}
        workflowId={workflowId ?? null}
        runs={runs}
        onClose={closeRunHistory}
        onSelectRun={(runId) => { setHistoryOpen(false); setDetailRunId(runId); }}
      />
    </>
  );

  return {
    requestCancel,
    requestResetAndRelaunch,
    relaunch,
    openRunDetail,
    openRunHistory,
    closeRunHistory,
    isHistoryOpen: historyOpen,
    actionErrorCode,
    clearActionError,
    successMessageKey,
    isSubmitting,
    modals,
  };
};
