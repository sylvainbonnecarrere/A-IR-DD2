import mongoose from 'mongoose';
import { assertUserToolRunTransition } from '../domain/execution/userToolRun.contract';
import { decrypt, encrypt } from '../utils/encryption';
import {
    IUserToolRun,
    IUserToolRunError,
    IUserToolRunOutputs,
    IUserToolRunPolicySnapshot,
    IUserToolRunResourceUsage,
    UserToolRun,
    UserToolRunLaunchContext,
    UserToolRunRunner,
    UserToolRunRuntime,
    UserToolRunStatus
} from '../models';
import { createRuntimeEventPublisher, RuntimeEventPublisher } from './runtimeEventPublisher.service';
import type { RunLease } from './runtime/MongoRunLeaseService';
import { DURABLE_RUN_WRITE_CONCERN } from './runtime/durableRunWriteConcern';
import { isReconstructionRejectionCode, type RunReconstructionRejectionCode } from '../domain/execution/runReconstructionQuarantine';

type ObjectIdLike = mongoose.Types.ObjectId | string | null | undefined;

export interface CreateUserToolRunData {
    executionId: string;
    ownerUserId: ObjectIdLike;
    toolId: ObjectIdLike;
    toolVersionTag: string;
    toolContentHash: string;
    launchContext: UserToolRunLaunchContext;
    runtime: UserToolRunRuntime;
    runner?: UserToolRunRunner;
    inputs?: Record<string, unknown>;
    policySnapshot: IUserToolRunPolicySnapshot;
    workflowId?: ObjectIdLike;
    agentPrototypeId?: ObjectIdLike;
    agentInstanceId?: ObjectIdLike;
    retryOfExecutionId?: string;
    requestFingerprint?: string;
    targetFingerprint?: string;
    privateContext?: Record<string, unknown>;
    queuedAt?: Date;
}

export interface CompleteUserToolRunData {
    outputs?: IUserToolRunOutputs | null;
    resourceUsage?: IUserToolRunResourceUsage;
    finishedAt?: Date;
}

export interface FailUserToolRunData {
    error: IUserToolRunError;
    outputs?: IUserToolRunOutputs | null;
    resourceUsage?: IUserToolRunResourceUsage;
    finishedAt?: Date;
}

export interface StopUserToolRunData {
    error?: IUserToolRunError | null;
    outputs?: IUserToolRunOutputs | null;
    resourceUsage?: IUserToolRunResourceUsage;
    finishedAt?: Date;
}

export interface ListUserToolRunsFilter {
    ownerUserId?: ObjectIdLike;
    workflowId?: ObjectIdLike;
    toolId?: ObjectIdLike;
    agentInstanceId?: ObjectIdLike;
    statuses?: UserToolRunStatus[];
    limit?: number;
}

export interface ExpiredSupervisedRun {
    executionId: string;
    ownerUserId: string;
    workflowId: string | null;
    attemptId: string;
}

export interface WorkerLostLockCleanup {
    executionId: string;
    ownerUserId: string;
    workflowId: string;
    attemptId: string;
}

export type WorkerLostContainerState = 'absent' | 'created' | 'exited' | 'dead';

export class UserToolRunStateError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'UserToolRunStateError';
    }
}

function toObjectId(value: ObjectIdLike, fieldName: string): mongoose.Types.ObjectId {
    if (!value) {
        throw new Error(`${fieldName} is required`);
    }

    if (value instanceof mongoose.Types.ObjectId) {
        return value;
    }

    if (!mongoose.Types.ObjectId.isValid(value)) {
        throw new Error(`${fieldName} must be a valid ObjectId`);
    }

    return new mongoose.Types.ObjectId(value);
}

function toOptionalObjectId(value: ObjectIdLike): mongoose.Types.ObjectId | null {
    if (!value) {
        return null;
    }

    if (value instanceof mongoose.Types.ObjectId) {
        return value;
    }

    if (!mongoose.Types.ObjectId.isValid(value)) {
        throw new Error('Optional ObjectId value must be a valid ObjectId');
    }

    return new mongoose.Types.ObjectId(value);
}

function computeDurationMs(startedAt?: Date | null, finishedAt?: Date | null): number | null {
    if (!startedAt || !finishedAt) {
        return null;
    }

    const duration = finishedAt.getTime() - startedAt.getTime();
    return duration >= 0 ? duration : 0;
}

export class UserToolRunService {
    private readonly runtimeEventPublisher?: RuntimeEventPublisher;

