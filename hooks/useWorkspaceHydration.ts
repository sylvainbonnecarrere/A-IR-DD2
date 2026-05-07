/**
 * @file useWorkspaceHydration.ts
 * @description Hook for hydrating workspace state from backend or localStorage
 * @domain Design Domain - State Hydration & Persistence
 * 
 * ARCHITECTURE:
 * - Automatic hydration on mount and auth state changes
 * - Dual-mode: API for authenticated, localStorage for guest
 * - Non-blocking with loading states
 * 
 * ⭐ ÉTAPE 2.2-2.3: Ajout Wipe stores + Hydratation avec canvasState, content, metrics
 * 
 * SOLID PRINCIPLES:
 * - S: Single responsibility (workspace hydration only)
 * - O: Open for extension (add new domains easily)
 * - D: Dependency inversion (abstracts storage backend)
 * 
 * USE CASES:
 * - App mount: Load workspace state
 * - Login success: Hydrate from MongoDB
 * - F5 refresh: Restore context without data loss
 * - Logout: Reset to guest mode (localStorage)
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from './useAuth';
import { GUEST_STORAGE_KEYS } from '../utils/guestDataUtils';
import { useDesignStore } from '../stores/useDesignStore';
import { useRuntimeStore } from '../stores/useRuntimeStore';
import { useWorkflowStore } from '../stores/useWorkflowStore';
import type { AgentInstance, V2WorkflowNode, V2WorkflowEdge } from '../types';
import { API_BASE_URL } from '../config/api.config';
import { mapPersistedChatMessages, mergePersistedAndRuntimeMessages } from '../services/persistedChatMessages';
import { getWorkspaceSessionGateState } from '../utils/workspaceSessionGate';

/**
 * Canvas state for visual reconstruction (ÉTAPE 1.6)
 */
interface CanvasState {
    zoom: number;
    panX: number;
    panY: number;
}

/**
 * Agent instance metrics (ÉTAPE 1.6)
 */
interface AgentInstanceMetrics {
    totalTokens: number;
    totalErrors: number;
    totalMediaGenerated: number;
    callCount: number;
}

/**
 * Workspace data structure (mirrors backend response)
 * ⭐ UPDATED ÉTAPE 1.6: Added canvasState, isDefault, content, metrics
 */
