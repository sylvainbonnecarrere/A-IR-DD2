import { useRuntimeStore } from '../../stores/useRuntimeStore';

import type { FunctionRunRecord } from '../../types/function.types';

const runRecord = (executionId: string, status: string, extra: Record<string, unknown> = {}): FunctionRunRecord => ({
  executionId,
  status: status as FunctionRunRecord['status'],
  runtime: 'python' as FunctionRunRecord['runtime'],
  runner: 'docker_sandbox',
  launchContext: 'workflow_run',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:10.000Z',
  timing: {},
  ...extra,
});

describe('useRuntimeStore runtime observation', () => {
  beforeEach(() => {
    useRuntimeStore.getState().resetAll();
    useRuntimeStore.getState().setRuntimeConnectionState('connected');
  });

  it('records run and task state changes from runtime events', () => {
    const event = {
      id: 'evt-1',
      type: 'run:started',
      version: 1,
      aggregateType: 'run',
      aggregateId: 'run-42',
      workspaceId: '507f1f77bcf86cd799439011',
      occurredAt: '2026-01-01T00:00:00.000Z',
      payload: { status: 'running', stage: 'dispatch', progress: 12 },
    } as const;

    useRuntimeStore.getState().recordRuntimeEvent(event);

    expect(useRuntimeStore.getState().runStatuses['run-42']).toBe('running');
    expect(useRuntimeStore.getState().latestRuntimeEvent).toEqual(event);

    useRuntimeStore.getState().recordRuntimeEvent({
      ...event,
      id: 'evt-2',
      type: 'task:completed',
      aggregateType: 'task',
      aggregateId: 'task-9',
      payload: { status: 'completed', resultCount: 3 },
    });

    expect(useRuntimeStore.getState().taskStatuses['task-9']).toBe('completed');
  });

  it('tracks offline and reconnecting socket states without mutating workflow state', () => {
    useRuntimeStore.getState().setRuntimeConnectionState('reconnecting');
    expect(useRuntimeStore.getState().runtimeConnectionState).toBe('reconnecting');

    useRuntimeStore.getState().setRuntimeConnectionState('offline');
    expect(useRuntimeStore.getState().runtimeConnectionState).toBe('offline');
  });

  it('applique les événements de quarantaine : statut, verrou et mapping instance -> run', () => {
    useRuntimeStore.getState().recordRuntimeEvent({
      id: 'evt-q1',
      type: 'run:quarantined',
      version: 1,
      aggregateType: 'run',
      aggregateId: 'run-9',
      workspaceId: 'wf-1',
      occurredAt: '2026-01-01T00:00:00.000Z',
      payload: { status: 'quarantined', lockHeld: true, agentId: 'inst-1' },
    });

    const state = useRuntimeStore.getState();
    expect(state.runStatuses['run-9']).toBe('quarantined');
    expect(state.runLockHeld['run-9']).toBe(true);
    expect(state.instanceRunIds['inst-1']).toBe('run-9');
  });

  it('run:fenced reste en quarantaine ; run:recovery_relaunched mappe le nouveau run en queued', () => {
    useRuntimeStore.getState().recordRuntimeEvent({
      id: 'evt-f1',
      type: 'run:fenced',
      version: 1,
      aggregateType: 'run',
      aggregateId: 'run-9',
      workspaceId: 'wf-1',
      occurredAt: '2026-01-01T00:00:00.000Z',
      payload: { lockHeld: true },
    });
    expect(useRuntimeStore.getState().runStatuses['run-9']).toBe('quarantined');
    expect(useRuntimeStore.getState().runLockHeld['run-9']).toBe(true);

    useRuntimeStore.getState().recordRuntimeEvent({
      id: 'evt-r1',
      type: 'run:recovery_relaunched',
      version: 1,
      aggregateType: 'run',
      aggregateId: 'run-9',
      workspaceId: 'wf-1',
      occurredAt: '2026-01-01T00:00:01.000Z',
      payload: { newRunId: 'run-10', agentId: 'inst-1' },
    });
    const state = useRuntimeStore.getState();
    expect(state.runStatuses['run-10']).toBe('queued');
    expect(state.instanceRunIds['inst-1']).toBe('run-10');
  });

  it('setRunSnapshot ingère une lecture REST : statuts, verrou, dernier run et état ready', () => {
    useRuntimeStore.getState().setRunSnapshot('wf-1', [
      runRecord('run-2', 'quarantined', { lockHeld: true, workflowId: 'wf-1', agentInstanceId: 'inst-2' }),
      runRecord('run-1', 'completed', { workflowId: 'wf-1' }),
    ]);

    const state = useRuntimeStore.getState();
    expect(state.runStatuses['run-2']).toBe('quarantined');
    expect(state.runLockHeld['run-2']).toBe(true);
    // verrou dérivé du statut quarantined quand lockHeld absent
    useRuntimeStore.getState().setRunSnapshot('wf-2', [
      runRecord('run-8', 'quarantined', { workflowId: 'wf-2' }),
    ]);
    expect(useRuntimeStore.getState().runLockHeld['run-8']).toBe(true);
    // premier élément (tri desc) = dernier run du workflow
    expect(useRuntimeStore.getState().workflowLatestRunId['wf-1']).toBe('run-2');
    expect(useRuntimeStore.getState().instanceRunIds['inst-2']).toBe('run-2');
    expect(useRuntimeStore.getState().runSyncState['wf-1']).toBe('ready');
    expect(useRuntimeStore.getState().workflowRuns['wf-1']).toHaveLength(2);
  });

  it('setRunSnapshot avec une réponse non tableau passe le sync en error', () => {
    useRuntimeStore.getState().setRunSnapshot('wf-1', undefined as never);
    expect(useRuntimeStore.getState().runSyncState['wf-1']).toBe('error');
  });

  it('sélecteurs getWorkflowLatestRunId / getInstanceRunStatus lisent l’état d’observation', () => {
    const { getWorkflowLatestRunId, getInstanceRunStatus } = require('../../stores/useRuntimeStore');
    useRuntimeStore.getState().setRunSnapshot('wf-1', [
      runRecord('run-5', 'running', { workflowId: 'wf-1', agentInstanceId: 'inst-5' }),
    ]);
    const state = useRuntimeStore.getState();
    expect(getWorkflowLatestRunId(state, 'wf-1')).toBe('run-5');
    expect(getWorkflowLatestRunId(state, null)).toBeNull();
    expect(getInstanceRunStatus(state, 'inst-5')).toEqual({ runId: 'run-5', status: 'running', lockHeld: false });
    expect(getInstanceRunStatus(state, undefined)).toBeNull();
    expect(getInstanceRunStatus(state, 'inst-inconnu')).toBeNull();
  });

  it('resetAll efface aussi l’état d’observation des runs (workflowRuns inclus)', () => {
    useRuntimeStore.getState().setRunSnapshot('wf-1', [
      runRecord('run-1', 'running', { workflowId: 'wf-1' }),
    ]);
    useRuntimeStore.getState().recordRuntimeEvent({
      id: 'evt-x',
      type: 'run:quarantined',
      version: 1,
      aggregateType: 'run',
      aggregateId: 'run-1',
      workspaceId: 'wf-1',
      occurredAt: '2026-01-01T00:00:00.000Z',
      payload: { lockHeld: true, agentId: 'inst-1' },
    });
    useRuntimeStore.getState().resetAll();
    const state = useRuntimeStore.getState();
    expect(state.runStatuses).toEqual({});
    expect(state.runLockHeld).toEqual({});
    expect(state.instanceRunIds).toEqual({});
    expect(state.workflowLatestRunId).toEqual({});
    expect(state.workflowRuns).toEqual({});
    expect(state.runSyncState).toEqual({});
  });

});
