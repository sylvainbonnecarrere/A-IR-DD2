/**
 * @file useWorkflowPersistence.ts
 * @description Hook unifié pour la persistance du workflow (auto/manuel)
 * @domain Design Domain - Persistence Logic
 * 
 * RÈGLE 4.5 Dev_rules.md - 5 PILIERS:
 * 1. Stratégie de Déclenchement: Debounce 2000ms
 * 2. Structure Store: flag isDirty + lastSynced
 * 3. Optimisation MongoDB: PATCH ciblés, pas de full JSON
 * 4. Optimistic UI: État "Enregistré" immédiat, rollback si erreur
 * 5. Résultats Agents: Buffer streaming, sauvegarde à la fin
 * 
 * MODES:
 * - Manual: Sauvegarde via bouton + Ctrl+S
 * - Auto: Sauvegarde debounced après modifications
 * 
 * SOLID PRINCIPLES:
 * - S: Single responsibility (persistence orchestration)
 * - O: Open for extension (add new save targets)
 * - D: Dependency inversion (abstracts storage backend)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from './useAuth';
import { useSaveModeStore } from '../stores/useSaveModeStore';
import { useDesignStore } from '../stores/useDesignStore';
import { PersistenceService } from '../services/persistenceService';
import { API_BASE_URL } from '../config/api.config';

// ============================================
// CONFIGURATION
// ============================================

/** Debounce delay for auto-save (ms) - Règle 4.5.1 */
const AUTO_SAVE_DEBOUNCE_MS = 2000;

/** Minimum interval between saves to prevent spam */
const MIN_SAVE_INTERVAL_MS = 1000;

/** Buffer interval for streaming agent results */
const AGENT_RESULT_BUFFER_MS = 10000;

// ============================================
// TYPES
// ============================================

export type PersistenceStatus = 
    | 'idle'           // No changes pending
    | 'dirty'          // Changes pending, not yet saved
    | 'saving'         // Save in progress
    | 'saved'          // Successfully saved
    | 'error'          // Save failed
    | 'offline';       // No network connection

export interface PersistenceState {
    status: PersistenceStatus;
    isDirty: boolean;
    lastSynced: Date | null;
    lastError: string | null;
    pendingChanges: number;
    version: number;  // For conflict detection (MongoDB __v)
}

export interface WorkflowPersistenceOptions {
    workflowId: string;
    workflowName?: string;
    canvasState?: {
        zoom: number;
        panX: number;
        panY: number;
    };
}

export interface UseWorkflowPersistenceResult {
    // State
    persistenceState: PersistenceState;
    
    // Actions
    saveNow: () => Promise<boolean>;
    markDirty: () => void;
    resetDirty: () => void;
    
    // Optimistic Update helpers
    withOptimisticUpdate: <T>(
        optimisticFn: () => T,
        saveFn: () => Promise<boolean>,
        rollbackFn: (previousValue: T) => void
    ) => Promise<boolean>;
    
    // Partial update for specific fields (PATCH)
    savePartial: (updates: Partial<{
        name: string;
        description: string;
        canvasState: { zoom: number; panX: number; panY: number };
        nodePositions: Array<{ id: string; x: number; y: number }>;
    }>) => Promise<boolean>;
    
    // Agent streaming result buffer
    bufferAgentResult: (instanceId: string, result: any) => void;
    flushAgentResults: () => Promise<void>;
}

// ============================================
// HOOK IMPLEMENTATION
// ============================================