export interface WorkspaceData {
    runtimeCompatibility?: {
        checkedAt: string;
        mode: 'rootless' | 'docker-desktop' | 'rootful-linux' | 'unknown';
        securityLevel: 'production-ready' | 'dev-only' | 'unavailable';
        executionReady: boolean;
        preferredRunner: 'docker_sandbox' | 'firecracker';
        warning?: string;
        summary: string;
    };
    workspaceContext?: {
        id: string;
        scopeType: 'project' | 'workflow';
        scopeId: string;
        status: 'active' | 'missing' | 'corrupted' | 'archived';
        manifests: {
            packageJson: boolean;
            packageLockJson: boolean;
            requirementsTxt: boolean;
            pyprojectToml: boolean;
        };
        lastScanAt?: Date | null;
    };
    workflow: {
        id: string;
        name: string;
        description?: string;
        isActive: boolean;
        isDefault: boolean; // ⭐ NOUVEAU
        isDirty: boolean;
        canvasState: CanvasState; // ⭐ NOUVEAU
        createdAt: Date;
        updatedAt: Date;
        lastSavedAt?: Date;
    } | null;
    nodes: Array<{
        id: string;
        agentId: string;
        agentName: string;
        position: { x: number; y: number };
        provider: string;
        model: string;
    }>;
    edges: Array<{
        id: string;
        sourceId: string;
        targetId: string;
        type: string;
    }>;
    agentInstances: Array<{
        id: string;
        name: string;
        provider: string;
        model: string;
        position: { x: number; y: number };
        systemInstruction?: string;
        // ⭐ NOUVEAU ÉTAPE 1.6
        executionId?: string;
        status?: string;
        metrics?: AgentInstanceMetrics;
        // ⭐ FIX QA: Chat messages with images for restoration
        chatMessages?: Array<{
            sender: string;
            text: string;
            timestamp?: Date;
            image?: string;
            mimeType?: string;
            fileName?: string;
            toolCalls?: any[];
        }>;
        // ⭐ FIX QA: Persistence config for media storage
        persistenceConfig?: {
            saveChat: boolean;
            saveErrors: boolean;
            saveHistorySummary: boolean;
            saveLinks: boolean;
            saveTasks: boolean;
            saveMedia: boolean;
            mediaStorage: 'db' | 'local' | 'cloud';
        };
    }>;
    llmConfigs: Array<{
        id: string;
        provider: string;
        enabled: boolean;
        hasApiKey: boolean;
        capabilities: Record<string, boolean>;
    }>;
    toolRuns: Array<{
        id: string;
        executionId: string;
        toolId: string;
        toolVersionTag: string;
        toolContentHash: string;
        workflowId?: string;
        agentPrototypeId?: string;
        agentInstanceId?: string;
        launchContext: 'editor_test' | 'workflow_run' | 'system_validation';
        status: 'queued' | 'running' | 'completed' | 'failed' | 'stopped' | 'timed_out';
        runtime: 'typescript' | 'python';
        runner: 'docker_sandbox' | 'docker_rootless' | 'firecracker';
        inputs: Record<string, unknown>;
        outputs?: {
            result?: unknown;
            stdout?: string;
            stderr?: string;
            artifacts?: Array<{
                path: string;
                kind: 'file' | 'json' | 'log';
            }>;
        };
        error?: {
            code?: string;
            message: string;
            retryable?: boolean;
        };
        timing: {
            queuedAt?: Date | null;
            startedAt?: Date | null;
            finishedAt?: Date | null;
            durationMs?: number | null;
        };
        createdAt: Date;
        updatedAt: Date;
    }>;
    userSettings: {
        language: string;
        theme: string;
    };
    metadata: {
        loadedAt: Date;
        userId: string;
        hasWorkflow: boolean;
        source: 'api' | 'localStorage';
    };
}

/**
 * Hook return type
 */
export interface UseWorkspaceHydrationResult {
    workspace: WorkspaceData | null;
    isLoading: boolean;
    error: string | null;
    refetch: () => Promise<void>;
    source: 'api' | 'localStorage' | 'none';
}

/**
 * Fetch workspace from API (authenticated mode)
 */
const fetchWorkspaceFromAPI = async (accessToken: string): Promise<WorkspaceData> => {
    const response = await fetch(`${API_BASE_URL}/api/user/workspace`, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        }
    });

    if (!response.ok) {
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    return {
        ...data,
        metadata: {
            ...data.metadata,
            source: 'api' as const
        }
    };
};

/**
 * Load workspace from localStorage (guest mode)
 */
