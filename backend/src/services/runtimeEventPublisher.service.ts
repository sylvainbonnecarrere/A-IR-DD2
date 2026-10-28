import { buildRuntimeEvent, RuntimeEventAggregateType, RuntimeEventEnvelope, RuntimeEventType } from '../domain/execution/runtimeEvent.contract';

export interface RuntimeEventEmitter {
  emitRuntimeEvent: (workspaceId: string, event: unknown) => boolean;
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
  [key: string]: unknown;
}

const RUN_TYPE_MAP: Record<string, RuntimeEventType> = {
  queued: 'run:queued',
  running: 'run:started',
  completed: 'run:completed',
  failed: 'run:failed',
  stopped: 'run:stopped',
  timed_out: 'run:failed',
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

  private publishStateChange(context: RuntimeEventPublishContext & { aggregateType: RuntimeEventAggregateType; aggregateId: string }): boolean {
    const workspaceId = context.workspaceId.trim();
    const roomWorkspaceId = context.roomWorkspaceId ? context.roomWorkspaceId.trim() : workspaceId;

    if (!workspaceId || !roomWorkspaceId || roomWorkspaceId !== workspaceId) {
      return false;
    }

    const status = typeof context.status === 'string' ? context.status : 'running';
    const type = this.resolveEventType(context.aggregateType, status, context.progress);
    const payload = this.buildPayload(context, status, type);

    const signature = this.buildEventSignature(workspaceId, context.aggregateType, context.aggregateId, type, payload);
    if (this.dedupeCache.has(signature)) {
      return false;
    }

    try {
      const event = buildRuntimeEvent({
        type,
        aggregateType: context.aggregateType,
        aggregateId: context.aggregateId,
        workspaceId,
        correlationId: context.correlationId as string | undefined,
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

    if (type === 'run:progressed' || type === 'task:progressed') {
      payload.progress = payload.progress ?? 0;
    }

    return payload;
  }

  private resolveEventType(aggregateType: RuntimeEventAggregateType, status: string, progress?: number): RuntimeEventType {
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

  private buildEventSignature(workspaceId: string, aggregateType: RuntimeEventAggregateType, aggregateId: string, type: RuntimeEventType, payload: Record<string, unknown>): string {
    return JSON.stringify({ workspaceId, aggregateType, aggregateId, type, payload });
  }
}

export function createRuntimeEventPublisher(emitter: RuntimeEventEmitter): RuntimeEventPublisher {
  return new RuntimeEventPublisher(emitter);
}
