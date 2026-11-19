import { useCallback, useEffect, useRef, useState } from 'react';

import WorkflowRunService from '../services/workflowRunService';

import {
  getWorkflowLatestRunId,
  useRuntimeStore,
  type InstanceRunStatus,
} from '../stores/useRuntimeStore';

import type { FunctionRunStatus } from '../types/function.types';

export type RunSyncState = 'loading' | 'ready' | 'error';

/**
 * ⭐ US-J7-13 — Synchronise l'état d'observation des runs d'un workflow :
 * - lecture REST autoritaire (`GET /api/runs?workflowId=…`) au montage, au
 *   changement de workflow, après une reconnexion du canal et sur tout événement
 *   temps réel appartenant à ce workspace (`event.workspaceId === workflowId`) ;
 * - écrit le résultat dans `useRuntimeStore` (source unique d'observation).
 *
 * Le composant appelant n'a qu'à monter ce hook une fois (page carte) et à lire
 * l'état via `useWorkflowRunStatus(workflowId)` / `useInstanceRunStatus(instanceId)`.
 */
export const useWorkflowRunSync = (workflowId: string | null | undefined): { refresh: () => void } => {
  const setRunSnapshot = useRuntimeStore((state) => state.setRunSnapshot);
  const setRunSyncState = useRuntimeStore((state) => state.setRunSyncState);
  const connectionState = useRuntimeStore((state) => state.runtimeConnectionState);
  const latestRuntimeEvent = useRuntimeStore((state) => state.latestRuntimeEvent);
  const [refreshCounter, setRefreshCounter] = useState(0);
  const inFlightRef = useRef(false);

  const refresh = useCallback(() => {
    setRefreshCounter((counter) => counter + 1);
  }, []);

  useEffect(() => {
    if (!workflowId) {
      return;
    }

    let cancelled = false;

    const load = async () => {
      if (inFlightRef.current) {
        return;
      }
      inFlightRef.current = true;
      setRunSyncState(workflowId, 'loading');
      try {
        const response = await WorkflowRunService.listWorkflowRuns(workflowId, {
          limit: 50,
          sortBy: 'createdAt',
          sortOrder: 'desc',
        });
        if (cancelled) {
          return;
        }
        if (!response || !Array.isArray(response.items)) {
          setRunSyncState(workflowId, 'error');
          return;
        }
        setRunSnapshot(workflowId, response.items);
      } catch (error) {
        if (!cancelled) {
          console.warn('[useWorkflowRunSync] Unable to fetch workflow runs:', error);
          setRunSyncState(workflowId, 'error');
        }
      } finally {
        inFlightRef.current = false;
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [workflowId, refreshCounter, connectionState, setRunSnapshot, setRunSyncState]);

  // Rafraîchit le snapshot REST quand un événement temps réel du même workspace arrive
  // (filtrage strict par workflowId : un événement d'un autre workflow est ignoré).
  useEffect(() => {
    if (!workflowId || !latestRuntimeEvent) {
      return;
    }
    if (latestRuntimeEvent.workspaceId !== workflowId) {
      return;
    }
    refresh();
  }, [latestRuntimeEvent, workflowId, refresh]);

  // Poll de fond léger : le REST reste autoritaire même sans événement (badge à jour).
  useEffect(() => {
    if (!workflowId) {
      return undefined;
    }
    const timer = window.setInterval(() => {
      setRefreshCounter((counter) => counter + 1);
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [workflowId]);

  return { refresh };
};

export interface WorkflowRunStatus {
  runId: string | null;
  status: FunctionRunStatus | string | null;
  lockHeld: boolean;
  syncState: RunSyncState | null;
  connectionState: string;
}

/** Statut du dernier run du workflow, dérivé du store runtime (REST + événements). */
export const useWorkflowRunStatus = (workflowId: string | null | undefined): WorkflowRunStatus => {
  const runId = useRuntimeStore((state) => getWorkflowLatestRunId(state, workflowId));
  const status = useRuntimeStore((state) => (runId ? state.runStatuses[runId] ?? null : null));
  const lockHeld = useRuntimeStore((state) => (runId ? state.runLockHeld[runId] === true : false));
  const syncState = useRuntimeStore((state) => (workflowId ? state.runSyncState[workflowId] ?? null : null));
  const connectionState = useRuntimeStore((state) => state.runtimeConnectionState);

  return { runId, status, lockHeld, syncState, connectionState };
};

/** Statut du run affiché sur le badge d'un nœud (agentInstanceId).
 * Sélecteurs sur primitives stables (zustand v5 : un objet neuf à chaque appel bouclerait). */
export const useInstanceRunStatus = (instanceId?: string | null): InstanceRunStatus | null => {
  const runId = useRuntimeStore((state) => (instanceId ? state.instanceRunIds[instanceId] ?? null : null));
  const status = useRuntimeStore((state) => (runId ? state.runStatuses[runId] ?? null : null));
  const lockHeld = useRuntimeStore((state) => (runId ? state.runLockHeld[runId] === true : false));
  if (!runId) {
    return null;
  }
  return { runId, status: status ?? 'queued', lockHeld };
};
