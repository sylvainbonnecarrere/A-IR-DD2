/**
 * @file guestDataUtils.ts
 * @description Utilities for managing guest mode volatile data
 * @domain Design Domain - Data Lifecycle Management
 * 
 * ARCHITECTURE:
 * - Centralized guest localStorage key management
 * - Wipe function for login transition (localStorage + Zustand stores)
 * - Safe operations with error handling
 * 
 * SOLID PRINCIPLES:
 * - S: Single responsibility (guest data cleanup only)
 * - O: Open for extension (add new keys easily)
 * - D: Dependency inversion (no external dependencies)
 * 
 * NON-RÉGRESSION:
 * - Guest mode still works (keys untouched until login)
 * - Only clears guest-specific keys
 * - Auth keys preserved
 * 
 * ⚠️ CRITICAL SECURITY:
 * - wipeGuestData() MUST clear both localStorage AND Zustand stores
 * - Prevents data leak from guest session to authenticated session
 */

import { useDesignStore } from '../stores/useDesignStore';
import { useWorkflowStore } from '../stores/useWorkflowStore';
import { useRuntimeStore } from '../stores/useRuntimeStore';

/**
 * Guest mode localStorage keys
 * All keys that should be cleared on login
 */
export const GUEST_STORAGE_KEYS = {
    // Workflow data
    workflow: 'guest_workflow_v1',
    workflowNodes: 'guest_workflow_nodes_v1',
    workflowEdges: 'guest_workflow_edges_v1',
    canvasState: 'guest_canvas_state_v1', // ⭐ ÉTAPE 2: Canvas zoom/pan state
    
    // Agent data
    agentInstances: 'guest_agent_instances_v1',
    
    // LLM configs (API keys in plain text for guest)
    llmConfigs: 'llm_configs_guest',
    llmConfigsLegacy: 'llmAgentWorkflow_configs', // ← J4.4: Old key from App.tsx - must also be wiped!

    // Local LLM profiles (multiple local server configs)
    localLLMProfiles: 'local_llm_profiles_v1',
    
    // User settings
    userSettings: 'user_settings_guest',
    
    // Legacy keys (for backward compatibility cleanup)
    legacySettings: 'settings',
    legacyWorkflow: 'workflow',
    
    // ⭐ Uppercase aliases for backward compatibility
    WORKFLOW: 'guest_workflow_v1',
    WORKFLOW_NODES: 'guest_workflow_nodes_v1',
    WORKFLOW_EDGES: 'guest_workflow_edges_v1',
    AGENT_INSTANCES: 'guest_agent_instances_v1',
    LLM_CONFIGS: 'llm_configs_guest',
    LLM_CONFIGS_LEGACY: 'llmAgentWorkflow_configs',
    USER_SETTINGS: 'user_settings_guest',
    LEGACY_SETTINGS: 'settings',
    LEGACY_WORKFLOW: 'workflow',
    LOCAL_LLM_PROFILES: 'local_llm_profiles_v1',
} as const;

/**
 * Get all guest storage keys as array
 */
export const getAllGuestKeys = (): string[] => {
    return Object.values(GUEST_STORAGE_KEYS);
};

/**
 * Wipe all guest mode volatile data from localStorage AND Zustand stores
 * Called on login to prevent data leak from guest to auth session
 * 
 * ⚠️ CRITICAL SECURITY FIX:
 * - Clears localStorage (persistent data)
 * - Resets Zustand stores (in-memory state)
 * - Prevents guest agents/workflows from appearing in auth session
 * 
 * @returns Object with cleanup statistics
 */
