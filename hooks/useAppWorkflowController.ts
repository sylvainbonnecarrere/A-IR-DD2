import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { AuthSessionStatus } from '../contexts/types/auth.types';
import type { RuntimeBootstrapState } from '../services/runtimeBootstrapService';
import { useWorkspaceHydrationOrchestrator } from './useWorkspaceHydrationOrchestrator';
import { useRuntimeStore } from '../stores/useRuntimeStore';
import { useDesignStore } from '../stores/useDesignStore';
import apiClient from '../utils/apiClient';

export interface UseAppWorkflowControllerParams {
  accessToken: string | null;
  authError: string | null;
  authLoading: boolean;
  isAuthenticated: boolean;
  refreshRuntimeConfigState: () => Promise<RuntimeBootstrapState | null>;
  sessionStatus: AuthSessionStatus;
  userId: string | null;
  currentRouteUsesWorkflowCanvas: boolean;
  t: (key: string) => string;
}

export interface UseAppWorkflowControllerResult {
  isSwitchingWorkflow: boolean;
  switchProgress: number;
  switchWorkflowName: string;
  isSwitchingRef: MutableRefObject<boolean>;
  switchToWorkflow: (workflowId: string, workflowName?: string) => Promise<void>;
  beginBlockingHydrationVisualGate: () => void;
  completeBlockingHydrationVisualGate: () => void;
  awaitingBlockingHydrationVisualGate: boolean;
  isBlockingHydration: boolean;
  isPreparingBlockingHydration: boolean;
  hydrationProgress: number;
  hydrationMessage: string;
  hydrateInteractiveWorkspaceState: (
    workspace: any,
    options?: { preserveRuntimeMessages?: boolean; onSnapshotApplied?: () => void },
  ) => Promise<string | null>;
  shouldShowHydrationOverlay: boolean;
  hydrationOverlayProgress: number;
  hydrationOverlayMessage: string;
  handleWorkflowCanvasReady: () => void;
}

