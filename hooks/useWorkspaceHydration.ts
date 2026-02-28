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

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './useAuth';
import { GUEST_STORAGE_KEYS } from '../utils/guestDataUtils';
import { useDesignStore } from '../stores/useDesignStore';
import { useRuntimeStore } from '../stores/useRuntimeStore';
import type { AgentInstance, V2WorkflowNode, V2WorkflowEdge } from '../types';
import { API_BASE_URL } from '../config/api.config';

/**
 * Canvas state for visual reconstruction (ÉTAPE 1.6)
 */
interface CanvasState {
    zoom: number;
    panX: number;
    panY: number;
}

/**
 * Agent instance content types (ÉTAPE 1.6 - polymorphic)
 */
interface AgentInstanceContent {
    type: 'chat' | 'image' | 'video' | 'error';
    [key: string]: any;
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
        content?: AgentInstanceContent[];
        metrics?: AgentInstanceMetrics;
    }>;
    llmConfigs: Array<{
        id: string;
        provider: string;
        enabled: boolean;
        hasApiKey: boolean;
        capabilities: Record<string, boolean>;
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
    const { isAuthenticated, accessToken, isLoading: authLoading } = useAuth();
    
    // ⭐ ÉTAPE 2.2: Access stores for reset & hydration
    const designStoreReset = useDesignStore((state) => state.resetAll);
    const runtimeStoreReset = useRuntimeStore((state) => state.resetAll);
    const designStoreHydrate = useDesignStore((state) => state.hydrateFromServer);
    
    const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [source, setSource] = useState<'api' | 'localStorage' | 'none'>('none');
    const [previousAuthState, setPreviousAuthState] = useState<boolean | null>(null);

    /**
     * Hydrate workspace based on auth state
     * ⭐ ÉTAPE 2.2: Wipe stores on auth state change
     */
    const hydrate = useCallback(async () => {
        // Wait for auth to finish loading
        if (authLoading) {
            return;
        }

        setIsLoading(true);
        setError(null);

        // ⭐ ÉTAPE 2.2: Wipe stores if auth state changed (login or logout)
        const authStateChanged = previousAuthState !== null && previousAuthState !== isAuthenticated;
        if (authStateChanged) {
            console.log('[useWorkspaceHydration] ⭐ Auth state changed - Wiping stores to prevent data leak');
            designStoreReset();
            runtimeStoreReset();
        }
        setPreviousAuthState(isAuthenticated);

        try {
            if (isAuthenticated && accessToken) {
                // Authenticated mode: fetch from API
                console.log('[useWorkspaceHydration] Hydrating from API...');
                const data = await fetchWorkspaceFromAPI(accessToken);
                setWorkspace(data);
                setSource('api');
                
                // ⭐ ÉTAPE 2.3: Hydrate design store with server data
                // Note: Backend now returns configuration_json ALREADY reconstructed via transformAgentInstanceForFrontend
                designStoreHydrate({
                    // Agents instances deviennent les nodes du store
                    agentInstances: data.agentInstances.map((inst: any) => ({
                        id: inst.id,
                        prototypeId: inst.prototypeId || inst.agentId || inst.id,
                        name: inst.name,
                        position: inst.position,
                        // Propriétés UI obligatoires
                        isMinimized: inst.isMinimized ?? false,
                        isMaximized: inst.isMaximized ?? false,
                        // ⭐ CRITICAL FIX #5: Use configuration_json from backend (NO reconstruction needed!)
                        // Backend now returns BOTH individual fields AND reconstructed configuration_json object
                        // This includes all capabilities, historyConfig, outputConfig, etc.
                        configuration_json: inst.configuration_json || {
                            role: 'assistant',
                            model: 'gpt-4o-mini',
                            llmProvider: 'openai',
                            systemPrompt: '',
                            capabilities: [],
                            tools: [],
                            historyConfig: {},
                            outputConfig: {},
                            position: inst.position || { x: 0, y: 0 }
                        },
                        // ⭐ NOUVEAU ÉTAPE 1.6 (champs optionnels pour le runtime)
                        executionId: inst.executionId,
                        status: inst.status,
                        content: inst.content || [],
                        metrics: inst.metrics
                    })) as AgentInstance[],
                    nodes: data.nodes.map((n: any) => ({
                        id: n.id,
                        type: (n.type || 'agent') as 'agent' | 'connection' | 'event' | 'file',
                        position: n.position,
                        data: { 
                            robotId: n.robotId || n.data?.robotId,
                            label: n.agentName || n.data?.label || '',
                            agentInstance: n.agentInstance,
                            isMinimized: n.isMinimized ?? false,
                            isMaximized: n.isMaximized ?? false
                        }
                    })) as V2WorkflowNode[],
                    edges: data.edges.map((e: any) => ({
                        id: e.id,
                        source: e.sourceId || e.source,
                        target: e.targetId || e.target,
                        type: e.type
                    })) as V2WorkflowEdge[]
                });
                
                console.log('[useWorkspaceHydration] API hydration complete:', {
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
    }, [isAuthenticated, accessToken, authLoading, previousAuthState, designStoreReset, runtimeStoreReset, designStoreHydrate]);

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