export function useWorkflowPersistence(
    options: WorkflowPersistenceOptions
): UseWorkflowPersistenceResult {
    const { isAuthenticated, accessToken } = useAuth();
    const { saveMode } = useSaveModeStore();
    const { nodes, edges } = useDesignStore();
    
    // Internal state
    const [persistenceState, setPersistenceState] = useState<PersistenceState>({
        status: 'idle',
        isDirty: false,
        lastSynced: null,
        lastError: null,
        pendingChanges: 0,
        version: 0
    });
    
    // Refs for debouncing and buffering
    const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
    const lastSaveTimeRef = useRef<number>(0);
    const agentResultBufferRef = useRef<Map<string, any[]>>(new Map());
    const bufferFlushTimerRef = useRef<NodeJS.Timeout | null>(null);
    const previousStateRef = useRef<any>(null);
    
    // ============================================
    // CORE SAVE FUNCTION
    // ============================================
    
    const performSave = useCallback(async (): Promise<boolean> => {
        // Prevent spam saves
        const now = Date.now();
        if (now - lastSaveTimeRef.current < MIN_SAVE_INTERVAL_MS) {
            console.log('[useWorkflowPersistence] Save throttled, too soon');
            return false;
        }
        
        if (!options.workflowId) {
            console.warn('[useWorkflowPersistence] No workflowId provided');
            return false;
        }
        
        // Update state to saving
        setPersistenceState(prev => ({
            ...prev,
            status: 'saving'
        }));
        
        try {
            const result = await PersistenceService.saveWorkflow(
                {
                    id: options.workflowId,
                    name: options.workflowName,
                    canvasState: options.canvasState,
                    nodes: nodes.map(n => ({
                        id: n.id,
                        type: n.type || 'agent',
                        position: n.position,
                        data: n.data as Record<string, any>
                    })),
                    edges: edges.map(e => ({
                        id: e.id,
                        source: e.source,
                        target: e.target,
                        type: e.type
                    }))
                },
                {
                    isAuthenticated,
                    accessToken: accessToken || undefined
                }
            );
            
            if (result.success) {
                lastSaveTimeRef.current = now;
                setPersistenceState(prev => ({
                    ...prev,
                    status: 'saved',
                    isDirty: false,
                    lastSynced: new Date(),
                    lastError: null,
                    pendingChanges: 0,
                    version: prev.version + 1
                }));
                
                // Reset to idle after showing success
                setTimeout(() => {
                    setPersistenceState(prev => 
                        prev.status === 'saved' ? { ...prev, status: 'idle' } : prev
                    );
                }, 2000);
                
                return true;
            } else {
                throw new Error(result.error || 'Save failed');
            }
            
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : 'Unknown error';
            console.error('[useWorkflowPersistence] Save error:', errorMsg);
            
            setPersistenceState(prev => ({
                ...prev,
                status: 'error',
                lastError: errorMsg
            }));
            
            // Reset to dirty after showing error
            setTimeout(() => {
                setPersistenceState(prev => 
                    prev.status === 'error' ? { ...prev, status: 'dirty' } : prev
                );
            }, 3000);
            
            return false;
        }
    }, [options, nodes, edges, isAuthenticated, accessToken]);
    
    // ============================================
    // PARTIAL SAVE (PATCH) - Règle 4.5.3
    // ============================================
    
    const savePartial = useCallback(async (
        updates: Partial<{
            name: string;
            description: string;
            canvasState: { zoom: number; panX: number; panY: number };
            nodePositions: Array<{ id: string; x: number; y: number }>;
        }>
    ): Promise<boolean> => {
        if (!isAuthenticated || !accessToken || !options.workflowId) {
            // Guest mode: fall back to full save
            return performSave();
        }
        
        setPersistenceState(prev => ({ ...prev, status: 'saving' }));
        
        try {
            // Build MongoDB-style $set updates
            const mongoUpdates: Record<string, any> = {};
            
            if (updates.name) mongoUpdates['name'] = updates.name;
            if (updates.description) mongoUpdates['description'] = updates.description;
            if (updates.canvasState) mongoUpdates['canvasState'] = updates.canvasState;
            
            // Node positions as targeted updates
            if (updates.nodePositions) {
                updates.nodePositions.forEach(np => {
                    mongoUpdates[`nodePositions.${np.id}`] = { x: np.x, y: np.y };
                });
            }
            
            const response = await fetch(
                `${API_BASE_URL}/api/workflows/${options.workflowId}/patch`,
                {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${accessToken}`
                    },
                    body: JSON.stringify({
                        $set: mongoUpdates,
                        expectedVersion: persistenceState.version
                    })
                }
            );
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                
                // Handle version conflict
                if (response.status === 409) {
                    throw new Error('Version conflict - please refresh');
                }
                
                throw new Error(errorData.message || `HTTP ${response.status}`);
            }
            
            const result = await response.json();
            
            setPersistenceState(prev => ({
                ...prev,
                status: 'saved',
                isDirty: false,
                lastSynced: new Date(),
                version: result.version || prev.version + 1
            }));
            
            setTimeout(() => {
                setPersistenceState(prev => 
                    prev.status === 'saved' ? { ...prev, status: 'idle' } : prev
                );
            }, 1500);
            
            return true;
            
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : 'Unknown error';
            setPersistenceState(prev => ({
                ...prev,
                status: 'error',
                lastError: errorMsg
            }));
            return false;
        }
    }, [isAuthenticated, accessToken, options.workflowId, persistenceState.version, performSave]);
    
    // ============================================
    // DIRTY STATE MANAGEMENT - Règle 4.5.2
    // ============================================
    
    const markDirty = useCallback(() => {
        setPersistenceState(prev => ({
            ...prev,
            isDirty: true,
            status: prev.status === 'idle' || prev.status === 'saved' ? 'dirty' : prev.status,
            pendingChanges: prev.pendingChanges + 1
        }));
    }, []);
    
    const resetDirty = useCallback(() => {
        setPersistenceState(prev => ({
            ...prev,
            isDirty: false,
            status: 'idle',
            pendingChanges: 0
        }));
    }, []);
    
    // ============================================
    // OPTIMISTIC UPDATE - Règle 4.5.4
    // ============================================
    
    const withOptimisticUpdate = useCallback(async <T,>(
        optimisticFn: () => T,
        saveFn: () => Promise<boolean>,
        rollbackFn: (previousValue: T) => void
    ): Promise<boolean> => {
        // Store previous state for rollback
        const previousValue = optimisticFn();
        previousStateRef.current = previousValue;
        
        // Optimistically update UI
        setPersistenceState(prev => ({ ...prev, status: 'saving', isDirty: false }));
        
        try {
            const success = await saveFn();
            
            if (!success) {
                // Rollback on failure
                rollbackFn(previousValue);
                setPersistenceState(prev => ({ ...prev, status: 'error', isDirty: true }));
                return false;
            }
            
            setPersistenceState(prev => ({
                ...prev,
                status: 'saved',
                lastSynced: new Date()
            }));
            
            return true;
            
        } catch (err) {
            // Rollback on error
            rollbackFn(previousValue);
            setPersistenceState(prev => ({
                ...prev,
                status: 'error',
                isDirty: true,
                lastError: err instanceof Error ? err.message : 'Unknown error'
            }));
            return false;
        }
    }, []);
    
    // ============================================
    // AGENT RESULT BUFFERING - Règle 4.5.5
    // ============================================
    
    const bufferAgentResult = useCallback((instanceId: string, result: any) => {
        const buffer = agentResultBufferRef.current;
        
        if (!buffer.has(instanceId)) {
            buffer.set(instanceId, []);
        }
        buffer.get(instanceId)!.push(result);
        
        // Reset flush timer
        if (bufferFlushTimerRef.current) {
            clearTimeout(bufferFlushTimerRef.current);
        }
        
        // Schedule flush after buffer interval
        bufferFlushTimerRef.current = setTimeout(() => {
            flushAgentResults();
        }, AGENT_RESULT_BUFFER_MS);
    }, []);
    
    const flushAgentResults = useCallback(async () => {
        const buffer = agentResultBufferRef.current;
        
        if (buffer.size === 0) return;
        
        // Clear the timer
        if (bufferFlushTimerRef.current) {
            clearTimeout(bufferFlushTimerRef.current);
            bufferFlushTimerRef.current = null;
        }
        
        // Flush each instance's results
        for (const [instanceId, results] of buffer.entries()) {
            if (results.length === 0) continue;
            
            try {
                // Batch save all buffered results for this instance
                for (const result of results) {
                    await PersistenceService.addAgentInstanceContent(
                        instanceId,
                        result,
                        { isAuthenticated, accessToken: accessToken || undefined }
                    );
                }
                
                console.log(`[useWorkflowPersistence] Flushed ${results.length} results for ${instanceId}`);
            } catch (err) {
                console.error(`[useWorkflowPersistence] Failed to flush results for ${instanceId}:`, err);
            }
        }
        
        // Clear buffer
        buffer.clear();
    }, [isAuthenticated, accessToken]);
    
    // ============================================
    // DEBOUNCED AUTO-SAVE - Règle 4.5.1
    // ============================================
    
    const debouncedSave = useCallback(() => {
        // Clear existing timer
        if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
        }
        
        // Set new timer
        debounceTimerRef.current = setTimeout(() => {
            if (persistenceState.isDirty) {
                performSave();
            }
        }, AUTO_SAVE_DEBOUNCE_MS);
    }, [performSave, persistenceState.isDirty]);
    
    // Auto-save effect (only in auto mode for authenticated users)
    useEffect(() => {
        if (
            saveMode === 'auto' && 
            isAuthenticated && 
            persistenceState.isDirty &&
            persistenceState.status !== 'saving'
        ) {
            debouncedSave();
        }
        
        return () => {
            if (debounceTimerRef.current) {
                clearTimeout(debounceTimerRef.current);
            }
        };
    }, [saveMode, isAuthenticated, persistenceState.isDirty, persistenceState.status, debouncedSave]);
    
    // Cleanup on unmount
    useEffect(() => {
        return () => {
            // Flush any remaining agent results
            if (agentResultBufferRef.current.size > 0) {
                flushAgentResults();
            }
        };
    }, [flushAgentResults]);
    
    // ============================================
    // PUBLIC API
    // ============================================
    
    return {
        persistenceState,
        saveNow: performSave,
        markDirty,
        resetDirty,
        withOptimisticUpdate,
        savePartial,
        bufferAgentResult,
        flushAgentResults
    };
}

export default useWorkflowPersistence;
