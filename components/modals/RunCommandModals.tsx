import React, { useRef } from 'react';

import { AccessibleModal, ModalCloseButton } from './AccessibleModal';

import { Button } from '../UI';

import { ExclamationTriangleIcon, ShieldAlertIcon } from '../Icons';

import { useLocalization } from '../../hooks/useLocalization';

import type { FunctionRunRecord, RunCommandErrorCode } from '../../types/function.types';

// ---------------------------------------------------------------- Confirm Annuler

interface ConfirmCancelRunModalProps {
  isOpen: boolean;
  runId: string | null;
  isSubmitting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmCancelRunModal: React.FC<ConfirmCancelRunModalProps> = ({ isOpen, runId, isSubmitting, onConfirm, onCancel }) => {
  const { t } = useLocalization();
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const titleId = 'confirm-cancel-run-title';

  return (
    <AccessibleModal isOpen={isOpen} onClose={onCancel} role="alertdialog" labelledBy={titleId} initialFocusRef={cancelRef}>
      <div className="flex items-start gap-3 mb-4">
        <div className="flex-shrink-0 w-10 h-10 bg-red-900/40 rounded-full flex items-center justify-center">
          <ExclamationTriangleIcon className="w-6 h-6 text-red-400" />
        </div>
        <div className="flex-1">
          <h3 id={titleId} className="text-lg font-medium text-gray-100 mb-2">
            {t('workflow.cancelRun.title')}
          </h3>
          <p className="text-sm text-gray-300">{t('workflow.cancelRun.body')}</p>
          {runId ? <p className="text-xs text-gray-500 mt-2 font-mono break-all">{runId}</p> : null}
        </div>
        <ModalCloseButton onClick={onCancel} label={t('workflow.cancelRun.cancel')} />
      </div>
      <div className="flex justify-end gap-3 mt-6">
        <Button ref={cancelRef} variant="secondary" onClick={onCancel} disabled={isSubmitting} className="px-4 py-2">
          {t('workflow.cancelRun.cancel')}
        </Button>
        <Button variant="danger" onClick={onConfirm} disabled={isSubmitting} className="px-4 py-2" data-testid="confirm-cancel-run">
          {t('workflow.cancelRun.confirm')}
        </Button>
      </div>
    </AccessibleModal>
  );
};

// ---------------------------------------------------------------- Reset & Relance

interface ResetAndRelaunchModalProps {
  isOpen: boolean;
  runId: string | null;
  lockHeld: boolean;
  isSubmitting: boolean;
  errorCode?: RunCommandErrorCode | string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ResetAndRelaunchModal: React.FC<ResetAndRelaunchModalProps> = ({
  isOpen,
  runId,
  lockHeld,
  isSubmitting,
  errorCode,
  onConfirm,
  onCancel,
}) => {
  const { t } = useLocalization();
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const titleId = 'reset-and-relaunch-title';
  const errorKey =
    errorCode && errorCode !== 'default' ? `workflow.resetAndRelaunch.errors.${errorCode}` : 'workflow.resetAndRelaunch.errors.default';

  return (
    <AccessibleModal isOpen={isOpen} onClose={onCancel} role="alertdialog" labelledBy={titleId} initialFocusRef={cancelRef}>
      <div className="flex items-start gap-3 mb-4">
        <div className="flex-shrink-0 w-10 h-10 bg-orange-900/40 rounded-full flex items-center justify-center">
          <ShieldAlertIcon className="w-6 h-6 text-orange-400" />
        </div>
        <div className="flex-1">
          <h3 id={titleId} className="text-lg font-medium text-gray-100 mb-2">
            {t('workflow.resetAndRelaunch.title')}
          </h3>
          <p className="text-sm text-gray-300">{t('workflow.resetAndRelaunch.body')}</p>
          {lockHeld ? <p className="text-xs text-orange-300 mt-2 font-medium">🔒 {t('workflow.resetAndRelaunch.lockHeld')}</p> : null}
          {runId ? <p className="text-xs text-gray-500 mt-2 font-mono break-all">{runId}</p> : null}
          {errorCode ? (
            <p role="alert" className="text-xs text-red-400 mt-2 font-medium" data-testid="reset-relaunch-error">
              {t(errorKey, t('workflow.resetAndRelaunch.errors.default'))}
            </p>
          ) : null}
        </div>
        <ModalCloseButton onClick={onCancel} label={t('workflow.resetAndRelaunch.cancel')} />
      </div>
      <div className="flex justify-end gap-3 mt-6">
        <Button ref={cancelRef} variant="secondary" onClick={onCancel} disabled={isSubmitting} className="px-4 py-2">
          {t('workflow.resetAndRelaunch.cancel')}
        </Button>
        <Button variant="danger" onClick={onConfirm} disabled={isSubmitting} className="px-4 py-2" data-testid="confirm-reset-relaunch">
          {t('workflow.resetAndRelaunch.confirm')}
        </Button>
      </div>
    </AccessibleModal>
  );
};

// ---------------------------------------------------------------- Détail du run

interface RunDetailModalProps {
  isOpen: boolean;
  run: FunctionRunRecord | null;
  onClose: () => void;
}

export const RunDetailModal: React.FC<RunDetailModalProps> = ({ isOpen, run, onClose }) => {
  const { t } = useLocalization();
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const titleId = 'run-detail-title';

  const rows: Array<[string, string]> = run
    ? [
        [t('workflow.runDetail.runId'), run.executionId],
        [t('workflow.runDetail.status'), t(`workflow.status.${run.status}`, run.status)],
        [t('workflow.runDetail.createdAt'), run.createdAt ? new Date(run.createdAt).toLocaleString() : '—'],
        [t('workflow.runDetail.startedAt'), run.timing?.startedAt ? new Date(run.timing.startedAt).toLocaleString() : '—'],
        [t('workflow.runDetail.finishedAt'), run.timing?.finishedAt ? new Date(run.timing.finishedAt).toLocaleString() : '—'],
        [t('workflow.runDetail.durationMs'), run.timing?.durationMs != null ? `${run.timing.durationMs} ms` : '—'],
      ]
    : [];

  return (
    <AccessibleModal
      isOpen={isOpen}
      onClose={onClose}
      role="dialog"
      labelledBy={titleId}
      initialFocusRef={closeRef}
      maxWidthClassName="max-w-lg"
    >
      <div className="flex items-start justify-between mb-4">
        <h3 id={titleId} className="text-lg font-medium text-gray-100">
          {t('workflow.runDetail.title')}
        </h3>
        <ModalCloseButton onClick={onClose} label={t('workflow.resetAndRelaunch.cancel')} />
      </div>
      {run ? (
        <dl className="text-sm space-y-2">
          {rows.map(([label, value]) => (
            <div key={label} className="flex gap-2">
              <dt className="text-gray-400 w-32 flex-shrink-0">{label}</dt>
              <dd className="text-gray-100 font-mono text-xs break-all">{value}</dd>
            </div>
          ))}
          {run.lockHeld || run.status === 'quarantined' ? (
            <p className="text-xs text-orange-300 font-medium pt-2">🔒 {t('workflow.runs.lockHeld')}</p>
          ) : null}
          {run.error?.message ? (
            <p role="alert" className="text-xs text-red-400 pt-2">
              {t('workflow.runDetail.error')}: {run.error.message}
            </p>
          ) : null}
        </dl>
      ) : (
        <p className="text-sm text-gray-400">{t('workflow.states.empty')}</p>
      )}
      <div className="flex justify-end mt-6">
        <Button ref={closeRef} variant="secondary" onClick={onClose} className="px-4 py-2">
          {t('workflow.resetAndRelaunch.cancel')}
        </Button>
      </div>
    </AccessibleModal>
  );
};

// ---------------------------------------------------------------- Historique des runs

interface RunHistoryModalProps {
  isOpen: boolean;
  workflowId: string | null;
  runs: FunctionRunRecord[];
  onClose: () => void;
  onSelectRun?: (runId: string) => void;
}

export const RunHistoryModal: React.FC<RunHistoryModalProps> = ({ isOpen, workflowId: _workflowId, runs, onClose, onSelectRun }) => {
  const { t } = useLocalization();
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const titleId = 'run-history-title';

  return (
    <AccessibleModal
      isOpen={isOpen}
      onClose={onClose}
      role="dialog"
      labelledBy={titleId}
      initialFocusRef={closeRef}
      maxWidthClassName="max-w-2xl"
    >
      <div className="flex items-start justify-between mb-4">
        <h3 id={titleId} className="text-lg font-medium text-gray-100">
          {t('workflow.runs.title')}
        </h3>
        <ModalCloseButton onClick={onClose} label={t('workflow.resetAndRelaunch.cancel')} />
      </div>
      {runs.length === 0 ? (
        <p className="text-sm text-gray-400">{t('workflow.runs.empty')}</p>
      ) : (
        <ul className="divide-y divide-gray-800 max-h-96 overflow-y-auto" data-testid="run-history-list">
          {runs.map((run) => {
            const quarantined = run.status === 'quarantined' || run.status === 'worker_lost' || run.lockHeld === true;
            return (
              <li key={run.executionId}>
                <button
                  type="button"
                  className="w-full flex items-center gap-3 px-2 py-2 text-left hover:bg-gray-800 rounded"
                  onClick={() => onSelectRun?.(run.executionId)}
                >
                  <span
                    aria-hidden="true"
                    className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${quarantined ? 'bg-orange-500 animate-pulse' : run.status === 'running' || run.status === 'queued' ? 'bg-blue-400 animate-pulse' : run.status === 'completed' ? 'bg-green-500' : run.status === 'failed' ? 'bg-red-500' : 'bg-gray-500'}`}
                  />
                  <span className="text-sm text-gray-100 font-mono truncate flex-1">{run.executionId}</span>
                  <span className="text-xs text-gray-300">{t(`workflow.status.${run.status}`, run.status)}</span>
                  {run.lockHeld === true || run.status === 'quarantined' ? (
                    <span className="text-xs text-orange-300 font-medium">🔒 {t('workflow.runs.lockHeld')}</span>
                  ) : null}
                  <span className="text-xs text-gray-500">{new Date(run.createdAt).toLocaleString()}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex justify-end mt-6">
        <Button ref={closeRef} variant="secondary" onClick={onClose} className="px-4 py-2">
          {t('workflow.resetAndRelaunch.cancel')}
        </Button>
      </div>
    </AccessibleModal>
  );
};