    constructor(runtimeEventPublisher: RuntimeEventPublisher = createRuntimeEventPublisher()) {
        this.runtimeEventPublisher = runtimeEventPublisher;
    }

    async createQueuedRun(data: CreateUserToolRunData): Promise<IUserToolRun> {
        if (!data.executionId?.trim()) {
            throw new Error('executionId is required');
        }

        const queuedAt = data.queuedAt ?? new Date();
        const ownerUserId = toObjectId(data.ownerUserId, 'ownerUserId');

        const run = new UserToolRun({
            executionId: data.executionId.trim(),
            ownerUserId,
            toolId: toObjectId(data.toolId, 'toolId'),
            toolVersionTag: data.toolVersionTag,
            toolContentHash: data.toolContentHash,
            workflowId: toOptionalObjectId(data.workflowId),
            agentPrototypeId: toOptionalObjectId(data.agentPrototypeId),
            agentInstanceId: toOptionalObjectId(data.agentInstanceId),
            retryOfExecutionId: data.retryOfExecutionId ?? null,
            requestFingerprint: data.requestFingerprint ?? null,
            targetFingerprint: data.targetFingerprint ?? null,
            privateContextCiphertext: data.privateContext
                ? encrypt(JSON.stringify(data.privateContext), ownerUserId.toString())
                : null,
            cancellationRequestedAt: null,
            cancellationRequestedBy: null,
            launchContext: data.launchContext,
            status: 'queued',
            runtime: data.runtime,
            runner: data.runner ?? 'docker_sandbox',
            inputs: data.inputs ?? {},
            outputs: null,
            policySnapshot: data.policySnapshot,
            timing: {
                queuedAt,
                startedAt: null,
                finishedAt: null,
                durationMs: null
            },
            error: null
        });

        await run.save({ w: DURABLE_RUN_WRITE_CONCERN.w, wtimeout: DURABLE_RUN_WRITE_CONCERN.wtimeoutMS });
        this.publishRuntimeStateChange(run, 'queued', 'queued');
        return run;
    }

    async requestCancellation(
        executionId: string,
        ownerUserId: ObjectIdLike,
        requestedBy: ObjectIdLike = ownerUserId,
        requestedAt: Date = new Date(),
    ): Promise<
        | { kind: 'stopped'; run: IUserToolRun }
        | { kind: 'requested'; run: IUserToolRun }
        | { kind: 'not_found' }
        | { kind: 'not_cancellable'; run: IUserToolRun }
    > {
        const ownerId = toObjectId(ownerUserId, 'ownerUserId');
        const requestedById = toObjectId(requestedBy, 'requestedBy');
        const cancelledError: IUserToolRunError = {
            code: 'RUN_CANCELLED',
            subsystem: 'validation',
            failureKind: 'cancelled',
            message: 'Run annulé par l’utilisateur',
            retryable: false,
        };

        const stoppedQueuedRun = await UserToolRun.findOneAndUpdate(
            { executionId, ownerUserId: ownerId, status: 'queued' },
            {
                $set: {
                    status: 'stopped',
                    error: cancelledError,
                    cancellationRequestedAt: requestedAt,
                    cancellationRequestedBy: requestedById,
                    lease: null,
                    workspaceRetentionProtected: false,
                    reconstructionQuarantine: null,
                    'timing.finishedAt': requestedAt,
                    'timing.durationMs': null,
                },
            },
            { new: true, writeConcern: DURABLE_RUN_WRITE_CONCERN },
        );

        if (stoppedQueuedRun) {
            this.publishRuntimeStateChange(stoppedQueuedRun, 'queued', 'stopped');
            return { kind: 'stopped', run: stoppedQueuedRun };
        }

        const requestedRunningRun = await UserToolRun.findOneAndUpdate(
            {
                executionId,
                ownerUserId: ownerId,
                status: 'running',
                cancellationRequestedAt: null,
            },
            {
                $set: {
                    cancellationRequestedAt: requestedAt,
                    cancellationRequestedBy: requestedById,
                },
            },
            { new: true, writeConcern: DURABLE_RUN_WRITE_CONCERN },
        );

        if (requestedRunningRun) {
            this.publishCancellationRequested(requestedRunningRun);
            return { kind: 'requested', run: requestedRunningRun };
        }

        const currentRun = await UserToolRun.findOne({ executionId, ownerUserId: ownerId })
            .read('primary').readConcern('majority').maxTimeMS(10_000);
        if (!currentRun) {
            return { kind: 'not_found' };
        }

        if (currentRun.status === 'running' && currentRun.cancellationRequestedAt) {
            return { kind: 'requested', run: currentRun };
        }

        if (currentRun.status === 'stopped' && currentRun.error?.code === 'RUN_CANCELLED') {
            return { kind: 'stopped', run: currentRun };
        }

        return { kind: 'not_cancellable', run: currentRun };
    }

