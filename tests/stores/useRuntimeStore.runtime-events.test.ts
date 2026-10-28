import { useRuntimeStore } from '../../stores/useRuntimeStore';

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
});
