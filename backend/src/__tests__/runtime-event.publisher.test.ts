import { describe, expect, it } from '@jest/globals';
import { RuntimeEventPublisher } from '../services/runtimeEventPublisher.service';

describe('RuntimeEventPublisher', () => {
  it('publishes a sanitized run event with a versioned payload', () => {
    const emitted: Array<{ workspaceId: string; event: unknown }> = [];
    const publisher = new RuntimeEventPublisher({
      emitRuntimeEvent: (workspaceId: string, event: unknown) => {
        emitted.push({ workspaceId, event });
        return true;
      },
    } as any);

    publisher.publishRunStatusChange({
      workspaceId: '507f1f77bcf86cd799439011',
      runId: 'run-001',
      status: 'running',
      progress: 33,
      message: 'Run started',
      attempt: 1,
      agentId: 'agent-42',
      workflowId: 'wf-42',
      token: 'secret-token',
      apiKey: 'secret-key',
    });

    expect(emitted).toHaveLength(1);
    const payload = (emitted[0].event as any).payload;
    expect((emitted[0].event as any).type).toBe('run:started');
    expect((emitted[0].event as any).version).toBe(1);
    expect(payload.progress).toBe(33);
    expect(payload.message).toBe('Run started');
    expect(payload.token).toBeUndefined();
    expect(payload.apiKey).toBeUndefined();
  });

  it('maps the lifecycle semantics for queued, started and progressed states', () => {
    const emitted: Array<{ workspaceId: string; event: any }> = [];
    const publisher = new RuntimeEventPublisher({
      emitRuntimeEvent: (workspaceId: string, event: unknown) => {
        emitted.push({ workspaceId, event: event as any });
        return true;
      },
    } as any);

    publisher.publishRunStatusChange({
      workspaceId: '507f1f77bcf86cd799439011',
      runId: 'run-queued',
      status: 'queued',
      message: 'Queued for execution',
    });

    publisher.publishRunStatusChange({
      workspaceId: '507f1f77bcf86cd799439011',
      runId: 'run-started',
      status: 'running',
      progress: 55,
      message: 'Run started',
    });

    publisher.publishRunStatusChange({
      workspaceId: '507f1f77bcf86cd799439011',
      runId: 'run-progressed',
      status: 'waiting',
      progress: 76,
      message: 'Still progressing',
    });

    expect(emitted.map((entry) => entry.event.type)).toEqual(['run:queued', 'run:started', 'run:progressed']);
  });

  it('skips duplicate progress emissions for the same state', () => {
    const emitted: unknown[] = [];
    const publisher = new RuntimeEventPublisher({
      emitRuntimeEvent: (workspaceId: string, event: unknown) => {
        emitted.push({ workspaceId, event });
        return true;
      },
    } as any);

    publisher.publishRunStatusChange({
      workspaceId: '507f1f77bcf86cd799439011',
      runId: 'run-001',
      status: 'running',
      progress: 25,
      message: 'Running',
    });

    publisher.publishRunStatusChange({
      workspaceId: '507f1f77bcf86cd799439011',
      runId: 'run-001',
      status: 'running',
      progress: 25,
      message: 'Running',
    });

    expect(emitted).toHaveLength(1);
  });

  it('blocks event emission when the workspace id does not match the room', () => {
    const publisher = new RuntimeEventPublisher({
      emitRuntimeEvent: () => true,
    } as any);

    const result = publisher.publishRunStatusChange({
      workspaceId: '507f1f77bcf86cd799439011',
      runId: 'run-001',
      status: 'failed',
      message: 'Runtime failed',
      roomWorkspaceId: '507f1f77bcf86cd799439012',
    });

    expect(result).toBe(false);
  });
});
