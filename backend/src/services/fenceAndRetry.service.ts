import { USER_TOOL_RUN_RECONCILABLE_TERMINAL_STATUS_VALUES } from '../domain/execution/userToolRun.contract';

import { DockerAttemptReservation } from './runtime/DockerAttemptReservation';

import type { RunWorkspaceLockRecovery } from './runtime/MongoExpiredRunReconciler';

import { MongoWorkspaceLockService } from './runtime/MongoWorkspaceLockService';

import {
    FENCE_AND_RETRY_TIMEOUT_MS,
    FenceAndRetryError,
    type FenceAndRetryReason,
    type FenceAndRetrySuccessResponse,
    type FenceAuditPort,
    type FenceControlPort,
    type FencedOperationLookupPort,
    type QuarantinedRetryPort,
    type QuarantinedRunStorePort,
    type RunCommandIdempotencyPort,
    type RuntimeAlertPort,
    type WorkflowOwnershipPort,
} from './runtime/fenceAndRetry.ports';

import { MongoGatewayFenceAuditStore, MongoQuarantinedRunStore, MongoRunCommandIdempotencyStore, MongoRuntimeAlertsStore, MongoWorkflowOwnershipStore, buildFenceAndRetryStorageId } from './runtime/fenceAndRetry.stores';

import { SandboxService } from './sandbox.service';

export { FenceAndRetryError } from './runtime/fenceAndRetry.ports';

export interface FenceAndRetryRequest {
    userId: string;
    workspaceId: string;
    runId: string;
    idempotencyKey: string;
    reason?: FenceAndRetryReason;
}

export type FenceAndRetryResult =
    | { kind: 'accepted'; replayed: boolean; response: FenceAndRetrySuccessResponse };

const REASON_TO_FENCE_KIND: Record<FenceAndRetryReason, 'user_manual_reset' | 'agent_auto_recovery' | 'admin_maintenance'> = {
    USER_MANUAL_RESET: 'user_manual_reset',
    AGENT_AUTO_RECOVERY: 'agent_auto_recovery',
    ADMIN_MAINTENANCE: 'admin_maintenance',
};

/**
 * Orchestration `fence-and-retry` (conception §4.3, ordre strict, chaque étape
 * persistée avant la suivante ; rejoue idempotent sur `Idempotency-Key`) :
 *
 *  1. fencing gateway (fence + verify, borne 30 s) — quiescence non prouvée,
 *     erreur ou timeout => 504 FENCING_TIMEOUT_ESCALATED + alerte critique
 *     persistée, verrou retenu, journal gateway intact (fail-closed) ;
 *  2. entrée d'audit signée dans `gateway_fence_audit` (append-only) ;
 *  3. libération conditionnelle du verrou (`owner === runId` uniquement),
 *     sinon 409 WORKSPACE_LOCKED_BY_OTHER_RUN (étapes 1-2 déjà persistées) ;
 *  4. nouveau run `queued` (nouvel executionId, `retryOfExecutionId`,
 *     `recoveryAttemptCount` = parent + 1, parent strictement immutable).
 */
export class FenceAndRetryService {

    constructor(
        private readonly control: FenceControlPort,
        private readonly lookup: FencedOperationLookupPort,
        private readonly runs: QuarantinedRunStorePort = new MongoQuarantinedRunStore(),
        private readonly workflows: WorkflowOwnershipPort = new MongoWorkflowOwnershipStore(),
        private readonly locks: RunWorkspaceLockRecovery = new MongoWorkspaceLockService(),
        private readonly audit: FenceAuditPort = new MongoGatewayFenceAuditStore(),
        private readonly alerts: RuntimeAlertPort = new MongoRuntimeAlertsStore(),
        private readonly idempotency: RunCommandIdempotencyPort = new MongoRunCommandIdempotencyStore(),
        private readonly retry: QuarantinedRetryPort = new SandboxService(),
    ) {}

