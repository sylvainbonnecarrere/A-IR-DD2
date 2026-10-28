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
});