const loadWorkspaceFromLocalStorage = (): WorkspaceData => {
    try {
        // Load workflow
        const workflowJson = localStorage.getItem(GUEST_STORAGE_KEYS.WORKFLOW);
        const workflow = workflowJson ? JSON.parse(workflowJson) : null;

        // Load nodes
        const nodesJson = localStorage.getItem(GUEST_STORAGE_KEYS.WORKFLOW_NODES);
        const nodes = nodesJson ? JSON.parse(nodesJson) : [];

        // Load edges
        const edgesJson = localStorage.getItem(GUEST_STORAGE_KEYS.WORKFLOW_EDGES);
        const edges = edgesJson ? JSON.parse(edgesJson) : [];

        // Load agent instances
        const instancesJson = localStorage.getItem(GUEST_STORAGE_KEYS.AGENT_INSTANCES);
        const agentInstances = instancesJson ? JSON.parse(instancesJson) : [];

        // Load LLM configs
        const configsJson = localStorage.getItem(GUEST_STORAGE_KEYS.LLM_CONFIGS);
        const llmConfigs = configsJson ? JSON.parse(configsJson) : [];

        // Load user settings
        const settingsJson = localStorage.getItem(GUEST_STORAGE_KEYS.USER_SETTINGS);
        const userSettings = settingsJson 
            ? JSON.parse(settingsJson) 
            : { language: 'fr', theme: 'dark' };

        return {
            workspaceContext: undefined,
            workflow,
            nodes,
            edges,
            agentInstances,
            llmConfigs: Array.isArray(llmConfigs) 
                ? llmConfigs.map((c: any) => ({
                    id: c.id || c.provider,
                    provider: c.provider,
                    enabled: c.enabled ?? true,
                    hasApiKey: !!(c.apiKey || c.apiKeyPlaintext),
                    capabilities: c.capabilities || {}
                }))
                : [],
            toolRuns: [],
            userSettings: {
                language: userSettings.language || 'fr',
                theme: userSettings.theme || 'dark'
            },
            metadata: {
                loadedAt: new Date(),
                userId: 'guest',
                hasWorkflow: !!workflow,
                source: 'localStorage' as const
            }
        };
    } catch (err) {
        console.error('[useWorkspaceHydration] localStorage parse error:', err);
        // Return empty workspace on error
        return {
            workspaceContext: undefined,
            workflow: null,
            nodes: [],
            edges: [],
            agentInstances: [],
            llmConfigs: [],
            userSettings: { language: 'fr', theme: 'dark' },
            metadata: {
                loadedAt: new Date(),
                userId: 'guest',
                hasWorkflow: false,
                source: 'localStorage' as const
            }
        };
    }
};

/**
 * Hook: useWorkspaceHydration
 * 
 * Automatically hydrates workspace state based on authentication status.
 * - Authenticated: Fetches from /api/user/workspace
 * - Guest: Loads from localStorage
 * 
 * ⭐ ÉTAPE 2.2: Wipe stores before hydration to prevent data leak
 * 
 * Triggers on:
 * - Initial mount
 * - isAuthenticated change (login/logout)
 * - accessToken change (refresh)
 * 
 * @returns Workspace data, loading state, error, and refetch function
 */
