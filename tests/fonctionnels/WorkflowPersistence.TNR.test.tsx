/**
 * @file WorkflowPersistence.TNR.test.tsx
 * @description Test de Non-Régression pour la persistance du workflow
 * @domain Testing - Persistence & Hydration
 * 
 * COUVERTURE:
 * 1. HydrationOverlay - Affichage et disparition
 * 2. useWorkflowPersistence - Debounce et isDirty
 * 3. Store isDirty/lastSynced state
 * 4. Sauvegarde manuelle vs automatique
 * 5. Optimistic UI rollback
 */

import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { renderHook } from '@testing-library/react';

// Mock des modules
jest.mock('../../contexts/AuthContext', () => ({
    useAuth: jest.fn(() => ({
        isAuthenticated: false,
        accessToken: null,
        llmApiKeys: null
    }))
}));

jest.mock('../../stores/useSaveModeStore', () => ({
    useSaveModeStore: jest.fn(() => ({
        saveMode: 'manual'
    }))
}));

jest.mock('../../stores/useDesignStore', () => ({
    useDesignStore: jest.fn(() => ({
        nodes: [],
        edges: []
    }))
}));

jest.mock('../../services/persistenceService', () => ({
    PersistenceService: {
        saveWorkflow: jest.fn().mockResolvedValue({ success: true }),
        addAgentInstanceContent: jest.fn().mockResolvedValue({ success: true })
    }
}));

import { HydrationOverlay } from '../../components/HydrationOverlay';
import { useWorkflowPersistence } from '../../hooks/useWorkflowPersistence';
import { useWorkflowStore } from '../../stores/useWorkflowStore';
import { useAuth } from '../../contexts/AuthContext';
import { useSaveModeStore } from '../../stores/useSaveModeStore';
import { PersistenceService } from '../../services/persistenceService';

describe('HydrationOverlay Component', () => {
    it('should render when isLoading is true', () => {
        render(<HydrationOverlay isLoading={true} />);
        
        expect(screen.getByText('Chargement du workspace...')).toBeInTheDocument();
        expect(screen.getByText('Synchronisation des données en cours')).toBeInTheDocument();
    });

    it('should not render when isLoading is false', () => {
        render(<HydrationOverlay isLoading={false} />);
        
        expect(screen.queryByText('Chargement du workspace...')).not.toBeInTheDocument();
    });

    it('should display custom message', () => {
        render(<HydrationOverlay isLoading={true} message="Loading test..." />);
        
        expect(screen.getByText('Loading test...')).toBeInTheDocument();
    });

    it('should display progress when provided', () => {
        render(<HydrationOverlay isLoading={true} progress={75} />);
        
        expect(screen.getByText('75%')).toBeInTheDocument();
    });

    it('should fade out when isLoading changes to false', async () => {
        const { rerender } = render(<HydrationOverlay isLoading={true} />);
        
        expect(screen.getByText('Chargement du workspace...')).toBeInTheDocument();
        
        rerender(<HydrationOverlay isLoading={false} />);
        
        // Should start fading out
        await waitFor(() => {
            expect(screen.queryByText('Chargement du workspace...')).not.toBeInTheDocument();
        }, { timeout: 1000 });
    });

    it('should call onHidden callback after fade out', async () => {
        const onHidden = jest.fn();
        const { rerender } = render(<HydrationOverlay isLoading={true} onHidden={onHidden} />);
        
        rerender(<HydrationOverlay isLoading={false} onHidden={onHidden} />);
        
        await waitFor(() => {
            expect(onHidden).toHaveBeenCalled();
        }, { timeout: 1000 });
    });

    it('should become visible again immediately when loading restarts', async () => {
        const { rerender } = render(<HydrationOverlay isLoading={true} />);

        rerender(<HydrationOverlay isLoading={false} />);

        await waitFor(() => {
            expect(screen.queryByText('Chargement du workspace...')).not.toBeInTheDocument();
        }, { timeout: 1000 });

        rerender(<HydrationOverlay isLoading={true} />);

        expect(screen.getByText('Chargement du workspace...')).toBeInTheDocument();
    });
});

describe('useWorkflowStore - isDirty/lastSynced', () => {
    beforeEach(() => {
        // Reset store to initial state
        useWorkflowStore.getState().resetAll();
    });

    it('should have initial isDirty = false', () => {
        const state = useWorkflowStore.getState();
        expect(state.isDirty).toBe(false);
    });

    it('should have initial lastSynced = null', () => {
        const state = useWorkflowStore.getState();
        expect(state.lastSynced).toBeNull();
    });

    it('should set isDirty = true when markDirty is called', () => {
        const store = useWorkflowStore.getState();
        store.markDirty('node_update');
        
        const state = useWorkflowStore.getState();
        expect(state.isDirty).toBe(true);
        expect(state.pendingChanges).toContain('node_update');
    });

    it('should reset isDirty and update lastSynced when markClean is called', () => {
        const store = useWorkflowStore.getState();
        store.markDirty('test');
        store.markClean(5);
        
        const state = useWorkflowStore.getState();
        expect(state.isDirty).toBe(false);
        expect(state.lastSynced).toBeInstanceOf(Date);
        expect(state.syncVersion).toBe(5);
        expect(state.pendingChanges).toHaveLength(0);
    });

    it('should return correct sync status', () => {
        const store = useWorkflowStore.getState();
        store.markDirty('change1');
        store.markDirty('change2');
        
        const status = store.getSyncStatus();
        expect(status.isDirty).toBe(true);
        expect(status.pendingCount).toBe(2);
    });

    it('should reset persistence state on resetAll', () => {
        const store = useWorkflowStore.getState();
        store.markDirty('test');
        store.markClean(10);
        store.resetAll();
        
        const state = useWorkflowStore.getState();
        expect(state.isDirty).toBe(false);
        expect(state.lastSynced).toBeNull();
        expect(state.syncVersion).toBe(0);
        expect(state.pendingChanges).toHaveLength(0);
    });
});

