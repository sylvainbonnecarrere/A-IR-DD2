import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { Agent } from '../types';
import type { AuthSessionStatus } from '../contexts/types/auth.types';
import type { RuntimeBootstrapState } from '../services/runtimeBootstrapService';
import { getAllGuestKeys } from '../utils/guestDataUtils';
import { mapPersistedChatMessages, mergePersistedAndRuntimeMessages } from '../services/persistedChatMessages';
import {
    mapPersistedInstanceToAgentInstance,
    mapPersistedInstanceToLegacyWorkflowNode,
    mapPersistedInstanceToV2Node,
    mapPersistedPrototypeToAgent,
} from '../services/agentContractAdapters';
import { getWorkspaceSessionGateState } from '../utils/workspaceSessionGate';
import {
    createWorkspaceBootstrapIssue,
    fetchWorkspaceSnapshot,
    loadAuthenticatedWorkspaceBootstrap,
    logWorkspaceBootstrapIssue,
    type WorkspaceSnapshot,
} from '../services/workspaceBootstrapService';
import {
    HYDRATION_COMPONENT_READY_EVENT,
    type HydrationComponentReadyDetail,
    type HydrationReadySource,
} from '../utils/hydrationComponentReadiness';
import { hydrateToolMessagesFromPersistedRuns } from '../services/bosRunProjectionService';
import { useDesignStore } from '../stores/useDesignStore';
import { useRuntimeStore } from '../stores/useRuntimeStore';
import { useWorkflowStore } from '../stores/useWorkflowStore';
import { useFunctionStore } from '../stores/useFunctionStore';

const RESUME_WORKSPACE_REFRESH_THROTTLE_MS = 5000;
const DEFAULT_HYDRATION_MESSAGE = 'Chargement de votre workspace...';

export type WorkspaceHydrationPhase =
    | 'idle'
    | 'blocking-bootstrap'
    | 'blocking-bootstrap-finalize'
    | 'silent-resume-revalidate';

const waitForHydrationVisualSettlement = async (): Promise<void> => {
    if (typeof window === 'undefined') {
        return;
    }

    const scheduleFrame = (callback: () => void) => {
        if (typeof window.requestAnimationFrame === 'function') {
            window.requestAnimationFrame(() => callback());
            return;
        }

        window.setTimeout(callback, 16);
    };

    await new Promise<void>((resolve) => {
        scheduleFrame(() => {
            scheduleFrame(resolve);
        });
    });
};

interface HydrateInteractiveWorkspaceOptions {
    preserveRuntimeMessages?: boolean;
    onSnapshotApplied?: () => void;
}

interface UseWorkspaceHydrationOrchestratorParams {
    accessToken: string | null;
    authError: string | null;
    authLoading: boolean;
    isAuthenticated: boolean;
    isSwitchingRef: MutableRefObject<boolean>;
    refreshRuntimeConfigState: () => Promise<RuntimeBootstrapState | null>;
    requiresBosMediaButtonHydrationReadiness?: boolean;
    requiresCanvasHydrationReadiness?: boolean;
    sessionStatus: AuthSessionStatus;
    userId: string | null;
}

interface UseWorkspaceHydrationOrchestratorResult {
    beginBlockingHydrationVisualGate: () => void;
    completeBlockingHydrationVisualGate: () => void;
    awaitingBlockingHydrationVisualGate: boolean;
    hydrateInteractiveWorkspaceState: (
        workspace: WorkspaceSnapshot,
        options?: HydrateInteractiveWorkspaceOptions,
    ) => Promise<string | null>;
    hydrationMessage: string;
    hydrationPhase: WorkspaceHydrationPhase;
    hydrationProgress: number;
    isBlockingHydration: boolean;
    isPreparingBlockingHydration: boolean;
    isHydrating: boolean;
    resumeWorkspaceSilently: (reason: string) => Promise<void> | undefined;
    sessionReadyForWorkspaceHydration: boolean;
}

