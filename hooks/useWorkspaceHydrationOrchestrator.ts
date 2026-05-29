import { useCallback, useEffect, useRef, useState } from 'react';
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
import { hydrateToolMessagesFromPersistedRuns } from '../services/bosRunProjectionService';
import { useDesignStore } from '../stores/useDesignStore';
import { useRuntimeStore } from '../stores/useRuntimeStore';
import { useWorkflowStore } from '../stores/useWorkflowStore';
import { useFunctionStore } from '../stores/useFunctionStore';

const RESUME_WORKSPACE_REFRESH_THROTTLE_MS = 5000;
const DEFAULT_HYDRATION_MESSAGE = 'Chargement de votre workspace...';

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

interface WorkspaceReloadRequest {
    reason: string;
    mode: 'initial-auth' | 'resume';
}

interface UseWorkspaceHydrationOrchestratorParams {
    accessToken: string | null;
    authError: string | null;
    authLoading: boolean;
    isAuthenticated: boolean;
    isSwitchingRef: MutableRefObject<boolean>;
    refreshRuntimeConfigState: () => Promise<RuntimeBootstrapState | null>;
    sessionStatus: AuthSessionStatus;
    userId: string | null;
}

interface UseWorkspaceHydrationOrchestratorResult {
    awaitingStableAuthenticatedSession: boolean;
    hydrateInteractiveWorkspaceState: (
        workspace: WorkspaceSnapshot,
        options?: HydrateInteractiveWorkspaceOptions,
    ) => Promise<string | null>;
    hydrationMessage: string;
    hydrationProgress: number;
    isHydrating: boolean;
    reloadWorkspaceSnapshot: (request: WorkspaceReloadRequest) => Promise<void> | undefined;
    sessionReadyForWorkspaceHydration: boolean;
}