export const useWorkspaceHydration = (): UseWorkspaceHydrationResult => {
    const { isAuthenticated, accessToken, isLoading: authLoading, sessionStatus, user } = useAuth();
    
    // ⭐ ÉTAPE 2.2: Access stores for reset & hydration
    const designStoreReset = useDesignStore((state) => state.resetAll);
    const runtimeStoreReset = useRuntimeStore((state) => state.resetAll);
    const workflowStoreReset = useWorkflowStore((state) => state.resetAll);
    const designStoreHydrate = useDesignStore((state) => state.hydrateFromServer);
    const workflowStoreHydrate = useWorkflowStore((state) => state.hydrateWorkflowFromServer);
    // ⭐ FIX QA: Access runtime store helpers for shared message hydration
    const getNodeMessages = useRuntimeStore((state) => state.getNodeMessages);
    const setNodeMessages = useRuntimeStore((state) => state.setNodeMessages);
    
    const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [source, setSource] = useState<'api' | 'localStorage' | 'none'>('none');
    const previousStableWorkspaceIdentityRef = useRef<string | null>(null);
    const {
        sessionReadyForWorkspaceHydration,
        awaitingStableAuthenticatedSession,
        stableWorkspaceIdentity
    } = getWorkspaceSessionGateState({
        isAuthenticated,
        accessToken,
        sessionStatus,
        userId: user?.id ?? null,
        authLoading
    });

    /**
     * Hydrate workspace based on auth state
     * ⭐ ÉTAPE 2.2: Wipe stores on auth state change
     */
    const hydrate = useCallback(async () => {
        // Wait for auth to finish loading
        if (authLoading) {
            return;
        }

        if (awaitingStableAuthenticatedSession) {
            setIsLoading(true);
            setError(null);
            return;
        }

        setIsLoading(true);
        setError(null);

        // ⭐ ÉTAPE 2.2: Wipe stores only when the stable workspace owner changes
        const identityChanged = previousStableWorkspaceIdentityRef.current !== null
            && previousStableWorkspaceIdentityRef.current !== stableWorkspaceIdentity;
        if (identityChanged) {
            console.log('[useWorkspaceHydration] ⭐ Auth state changed - Wiping stores to prevent data leak');
            designStoreReset();
            runtimeStoreReset();
            workflowStoreReset();
        }

        previousStableWorkspaceIdentityRef.current = stableWorkspaceIdentity;

        try {
            if (sessionReadyForWorkspaceHydration && accessToken) {
                // Authenticated mode: fetch from API
                console.log('[useWorkspaceHydration] Hydrating from API...');
                const data = await fetchWorkspaceFromAPI(accessToken);
                setWorkspace(data);
                setSource('api');
                
                // ⭐ ÉTAPE 2.3: Hydrate design store with server data
                // Note: Backend now returns configuration_json ALREADY reconstructed via transformAgentInstanceForFrontend
                
                // ⭐ FIX QA: Pre-process agentInstances to create proper objects
                const hydratedInstances = data.agentInstances.map((inst: any) => ({
                    id: inst.id,
                    prototypeId: inst.prototypeId || inst.agentId || inst.id,
                    name: inst.name,
                    position: inst.position,
                    workflowId: inst.workflowId,
                    // Propriétés UI obligatoires
                    isMinimized: inst.isMinimized ?? false,
                    isMaximized: inst.isMaximized ?? false,
                    // ⭐ FIX QA: Include persistenceConfig for media storage options
                    persistenceConfig: inst.persistenceConfig || {
                        saveChat: true,
                        saveErrors: true,
                        saveHistorySummary: false,
                        saveLinks: false,
                        saveTasks: false,
                        saveMedia: false,
                        mediaStorage: 'db'
                    },
                    // ⭐ CRITICAL FIX #5: Use configuration_json from backend (NO reconstruction needed!)
                    // Backend now returns BOTH individual fields AND reconstructed configuration_json object
                    // This includes all capabilities, historyConfig, outputConfig, etc.
                    configuration_json: inst.configuration_json || {
                        role: inst.role || 'assistant',
                        model: inst.llmModel || inst.model || 'gpt-4o-mini',
                        llmProvider: inst.llmProvider || 'openai',
                        systemPrompt: inst.systemPrompt || '',
                        capabilities: inst.capabilities || [],
                        tools: inst.tools || [],
                        historyConfig: inst.historyConfig || {},
                        outputConfig: inst.outputConfig || {},
                        position: inst.position || { x: 0, y: 0 }
                    },
                    // ⭐ NOUVEAU ÉTAPE 1.6 (champs optionnels pour le runtime)
                    executionId: inst.executionId,
                    status: inst.status,
                    metrics: inst.metrics
                })) as AgentInstance[];
                
                // ⭐ FIX QA: Create nodes directly from agentInstances with proper data
                // This ensures each node has agentInstance reference for media buttons to work
                const hydratedNodes = hydratedInstances.map((inst: AgentInstance) => {
                    // Create a minimal Agent object from instance configuration
                    const agent: any = {
                        id: inst.prototypeId || inst.id,
                        name: inst.name,
                        role: inst.configuration_json?.role || 'assistant',
                        systemPrompt: inst.configuration_json?.systemPrompt || '',
                        llmProvider: inst.configuration_json?.llmProvider || 'openai',
                        model: inst.configuration_json?.model || 'gpt-4o-mini',
                        capabilities: inst.configuration_json?.capabilities || [],
                        tools: inst.configuration_json?.tools || [],
                        historyConfig: inst.configuration_json?.historyConfig,
                        outputConfig: inst.configuration_json?.outputConfig
                    };
                    
                    return {
                        id: inst.id, // Node ID = Instance ID
                        type: 'agent' as const,
                        position: inst.position || { x: 0, y: 0 },
                        data: {
                            robotId: 'AR_001', // Default to Archi
                            label: inst.name,
                            agent, // Reconstructed agent from instance config
                            agentInstance: inst, // ⭐ FIX QA: Include full instance for media buttons
                            workflowId: inst.workflowId,
                            isMinimized: inst.isMinimized ?? false,
                            isMaximized: inst.isMaximized ?? false
                        }
                    };
                }) as V2WorkflowNode[];
                
                designStoreHydrate({
                    agentInstances: hydratedInstances,
                    nodes: hydratedNodes,
                    edges: data.edges.map((e: any) => ({
                        id: e.id,
                        source: e.sourceId || e.source,
                        target: e.targetId || e.target,
                        type: e.type
                    })) as V2WorkflowEdge[]
                });

                if (data.workflow) {
                    workflowStoreHydrate({
                        id: data.workflow.id,
                        name: data.workflow.name,
                        description: data.workflow.description,
                        isActive: data.workflow.isActive,
                        isDefault: data.workflow.isDefault,
                        canvasState: data.workflow.canvasState,
                    });
                }
                
                // ⭐ FIX QA: Hydrate chat messages with images into RuntimeStore
                // Backend now returns chatMessages for each instance
                for (const inst of data.agentInstances) {
                    if (inst.chatMessages && inst.chatMessages.length > 0) {
                        const persistedMessages = mapPersistedChatMessages(inst.chatMessages);
                        const messages = mergePersistedAndRuntimeMessages(persistedMessages, getNodeMessages(inst.id));
                        setNodeMessages(inst.id, messages);
                        console.log(`[useWorkspaceHydration] ✅ Restored ${persistedMessages.length} chat messages for instance ${inst.id}`);
                    }
                }
                
                console.log('[useWorkspaceHydration] API hydration complete:', {
                    hasWorkspace: !!data.workspaceContext,
                    hasWorkflow: !!data.workflow,
                    nodesCount: data.nodes.length,
                    llmConfigsCount: data.llmConfigs.length,
                    canvasState: data.workflow?.canvasState
                });
            } else {
                // Guest mode: load from localStorage
                console.log('[useWorkspaceHydration] Hydrating from localStorage...');
                const data = loadWorkspaceFromLocalStorage();
                setWorkspace(data);
                setSource('localStorage');
                console.log('[useWorkspaceHydration] localStorage hydration complete:', {
                    hasWorkflow: !!data.workflow,
                    nodesCount: data.nodes.length
                });
            }
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : 'Hydration failed';
            console.error('[useWorkspaceHydration] Error:', errorMsg);
            setError(errorMsg);
            
            // Fallback to empty workspace
            setWorkspace({
                workflow: null,
                nodes: [],
                edges: [],
                agentInstances: [],
                llmConfigs: [],
                toolRuns: [],
                userSettings: { language: 'fr', theme: 'dark' },
                metadata: {
                    loadedAt: new Date(),
                    userId: isAuthenticated ? 'error' : 'guest',
                    hasWorkflow: false,
                    source: isAuthenticated ? 'api' : 'localStorage'
                }
            });
        } finally {
            setIsLoading(false);
        }
    }, [accessToken, authLoading, awaitingStableAuthenticatedSession, designStoreHydrate, designStoreReset, getNodeMessages, runtimeStoreReset, sessionReadyForWorkspaceHydration, setNodeMessages, stableWorkspaceIdentity, workflowStoreHydrate, workflowStoreReset]);

    /**
     * Auto-hydrate on mount and auth changes
     */
    useEffect(() => {
        hydrate();
    }, [hydrate]);

    /**
     * Manual refetch function
     */
    const refetch = useCallback(async () => {
        await hydrate();
    }, [hydrate]);

    return {
        workspace,
        isLoading: isLoading || authLoading,
        error,
        refetch,
        source
    };
};

export default useWorkspaceHydration;