describe('useWorkflowPersistence Hook', () => {
    const mockOptions = {
        workflowId: 'test-workflow-123',
        workflowName: 'Test Workflow',
        canvasState: { zoom: 1, panX: 0, panY: 0 }
    };

    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
        
        // Default mocks
        (useAuth as any).mockReturnValue({
            isAuthenticated: false,
            accessToken: null
        });
        (useSaveModeStore as any).mockReturnValue({
            saveMode: 'manual'
        });
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('should have initial idle state', () => {
        const { result } = renderHook(() => useWorkflowPersistence(mockOptions));
        
        expect(result.current.persistenceState.status).toBe('idle');
        expect(result.current.persistenceState.isDirty).toBe(false);
    });

    it('should mark dirty when markDirty is called', () => {
        const { result } = renderHook(() => useWorkflowPersistence(mockOptions));
        
        act(() => {
            result.current.markDirty();
        });
        
        expect(result.current.persistenceState.isDirty).toBe(true);
        expect(result.current.persistenceState.status).toBe('dirty');
    });

    it('should reset dirty state when resetDirty is called', () => {
        const { result } = renderHook(() => useWorkflowPersistence(mockOptions));
        
        act(() => {
            result.current.markDirty();
            result.current.resetDirty();
        });
        
        expect(result.current.persistenceState.isDirty).toBe(false);
        expect(result.current.persistenceState.status).toBe('idle');
    });

    it('should call PersistenceService.saveWorkflow on saveNow', async () => {
        const { result } = renderHook(() => useWorkflowPersistence(mockOptions));
        
        let saveResult: boolean;
        await act(async () => {
            saveResult = await result.current.saveNow();
        });
        
        expect(PersistenceService.saveWorkflow).toHaveBeenCalled();
        expect(saveResult!).toBe(true);
    });

    it('should buffer agent results and flush after interval', async () => {
        const { result } = renderHook(() => useWorkflowPersistence(mockOptions));
        
        act(() => {
            result.current.bufferAgentResult('instance-1', { type: 'chat', message: 'test' });
            result.current.bufferAgentResult('instance-1', { type: 'chat', message: 'test2' });
        });
        
        // Advance timers to trigger flush
        await act(async () => {
            jest.advanceTimersByTime(10000);
        });
        
        expect(PersistenceService.addAgentInstanceContent).toHaveBeenCalled();
    });

    it('should not auto-save in manual mode', async () => {
        (useSaveModeStore as any).mockReturnValue({ saveMode: 'manual' });
        
        const { result } = renderHook(() => useWorkflowPersistence(mockOptions));
        
        act(() => {
            result.current.markDirty();
        });
        
        // Advance timers beyond debounce
        await act(async () => {
            jest.advanceTimersByTime(5000);
        });
        
        // saveWorkflow should NOT be called automatically
        expect(PersistenceService.saveWorkflow).not.toHaveBeenCalled();
    });

    it('should auto-save in auto mode for authenticated users', async () => {
        (useAuth as any).mockReturnValue({
            isAuthenticated: true,
            accessToken: 'test-token'
        });
        (useSaveModeStore as any).mockReturnValue({ saveMode: 'auto' });
        
        const { result } = renderHook(() => useWorkflowPersistence(mockOptions));
        
        act(() => {
            result.current.markDirty();
        });
        
        // Advance timers beyond debounce (2000ms)
        await act(async () => {
            jest.advanceTimersByTime(3000);
        });
        
        expect(PersistenceService.saveWorkflow).toHaveBeenCalled();
    });
});

describe('Optimistic UI Pattern', () => {
    const mockOptions = {
        workflowId: 'test-workflow-123'
    };

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should rollback on save failure', async () => {
        // Mock save failure
        (PersistenceService.saveWorkflow as any).mockResolvedValueOnce({ 
            success: false, 
            error: 'Network error' 
        });
        
        const { result } = renderHook(() => useWorkflowPersistence(mockOptions));
        
        let previousValue = { test: 'original' };
        const rollbackFn = jest.fn();
        
        await act(async () => {
            await result.current.withOptimisticUpdate(
                () => previousValue,
                async () => {
                    const saveResult = await PersistenceService.saveWorkflow({} as any, {} as any);
                    return saveResult.success;
                },
                rollbackFn
            );
        });
        
        expect(rollbackFn).toHaveBeenCalledWith(previousValue);
        expect(result.current.persistenceState.status).toBe('error');
    });

    it('should not rollback on save success', async () => {
        (PersistenceService.saveWorkflow as any).mockResolvedValueOnce({ success: true });
        
        const { result } = renderHook(() => useWorkflowPersistence(mockOptions));
        
        const rollbackFn = jest.fn();
        
        await act(async () => {
            await result.current.withOptimisticUpdate(
                () => 'test',
                async () => true,
                rollbackFn
            );
        });
        
        expect(rollbackFn).not.toHaveBeenCalled();
    });
});

describe('Security Wipe on Auth Change', () => {
    it('should reset store on resetAll', () => {
        const store = useWorkflowStore.getState();
        
        // Simulate user data
        store.markDirty('test');
        store.createWorkflow('Test', 'archi' as any);
        
        // Simulate logout wipe
        store.resetAll();
        
        const state = useWorkflowStore.getState();
        expect(state.currentWorkflow).toBeNull();
        expect(state.workflows).toHaveLength(0);
        expect(state.isDirty).toBe(false);
        expect(state.lastSynced).toBeNull();
    });
});