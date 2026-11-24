import { buildRuntimeEvent, RuntimeEventAggregateType, RuntimeEventType } from '../domain/execution/runtimeEvent.contract';

export interface RuntimeEventEmitter {
  emitRuntimeEvent: (workspaceId: string, event: unknown) => boolean;
}

let configuredRuntimeEventEmitter: RuntimeEventEmitter | null = null;

export function configureRuntimeEventEmitter(emitter: RuntimeEventEmitter | null): void {
  configuredRuntimeEventEmitter = emitter;
}

export interface RuntimeEventPublishContext {
  workspaceId: string;
  roomWorkspaceId?: string;
  runId?: string;
  taskId?: string;
  status?: string;
  progress?: number;
  message?: string;
  stage?: string;
  attempt?: number;
  retryAfterMs?: number;
  errorCode?: string;
  durationMs?: number;
  resultCount?: number;
  agentId?: string;
  workflowId?: string;
  lockHeld?: boolean; // ⭐ J7-09
  [key: string]: unknown;
}

const RUN_TYPE_MAP: Record<string, RuntimeEventType> = {
  queued: 'run:queued',
  running: 'run:started',
  completed: 'run:completed',
  failed: 'run:failed',
  stopped: 'run:stopped',
  timed_out: 'run:failed',
  quarantined: 'run:quarantined', // ⭐ J7-09
};

const TASK_TYPE_MAP: Record<string, RuntimeEventType> = {
  queued: 'task:queued',
  running: 'task:started',
  completed: 'task:completed',
  failed: 'task:failed',
  cancelled: 'task:cancelled',
  blocked: 'task:blocked',
  timed_out: 'task:failed',
};

export class RuntimeEventPublisher {
  private readonly emitter: RuntimeEventEmitter;
  private readonly dedupeCache = new Map<string, string>();

  constructor(emitter: RuntimeEventEmitter) {
    this.emitter = emitter;
  }

  public publishRunStatusChange(context: RuntimeEventPublishContext): boolean {
    return this.publishStateChange({
      aggregateType: 'run',
      aggregateId: context.runId ?? context.workflowId ?? context.workspaceId,
      ...context,
    });
  }

  public publishTaskStatusChange(context: RuntimeEventPublishContext): boolean {
    return this.publishStateChange({
      aggregateType: 'task',
      aggregateId: context.taskId ?? context.runId ?? context.workspaceId,
      ...context,
    });
  }

  // ⭐ J7-09: événements de visibilité quarantaine/fencing (payload whitelisté, aucun secret).

  public publishRunQuarantined(
    context: RuntimeEventPublishContext & { lockHeld?: boolean; reason?: string; operationId?: string },
  ): boolean {
    return this.emitRunEvent('run:quarantined', context, {
      lockHeld: context.lockHeld ?? true,
      reason: context.reason,
      operationId: context.operationId,
    });
  }

  public publishRunFenced(context: RuntimeEventPublishContext & { operationId?: string; reason?: string; lockHeld?: boolean }): boolean {
    return this.emitRunEvent('run:fenced', context, {
      operationId: context.operationId,
      reason: context.reason,
      lockHeld: context.lockHeld,
    });
  }

  public publishRunRecoveryRelaunched(
    context: RuntimeEventPublishContext & { newRunId?: string; recoveryAttemptCount?: number; reason?: string },
  ): boolean {
    return this.emitRunEvent('run:recovery_relaunched', context, {
      newRunId: context.newRunId,
      recoveryAttemptCount: context.recoveryAttemptCount,
      reason: context.reason,
    });
  }

  private emitRunEvent(type: RuntimeEventType, context: RuntimeEventPublishContext, extraPayload: Record<string, unknown>): boolean {
    const workspaceId = context.workspaceId.trim();
    const roomWorkspaceId = context.roomWorkspaceId ? context.roomWorkspaceId.trim() : workspaceId;
    if (!workspaceId || roomWorkspaceId !== workspaceId) {
      return false;
    }
    const basePayload: Record<string, unknown> = {
      status: typeof context.status === 'string' ? context.status : undefined,
      message: typeof context.message === 'string' && context.message.trim().length > 0 ? context.message.trim() : undefined,
      errorCode: typeof context.errorCode === 'string' && context.errorCode.trim().length > 0 ? context.errorCode.trim() : undefined,
      agentId: typeof context.agentId === 'string' && context.agentId.trim().length > 0 ? context.agentId.trim() : undefined,
      workflowId: typeof context.workflowId === 'string' && context.workflowId.trim().length > 0 ? context.workflowId.trim() : undefined,
      runId: typeof context.runId === 'string' && context.runId.trim().length > 0 ? context.runId.trim() : undefined,
    };
    const payload: Record<string, unknown> = Object.fromEntries(
      Object.entries({ ...basePayload, ...extraPayload }).filter(([, value]) => value !== undefined),
    );
    return this.emit(
      workspaceId,
      type,
      'run',
      context.runId ?? context.workflowId ?? workspaceId,
      payload,
      context.correlationId as string | undefined,
    );
  }

