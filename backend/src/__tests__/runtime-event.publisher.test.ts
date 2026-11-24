import { describe, expect, it } from '@jest/globals';
import type { RuntimeEventEnvelope } from '../domain/execution/runtimeEvent.contract';
import {
  configureRuntimeEventEmitter,
  createRuntimeEventPublisher,
  RuntimeEventPublisher,
} from '../services/runtimeEventPublisher.service';

describe('RuntimeEventPublisher', () => {
  it('publishes a sanitized run event with a versioned payload', () => {
    const emitted: Array<{ workspaceId: string; event: RuntimeEventEnvelope }> = [];
    const publisher = new RuntimeEventPublisher({
      emitRuntimeEvent: (workspaceId: string, event: unknown) => {
        emitted.push({ workspaceId, event: event as RuntimeEventEnvelope });
        return true;
      },
    });

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
    const payload = (emitted[0].event as RuntimeEventEnvelope).payload;
    expect((emitted[0].event as RuntimeEventEnvelope).type).toBe('run:started');
    expect((emitted[0].event as RuntimeEventEnvelope).version).toBe(1);
    expect(payload.progress).toBe(33);
    expect(payload.message).toBe('Run started');
    expect(payload.token).toBeUndefined();
    expect(payload.apiKey).toBeUndefined();
  });

  it('maps the lifecycle semantics for queued, started and progressed states', () => {
    const emitted: Array<{ workspaceId: string; event: RuntimeEventEnvelope }> = [];
    const publisher = new RuntimeEventPublisher({
      emitRuntimeEvent: (workspaceId: string, event: unknown) => {
        emitted.push({ workspaceId, event: event as RuntimeEventEnvelope });
        return true;
      },
    });

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
        emitted.push({ workspaceId, event: event as RuntimeEventEnvelope });
        return true;
      },
    });

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
    });

    const result = publisher.publishRunStatusChange({
      workspaceId: '507f1f77bcf86cd799439011',
      runId: 'run-001',
      status: 'failed',
      message: 'Runtime failed',
      roomWorkspaceId: '507f1f77bcf86cd799439012',
    });

    expect(result).toBe(false);
  });

  it('routes cancellation-requested updates through the configured emitter as run progress', () => {
    const emitted: Array<{ workspaceId: string; event: RuntimeEventEnvelope }> = [];
    const publisher = createRuntimeEventPublisher();
    configureRuntimeEventEmitter({
      emitRuntimeEvent: (workspaceId, event) => {
        emitted.push({ workspaceId, event: event as RuntimeEventEnvelope });
        return true;
      },
    });

    try {
      const published = publisher.publishRunStatusChange({
        workspaceId: '507f1f77bcf86cd799439011',
        runId: 'run-cancel-request',
        status: 'running',
        stage: 'cancellation_requested',
        progress: 50,
      });

      expect(published).toBe(true);
      expect(emitted[0].event.type).toBe('run:progressed');
      expect(emitted[0].event.payload).toEqual(
        expect.objectContaining({
          status: 'running',
          stage: 'cancellation_requested',
          progress: 50,
        }),
      );
    } finally {
      configureRuntimeEventEmitter(null);
    }
  });

  // ⭐ J7-09: visibilité quarantaine/fencing
  it('maps the quarantined status to run:quarantined with lockHeld', () => {
    const emitted: Array<{ workspaceId: string; event: RuntimeEventEnvelope }> = [];
    const publisher = new RuntimeEventPublisher({
      emitRuntimeEvent: (workspaceId: string, event: unknown) => {
        emitted.push({ workspaceId, event: event as RuntimeEventEnvelope });
        return true;
      },
    });

    const published = publisher.publishRunStatusChange({
      workspaceId: '507f1f77bcf86cd799439011',
      runId: 'run-quar-1',
      status: 'quarantined',
      message: 'Quiescence unproven',
      errorCode: 'QUARANTINED',
      lockHeld: true,
      agentId: '507f1f77bcf86cd799439012',
    });

    expect(published).toBe(true);
    expect(emitted).toHaveLength(1);
    expect(emitted[0].event.type).toBe('run:quarantined');
    expect(emitted[0].event.version).toBe(1);
    expect(emitted[0].event.payload).toEqual(
      expect.objectContaining({
        status: 'quarantined',
        lockHeld: true,
        errorCode: 'QUARANTINED',
        runId: 'run-quar-1',
        agentId: '507f1f77bcf86cd799439012',
      }),
    );
  });

  it('publishes run:fenced and run:recovery_relaunched with whitelisted payloads', () => {
    const emitted: Array<{ workspaceId: string; event: RuntimeEventEnvelope }> = [];
    const publisher = new RuntimeEventPublisher({
      emitRuntimeEvent: (workspaceId: string, event: unknown) => {
        emitted.push({ workspaceId, event: event as RuntimeEventEnvelope });
        return true;
      },
    });

    publisher.publishRunFenced({
      workspaceId: '507f1f77bcf86cd799439011',
      runId: 'run-quar-1',
      operationId: 'op-123',
      reason: 'AGENT_AUTO_RECOVERY',
      lockHeld: true,
      userId: 'must-be-stripped',
    });

    publisher.publishRunRecoveryRelaunched({
      workspaceId: '507f1f77bcf86cd799439011',
      runId: 'run-quar-1',
      newRunId: 'run-child-1',
      recoveryAttemptCount: 1,
      reason: 'AGENT_AUTO_RECOVERY',
      password: 'must-be-stripped',
    });

    expect(emitted.map((entry) => entry.event.type)).toEqual(['run:fenced', 'run:recovery_relaunched']);
    expect(emitted[0].event.payload).toEqual(
      expect.objectContaining({
        operationId: 'op-123',
        reason: 'AGENT_AUTO_RECOVERY',
        lockHeld: true,
        runId: 'run-quar-1',
      }),
    );
    expect(emitted[0].event.payload.userId).toBeUndefined();
    expect(emitted[1].event.payload).toEqual(
      expect.objectContaining({
        newRunId: 'run-child-1',
        recoveryAttemptCount: 1,
        reason: 'AGENT_AUTO_RECOVERY',
      }),
    );
    expect(emitted[1].event.payload.password).toBeUndefined();
  });

  it('blocks quarantine visibility events when the workspace id does not match the room', () => {
    const emitted: unknown[] = [];
    const publisher = new RuntimeEventPublisher({
      emitRuntimeEvent: (workspaceId: string, event: unknown) => {
        emitted.push({ workspaceId, event: event as RuntimeEventEnvelope });
        return true;
      },
    });

    const result = publisher.publishRunQuarantined({
      workspaceId: '507f1f77bcf86cd799439011',
      roomWorkspaceId: '507f1f77bcf86cd799439012',
      runId: 'run-quar-1',
      lockHeld: true,
      reason: 'QUARANTINED',
    });

    expect(result).toBe(false);
    expect(emitted).toHaveLength(0);
  });
});