export const useWorkspaceHydrationOrchestrator = ({
    accessToken,
    authError,
    authLoading,
    isAuthenticated,
    isSwitchingRef,
    refreshRuntimeConfigState,
    sessionStatus,
    userId,
}: UseWorkspaceHydrationOrchestratorParams): UseWorkspaceHydrationOrchestratorResult => {
    const hydrateFromServer = useDesignStore((state) => state.hydrateFromServer);
    const hydrateWorkflowFromServer = useWorkflowStore((state) => state.hydrateWorkflowFromServer);
    const updateLLMConfigs = useRuntimeStore((state) => state.updateLLMConfigs);
    const updateLocalLLMProfiles = useRuntimeStore((state) => state.updateLocalLLMProfiles);

    const { sessionReadyForWorkspaceHydration, awaitingStableAuthenticatedSession } = getWorkspaceSessionGateState({
        isAuthenticated,
        accessToken,
        sessionStatus,
        userId,
        authLoading,
    });

    const [isHydrating, setIsHydrating] = useState(false);
    const [hydrationProgress, setHydrationProgress] = useState(0);
    const [hydrationMessage, setHydrationMessage] = useState(DEFAULT_HYDRATION_MESSAGE);
    const isHydratingRef = useRef(false);
    const workspaceReloadPromiseRef = useRef<Promise<void> | null>(null);
    const hydratedWorkspaceIdentityRef = useRef<string | null>(null);
    const lastResumeWorkspaceRefreshAtRef = useRef(0);

    useEffect(() => {
        isHydratingRef.current = isHydrating;
    }, [isHydrating]);

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

    const reloadWorkspaceSnapshot = useCallback(async ({ reason, mode }: WorkspaceReloadRequest) => {
        if (!isAuthenticated || !sessionReadyForWorkspaceHydration || !userId) {
            return;
        }

        if (workspaceReloadPromiseRef.current) {
            return workspaceReloadPromiseRef.current;
        }

        const reloadPromise = (async () => {
            const showOverlay = mode === 'initial-auth';

            if (showOverlay) {
                setHydrationMessage(DEFAULT_HYDRATION_MESSAGE);
                setIsHydrating(true);
                sessionStorage.setItem('_arc_hydrating', 'true');
                setHydrationProgress(10);
            }

            try {
                if (mode === 'initial-auth') {
                    useDesignStore.getState().resetAll();
                    useRuntimeStore.getState().resetForWorkflowSwitch();

                    const allGuestKeys = getAllGuestKeys();
                    allGuestKeys.forEach((key) => localStorage.removeItem(key));

                    sessionStorage.clear();
                    sessionStorage.setItem('_arc_hydrating', 'true');
                    setHydrationProgress(30);
                }

                if (showOverlay) {
                    setHydrationMessage('Synchronisation de la session runtime...');
                    setHydrationProgress(55);
                }

                let workspace: WorkspaceSnapshot;

                if (mode === 'initial-auth') {
                    const { workspace: hydratedWorkspace, runtimeState, runtimeIssue } = await loadAuthenticatedWorkspaceBootstrap({
                        loadRuntimeState: () => refreshRuntimeConfigState(),
                    });

                    if (runtimeIssue) {
                        logWorkspaceBootstrapIssue('[App]', runtimeIssue, {
                            reason,
                            mode,
                            userId,
                        });
                    }

                    if (runtimeState) {
                        updateLLMConfigs(runtimeState.runtimeLLMConfigs);
                        updateLocalLLMProfiles(runtimeState.localLLMProfiles);
                    }

                    workspace = hydratedWorkspace;
                } else {
                    const runtimeState = await refreshRuntimeConfigState();
                    if (runtimeState) {
                        updateLLMConfigs(runtimeState.runtimeLLMConfigs);
                        updateLocalLLMProfiles(runtimeState.localLLMProfiles);
                    }

                    workspace = await fetchWorkspaceSnapshot();
                }

                if (showOverlay) {
                    setHydrationMessage('Restauration du canvas...');
                    setHydrationProgress(75);
                }

                await hydrateInteractiveWorkspaceState(workspace, {
                    preserveRuntimeMessages: mode === 'resume',
                    onSnapshotApplied: showOverlay
                        ? () => {
                            setHydrationMessage('Chargement du catalogue d\'outils...');
                            setHydrationProgress(90);
                        }
                        : undefined,
                });

                if (showOverlay) {
                    setHydrationMessage('Synchronisation du catalogue workflows...');
                    setHydrationProgress(92);
                    await useDesignStore.getState().loadUserWorkflows();
                }

                if (showOverlay) {
                    setHydrationMessage('Finalisation du canvas...');
                    setHydrationProgress(95);
                    await waitForHydrationVisualSettlement();
                    setHydrationProgress(100);
                }

                hydratedWorkspaceIdentityRef.current = `auth:${userId}`;

                console.log('[App] Workspace reload complete:', {
                    reason,
                    mode,
                    userId,
                });
            } catch (err) {
                const issue = createWorkspaceBootstrapIssue('workspace', err);
                logWorkspaceBootstrapIssue('[App]', issue, {
                    reason,
                    mode,
                    userId,
                });

                if (showOverlay) {
                    setHydrationMessage(
                        issue.transient
                            ? 'Backend indisponible. Relancez la session quand le service est revenu.'
                            : authError || 'Restauration de session impossible. Reconnexion requise.',
                    );
                }
            } finally {
                if (showOverlay) {
                    setTimeout(() => {
                        setIsHydrating(false);
                        setHydrationProgress(0);
                        sessionStorage.removeItem('_arc_hydrating');
                    }, 500);
                }
            }
        })().finally(() => {
            workspaceReloadPromiseRef.current = null;
        });

        workspaceReloadPromiseRef.current = reloadPromise;
        return reloadPromise;
    }, [authError, hydrateInteractiveWorkspaceState, isAuthenticated, refreshRuntimeConfigState, sessionReadyForWorkspaceHydration, updateLLMConfigs, updateLocalLLMProfiles, userId]);

    useEffect(() => {
        if (!isAuthenticated) {
            hydratedWorkspaceIdentityRef.current = null;
            setIsHydrating(false);
            setHydrationProgress(0);
            setHydrationMessage(DEFAULT_HYDRATION_MESSAGE);
            sessionStorage.removeItem('_arc_hydrating');
            return;
        }

        if (!sessionReadyForWorkspaceHydration || !userId) {
            return;
        }

        const currentIdentity = `auth:${userId}`;
        if (hydratedWorkspaceIdentityRef.current === currentIdentity) {
            return;
        }

        void reloadWorkspaceSnapshot({
            reason: 'initial-auth-hydration',
            mode: 'initial-auth',
        });
    }, [isAuthenticated, reloadWorkspaceSnapshot, sessionReadyForWorkspaceHydration, userId]);

    useEffect(() => {
        if (!sessionReadyForWorkspaceHydration || !userId) {
            return;
        }

        const requestResumeWorkspaceRefresh = (reason: string) => {
            const now = Date.now();

            if (isHydratingRef.current || isSwitchingRef.current) {
                return;
            }

            if (now - lastResumeWorkspaceRefreshAtRef.current < RESUME_WORKSPACE_REFRESH_THROTTLE_MS) {
                return;
            }

            lastResumeWorkspaceRefreshAtRef.current = now;

            void reloadWorkspaceSnapshot({
                reason,
                mode: 'resume',
            });
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
    }, [isSwitchingRef, reloadWorkspaceSnapshot, sessionReadyForWorkspaceHydration, userId]);

    return {
        awaitingStableAuthenticatedSession,
        hydrateInteractiveWorkspaceState,
        hydrationMessage,
        hydrationProgress,
        isHydrating,
        reloadWorkspaceSnapshot,
        sessionReadyForWorkspaceHydration,
    };
};