/**
 * @file useAutoSave.ts
 * @description Hook pour la sauvegarde automatique du workflow avec debounce
 * @domain Design Domain - Persistence Logic
 * 
 * ⭐ PLAN_DE_PERSISTENCE: Mode Automatique
 * 
 * ARCHITECTURE:
 * - Surveille les changements de nodes/edges dans le DesignStore
 * - Debounce de 2000ms pour éviter les sauvegardes trop fréquentes
 * - Indicateur d'état (idle/saving/saved/error)
 * - Respect du saveMode (auto vs manual)
 * 
 * SOLID PRINCIPLES:
 * - S: Single responsibility - Uniquement la sauvegarde auto
 * - O: Open for extension via callbacks
 * - D: Dépend des abstractions (PersistenceService, stores)
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { useDesignStore } from '../stores/useDesignStore';
import { useSaveModeStore } from '../stores/useSaveModeStore';
import { useWorkflowStore } from '../stores/useWorkflowStore';
import { useAuth } from '../contexts/AuthContext';
import { PersistenceService } from '../services/persistenceService';

export type AutoSaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

const INVALID_WORKFLOW_IDS = new Set([
  'default-workflow',
  'new-workflow',
  'temp-workflow',
  'placeholder',
  ''
]);

function isValidWorkflowId(workflowId: string | null | undefined): workflowId is string {
  return !!workflowId && !INVALID_WORKFLOW_IDS.has(workflowId.toLowerCase()) && /^[a-f\d]{24}$/i.test(workflowId);
}

interface UseAutoSaveOptions {
  /** Debounce delay in ms (default: 2000) */
  debounceMs?: number;
  /** Callback when save starts */
  onSaveStart?: () => void;
  /** Callback when save completes */
  onSaveComplete?: (success: boolean) => void;
  /** Workflow ID to save */
  workflowId: string;
  /** Workflow name */
  workflowName?: string;
  /** Canvas state */
  canvasState?: { zoom: number; panX: number; panY: number };
}

interface UseAutoSaveReturn {
  /** Current auto-save status */
  status: AutoSaveStatus;
  /** Last saved timestamp */
  lastSavedAt: Date | null;
  /** Last error message */
  error: string | null;
  /** Manually trigger save (bypasses debounce) */
  saveNow: () => Promise<void>;
  /** Is auto-save enabled (based on saveMode) */
  isEnabled: boolean;
}

export function useAutoSave(options: UseAutoSaveOptions): UseAutoSaveReturn {
  const {
    debounceMs = 2000,
    onSaveStart,
    onSaveComplete,
    workflowId,
    workflowName,
    canvasState
  } = options;

  const [status, setStatus] = useState<AutoSaveStatus>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { isAuthenticated, accessToken } = useAuth();
  const { nodes, edges } = useDesignStore();
  const { isAutoSave } = useSaveModeStore();
  const { getCurrentWorkflowId } = useWorkflowStore();

  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const prevNodesRef = useRef<string>('');
  const prevEdgesRef = useRef<string>('');
  const isSavingRef = useRef(false);

  // Is auto-save enabled?
  const isEnabled = isAuthenticated && isAutoSave();

  /**
   * Perform the actual save operation
   */
  const performSave = useCallback(async () => {
    // Prevent concurrent saves
    if (isSavingRef.current) return;
    
    // Only save if authenticated and auto-save enabled
    if (!isAuthenticated || !accessToken) return;

    const currentWorkflowId = getCurrentWorkflowId();
    const effectiveWorkflowId = workflowId || currentWorkflowId;
    if (!isValidWorkflowId(effectiveWorkflowId)) {
      return;
    }

    isSavingRef.current = true;
    setStatus('saving');
    setError(null);
    onSaveStart?.();

    try {
      const result = await PersistenceService.saveWorkflow(
        {
          id: effectiveWorkflowId,
          name: workflowName,
          canvasState,
          nodes: nodes.map(n => ({
            id: n.id,
            type: n.type,
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
        setStatus('saved');
        setLastSavedAt(new Date());
        setError(null);
        console.log('[useAutoSave] ✅ Auto-save successful');
        
        // Reset status after 3 seconds
        setTimeout(() => {
          if (!isSavingRef.current) {
            setStatus('idle');
          }
        }, 3000);
        
        onSaveComplete?.(true);
      } else {
        setStatus('error');
        setError(result.error || 'Unknown error');
        console.error('[useAutoSave] ❌ Auto-save failed:', result.error);
        onSaveComplete?.(false);
      }
    } catch (err) {
      setStatus('error');
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      setError(errMsg);
      console.error('[useAutoSave] ❌ Auto-save error:', errMsg);
      onSaveComplete?.(false);
    } finally {
      isSavingRef.current = false;
    }
  }, [
    isAuthenticated,
    accessToken,
    workflowId,
    getCurrentWorkflowId,
    workflowName,
    canvasState,
    nodes,
    edges,
    onSaveStart,
    onSaveComplete
  ]);

  /**
   * Manually trigger save (bypasses debounce)
   */
  const saveNow = useCallback(async () => {
    // Clear any pending debounce
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    await performSave();
  }, [performSave]);

  /**
   * Debounced save trigger
   */
  const scheduleAutoSave = useCallback(() => {
    if (!isEnabled) return;

    // Clear existing timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Set pending status immediately
    setStatus('pending');

    // Schedule new save
    debounceTimerRef.current = setTimeout(() => {
      performSave();
    }, debounceMs);
  }, [isEnabled, debounceMs, performSave]);

  /**
   * Watch for changes in nodes and edges
   */
  useEffect(() => {
    // Skip if not enabled
    if (!isEnabled) return;

    // Serialize current state for comparison
    const nodesHash = JSON.stringify(nodes.map(n => ({ id: n.id, position: n.position })));
    const edgesHash = JSON.stringify(edges.map(e => ({ id: e.id, source: e.source, target: e.target })));

    // Check if state actually changed
    const nodesChanged = nodesHash !== prevNodesRef.current;
    const edgesChanged = edgesHash !== prevEdgesRef.current;

    if (nodesChanged || edgesChanged) {
      prevNodesRef.current = nodesHash;
      prevEdgesRef.current = edgesHash;
      
      // Only trigger if we had previous state (skip initial render)
      if (prevNodesRef.current && prevEdgesRef.current) {
        console.log('[useAutoSave] 📝 Changes detected, scheduling auto-save...');
        scheduleAutoSave();
      }
    }
  }, [nodes, edges, isEnabled, scheduleAutoSave]);

  /**
   * Cleanup on unmount
   */
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  /**
   * Reset refs when auth changes
   */
  useEffect(() => {
    prevNodesRef.current = '';
    prevEdgesRef.current = '';
    setStatus('idle');
    setError(null);
  }, [isAuthenticated]);

  return {
    status,
    lastSavedAt,
    error,
    saveNow,
    isEnabled
  };
}

export default useAutoSave;