  private publishStateChange(
    context: RuntimeEventPublishContext & { aggregateType: RuntimeEventAggregateType; aggregateId: string },
  ): boolean {
    const workspaceId = context.workspaceId.trim();
    const roomWorkspaceId = context.roomWorkspaceId ? context.roomWorkspaceId.trim() : workspaceId;

    if (!workspaceId || !roomWorkspaceId || roomWorkspaceId !== workspaceId) {
      return false;
    }

    const status = typeof context.status === 'string' ? context.status : 'running';
    const type = this.resolveEventType(context.aggregateType, status, context.progress, context.stage);
    const payload = this.buildPayload(context, status, type);

    return this.emit(workspaceId, type, context.aggregateType, context.aggregateId, payload, context.correlationId as string | undefined);
  }

  private emit(
    workspaceId: string,
    type: RuntimeEventType,
    aggregateType: RuntimeEventAggregateType,
    aggregateId: string,
    payload: Record<string, unknown>,
    correlationId?: string,
  ): boolean {
    const signature = this.buildEventSignature(workspaceId, aggregateType, aggregateId, type, payload);
    if (this.dedupeCache.has(signature)) {
      return false;
    }

    try {
      const event = buildRuntimeEvent({
        type,
        aggregateType,
        aggregateId,
        workspaceId,
        correlationId,
        payload,
      });

      const wasPublished = this.emitter.emitRuntimeEvent(workspaceId, event);
      if (!wasPublished) {
        return false;
      }

      this.dedupeCache.set(signature, type);
      if (this.dedupeCache.size > 500) {
        this.dedupeCache.clear();
      }
      return true;
    } catch {
      return false;
    }
  }

  private buildPayload(context: RuntimeEventPublishContext, status: string, type: RuntimeEventType): Record<string, unknown> {
    const payload: Record<string, unknown> = { status };

    if (context.stage) {
      payload.stage = context.stage;
    }

    if (typeof context.progress === 'number') {
      payload.progress = Number(context.progress);
    }

    if (typeof context.message === 'string' && context.message.trim().length > 0) {
      payload.message = context.message.trim();
    }

    if (typeof context.attempt === 'number') {
      payload.attempt = context.attempt;
    }

    if (typeof context.retryAfterMs === 'number') {
      payload.retryAfterMs = context.retryAfterMs;
    }

    if (typeof context.errorCode === 'string' && context.errorCode.trim().length > 0) {
      payload.errorCode = context.errorCode.trim();
    }

    if (typeof context.durationMs === 'number') {
      payload.durationMs = context.durationMs;
    }

    if (typeof context.resultCount === 'number') {
      payload.resultCount = context.resultCount;
    }

    if (typeof context.agentId === 'string' && context.agentId.trim().length > 0) {
      payload.agentId = context.agentId.trim();
    }

    if (typeof context.workflowId === 'string' && context.workflowId.trim().length > 0) {
      payload.workflowId = context.workflowId.trim();
    }

    if (typeof context.runId === 'string' && context.runId.trim().length > 0) {
      payload.runId = context.runId.trim();
    }

    if (typeof context.taskId === 'string' && context.taskId.trim().length > 0) {
      payload.taskId = context.taskId.trim();
    }

    if (typeof context.lockHeld === 'boolean') {
      payload.lockHeld = context.lockHeld; // ⭐ J7-09
    }

    if (type === 'run:progressed' || type === 'task:progressed') {
      payload.progress = payload.progress ?? 0;
    }

    return payload;
  }

  private resolveEventType(aggregateType: RuntimeEventAggregateType, status: string, progress?: number, stage?: string): RuntimeEventType {
    if (aggregateType === 'run' && stage === 'cancellation_requested') {
      return 'run:progressed';
    }

    const map = aggregateType === 'run' ? RUN_TYPE_MAP : TASK_TYPE_MAP;
    const mapped = map[status];

    if (mapped) {
      return mapped;
    }

    if (typeof progress === 'number') {
      return aggregateType === 'run' ? 'run:progressed' : 'task:progressed';
    }

    return aggregateType === 'run' ? 'run:progressed' : 'task:progressed';
  }

  private buildEventSignature(
    workspaceId: string,
    aggregateType: RuntimeEventAggregateType,
    aggregateId: string,
    type: RuntimeEventType,
    payload: Record<string, unknown>,
  ): string {
    return JSON.stringify({ workspaceId, aggregateType, aggregateId, type, payload });
  }
}

export function createRuntimeEventPublisher(emitter?: RuntimeEventEmitter): RuntimeEventPublisher {
  return new RuntimeEventPublisher(
    emitter ?? {
      emitRuntimeEvent: (workspaceId, event) => configuredRuntimeEventEmitter?.emitRuntimeEvent(workspaceId, event) ?? false,
    },
  );
}
