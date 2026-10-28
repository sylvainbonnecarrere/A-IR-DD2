import { z } from 'zod';

const RUNTIME_EVENT_TYPE_VALUES = [
  'run:queued',
  'run:started',
  'run:progressed',
  'run:completed',
  'run:failed',
  'run:stopped',
  'task:queued',
  'task:started',
  'task:progressed',
  'task:completed',
  'task:failed',
  'task:cancelled',
  'task:blocked',
] as const;

const RUNTIME_EVENT_AGGREGATE_VALUES = ['run', 'task'] as const;
const RUNTIME_EVENT_ALLOWED_PAYLOAD_KEYS = new Set([
  'status',
  'stage',
  'progress',
  'message',
  'attempt',
  'retryAfterMs',
  'errorCode',
  'durationMs',
  'resultCount',
  'agentId',
  'workflowId',
  'runId',
  'taskId',
]);
const RUNTIME_EVENT_SENSITIVE_KEYS = new Set([
  'secret',
  'token',
  'password',
  'authorization',
  'apiKey',
  'apikey',
  'cookie',
  'session',
  'jwt',
  'privatekey',
  'credential',
  'email',
  'userId',
  'username',
  'fullName',
]);

export const RuntimeEventTypeSchema = z.enum(RUNTIME_EVENT_TYPE_VALUES);
export const RuntimeEventAggregateTypeSchema = z.enum(RUNTIME_EVENT_AGGREGATE_VALUES);
export const WorkspaceEventIdSchema = z.string().trim().min(1).max(120);
export const RuntimeEventCorrelationIdSchema = z.string().trim().min(1).max(160).optional();

const sanitizeRuntimeEventValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeRuntimeEventValue(item));
  }

  if (value !== null && typeof value === 'object') {
    const sanitized: Record<string, unknown> = {};
    Object.entries(value as Record<string, unknown>).forEach(([key, nestedValue]) => {
      const loweredKey = key.toLowerCase();
      const isSensitive = Array.from(RUNTIME_EVENT_SENSITIVE_KEYS).some((sensitiveKey) => loweredKey.includes(sensitiveKey));
      if (isSensitive || !RUNTIME_EVENT_ALLOWED_PAYLOAD_KEYS.has(key) && !RUNTIME_EVENT_ALLOWED_PAYLOAD_KEYS.has(loweredKey)) {
        return;
      }
      sanitized[key] = sanitizeRuntimeEventValue(nestedValue);
    });
    return sanitized;
  }

  return value;
};

const containsSensitiveRuntimeData = (value: unknown): boolean => {
  if (Array.isArray(value)) {
    return value.some((item) => containsSensitiveRuntimeData(item));
  }

  if (value !== null && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).some(([key, nestedValue]) => {
      const loweredKey = key.toLowerCase();
      const isSensitive = Array.from(RUNTIME_EVENT_SENSITIVE_KEYS).some((sensitiveKey) => loweredKey.includes(sensitiveKey));
      return isSensitive || containsSensitiveRuntimeData(nestedValue);
    });
  }

  return false;
};

export const RuntimeEventPayloadSchema = z
  .record(z.string(), z.unknown())
  .refine((value) => !containsSensitiveRuntimeData(value), {
    message: 'runtime event payload contains sensitive data',
  })
  .transform((value) => sanitizeRuntimeEventValue(value) as Record<string, unknown>);

export const RuntimeEventEnvelopeSchema = z.object({
  id: WorkspaceEventIdSchema,
  type: RuntimeEventTypeSchema,
  version: z.literal(1),
  aggregateType: RuntimeEventAggregateTypeSchema,
  aggregateId: z.string().trim().min(1).max(160),
  workspaceId: z.string().trim().regex(/^[a-f\d]{24}$/i, 'workspaceId must be a valid MongoDB ObjectId'),
  correlationId: RuntimeEventCorrelationIdSchema,
  occurredAt: z.string().datetime(),
  payload: RuntimeEventPayloadSchema,
}).strict();

export type RuntimeEventType = z.infer<typeof RuntimeEventTypeSchema>;
export type RuntimeEventAggregateType = z.infer<typeof RuntimeEventAggregateTypeSchema>;
export type RuntimeEventPayload = z.infer<typeof RuntimeEventPayloadSchema>;
export type RuntimeEventEnvelope = z.infer<typeof RuntimeEventEnvelopeSchema>;

export function buildRuntimeEvent({
  type,
  aggregateType,
  aggregateId,
  workspaceId,
  correlationId,
  payload,
  occurredAt = new Date().toISOString(),
}: {
  type: RuntimeEventType;
  aggregateType: RuntimeEventAggregateType;
  aggregateId: string;
  workspaceId: string;
  correlationId?: string;
  payload: Record<string, unknown>;
  occurredAt?: string | Date;
}): RuntimeEventEnvelope {
  const event = {
    id: `evt-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
    type,
    version: 1 as const,
    aggregateType,
    aggregateId,
    workspaceId,
    correlationId: correlationId ?? `corr-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
    occurredAt: occurredAt instanceof Date ? occurredAt.toISOString() : occurredAt,
    payload: sanitizeRuntimeEventValue(payload) as Record<string, unknown>,
  };

  const parsed = RuntimeEventEnvelopeSchema.safeParse(event);
  if (!parsed.success) {
    throw new Error(`Invalid runtime event payload: ${parsed.error.message}`);
  }

  return parsed.data;
}