export const wipeGuestData = (): { 
    keysCleared: string[]; 
    storesReset: string[];
    errors: string[];
    success: boolean;
} => {
    const keysCleared: string[] = [];
    const storesReset: string[] = [];
    const errors: string[] = [];

    const keysToWipe = getAllGuestKeys();

    // 1. Wipe localStorage
    for (const key of keysToWipe) {
        try {
            if (localStorage.getItem(key) !== null) {
                localStorage.removeItem(key);
                keysCleared.push(key);
            }
        } catch (err) {
            const errorMsg = `Failed to clear ${key}: ${err instanceof Error ? err.message : 'Unknown error'}`;
            errors.push(errorMsg);
            console.error(`[GuestDataUtils] ❌ ${errorMsg}`);
        }
    }

    // 2. ⭐ CRITICAL: Reset Zustand stores (in-memory state)
    try {
        // Reset Design Store (agents, instances, nodes, edges)
        const designStore = useDesignStore.getState();
        if (typeof designStore.resetAll === 'function') {
            designStore.resetAll();
            storesReset.push('useDesignStore');
        }
    } catch (err) {
        const errorMsg = `Failed to reset useDesignStore: ${err instanceof Error ? err.message : 'Unknown error'}`;
        errors.push(errorMsg);
        console.error(`[GuestDataUtils] ❌ ${errorMsg}`);
    }

    try {
        // Reset Workflow Store (workflow metadata, execution state)
        const workflowStore = useWorkflowStore.getState();
        if (typeof workflowStore.resetAll === 'function') {
            workflowStore.resetAll();
            storesReset.push('useWorkflowStore');
        }
    } catch (err) {
        const errorMsg = `Failed to reset useWorkflowStore: ${err instanceof Error ? err.message : 'Unknown error'}`;
        errors.push(errorMsg);
        console.error(`[GuestDataUtils] ❌ ${errorMsg}`);
    }

    try {
        // Reset Runtime Store (chat sessions, streaming state)
        const runtimeStore = useRuntimeStore.getState();
        if (typeof runtimeStore.resetAll === 'function') {
            runtimeStore.resetAll();
            storesReset.push('useRuntimeStore');
        }
    } catch (err) {
        const errorMsg = `Failed to reset useRuntimeStore: ${err instanceof Error ? err.message : 'Unknown error'}`;
        errors.push(errorMsg);
        console.error(`[GuestDataUtils] ❌ ${errorMsg}`);
    }

    const success = errors.length === 0;

    return { keysCleared, storesReset, errors, success };
};

/**
 * Check if guest data exists in localStorage
 * Useful for prompting user before login (optional migration)
 * 
 * @returns Object describing what guest data exists
 */
export const checkGuestDataExists = (): {
    hasWorkflow: boolean;
    hasLLMConfigs: boolean;
    hasSettings: boolean;
    totalKeys: number;
} => {
    const hasWorkflow = localStorage.getItem(GUEST_STORAGE_KEYS.WORKFLOW) !== null ||
                       localStorage.getItem(GUEST_STORAGE_KEYS.WORKFLOW_NODES) !== null;
    
    const hasLLMConfigs = localStorage.getItem(GUEST_STORAGE_KEYS.LLM_CONFIGS) !== null;
    
    const hasSettings = localStorage.getItem(GUEST_STORAGE_KEYS.USER_SETTINGS) !== null;

    let totalKeys = 0;
    for (const key of getAllGuestKeys()) {
        if (localStorage.getItem(key) !== null) {
            totalKeys++;
        }
    }

    return {
        hasWorkflow,
        hasLLMConfigs,
        hasSettings,
        totalKeys
    };
};

/**
 * Get guest LLM configs (for potential migration to auth)
 * Returns null if no guest configs exist
 * 
 * @returns Parsed guest LLM configs or null
 */
export const getGuestLLMConfigs = (): Record<string, any> | null => {
    try {
        const stored = localStorage.getItem(GUEST_STORAGE_KEYS.LLM_CONFIGS);
        if (!stored) return null;
        return JSON.parse(stored);
    } catch (err) {
        console.error('[GuestDataUtils] Failed to parse guest LLM configs:', err);
        return null;
    }
};

export default {
    GUEST_STORAGE_KEYS,
    getAllGuestKeys,
    wipeGuestData,
    checkGuestDataExists,
    getGuestLLMConfigs
};
