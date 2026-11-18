import mongoose from 'mongoose';
import { UserToolRun } from '../models/UserToolRun.model';
import { UserToolRunService, UserToolRunStateError } from '../services/userToolRun.service';
import { isEncrypted } from '../utils/encryption';

describe('UserToolRunService', () => {
    const service = new UserToolRunService();

    afterEach(async () => {
        await UserToolRun.deleteMany({});
    });

    function buildCreateData() {
        return {
            executionId: `run-${new mongoose.Types.ObjectId().toString()}`,
            ownerUserId: new mongoose.Types.ObjectId(),
            toolId: new mongoose.Types.ObjectId(),
            toolVersionTag: 'v1',
            toolContentHash: 'hash-v1',
            workflowId: new mongoose.Types.ObjectId(),
            agentPrototypeId: new mongoose.Types.ObjectId(),
            agentInstanceId: new mongoose.Types.ObjectId(),
            launchContext: 'workflow_run' as const,
            runtime: 'python' as const,
            runner: 'docker_rootless' as const,
            inputs: {
                prompt: 'run test'
            },
            policySnapshot: {
                networkMode: 'restricted' as const,
                timeoutSeconds: 60,
                maxMemoryMb: 256,
                secretAliases: []
            }
        };
    }

    it('acknowledges creation and cancellation with majority writes', async () => {
        const data = buildCreateData();
        const save = jest.spyOn(UserToolRun.prototype, 'save');
        const update = jest.spyOn(UserToolRun, 'findOneAndUpdate');
        try {
            await service.createQueuedRun(data);
            expect(save).toHaveBeenCalledWith({
                w: 'majority', wtimeout: 10_000,
            });
            await service.requestCancellation(data.executionId, data.ownerUserId);
            expect(update.mock.calls[0][2]).toEqual(expect.objectContaining({
                writeConcern: { w: 'majority', wtimeoutMS: 10_000 },
            }));

            const running = buildCreateData();
            await service.createQueuedRun(running);
            await service.markRunning(running.executionId);
            update.mockClear();
            await service.requestCancellation(running.executionId, running.ownerUserId);
            expect(update).toHaveBeenCalledTimes(2);
            for (const call of update.mock.calls) {
                expect(call[2]).toEqual(expect.objectContaining({
                    writeConcern: { w: 'majority', wtimeoutMS: 10_000 },
                }));
            }
        } finally {
            save.mockRestore();
            update.mockRestore();
        }
    });

    it('uses majority reads for idempotent cancellation and confirmed run lookup', async () => {
        const data = buildCreateData();
        await service.createQueuedRun(data);
        await service.requestCancellation(data.executionId, data.ownerUserId);
        const readConcern = jest.spyOn(mongoose.Query.prototype, 'readConcern');
        try {
            expect((await service.requestCancellation(data.executionId, data.ownerUserId)).kind).toBe('stopped');
            expect(readConcern).toHaveBeenCalledWith('majority');
            readConcern.mockClear();
            expect((await service.getRunByExecutionId(data.executionId, 'majority'))?.status).toBe('stopped');
            expect(readConcern).toHaveBeenCalledWith('majority');
        } finally {
            readConcern.mockRestore();
        }
    });

    it('creates, starts and completes a run with the expected timing metadata', async () => {
        const createData = buildCreateData();
        const queuedAt = new Date('2026-03-17T11:00:00.000Z');
        const startedAt = new Date('2026-03-17T11:00:05.000Z');
        const finishedAt = new Date('2026-03-17T11:00:17.000Z');

        const queuedRun = await service.createQueuedRun({
            ...createData,
            queuedAt
        });

        expect(queuedRun.status).toBe('queued');
        expect(queuedRun.timing.queuedAt?.toISOString()).toBe(queuedAt.toISOString());
        expect(queuedRun.timing.startedAt).toBeNull();
        expect(queuedRun.timing.finishedAt).toBeNull();

        const runningRun = await service.markRunning(createData.executionId, startedAt);

        expect(runningRun.status).toBe('running');
        expect(runningRun.timing.startedAt?.toISOString()).toBe(startedAt.toISOString());
        expect(runningRun.error).toBeNull();

        const completedRun = await service.completeRun(createData.executionId, {
            outputs: {
                stdout: 'done',
                result: { ok: true }
            },
            resourceUsage: {
                peakMemoryMb: 128,
                cpuMs: 240
            },
            finishedAt
        });

        expect(completedRun.status).toBe('completed');
        expect(completedRun.outputs).toEqual(expect.objectContaining({
            stdout: 'done',
            result: expect.objectContaining({ ok: true })
        }));
        expect(completedRun.resourceUsage).toEqual(expect.objectContaining({
            peakMemoryMb: 128,
            cpuMs: 240
        }));
        expect(completedRun.timing.finishedAt?.toISOString()).toBe(finishedAt.toISOString());
        expect(completedRun.timing.durationMs).toBe(12000);

        const persisted = await service.getRunByExecutionId(createData.executionId);
        expect(persisted?.status).toBe('completed');
    });

    it('allows failing directly from queued state', async () => {
        const createData = buildCreateData();

        await service.createQueuedRun(createData);
        const failedRun = await service.failRun(createData.executionId, {
            error: {
                code: 'TOOL_CRASH',
                message: 'Tool execution crashed',
                retryable: true
            },
            outputs: {
                stderr: 'segmentation fault'
            },
            finishedAt: new Date('2026-03-17T12:00:30.000Z')
        });

        expect(failedRun.status).toBe('failed');
        expect(failedRun.error).toEqual(expect.objectContaining({
            code: 'TOOL_CRASH',
            message: 'Tool execution crashed',
            retryable: true
        }));
        expect(failedRun.outputs).toEqual(expect.objectContaining({
            stderr: 'segmentation fault'
        }));
    });

    it('rejects invalid transitions from terminal states', async () => {
        const createData = buildCreateData();

        await service.createQueuedRun(createData);
        await service.markRunning(createData.executionId, new Date('2026-03-17T13:00:00.000Z'));
        await service.completeRun(createData.executionId, {
            finishedAt: new Date('2026-03-17T13:00:10.000Z')
        });

        await expect(
            service.markRunning(createData.executionId, new Date('2026-03-17T13:00:20.000Z'))
        ).rejects.toBeInstanceOf(UserToolRunStateError);

        await expect(
            service.failRun(createData.executionId, {
                error: {
                    message: 'should not happen'
                }
            })
        ).rejects.toBeInstanceOf(UserToolRunStateError);
    });

    it('persists burst queued runs independently for the same user and tool', async () => {
        const baseData = buildCreateData();
        const burstRuns = Array.from({ length: 10 }, (_, index) => ({
            ...baseData,
            executionId: `run-burst-${index}-${new mongoose.Types.ObjectId().toString()}`,
            inputs: { prompt: `run ${index}` }
        }));

        await Promise.all(burstRuns.map((runData) => service.createQueuedRun(runData)));

        const persistedRuns = await service.listRuns({
            ownerUserId: baseData.ownerUserId,
            toolId: baseData.toolId,
            statuses: ['queued'],
            limit: 20
        });

        expect(persistedRuns).toHaveLength(10);
        expect(persistedRuns.map((run) => run.executionId).sort()).toEqual(burstRuns.map((run) => run.executionId).sort());
    });

    it('allows only one terminal transition to win under concurrent updates on the same run', async () => {
        const createData = buildCreateData();

        await service.createQueuedRun(createData);
        await service.markRunning(createData.executionId, new Date('2026-03-17T14:00:00.000Z'));

        const [completionAttempt, failureAttempt] = await Promise.allSettled([
            service.completeRun(createData.executionId, {
                outputs: { stdout: 'done', result: { ok: true } },
                finishedAt: new Date('2026-03-17T14:00:05.000Z')
            }),
            service.failRun(createData.executionId, {
                error: {
                    code: 'RACE_FAIL',
                    message: 'Concurrent failure should lose once completion wins',
                    retryable: false
                },
                finishedAt: new Date('2026-03-17T14:00:06.000Z')
            })
        ]);

        const fulfilled = [completionAttempt, failureAttempt].filter((result) => result.status === 'fulfilled');
        const rejected = [completionAttempt, failureAttempt].filter((result) => result.status === 'rejected');

        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);
        expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(UserToolRunStateError);

        const persisted = await service.getRunByExecutionId(createData.executionId);
        expect(persisted?.status === 'completed' || persisted?.status === 'failed').toBe(true);

        if (persisted?.status === 'completed') {
            expect(persisted.outputs).toEqual(expect.objectContaining({ stdout: 'done' }));
        }

        if (persisted?.status === 'failed') {
            expect(persisted.error).toEqual(expect.objectContaining({ code: 'RACE_FAIL' }));
        }
    });

    it('persists retry lineage and encrypts private execution context', async () => {
        const createData = buildCreateData();
        const privateContext = { accessToken: 'do-not-store-plaintext', workflow: { id: 'wf-1' } };
        const run = await service.createQueuedRun({
            ...createData,
            retryOfExecutionId: 'parent-run-1',
            requestFingerprint: 'sha256-request-fingerprint',
            privateContext,
        });

        expect(run.retryOfExecutionId).toBe('parent-run-1');
        expect(run.requestFingerprint).toBe('sha256-request-fingerprint');
        expect(run.privateContextCiphertext).toBeTruthy();
        expect(isEncrypted(run.privateContextCiphertext!)).toBe(true);
        expect(run.privateContextCiphertext).not.toContain('do-not-store-plaintext');
        await expect(service.getPrivateContext(run)).resolves.toEqual(privateContext);
    });

    it('stops a queued run atomically and treats a repeated cancellation as idempotent', async () => {
        const createData = buildCreateData();
        await service.createQueuedRun(createData);

        const requestedAt = new Date('2026-03-17T15:00:00.000Z');
        const first = await service.requestCancellation(createData.executionId, createData.ownerUserId, createData.ownerUserId, requestedAt);
        const repeated = await service.requestCancellation(createData.executionId, createData.ownerUserId, createData.ownerUserId, requestedAt);

        expect(first.kind).toBe('stopped');
        expect(repeated.kind).toBe('stopped');
        if (first.kind === 'stopped') {
            expect(first.run.status).toBe('stopped');
            expect(first.run.error?.code).toBe('RUN_CANCELLED');
        }
    });

    it('records a running cancellation request without claiming the runner has stopped', async () => {
        const createData = buildCreateData();
        await service.createQueuedRun(createData);
        await service.markRunning(createData.executionId);

        const requestedAt = new Date('2026-03-17T16:00:00.000Z');
        const first = await service.requestCancellation(createData.executionId, createData.ownerUserId, createData.ownerUserId, requestedAt);
        const repeated = await service.requestCancellation(createData.executionId, createData.ownerUserId, createData.ownerUserId, new Date('2026-03-17T16:00:05.000Z'));

        expect(first.kind).toBe('requested');
        expect(repeated.kind).toBe('requested');
        if (first.kind === 'requested' && repeated.kind === 'requested') {
            expect(first.run.status).toBe('running');
            expect(repeated.run.status).toBe('running');
            expect(first.run.cancellationRequestedAt?.toISOString()).toBe(requestedAt.toISOString());
            expect(repeated.run.cancellationRequestedAt?.toISOString()).toBe(requestedAt.toISOString());
        }
    });

    it('does not expose cancellation state for a run owned by another user', async () => {
        const createData = buildCreateData();
        await service.createQueuedRun(createData);

        const result = await service.requestCancellation(createData.executionId, new mongoose.Types.ObjectId());

        expect(result.kind).toBe('not_found');
        expect((await service.getRunByExecutionId(createData.executionId))?.status).toBe('queued');
    });

    it('publishes queued, started and cancellation-requested runtime events for workflow runs', async () => {
        const publishRunStatusChange = jest.fn(() => true);
        const eventService = new UserToolRunService({ publishRunStatusChange } as any);
        const createData = buildCreateData();
        await eventService.createQueuedRun(createData);
        await eventService.markRunning(createData.executionId);
        const cancellation = await eventService.requestCancellation(
            createData.executionId,
            createData.ownerUserId,
        );

        expect(cancellation.kind).toBe('requested');
        expect(publishRunStatusChange).toHaveBeenNthCalledWith(1, expect.objectContaining({ status: 'queued' }));
        expect(publishRunStatusChange).toHaveBeenNthCalledWith(2, expect.objectContaining({ status: 'running' }));
        expect(publishRunStatusChange).toHaveBeenNthCalledWith(3, expect.objectContaining({
            status: 'running',
            stage: 'cancellation_requested',
            progress: 50,
        }));
    });

    async function createExpiredSupervisedRun(executionId: string, workflowId: mongoose.Types.ObjectId) {
        const data = buildCreateData();
        const run = { ...data, executionId, workflowId };
        await service.createQueuedRun(run);
        await service.markRunning(executionId, new Date(), 'docker_sandbox');
        const attemptId = '123e4567-e89b-42d3-a456-426614174000';
        await UserToolRun.updateOne({ executionId }, {
            $set: {
                lease: { owner: 'worker-1', token: 'lease-token', acquiredAt: new Date(), expiresAt: new Date(0) },
                supervisedAttempt: {
                    attemptId,
                    leaseOwner: 'worker-1',
                    leaseTokenDigest: 'digest',
                    createdAt: new Date(),
                },
            },
        });
        return { ...run, attemptId };
    }

    it('defaults recoveryAttemptCount to 0 and persists an explicit increment on retry lineage', async () => {
        const createData = buildCreateData();
        const run = await service.createQueuedRun(createData);
        expect(run.recoveryAttemptCount).toBe(0);

        const retry = await service.createQueuedRun({
            ...buildCreateData(),
            retryOfExecutionId: createData.executionId,
            recoveryAttemptCount: 1,
        });
        expect(retry.retryOfExecutionId).toBe(createData.executionId);
        expect(retry.recoveryAttemptCount).toBe(1);
        expect((await service.getRunByExecutionId(retry.executionId))?.recoveryAttemptCount).toBe(1);

        await expect(service.createQueuedRun({ ...buildCreateData(), recoveryAttemptCount: -1 }))
            .rejects.toThrow('recoveryAttemptCount must be a non-negative integer');
        await expect(service.createQueuedRun({ ...buildCreateData(), recoveryAttemptCount: 1.5 }))
            .rejects.toThrow('recoveryAttemptCount must be a non-negative integer');
    });

    it('marks an expired supervised run worker_lost (terminal, error.code WORKER_LOST conservé)', async () => {
        const workflowId = new mongoose.Types.ObjectId();
        const { executionId, attemptId } = await createExpiredSupervisedRun(`run-wl-${new mongoose.Types.ObjectId()}`, workflowId);

        await expect(service.listExpiredSupervisedRuns()).resolves.toHaveLength(1);
        await expect(service.markExpiredRunWorkerLost(executionId, attemptId, 'exited')).resolves.toBe(true);

        const stored = await UserToolRun.findOne({ executionId }).select('+supervisedAttempt').lean();
        expect(stored?.status).toBe('worker_lost');
        expect(stored?.error?.code).toBe('WORKER_LOST');
        expect(stored?.error?.retryable).toBe(true);
        expect(stored?.lease).toBeNull();
        expect(stored?.supervisedAttempt?.workerLossReconciliation).toMatchObject({
            containerState: 'exited',
            workspaceLockReleased: false,
        });

        // Irréversible : aucune transition vers queued/running depuis worker_lost.
        await expect(service.markRunning(executionId)).rejects.toBeInstanceOf(UserToolRunStateError);
        await expect(service.failRun(executionId, { error: { message: 'nope' } }))
            .rejects.toBeInstanceOf(UserToolRunStateError);
        expect((await service.getRunByExecutionId(executionId))?.status).toBe('worker_lost');
    });

    it('marks an expired supervised run quarantined when quiescence is unproven and keeps the workspace lock held', async () => {
        const workflowId = new mongoose.Types.ObjectId();
        const { executionId, attemptId } = await createExpiredSupervisedRun(`run-q-${new mongoose.Types.ObjectId()}`, workflowId);
        await UserToolRun.updateOne({ executionId }, { $set: { workspaceRetentionProtected: true } });

        await expect(service.markRunQuarantined(executionId, attemptId)).resolves.toBe(true);

        const stored = await UserToolRun.findOne({ executionId }).select('+supervisedAttempt +workspaceRetentionProtected').lean();
        expect(stored?.status).toBe('quarantined');
        expect(stored?.error?.code).toBe('QUARANTINED');
        expect(stored?.error?.retryable).toBe(true);
        expect(stored?.lease).toBeNull();
        // Verrou tenu : la rétention du workspace reste protégée et aucune réconciliation worker_lost n'est posée.
        expect(stored?.workspaceRetentionProtected).toBe(true);
        expect(stored?.supervisedAttempt?.workerLossReconciliation).toBeUndefined();

        // Irréversible : aucune transition vers queued/running depuis quarantined.
        await expect(service.markRunning(executionId)).rejects.toBeInstanceOf(UserToolRunStateError);
        await expect(service.completeRun(executionId)).rejects.toBeInstanceOf(UserToolRunStateError);
        expect((await service.getRunByExecutionId(executionId))?.status).toBe('quarantined');
    });

    it('does not mark a run whose lease is still valid', async () => {
        const createData = buildCreateData();
        await service.createQueuedRun(createData);
        await service.markRunning(createData.executionId, new Date(), 'docker_sandbox');
        const attemptId = '123e4567-e89b-42d3-a456-426614174000';
        await UserToolRun.updateOne({ executionId: createData.executionId }, {
            $set: {
                lease: { owner: 'worker-1', token: 'lease-token', acquiredAt: new Date(), expiresAt: new Date(Date.now() + 60_000) },
                supervisedAttempt: { attemptId, leaseOwner: 'worker-1', leaseTokenDigest: 'd', createdAt: new Date() },
            },
        });

        await expect(service.markRunQuarantined(createData.executionId, attemptId)).resolves.toBe(false);
        await expect(service.markExpiredRunWorkerLost(createData.executionId, attemptId, 'absent')).resolves.toBe(false);
        expect((await service.getRunByExecutionId(createData.executionId))?.status).toBe('running');
    });

    it('lists worker_lost runs pending lock cleanup only', async () => {
        const workflowId = new mongoose.Types.ObjectId();
        const lost = await createExpiredSupervisedRun(`run-lost-${new mongoose.Types.ObjectId()}`, workflowId);
        await service.markExpiredRunWorkerLost(lost.executionId, lost.attemptId, 'absent');
        const quarantined = await createExpiredSupervisedRun(`run-quar-${new mongoose.Types.ObjectId()}`, workflowId);
        await service.markRunQuarantined(quarantined.executionId, quarantined.attemptId);

        const cleanup = await service.listWorkerLostLockCleanup();
        expect(cleanup.map((entry) => entry.executionId)).toEqual([lost.executionId]);

        await expect(service.markWorkerLostWorkspaceLockReleased(lost.executionId, lost.attemptId)).resolves.toBe(true);
        expect(await service.listWorkerLostLockCleanup()).toHaveLength(0);
        // Un run quarantined n'est jamais éligible au cleanup worker_lost.
        await expect(service.markWorkerLostWorkspaceLockReleased(quarantined.executionId, quarantined.attemptId)).resolves.toBe(false);
    });
});