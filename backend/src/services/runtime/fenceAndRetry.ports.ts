import type { DockerGatewayFenceKind, DockerGatewayFencedOperation, DockerGatewayFenceResult } from './DockerGatewayAdmission';

/**
 * Ports du flux `fence-and-retry` (US-J7-07, conception §4.1-4.4).
 * Toute implémentation doit rester fail-closed : une erreur d'inspection,
 * un état inconnu ou un timeout valent « preuve absente », jamais l'inverse.
 */

export const FENCE_AND_RETRY_TIMEOUT_MS = 30_000;

export type FenceAndRetryReason = 'USER_MANUAL_RESET' | 'AGENT_AUTO_RECOVERY' | 'ADMIN_MAINTENANCE';

export interface FenceControlPort {
    fenceOperation(operationId: string, fenceKind?: DockerGatewayFenceKind): Promise<DockerGatewayFenceResult>;
    verifyFenced(operationId: string): Promise<{ quiescent: boolean }>;
}

export interface FencedOperationLookupPort {
    getFencedOperations(): Promise<DockerGatewayFencedOperation[]>;
}

export interface FenceAuditEntry {
    actorUserId: string;
    timestamp: Date;
    fencedOpUuid: string;
    operationId: string;
    workspaceId: string;
    runId: string;
    reason: FenceAndRetryReason;
    fenceKind: DockerGatewayFenceKind;
    quiescenceProven: boolean;
}

/** Journal d'audit immuable : insert-only, jamais de mise à jour ni de suppression. */
export interface FenceAuditPort {
    record(entry: FenceAuditEntry): Promise<void>;
}

export interface RuntimeAlertEntry {
    severity: 'critical' | 'high' | 'medium' | 'low';
    code: string;
    message: string;
    userId: string;
    workspaceId: string;
    runId: string;
    operationId?: string | null;
}

export interface RuntimeAlertPort {
    raise(entry: RuntimeAlertEntry): Promise<void>;
}

export interface FenceAndRetryIdempotencyRecord {
    /** Identifiant de stockage : `${userId}:${command}:${key}` (unicité par utilisateur). */
    storageId: string;
    userId: string;
    command: 'fence-and-retry';
    idempotencyKey: string;
    workspaceId: string;
    runId: string;
    response: FenceAndRetrySuccessResponse;
    createdAt: Date;
}

export interface FenceAndRetrySuccessResponse {
    fencedRunId: string;
    newExecutionId: string;
    status: 'queued';
    recoveryAttemptCount: number;
}

export interface RunCommandIdempotencyPort {
    find(storageId: string): Promise<FenceAndRetryIdempotencyRecord | null>;
    store(record: FenceAndRetryIdempotencyRecord): Promise<void>;
}

export interface FenceAndRetryRunView {
    executionId: string;
    ownerUserId: string;
    workflowId: string | null;
    status: string;
    error?: { code?: string; retryable?: boolean } | null;
    recoveryAttemptCount: number | null;
    supervisedAttempt?: { attemptId: string } | null;
}

export interface QuarantinedRunStorePort {
    findOwnedRunInWorkspace(executionId: string, ownerUserId: string, workflowId: string): Promise<FenceAndRetryRunView | null>;
}

export interface WorkflowOwnershipPort {
    existsOwnedWorkflow(workspaceId: string, userId: string): Promise<boolean>;
}

export interface QuarantinedRetryPort {
    retryQuarantinedRun(executionId: string, userId: string, idempotencyKey: string): Promise<{ executionId: string; status: string; replayed: boolean }>;
}

export class FenceAndRetryError extends Error {
    constructor(
        message: string,
        public readonly statusCode: number,
        public readonly code: string,
        public readonly details?: Record<string, unknown>,
    ) {
        super(message);
        this.name = 'FenceAndRetryError';
    }
}

export function fenceAndRetryHttpError(statusCode: number, code: string, message: string, details?: Record<string, unknown>): FenceAndRetryError {
    return new FenceAndRetryError(message, statusCode, code, details);
}