    async fenceAndRetry(request: FenceAndRetryRequest): Promise<FenceAndRetryResult> {
        const userId = request.userId.trim();
        const workspaceId = request.workspaceId.trim();
        const runId = request.runId.trim();
        const idempotencyKey = request.idempotencyKey.trim();
        const reason = request.reason ?? 'USER_MANUAL_RESET';

        if (!userId || !workspaceId || !runId || !idempotencyKey) {
            throw new FenceAndRetryError('userId, workspaceId, runId et idempotencyKey sont requis', 400, 'INVALID_FENCE_AND_RETRY_REQUEST');
        }

        // Rejeu idempotent : même clé + même cible -> même réponse, sans re-fencing.
        const storageId = buildFenceAndRetryStorageId(userId, idempotencyKey);
        const existing = await this.idempotency.find(storageId);
        if (existing) {
            if (existing.runId !== runId || existing.workspaceId !== workspaceId) {
                throw new FenceAndRetryError(
                    'Idempotency-Key déjà utilisée pour une autre cible',
                    409,
                    'IDEMPOTENCY_KEY_REUSED',
                );
            }
            return { kind: 'accepted', replayed: true, response: existing.response };
        }

        // Ownership strict : le workflow et le run appartiennent à l'utilisateur.
        if (!await this.workflows.existsOwnedWorkflow(workspaceId, userId)) {
            throw new FenceAndRetryError('Run introuvable', 404, 'RUN_NOT_FOUND');
        }
        const run = await this.runs.findOwnedRunInWorkspace(runId, userId, workspaceId);
        if (!run) {
            throw new FenceAndRetryError('Run introuvable', 404, 'RUN_NOT_FOUND');
        }

        // Précondition métier : statut terminal réconciliable uniquement.
        if (!(USER_TOOL_RUN_RECONCILABLE_TERMINAL_STATUS_VALUES as readonly string[]).includes(run.status)) {
            throw new FenceAndRetryError(
                'Seul un run worker_lost ou quarantined peut être fence-and-retry',
                409,
                'RUN_NOT_QUARANTINED',
                { status: run.status },
            );
        }

        // Étape 1 : fencing + preuve de quiescence via le control plane gateway (fail-closed, borne 30 s).
        const operation = await this.findFencedOperation(run);
        if (!operation) {
            await this.raiseFencingAlert(userId, workspaceId, runId, null, 'Aucune opération fencée ne correspond à la tentative du run');
            throw new FenceAndRetryError(
                'La quiescence Docker n’a pas pu être prouvée (aucune opération fencée correspondante)',
                504,
                'FENCING_TIMEOUT_ESCALATED',
            );
        }
        const quiescent = await this.proveQuiescence(operation.id, REASON_TO_FENCE_KIND[reason]);
        if (!quiescent) {
            await this.raiseFencingAlert(userId, workspaceId, runId, operation.id, 'verifyFenced a retourné quiescent=false ou a échoué');
            throw new FenceAndRetryError(
                'La quiescence Docker n’a pas été prouvée dans la fenêtre de 30 s',
                504,
                'FENCING_TIMEOUT_ESCALATED',
                { operationId: operation.id },
            );
        }

        // Étape 2 : audit signé (append-only, jamais modifié ni effacé ensuite).
        await this.audit.record({
            actorUserId: userId,
            timestamp: new Date(),
            fencedOpUuid: operation.id,
            operationId: operation.id,
            workspaceId,
            runId,
            reason,
            fenceKind: REASON_TO_FENCE_KIND[reason],
            quiescenceProven: true,
        });

        // Étape 3 : libération conditionnelle du verrou — uniquement si owner === runId.
        const release = await this.locks.releaseForRun(userId, workspaceId, runId);
        if (release === 'owned_by_another_run') {
            throw new FenceAndRetryError(
                'Le verrou du workspace appartient à un autre run',
                409,
                'WORKSPACE_LOCKED_BY_OTHER_RUN',
            );
        }

        // Étape 4 : nouveau run queued (parent strictement immutable).
        const child = await this.retry.retryQuarantinedRun(runId, userId, idempotencyKey);
        const response: FenceAndRetrySuccessResponse = {
            fencedRunId: runId,
            newExecutionId: child.executionId,
            status: 'queued',
            recoveryAttemptCount: (run.recoveryAttemptCount ?? 0) + 1,
        };

        try {
            await this.idempotency.store({
                storageId,
                userId,
                command: 'fence-and-retry',
                idempotencyKey,
                workspaceId,
                runId,
                response,
                createdAt: new Date(),
            });
        } catch (error) {
            // Course entre deux requêtes simultanées : rejoue la réponse enregistrée.
            if (typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 11000) {
                const stored = await this.idempotency.find(storageId);
                if (stored && stored.runId === runId && stored.workspaceId === workspaceId) {
                    return { kind: 'accepted', replayed: true, response: stored.response };
                }
            }
            throw error;
        }

        return { kind: 'accepted', replayed: false, response };
    }

    private async findFencedOperation(run: { supervisedAttempt?: { attemptId: string } | null }) {
        const attemptId = run.supervisedAttempt?.attemptId;
        if (!attemptId) return undefined;
        const containerName = DockerAttemptReservation.containerName(attemptId);
        const fencedOperations = await this.lookup.getFencedOperations();
        return fencedOperations.find((entry) =>
            entry.effect?.attemptId === attemptId && entry.effect.containerName === containerName,
        );
    }

    private async proveQuiescence(operationId: string, fenceKind: 'user_manual_reset' | 'agent_auto_recovery' | 'admin_maintenance'): Promise<boolean> {
        const deadline = Date.now() + FENCE_AND_RETRY_TIMEOUT_MS;
        try {
            const fencePromise = this.control.fenceOperation(operationId, fenceKind);
            const fence = await this.withDeadline(fencePromise, deadline);
            const verify = await this.withDeadline(this.control.verifyFenced(operationId), deadline);
            return fence.quiescent && verify.quiescent;
        } catch (error) {
            // Toute erreur du control plane vaut preuve absente (fail-closed).
            console.error('[FenceAndRetryService] Gateway fencing failed closed', {
                operationId,
                error: error instanceof Error ? error.message : String(error),
            });
            return false;
        }
    }

    private async withDeadline<T>(promise: Promise<T>, deadline: number): Promise<T> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            return await Promise.race([
                promise,
                new Promise<never>((_, reject) => {
                    const remaining = deadline - Date.now();
                    timer = setTimeout(() => reject(new Error('Fencing deadline exceeded')), Math.max(0, remaining));
                }),
            ]);
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    private async raiseFencingAlert(
        userId: string,
        workspaceId: string,
        runId: string,
        operationId: string | null,
        detail: string,
    ): Promise<void> {
        try {
            await this.alerts.raise({
                severity: 'critical',
                code: 'FENCING_TIMEOUT_ESCALATED',
                message: `Fencing du run ${runId} non prouvé : ${detail}. Verrou workspace retenu.`,
                userId,
                workspaceId,
                runId,
                operationId,
            });
        } catch (error) {
            // L'alerte ne doit jamais empêcher la réponse fail-closed.
            console.error('[FenceAndRetryService] Could not persist fencing alert', {
                runId,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
}