export function useAppWorkflowController({
  accessToken,
  authError,
  authLoading,
  isAuthenticated,
  refreshRuntimeConfigState,
  sessionStatus,
  userId,
  currentRouteUsesWorkflowCanvas,
  t,
}: UseAppWorkflowControllerParams): UseAppWorkflowControllerResult {
  const isSwitchingRef = useRef(false);
  const hydrationCanvasReadyGuardRef = useRef(false);
  const lastCanvasReadySignalAtRef = useRef(0);
  const [isSwitchingWorkflow, setIsSwitchingWorkflow] = useState(false);
  const [switchProgress, setSwitchProgress] = useState(0);
  const [switchWorkflowName, setSwitchWorkflowName] = useState('');

  const {
    beginBlockingHydrationVisualGate,
    completeBlockingHydrationVisualGate,
    awaitingBlockingHydrationVisualGate,
    isBlockingHydration,
    isPreparingBlockingHydration,
    hydrationProgress,
    hydrationMessage,
    hydrateInteractiveWorkspaceState,
  } = useWorkspaceHydrationOrchestrator({
    accessToken,
    authError,
    authLoading,
    isAuthenticated,
    isSwitchingRef,
    refreshRuntimeConfigState,
    requiresBosMediaButtonHydrationReadiness: currentRouteUsesWorkflowCanvas,
    requiresCanvasHydrationReadiness: currentRouteUsesWorkflowCanvas,
    sessionStatus,
    userId,
  });

  const shouldShowHydrationOverlay = isPreparingBlockingHydration || isBlockingHydration || awaitingBlockingHydrationVisualGate;
  const hydrationOverlayProgress = isPreparingBlockingHydration
    ? 5
    : isBlockingHydration
      ? hydrationProgress
      : awaitingBlockingHydrationVisualGate
        ? 100
        : 0;
  const hydrationOverlayMessage = isPreparingBlockingHydration
    ? 'Restauration de la session...'
    : isBlockingHydration
      ? hydrationMessage
      : awaitingBlockingHydrationVisualGate
        ? 'Preparation de la carte...'
        : 'Chargement du workspace...';

  const switchToWorkflow = useCallback(async (workflowId: string, workflowName?: string) => {
    if (isSwitchingRef.current) {
      console.warn('[AppWorkflowController] Switch already in progress, ignoring');
      return;
    }
    if (isBlockingHydration) {
      console.warn('[AppWorkflowController] Initial hydration in progress, ignoring');
      return;
    }
    if (!accessToken) {
      console.warn('[AppWorkflowController] No accessToken — aborting switch');
      window.dispatchEvent(new CustomEvent('workflow:switch:error', {
        detail: { message: t('workflow_switch_error_message').replace('{name}', workflowName || '') },
      }));
      return;
    }

    isSwitchingRef.current = true;
    setIsSwitchingWorkflow(true);
    setSwitchWorkflowName(workflowName || 'Workflow');
    setSwitchProgress(0);

    try {
      setSwitchProgress(10);
      useRuntimeStore.getState().resetForWorkflowSwitch();

      setSwitchProgress(30);
      const { data } = await apiClient.post(`/api/workflows/${workflowId}/select`);

      if (!data.success) {
        throw new Error(data.message || 'Switch failed');
      }

      setSwitchProgress(70);
      await hydrateInteractiveWorkspaceState(data.reloadedData, {
        preserveRuntimeMessages: false,
        onSnapshotApplied: () => setSwitchProgress(85),
      });

      setSwitchProgress(95);
      try {
        await useDesignStore.getState().loadUserWorkflows();
      } catch (refreshErr) {
        console.warn('[AppWorkflowController] Workflow list refresh failed (non-blocking):', refreshErr);
      }

      setSwitchProgress(100);
      window.dispatchEvent(new CustomEvent('workflow:switch:success', {
        detail: { workflowId, workflowName },
      }));
    } catch (error: any) {
      console.error('[AppWorkflowController] Workflow switch failed:', error);
      window.dispatchEvent(new CustomEvent('workflow:switch:error', {
        detail: { message: error.message || 'Unknown error', workflowId },
      }));
    } finally {
      setTimeout(() => {
        setIsSwitchingWorkflow(false);
        setSwitchProgress(0);
        setSwitchWorkflowName('');
      }, 300);
      isSwitchingRef.current = false;
    }
  }, [accessToken, hydrateInteractiveWorkspaceState, isBlockingHydration, t]);

  useEffect(() => {
    const handleWorkflowSwitch = (event: Event) => {
      const { workflowId, workflowName } = (event as CustomEvent).detail;
      if (workflowId) {
        void switchToWorkflow(workflowId, workflowName || 'Workflow');
      }
    };

    window.addEventListener('workflow:switch', handleWorkflowSwitch);
    return () => window.removeEventListener('workflow:switch', handleWorkflowSwitch);
  }, [switchToWorkflow]);

  const handleWorkflowCanvasReady = useCallback(() => {
    if (!currentRouteUsesWorkflowCanvas) {
      return;
    }

    const now = Date.now();
    if (now - lastCanvasReadySignalAtRef.current < 300) {
      return;
    }

    lastCanvasReadySignalAtRef.current = now;
    hydrationCanvasReadyGuardRef.current = true;
    completeBlockingHydrationVisualGate();

    try {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        try {
          window.dispatchEvent(new Event('hydration:components:ready'));
        } catch {
          // ignore
        }
      }));
    } catch {
      // ignore
    }
  }, [completeBlockingHydrationVisualGate, currentRouteUsesWorkflowCanvas]);

  useEffect(() => {
    if (!currentRouteUsesWorkflowCanvas) {
      hydrationCanvasReadyGuardRef.current = false;
      lastCanvasReadySignalAtRef.current = 0;
      return;
    }

    if (!isBlockingHydration) {
      hydrationCanvasReadyGuardRef.current = false;
      lastCanvasReadySignalAtRef.current = 0;
    }
  }, [currentRouteUsesWorkflowCanvas, isBlockingHydration]);

  useEffect(() => {
    if (isBlockingHydration && currentRouteUsesWorkflowCanvas) {
      beginBlockingHydrationVisualGate();
      return;
    }

    if (!isBlockingHydration && !isPreparingBlockingHydration) {
      completeBlockingHydrationVisualGate();
    }

    if (!currentRouteUsesWorkflowCanvas) {
      completeBlockingHydrationVisualGate();
    }
  }, [beginBlockingHydrationVisualGate, completeBlockingHydrationVisualGate, currentRouteUsesWorkflowCanvas, isBlockingHydration, isPreparingBlockingHydration]);

  return {
    isSwitchingWorkflow,
    switchProgress,
    switchWorkflowName,
    isSwitchingRef,
    switchToWorkflow,
    beginBlockingHydrationVisualGate,
    completeBlockingHydrationVisualGate,
    awaitingBlockingHydrationVisualGate,
    isBlockingHydration,
    isPreparingBlockingHydration,
    hydrationProgress,
    hydrationMessage,
    hydrateInteractiveWorkspaceState,
    shouldShowHydrationOverlay,
    hydrationOverlayProgress,
    hydrationOverlayMessage,
    handleWorkflowCanvasReady,
  };
}