    async getPrivateContext(run: IUserToolRun): Promise<Record<string, unknown> | undefined> {
        const ciphertext = run.privateContextCiphertext;
        if (!ciphertext) {
            return undefined;
        }

        const plaintext = decrypt(ciphertext, run.ownerUserId.toString());
        const parsed: unknown = JSON.parse(plaintext);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            throw new Error('Persisted run private context must be a record');
        }

        return parsed as Record<string, unknown>;
    }

    async createAndStartRun(
        data: CreateUserToolRunData,
        startedAt: Date = new Date()
    ): Promise<IUserToolRun> {
        await this.createQueuedRun(data);
        return this.markRunning(data.executionId, startedAt);
    }

    async markRunning(executionId: string, startedAt: Date = new Date(), runner?: UserToolRunRunner, lease?: RunLease): Promise<IUserToolRun> {
        const run = await this.getRequiredRun(executionId);
        this.assertTransitionAllowed(run.status, 'running', executionId);

        return this.applyTransition(
            executionId,
            run.status,
            'running',
            {
                status: 'running',
                ...(runner ? { runner } : {}),
                error: null,
                'timing.startedAt': startedAt,
                'timing.finishedAt': null,
                'timing.durationMs': null
            },
            lease
        );
    }

    async assertRunningLease(lease: RunLease): Promise<void> {
        const run = await UserToolRun.findOne({
            executionId: lease.executionId,
            status: 'running',
            'lease.owner': lease.owner,
            'lease.token': lease.token,
            cancellationRequestedAt: null,
            $expr: { $gt: ['$lease.expiresAt', '$$NOW'] },
        }).read('primary').readConcern('majority').maxTimeMS(10_000);
        if (!run) {
            throw new UserToolRunStateError(`Invalid UserToolRun transition or lease for ${lease.executionId}`);
        }
    }

    async completeRun(executionId: string, data: CompleteUserToolRunData = {}, lease?: RunLease): Promise<IUserToolRun> {
        const finishedAt = data.finishedAt ?? new Date();
        const run = await this.getRequiredRun(executionId);
        this.assertTransitionAllowed(run.status, 'completed', executionId);

        return this.applyTransition(
            executionId,
            run.status,
            'completed',
            {
                status: 'completed',
                outputs: data.outputs ?? run.outputs ?? null,
                error: null,
                resourceUsage: data.resourceUsage ?? run.resourceUsage,
                'timing.finishedAt': finishedAt,
                'timing.durationMs': computeDurationMs(run.timing.startedAt ?? null, finishedAt)
            },
            lease
        );
    }

    async failRun(executionId: string, data: FailUserToolRunData, lease?: RunLease): Promise<IUserToolRun> {
        const finishedAt = data.finishedAt ?? new Date();
        const run = await this.getRequiredRun(executionId);
        this.assertTransitionAllowed(run.status, 'failed', executionId);

        return this.applyTransition(
            executionId,
            run.status,
            'failed',
            {
                status: 'failed',
                error: data.error,
                outputs: data.outputs ?? run.outputs ?? null,
                resourceUsage: data.resourceUsage ?? run.resourceUsage,
                'timing.finishedAt': finishedAt,
                'timing.durationMs': computeDurationMs(run.timing.startedAt ?? null, finishedAt)
            },
            lease
        );
    }

    async timeoutRun(executionId: string, data: StopUserToolRunData = {}, lease?: RunLease): Promise<IUserToolRun> {
        return this.finishWithTerminalStatus(executionId, 'timed_out', data, lease);
    }

    async stopRun(executionId: string, data: StopUserToolRunData = {}, lease?: RunLease): Promise<IUserToolRun> {
        return this.finishWithTerminalStatus(executionId, 'stopped', data, lease);
    }

    async getRunByExecutionId(
        executionId: string,
        consistency: 'local' | 'majority' = 'local',
        ownerUserId?: ObjectIdLike,
    ): Promise<IUserToolRun | null> {
        const query = UserToolRun.findOne({
            executionId,
            ...(ownerUserId ? { ownerUserId: toObjectId(ownerUserId, 'ownerUserId') } : {}),
        });
        return consistency === 'majority'
            ? query.read('primary').readConcern('majority').maxTimeMS(10_000)
            : query;
    }

    async listExpiredSupervisedRuns(): Promise<ExpiredSupervisedRun[]> {
        const runs = await UserToolRun.find({
            status: 'running',
            $expr: { $lte: ['$lease.expiresAt', '$$NOW'] },
            'supervisedAttempt.attemptId': { $type: 'string' },
        })
            .select('executionId ownerUserId workflowId')
            .select('+supervisedAttempt')
            .read('primary')
            .readConcern('majority')
            .maxTimeMS(10_000)
            .lean();
        return runs.flatMap((run) => {
            const attemptId = run.supervisedAttempt?.attemptId;
            if (!attemptId) return [];
            return [{
                executionId: run.executionId,
                ownerUserId: run.ownerUserId.toString(),
                workflowId: run.workflowId?.toString() ?? null,
                attemptId,
            }];
        });
    }

    async listWorkerLostLockCleanup(): Promise<WorkerLostLockCleanup[]> {
        const runs = await UserToolRun.find({
            status: 'failed',
            'error.code': 'WORKER_LOST',
            workflowId: { $type: 'objectId' },
            'supervisedAttempt.workerLossReconciliation.workspaceLockReleased': false,
        })
            .select('executionId ownerUserId workflowId')
            .select('+supervisedAttempt')
            .read('primary')
            .readConcern('majority')
            .maxTimeMS(10_000)
            .lean();
        return runs.flatMap((run) => {
            const attemptId = run.supervisedAttempt?.attemptId;
            if (!attemptId || !run.workflowId) return [];
            return [{
                executionId: run.executionId,
                ownerUserId: run.ownerUserId.toString(),
                workflowId: run.workflowId.toString(),
                attemptId,
            }];
        });
    }

    async markExpiredRunWorkerLost(
        executionId: string,
        attemptId: string,
        containerState: WorkerLostContainerState,
    ): Promise<boolean> {
        if (!executionId.trim() || !attemptId.trim()
            || !['absent', 'created', 'exited', 'dead'].includes(containerState)) {
            throw new Error('Worker-loss reconciliation identity or proof is invalid');
        }
        const run = await UserToolRun.findOneAndUpdate(
            {
                executionId,
                status: 'running',
                'supervisedAttempt.attemptId': attemptId,
                $expr: { $lte: ['$lease.expiresAt', '$$NOW'] },
            },
            [{
                $set: {
                    status: 'failed',
                    error: {
                        code: 'WORKER_LOST',
                        subsystem: 'runner',
                        failureKind: 'worker_lost',
                        message: 'Le worker a été perdu ; le conteneur Docker supervisé a été réconcilié comme arrêté.',
                        retryable: true,
                    },
                    'timing.finishedAt': '$$NOW',
                    'timing.durationMs': {
                        $cond: [
                            { $eq: [{ $ifNull: ['$timing.startedAt', null] }, null] },
                            null,
                            { $subtract: ['$$NOW', '$timing.startedAt'] },
                        ],
                    },
                    lease: null,
                    workspaceRetentionProtected: false,
                    'supervisedAttempt.dockerJournal.admission': 'closed',
                    'supervisedAttempt.dockerJournal.pending': null,
                    'supervisedAttempt.dockerJournal.hasUnknownOutcome': false,
                    'supervisedAttempt.workerLossReconciliation': {
                        containerName: `airdd2-j7-attempt-${attemptId}`,
                        containerState: { $literal: containerState },
                        verifiedAt: '$$NOW',
                        workspaceLockReleased: { $eq: [{ $ifNull: ['$workflowId', null] }, null] },
                    },
                },
            }],
            { new: true, writeConcern: DURABLE_RUN_WRITE_CONCERN },
        );
        if (!run) return false;
        this.publishRuntimeStateChange(run, 'running', 'failed');
        return true;
    }

    async markWorkerLostWorkspaceLockReleased(executionId: string, attemptId: string): Promise<boolean> {
        const result = await UserToolRun.updateOne(
            {
                executionId,
                status: 'failed',
                'error.code': 'WORKER_LOST',
                'supervisedAttempt.attemptId': attemptId,
                'supervisedAttempt.workerLossReconciliation.workspaceLockReleased': false,
            },
            { $set: { 'supervisedAttempt.workerLossReconciliation.workspaceLockReleased': true } },
            { writeConcern: DURABLE_RUN_WRITE_CONCERN },
        );
        return result.modifiedCount === 1;
    }

    async failQuarantinedRun(
        executionId: string,
        expectedCode: RunReconstructionRejectionCode,
        resolvedBy: ObjectIdLike,
    ): Promise<{ kind: 'failed'; run: IUserToolRun } | { kind: 'not_found' } | { kind: 'conflict' }> {
        if (!isReconstructionRejectionCode(expectedCode)) {
            throw new Error('Invalid reconstruction quarantine code');
        }
        const actorId = toObjectId(resolvedBy, 'resolvedBy');
        const run = await UserToolRun.findOneAndUpdate(
            {
                executionId,
                status: 'queued',
                'reconstructionQuarantine.code': expectedCode,
                'reconstructionQuarantine.resolution': { $exists: false },
                lease: null,
                cancellationRequestedAt: null,
            },
            [{
                $set: {
                    reconstructionQuarantineResolution: {
                        code: '$reconstructionQuarantine.code',
                        quarantinedAt: '$reconstructionQuarantine.quarantinedAt',
                        resolution: 'failed',
                        resolvedAt: '$$NOW',
                        resolvedBy: { $literal: actorId },
                    },
                    reconstructionQuarantine: null,
                    status: 'failed',
                    error: {
                        code: 'RUN_RECONSTRUCTION_REJECTED',
                        subsystem: 'validation',
                        failureKind: 'reconstruction_rejected',
                        message: 'Run clôturé par un administrateur après rejet de reconstruction.',
                        retryable: false,
                    },
                    'timing.finishedAt': '$$NOW',
                    'timing.durationMs': null,
                },
            }],
            { new: true, writeConcern: DURABLE_RUN_WRITE_CONCERN },
        );
        if (run) {
            this.publishRuntimeStateChange(run, 'queued', 'failed');
            return { kind: 'failed', run };
        }

        const current = await UserToolRun.exists({ executionId });
        return current ? { kind: 'conflict' } : { kind: 'not_found' };
    }

    async listRuns(filter: ListUserToolRunsFilter = {}): Promise<IUserToolRun[]> {
        const query: Record<string, unknown> = {};

        if (filter.ownerUserId) {
            query.ownerUserId = toObjectId(filter.ownerUserId, 'ownerUserId');
        }

        if (filter.workflowId) {
            query.workflowId = toObjectId(filter.workflowId, 'workflowId');
        }

        if (filter.toolId) {
            query.toolId = toObjectId(filter.toolId, 'toolId');
        }

        if (filter.agentInstanceId) {
            query.agentInstanceId = toObjectId(filter.agentInstanceId, 'agentInstanceId');
        }

        if (filter.statuses && filter.statuses.length > 0) {
            query.status = { $in: filter.statuses };
        }

        return UserToolRun.find(query)
            .sort({ createdAt: -1 })
            .limit(filter.limit ?? 50);
    }

    async listActiveRunsForUser(ownerUserId: ObjectIdLike): Promise<IUserToolRun[]> {
        return this.listRuns({
            ownerUserId,
            statuses: ['queued', 'running'],
            limit: 100
        });
    }

    private async finishWithTerminalStatus(
        executionId: string,
        status: Extract<UserToolRunStatus, 'stopped' | 'timed_out'>,
        data: StopUserToolRunData,
        lease?: RunLease
    ): Promise<IUserToolRun> {
        const finishedAt = data.finishedAt ?? new Date();
        const run = await this.getRequiredRun(executionId);
        this.assertTransitionAllowed(run.status, status, executionId);

        return this.applyTransition(
            executionId,
            run.status,
            status,
            {
                status,
                error: data.error ?? run.error ?? null,
                outputs: data.outputs ?? run.outputs ?? null,
                resourceUsage: data.resourceUsage ?? run.resourceUsage,
                'timing.finishedAt': finishedAt,
                'timing.durationMs': computeDurationMs(run.timing.startedAt ?? null, finishedAt)
            },
            lease
        );
    }

    private async applyTransition(
        executionId: string,
        currentStatus: UserToolRunStatus,
        nextStatus: UserToolRunStatus,
        patch: Record<string, unknown>,
        lease?: RunLease
    ): Promise<IUserToolRun> {
        if (lease && lease.executionId !== executionId) {
            throw new UserToolRunStateError(`Lease does not belong to executionId '${executionId}'`);
        }
        const updatedRun = await UserToolRun.findOneAndUpdate(
            {
                executionId,
                status: currentStatus,
                reconstructionQuarantine: null,
                ...(lease
                    ? {
                        'lease.owner': lease.owner,
                        'lease.token': lease.token,
                        $expr: { $gt: ['$lease.expiresAt', '$$NOW'] },
                    }
                    : { lease: null }),
            },
            {
                $set: {
                    ...patch,
                    ...(nextStatus === 'running' ? {} : { lease: null, workspaceRetentionProtected: false }),
                }
            },
            {
                new: true,
                ...(lease ? { writeConcern: DURABLE_RUN_WRITE_CONCERN } : {}),
            }
        );

        if (updatedRun) {
            this.publishRuntimeStateChange(updatedRun, currentStatus, nextStatus);
            return updatedRun;
        }

        const currentRun = await this.getRunByExecutionId(executionId);
        if (!currentRun) {
            throw new Error(`UserToolRun not found for executionId '${executionId}'`);
        }

        throw new UserToolRunStateError(
            `Invalid UserToolRun transition or lease for ${executionId}: ${currentRun.status} -> ${nextStatus}`
        );
    }

    private publishRuntimeStateChange(
        run: IUserToolRun,
        previousStatus: UserToolRunStatus,
        nextStatus: UserToolRunStatus,
    ): void {
        if (!this.runtimeEventPublisher || !run.workflowId) {
            return;
        }

        const workspaceId = run.workflowId.toString();
        const payload: Record<string, unknown> = {
            status: nextStatus,
            stage: nextStatus === 'running' ? 'execution' : nextStatus === 'completed' ? 'finalize' : 'terminal',
            durationMs: run.timing?.durationMs ?? undefined,
            message: run.error?.message ?? undefined,
            resultCount: Array.isArray(run.outputs?.artifacts) ? run.outputs.artifacts.length : undefined,
            workflowId: workspaceId,
            runId: run.executionId,
            agentId: run.agentInstanceId?.toString() ?? undefined,
        };

        const progress = nextStatus === 'running' ? 50 : nextStatus === 'completed' ? 100 : nextStatus === 'failed' || nextStatus === 'stopped' || nextStatus === 'timed_out' ? 100 : undefined;

        this.runtimeEventPublisher.publishRunStatusChange({
            workspaceId,
            roomWorkspaceId: workspaceId,
            runId: run.executionId,
            status: nextStatus,
            progress,
            message: payload.message as string | undefined,
            stage: payload.stage as string | undefined,
            durationMs: payload.durationMs as number | undefined,
            resultCount: payload.resultCount as number | undefined,
            workflowId: workspaceId,
            agentId: payload.agentId as string | undefined,
            errorCode: run.error?.code ?? undefined,
            correlationId: `run:${run.executionId}:${previousStatus}->${nextStatus}`,
        });
    }

    private publishCancellationRequested(run: IUserToolRun): void {
        if (!this.runtimeEventPublisher || !run.workflowId) {
            return;
        }

        const workflowId = run.workflowId.toString();
        this.runtimeEventPublisher.publishRunStatusChange({
            workspaceId: workflowId,
            roomWorkspaceId: workflowId,
            runId: run.executionId,
            status: 'running',
            progress: 50,
            stage: 'cancellation_requested',
            message: 'Cancellation requested',
            workflowId,
            agentId: run.agentInstanceId?.toString() ?? undefined,
            correlationId: `run:${run.executionId}:cancellation_requested`,
        });
    }

    private async getRequiredRun(executionId: string): Promise<IUserToolRun> {
        const run = await this.getRunByExecutionId(executionId);
        if (!run) {
            throw new Error(`UserToolRun not found for executionId '${executionId}'`);
        }
        return run;
    }

    private assertTransitionAllowed(
        currentStatus: UserToolRunStatus,
        nextStatus: UserToolRunStatus,
        executionId: string
    ): void {
        try {
            assertUserToolRunTransition(currentStatus, nextStatus, executionId);
        } catch (error) {
            throw new UserToolRunStateError(
                error instanceof Error
                    ? error.message
                    : `Invalid UserToolRun transition for ${executionId}: ${currentStatus} -> ${nextStatus}`
            );
        }
    }
}