export const useWorkspaceHydrationOrchestrator = ({
    accessToken,
    authError,
    authLoading,
    isAuthenticated,
    isSwitchingRef,
    refreshRuntimeConfigState,
    requiresBosMediaButtonHydrationReadiness = false,
    requiresCanvasHydrationReadiness = false,
    sessionStatus,
    userId,
}: UseWorkspaceHydrationOrchestratorParams): UseWorkspaceHydrationOrchestratorResult => {
    const hydrateFromServer = useDesignStore((state) => state.hydrateFromServer);
    const hydrateWorkflowFromServer = useWorkflowStore((state) => state.hydrateWorkflowFromServer);
    const updateLLMConfigs = useRuntimeStore((state) => state.updateLLMConfigs);
    const updateLocalLLMProfiles = useRuntimeStore((state) => state.updateLocalLLMProfiles);

    const { sessionReadyForWorkspaceHydration } = getWorkspaceSessionGateState({
        isAuthenticated,
        accessToken,
        sessionStatus,
        userId,
        authLoading,
    });

    const [hydrationPhase, setHydrationPhase] = useState<WorkspaceHydrationPhase>('idle');
    const [hydrationProgress, setHydrationProgress] = useState(0);
    const [hydrationMessage, setHydrationMessage] = useState(DEFAULT_HYDRATION_MESSAGE);
    const [awaitingBlockingHydrationVisualGate, setAwaitingBlockingHydrationVisualGate] = useState(false);
    const workspaceReloadPromiseRef = useRef<Promise<void> | null>(null);
    const hydratedWorkspaceIdentityRef = useRef<string | null>(null);
    const lastResumeWorkspaceRefreshAtRef = useRef(0);
    const guestHydrationResetAppliedRef = useRef(false);
    const currentHydrationIdentity = !authLoading && isAuthenticated && userId ? `auth:${userId}` : null;
    const blockingHydrationExpectedSources = useMemo<HydrationReadySource[]>(() => {
        const expectedSources: HydrationReadySource[] = [];

        if (requiresCanvasHydrationReadiness) {
            expectedSources.push('workflow-canvas-stable');
        }
        if (requiresBosMediaButtonHydrationReadiness) {
            expectedSources.push('bos-media-button');
        }

        return expectedSources;
    }, [requiresBosMediaButtonHydrationReadiness, requiresCanvasHydrationReadiness]);
    const isPreparingBlockingHydration = Boolean(
        currentHydrationIdentity
        && hydratedWorkspaceIdentityRef.current !== currentHydrationIdentity
        && sessionStatus === 'restoring-session',
    );
    const isBlockingHydration = hydrationPhase === 'blocking-bootstrap' || hydrationPhase === 'blocking-bootstrap-finalize';
    const isHydrating = isBlockingHydration;

    const beginBlockingHydrationVisualGate = useCallback(() => {
        setAwaitingBlockingHydrationVisualGate(true);
    }, []);

    const completeBlockingHydrationVisualGate = useCallback(() => {
        setAwaitingBlockingHydrationVisualGate(false);
    }, []);

    const applyRuntimeBootstrapState = useCallback((runtimeState: RuntimeBootstrapState | null) => {
        if (!runtimeState) {
            return;
        }

        updateLLMConfigs(runtimeState.runtimeLLMConfigs);
        updateLocalLLMProfiles(runtimeState.localLLMProfiles);
    }, [updateLLMConfigs, updateLocalLLMProfiles]);

    const waitForBlockingHydrationComponentReadiness = useCallback(async () => {
        try {
            if (typeof window === 'undefined') {
                return;
            }

            if (blockingHydrationExpectedSources.length === 0) {
                return;
            }

            await new Promise<void>((resolve) => {
                const seenSources = new Set<HydrationReadySource>();
                let settled = false;
                let settleTimerId = 0;
                const onReady = (event: Event) => {
                    const detail = (event as CustomEvent<HydrationComponentReadyDetail>).detail;
                    const source = detail?.source;

                    if (!source || !blockingHydrationExpectedSources.includes(source)) {
                        return;
                    }

                    seenSources.add(source);
                    if (!blockingHydrationExpectedSources.every((expectedSource) => seenSources.has(expectedSource))) {
                        return;
                    }

                    if (settled) return;
                    window.clearTimeout(settleTimerId);
                    settleTimerId = window.setTimeout(() => {
                        if (settled) return;
                        settled = true;
                        clearTimeout(timeoutId);
                        try { window.removeEventListener(HYDRATION_COMPONENT_READY_EVENT, onReady as EventListener); } catch {}
                        resolve();
                    }, 160);
                };

                const timeoutId = window.setTimeout(() => {
                    if (settled) return;
                    settled = true;
                    window.clearTimeout(settleTimerId);
                    try { window.removeEventListener(HYDRATION_COMPONENT_READY_EVENT, onReady as EventListener); } catch {}
                    resolve();
                }, 1600);

                try {
                    window.addEventListener(HYDRATION_COMPONENT_READY_EVENT, onReady as EventListener);
                } catch {
                    clearTimeout(timeoutId);
                    resolve();
                }
            });
        } catch (error) {
            console.debug('[HydrationOrchestrator] UI readiness wait failed or timed out', error);
        }
    }, [blockingHydrationExpectedSources]);

    const applyWorkspaceSnapshot = useCallback(async (workspace: WorkspaceSnapshot, options?: { preserveRuntimeMessages?: boolean }) => {
        const snapshotWorkflowId = workspace.workflow?.id;
        const fallbackTimestamp = new Date().toISOString();
        const rawPrototypes = Array.isArray(workspace.agentPrototypes) ? workspace.agentPrototypes : [];
        const rawInstances = Array.isArray(workspace.agentInstances) ? workspace.agentInstances : [];
        const prototypeIndex = new Map<string, Agent>();
        const hydratedPrototypes = rawPrototypes.map((prototype: any) => {
            const hydratedPrototype = mapPersistedPrototypeToAgent(prototype, fallbackTimestamp);
            prototypeIndex.set(hydratedPrototype.id, hydratedPrototype);
            return hydratedPrototype;
        });
        const hydratedInstances = rawInstances.map((instance: any) => {
            const prototype = prototypeIndex.get(instance.prototypeId);
            return mapPersistedInstanceToAgentInstance(instance, snapshotWorkflowId, prototype);
        });
        const v2Nodes = rawInstances.map((instance: any) => {
            const prototype = prototypeIndex.get(instance.prototypeId);
            return mapPersistedInstanceToV2Node(instance, snapshotWorkflowId, prototype, fallbackTimestamp);
        });
        if (workspace.workflow) {
            hydrateWorkflowFromServer({
                id: workspace.workflow.id,
                name: workspace.workflow.name,
                description: workspace.workflow.description,
                isDefault: workspace.workflow.isDefault,
                isActive: workspace.workflow.isActive,
                canvasState: workspace.workflow.canvasState,
            });
        }

        useDesignStore.getState().setCurrentWorkflowId(snapshotWorkflowId || null);
        hydrateFromServer({
            agents: hydratedPrototypes,
            agentInstances: hydratedInstances,
            nodes: v2Nodes,
            edges: Array.isArray(workspace.edges) ? workspace.edges : [],
        });

        const { setNodeMessages, getNodeMessages } = useRuntimeStore.getState();
        for (const [index, instance] of rawInstances.entries()) {
            const instanceId = hydratedInstances[index]?.id;
            if (!instanceId) {
                continue;
            }

            const nodeId = `node-${instanceId}`;
            const persistedMessages = mapPersistedChatMessages(instance.chatMessages);
            const hydratedPersistedMessages = await hydrateToolMessagesFromPersistedRuns(persistedMessages);
            const nextMessages = options?.preserveRuntimeMessages
                ? mergePersistedAndRuntimeMessages(hydratedPersistedMessages, getNodeMessages(nodeId))
                : hydratedPersistedMessages;
            setNodeMessages(nodeId, nextMessages);
        }

        console.log('[App] Workspace snapshot applied:', {
            workflowId: snapshotWorkflowId,
            prototypes: hydratedPrototypes.length,
            instances: hydratedInstances.length,
            edges: Array.isArray(workspace.edges) ? workspace.edges.length : 0,
        });

        return snapshotWorkflowId || null;
    }, [hydrateFromServer, hydrateWorkflowFromServer]);

    const hydrateInteractiveWorkspaceState = useCallback(async (
        workspace: WorkspaceSnapshot,
        options?: HydrateInteractiveWorkspaceOptions,
    ) => {
        const snapshotWorkflowId = await applyWorkspaceSnapshot(workspace, {
            preserveRuntimeMessages: options?.preserveRuntimeMessages,
        });

        options?.onSnapshotApplied?.();
        await useFunctionStore.getState().loadFunctions(snapshotWorkflowId || undefined);
        return snapshotWorkflowId;
    }, [applyWorkspaceSnapshot]);

    const runBlockingBootstrapHydration = useCallback(async (reason: string) => {
        if (!isAuthenticated || !sessionReadyForWorkspaceHydration || !userId) {
            return;
        }

        if (workspaceReloadPromiseRef.current) {
            return workspaceReloadPromiseRef.current;
        }

        const reloadPromise = (async () => {
            setHydrationPhase('blocking-bootstrap');
            setHydrationMessage(DEFAULT_HYDRATION_MESSAGE);
            sessionStorage.setItem('_arc_hydrating', 'true');
            setHydrationProgress(10);

            try {
                useDesignStore.getState().resetAll();
                useRuntimeStore.getState().resetForWorkflowSwitch();

                const allGuestKeys = getAllGuestKeys();
                allGuestKeys.forEach((key) => localStorage.removeItem(key));

                sessionStorage.clear();
                sessionStorage.setItem('_arc_hydrating', 'true');
                setHydrationProgress(30);
                setHydrationMessage('Synchronisation de la session runtime...');
                setHydrationProgress(55);

                const { workspace, runtimeState, runtimeIssue } = await loadAuthenticatedWorkspaceBootstrap({
                    loadRuntimeState: () => refreshRuntimeConfigState(),
                });

                if (runtimeIssue) {
                    logWorkspaceBootstrapIssue('[App]', runtimeIssue, {
                        reason,
                        mode: 'initial-auth',
                        userId,
                    });
                }

                applyRuntimeBootstrapState(runtimeState);

                setHydrationMessage('Restauration du canvas...');
                setHydrationProgress(75);

                await hydrateInteractiveWorkspaceState(workspace, {
                    preserveRuntimeMessages: false,
                    onSnapshotApplied: () => {
                        setHydrationMessage('Chargement du catalogue d\'outils...');
                        setHydrationProgress(90);
                    },
                });

                setHydrationMessage('Synchronisation du catalogue workflows...');
                setHydrationProgress(92);
                await useDesignStore.getState().loadUserWorkflows();

                setHydrationPhase('blocking-bootstrap-finalize');
                setHydrationMessage('Finalisation du canvas...');
                setHydrationProgress(95);
                await waitForHydrationVisualSettlement();
                setHydrationProgress(100);
                await waitForBlockingHydrationComponentReadiness();

                hydratedWorkspaceIdentityRef.current = `auth:${userId}`;

                console.log('[App] Workspace reload complete:', {
                    reason,
                    mode: 'initial-auth',
                    userId,
                });
            } catch (err) {
                const issue = createWorkspaceBootstrapIssue('workspace', err);
                logWorkspaceBootstrapIssue('[App]', issue, {
                    reason,
                    mode: 'initial-auth',
                    userId,
                });

                setHydrationMessage(
                    issue.transient
                        ? 'Backend indisponible. Relancez la session quand le service est revenu.'
                        : authError || 'Restauration de session impossible. Reconnexion requise.',
                );
            } finally {
                setTimeout(() => {
                    setHydrationPhase('idle');
                    setHydrationProgress(0);
                    sessionStorage.removeItem('_arc_hydrating');
                }, 500);
            }
        })().finally(() => {
            workspaceReloadPromiseRef.current = null;
        });

        workspaceReloadPromiseRef.current = reloadPromise;
        return reloadPromise;
    }, [applyRuntimeBootstrapState, authError, hydrateInteractiveWorkspaceState, isAuthenticated, refreshRuntimeConfigState, sessionReadyForWorkspaceHydration, userId, waitForBlockingHydrationComponentReadiness]);

    const resumeWorkspaceSilently = useCallback(async (reason: string) => {
        if (!isAuthenticated || !sessionReadyForWorkspaceHydration || !userId) {
            return;
        }

        if (workspaceReloadPromiseRef.current) {
            return workspaceReloadPromiseRef.current;
        }

        const reloadPromise = (async () => {
            setHydrationPhase('silent-resume-revalidate');

            try {
                const runtimeState = await refreshRuntimeConfigState();
                applyRuntimeBootstrapState(runtimeState);

                const workspace = await fetchWorkspaceSnapshot();
                await hydrateInteractiveWorkspaceState(workspace, {
                    preserveRuntimeMessages: true,
                });

                hydratedWorkspaceIdentityRef.current = `auth:${userId}`;

                console.log('[App] Workspace reload complete:', {
                    reason,
                    mode: 'resume',
                    userId,
                });
            } catch (err) {
                const issue = createWorkspaceBootstrapIssue('workspace', err);
                logWorkspaceBootstrapIssue('[App]', issue, {
                    reason,
                    mode: 'resume',
                    userId,
                });
            } finally {
                setHydrationPhase((currentPhase) => (
                    currentPhase === 'silent-resume-revalidate' ? 'idle' : currentPhase
                ));
            }
        })().finally(() => {
            workspaceReloadPromiseRef.current = null;
        });

        workspaceReloadPromiseRef.current = reloadPromise;
        return reloadPromise;
    }, [applyRuntimeBootstrapState, hydrateInteractiveWorkspaceState, isAuthenticated, refreshRuntimeConfigState, sessionReadyForWorkspaceHydration, userId]);

    useLayoutEffect(() => {
        if (!isAuthenticated) {
            hydratedWorkspaceIdentityRef.current = null;
            if (guestHydrationResetAppliedRef.current) {
                return;
            }

            guestHydrationResetAppliedRef.current = true;
            setHydrationPhase('idle');
            setHydrationProgress(0);
            setHydrationMessage(DEFAULT_HYDRATION_MESSAGE);
            setAwaitingBlockingHydrationVisualGate(false);
            sessionStorage.removeItem('_arc_hydrating');
            return;
        }

        guestHydrationResetAppliedRef.current = false;

        if (!sessionReadyForWorkspaceHydration || !userId) {
            return;
        }

        const currentIdentity = `auth:${userId}`;
        if (hydratedWorkspaceIdentityRef.current === currentIdentity) {
            return;
        }

        void runBlockingBootstrapHydration('initial-auth-hydration');
    }, [isAuthenticated, runBlockingBootstrapHydration, sessionReadyForWorkspaceHydration, userId]);

    useEffect(() => {
        if (!sessionReadyForWorkspaceHydration || !userId) {
            return;
        }

        const requestResumeWorkspaceRefresh = (reason: string) => {
            const now = Date.now();

            if (workspaceReloadPromiseRef.current || isSwitchingRef.current) {
                return;
            }

            if (now - lastResumeWorkspaceRefreshAtRef.current < RESUME_WORKSPACE_REFRESH_THROTTLE_MS) {
                return;
            }

            lastResumeWorkspaceRefreshAtRef.current = now;

            void resumeWorkspaceSilently(reason);
        };

        const handleFocus = () => requestResumeWorkspaceRefresh('window-focus');
        const handleOnline = () => requestResumeWorkspaceRefresh('network-online');
        const handlePageShow = () => requestResumeWorkspaceRefresh('page-show');
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                requestResumeWorkspaceRefresh('visibility-visible');
            }
        };

        window.addEventListener('focus', handleFocus);
        window.addEventListener('online', handleOnline);
        window.addEventListener('pageshow', handlePageShow);
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            window.removeEventListener('focus', handleFocus);
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('pageshow', handlePageShow);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [isSwitchingRef, resumeWorkspaceSilently, sessionReadyForWorkspaceHydration, userId]);

    return {
        beginBlockingHydrationVisualGate,
        completeBlockingHydrationVisualGate,
        awaitingBlockingHydrationVisualGate,
        hydrateInteractiveWorkspaceState,
        hydrationMessage,
        hydrationPhase,
        hydrationProgress,
        isBlockingHydration,
        isPreparingBlockingHydration,
        isHydrating,
        resumeWorkspaceSilently,
        sessionReadyForWorkspaceHydration,
    };
};