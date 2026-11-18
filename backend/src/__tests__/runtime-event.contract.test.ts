import { describe, expect, it } from '@jest/globals';
import {
  RuntimeEventEnvelopeSchema,
  RuntimeEventTypeSchema,
  buildRuntimeEvent,
} from '../domain/execution/runtimeEvent.contract';

describe('Runtime event contract', () => {
  it('accepts a valid versioned runtime event envelope', () => {
    const data = {
      id: 'evt-123',
      type: 'run:started',
      version: 1,
      aggregateType: 'run',
      aggregateId: 'run_123',
      workspaceId: '507f1f77bcf86cd799439011',
      occurredAt: '2026-01-01T00:00:00.000Z',
      correlationId: 'corr-123',
      payload: {
        stage: 'boot',
        progress: 12,
        message: 'Run started',
      },
    };

    const result = RuntimeEventEnvelopeSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.version).toBe(1);
      expect(result.data.type).toBe('run:started');
    }
  });

  it('rejects unsafe payload keys and unsupported event versions', () => {
    expect(RuntimeEventTypeSchema.safeParse('run:secret').success).toBe(false);
    expect(
      RuntimeEventEnvelopeSchema.safeParse({
        id: 'evt-456',
        type: 'task:progressed',
        version: 2,
        aggregateType: 'task',
        aggregateId: 'task_456',
        workspaceId: '507f1f77bcf86cd799439011',
        occurredAt: '2026-01-01T00:00:00.000Z',
        payload: { secret: 'x' },
      }).success,
    ).toBe(false);
  });

  it('builds a minimal payload without sensitive fields', () => {
    const event = buildRuntimeEvent({
      type: 'task:completed',
      aggregateType: 'task',
      aggregateId: 'task_789',
      workspaceId: '507f1f77bcf86cd799439011',
      payload: {
        message: 'Task completed',
        stage: 'finalize',
        progress: 100,
        secretValue: 'do-not-send',
      },
    });

    expect(event.type).toBe('task:completed');
    expect(event.payload).toEqual({
      message: 'Task completed',
      stage: 'finalize',
      progress: 100,
    });
    expect('secretValue' in event.payload).toBe(false);
  });

  // ⭐ J7-09: événements de visibilité quarantaine/fencing (extension additive v1)
  it('accepts the quarantine visibility event types at version 1', () => {
    for (const type of ['run:quarantined', 'run:fenced', 'run:recovery_relaunched'] as const) {
      expect(RuntimeEventTypeSchema.safeParse(type).success).toBe(true);
      const event = buildRuntimeEvent({
        type,
        aggregateType: 'run',
        aggregateId: 'run_quar_1',
        workspaceId: '507f1f77bcf86cd799439011',
        payload: { status: 'quarantined', lockHeld: true },
      });
      expect(event.version).toBe(1);
      expect(event.type).toBe(type);
    }
  });

  it('keeps the quarantine payload whitelist strict and free of secrets', () => {
    const event = buildRuntimeEvent({
      type: 'run:recovery_relaunched',
      aggregateType: 'run',
      aggregateId: 'run_quar_1',
      workspaceId: '507f1f77bcf86cd799439011',
      payload: {
        status: 'relaunched',
        lockHeld: false,
        reason: 'AGENT_AUTO_RECOVERY',
        operationId: 'op-123',
        recoveryAttemptCount: 2,
        newRunId: 'run_child_1',
        runId: 'run_quar_1',
        agentId: '507f1f77bcf86cd799439012',
        userId: 'should-be-stripped',
        token: 'should-be-stripped',
        internalNotes: 'should-be-stripped',
      },
    });

    expect(event.payload).toEqual({
      status: 'relaunched',
      lockHeld: false,
      reason: 'AGENT_AUTO_RECOVERY',
      operationId: 'op-123',
      recoveryAttemptCount: 2,
      newRunId: 'run_child_1',
      runId: 'run_quar_1',
      agentId: '507f1f77bcf86cd799439012',
    });
  });

  it('rejects a quarantine event with an invalid workspaceId', () => {
    expect(() =>
      buildRuntimeEvent({
        type: 'run:quarantined',
        aggregateType: 'run',
        aggregateId: 'run_1',
        workspaceId: 'not-an-objectid',
        payload: { status: 'quarantined' },
      }),
    ).toThrow('Invalid runtime event payload');
  });
});
