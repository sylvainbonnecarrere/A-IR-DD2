import mongoose from 'mongoose';
import { MonitoredRunDispatch } from '../services/runtime/MonitoredRunDispatch';
import { MongoWorkspaceLockService } from '../services/runtime/MongoWorkspaceLockService';
import { MongoRunLeaseService, type RunLease, type RunLeaseObservation } from '../services/runtime/MongoRunLeaseService';
import type { ExecutionOrchestratorRequest } from '../services/runtime/ExecutionOrchestrator';
import { DurableRunWorker } from '../services/runtime/DurableRunWorker';
import { UserToolRunService } from '../services/userToolRun.service';
import { UserToolRun } from '../models/UserToolRun.model';

describe('monitored dispatch workspace quarantine', () => {
    const userId = new mongoose.Types.ObjectId().toHexString();
    const workflowId = new mongoose.Types.ObjectId().toHexString();
    const timing = { intervalMs: 100, timeoutMs: 1000, leaseDurationMs: 30_000 };
    const makeLease = (executionId: string): RunLease => ({
        executionId, owner: 'worker', token: 'lease-token', expiresAt: new Date(Date.now() + 30_000),
    });
    const makeRequest = (lease: RunLease): ExecutionOrchestratorRequest => ({
        fn: { _id: new mongoose.Types.ObjectId(), name: 'fixture', language: 'typescript', origin: 'custom', workflowId },
        userId, args: {}, launchContext: 'workflow_run',
        persistedExecutionId: lease.executionId, executeExistingQueued: true,
    });
    const observer = {
        renewAndObserve: async (lease: RunLease): Promise<RunLeaseObservation> => ({ kind: 'active', lease }),
    };

    beforeEach(() => {
        jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    afterEach(async () => {
        if (!mongoose.connection.db) throw new Error('Test database is unavailable');
        await mongoose.connection.db.collection('workspace_execution_locks').deleteMany({});
        jest.restoreAllMocks();
    });

    it('locks before preparation, blocks a concurrent dispatch, and releases after confirmed completion', async () => {
        const locks = new MongoWorkspaceLockService();
        const first = makeLease('first-run');
        const second = makeLease('second-run');
        let preparationStarted!: () => void;
        const started = new Promise<void>((resolve) => { preparationStarted = resolve; });
        let finish!: () => void;
        const gate = new Promise<void>((resolve) => { finish = resolve; });
        const prepare = jest.fn(async () => {
            expect(await locks.tryAcquire(userId, workflowId, 'competing-process')).toBeNull();
            preparationStarted();
            await gate;
        });
        const executor = {
            execute: jest.fn(async (request: ExecutionOrchestratorRequest, preparation: () => Promise<void>) => {
                await preparation();
                return {
                    executionId: request.persistedExecutionId!, status: 'completed' as const,
                    success: true, output: 1, durationMs: 1, exitCode: 0, runner: 'docker_sandbox' as const,
                    metadata: { runnerTerminationConfirmed: true },
                };
            }),
        };
        const dispatch = new MonitoredRunDispatch(observer, {
            reconstructQueuedRun: async (lease) => ({ request: makeRequest(lease), prepareForDispatch: prepare }),
        }, executor, timing, locks, {
            quarantineQueued: async () => false,
            deferQueued: async () => true,
        });
        const work = dispatch.dispatch(first);
        try {
            await started;
            await expect(dispatch.dispatch(second)).resolves.toEqual({ kind: 'deferred', executionId: second.executionId });
        } finally {
            finish();
            await work;
        }
        expect(executor.execute).toHaveBeenCalledTimes(1);
        expect(executor.execute).toHaveBeenCalledWith(
            expect.objectContaining({ workspaceLock: expect.objectContaining({ key: `${userId}:${workflowId}` }) }),
            prepare,
        );
        expect(prepare).toHaveBeenCalledTimes(1);
        const afterCompletion = await locks.tryAcquire(userId, workflowId, 'after-completion');
        expect(afterCompletion).not.toBeNull();
        if (afterCompletion) await locks.release(afterCompletion);
        const record = await mongoose.connection.db!.collection('workspace_execution_locks').findOne({ owner: first.executionId });
        expect(record).toBeNull();
        expect(JSON.stringify((console.warn as jest.Mock).mock.calls)).not.toContain(first.token);
    });

    it('retains the lock when execution throws', async () => {
        const locks = new MongoWorkspaceLockService();
        const lease = makeLease('uncertain-run');
        const dispatch = new MonitoredRunDispatch(observer, {
            reconstructQueuedRun: async () => ({ request: makeRequest(lease), prepareForDispatch: async () => undefined }),
        }, { execute: async () => { throw new Error('runner outcome unknown'); } }, timing, locks);
        await expect(dispatch.dispatch(lease)).rejects.toThrow('runner outcome unknown');
        expect(await locks.tryAcquire(userId, workflowId, 'other')).toBeNull();
    });

    it('retains the lock when the executor returns a running outcome', async () => {
        const locks = new MongoWorkspaceLockService();
        const lease = makeLease('still-running');
        const dispatch = new MonitoredRunDispatch(observer, {
            reconstructQueuedRun: async () => ({ request: makeRequest(lease), prepareForDispatch: async () => undefined }),
        }, { execute: async () => ({
            executionId: lease.executionId, status: 'running', success: false,
            output: null, durationMs: 1, exitCode: 1, runner: 'docker_sandbox',
        }) }, timing, locks);
        expect(await dispatch.dispatch(lease)).toMatchObject({ status: 'running' });
        expect(await locks.tryAcquire(userId, workflowId, 'other')).toBeNull();
    });

    it.each(['retention:cleanup', 'uncertain-run'] as const)(
        'requeues safely while a workspace lock owned by %s is held',
        async (lockOwner) => {
        const runs = new UserToolRunService();
        const leases = new MongoRunLeaseService(timing.leaseDurationMs);
        const executionId = `maintenance-deferred-${new mongoose.Types.ObjectId().toHexString()}`;
        await runs.createQueuedRun({
            executionId,
            ownerUserId: userId,
            toolId: new mongoose.Types.ObjectId(),
            workflowId,
            toolVersionTag: 'v1',
            toolContentHash: 'hash',
            launchContext: 'workflow_run',
            runtime: 'typescript',
            policySnapshot: { networkMode: 'none' },
        });
        const locks = new MongoWorkspaceLockService();
        const heldLock = await locks.tryAcquire(userId, workflowId, lockOwner);
        expect(heldLock).not.toBeNull();
        try {
            const lease = await leases.claimQueued('maintenance-aware-worker');
            expect(lease?.executionId).toBe(executionId);
            const executor = { execute: jest.fn() };
            const dispatch = new MonitoredRunDispatch(leases, {
                reconstructQueuedRun: async (claimedLease) => ({
                    request: makeRequest(claimedLease),
                    prepareForDispatch: async () => undefined,
                }),
            }, executor, timing, locks);

            await expect(dispatch.dispatch(lease!)).resolves.toEqual({ kind: 'deferred', executionId });
            const deferredRun = await UserToolRun.findOne({ executionId })
                .select('+lease +workspaceRetentionProtected')
                .lean();
            expect(deferredRun).toMatchObject({
                status: 'queued',
                lease: null,
                workspaceRetentionProtected: false,
            });
            expect(executor.execute).not.toHaveBeenCalled();
            expect(await locks.tryAcquire(userId, workflowId, 'other')).toBeNull();
        } finally {
            if (heldLock) await locks.release(heldLock);
        }
    });

    it('prevents a replacement worker from entering the quarantined workspace', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
        const runs = new UserToolRunService();
        const leases = new MongoRunLeaseService(30_000);
        for (const executionId of ['first', 'second']) {
            await runs.createQueuedRun({
                executionId, ownerUserId: userId, toolId: new mongoose.Types.ObjectId(), workflowId,
                toolVersionTag: 'v1', toolContentHash: 'hash', launchContext: 'workflow_run',
                runtime: 'typescript', policySnapshot: { networkMode: 'none' },
            });
        }
        let started!: () => void;
        const startedRun = new Promise<void>((resolve) => { started = resolve; });
        const execute = jest.fn(async (request: ExecutionOrchestratorRequest) => {
            await runs.markRunning(request.persistedExecutionId!, new Date(), undefined, request.lease);
            started();
            return {
                executionId: request.persistedExecutionId!, status: 'running' as const, success: false,
                output: null, durationMs: 1, exitCode: 1, runner: 'docker_sandbox' as const,
            };
        });
        const dispatch = new MonitoredRunDispatch(leases, {
            reconstructQueuedRun: async (lease) => ({ request: makeRequest(lease), prepareForDispatch: async () => undefined }),
        }, { execute }, timing);
        const firstWorker = new DurableRunWorker('first-worker', leases, dispatch, 60_000);
        firstWorker.start();
        await startedRun;
        await firstWorker.stop();
        expect(firstWorker.getState()).toBe('stopped');
        expect(firstWorker.getFailure()).toBeUndefined();

        let deferred!: () => void;
        const deferredRun = new Promise<void>((resolve) => { deferred = resolve; });
        const secondWorker = new DurableRunWorker('replacement-worker', leases, {
            dispatch: async (lease) => {
                const result = await dispatch.dispatch(lease);
                if ('kind' in result && result.kind === 'deferred') deferred();
                return result;
            },
        }, 60_000);
        secondWorker.start();
        await deferredRun;
        await secondWorker.stop();
        expect(secondWorker.getState()).toBe('stopped');
        expect(secondWorker.getFailure()).toBeUndefined();
        expect(execute).toHaveBeenCalledTimes(1);
        expect((await runs.getRunByExecutionId('first'))?.status).toBe('running');
        expect((await runs.getRunByExecutionId('second'))?.status).toBe('queued');
    });

    it('releases the acquired lock without executing when monitoring stops during acquisition', async () => {
        const lease = makeLease('aborted-run');
        const locks = new MongoWorkspaceLockService();
        const release = jest.spyOn(locks, 'release');
        let finishAcquire!: () => void;
        const acquiring = new Promise<void>((resolve) => { finishAcquire = resolve; });
        let startedAcquire!: () => void;
        const started = new Promise<void>((resolve) => { startedAcquire = resolve; });
        let lostLease!: () => void;
        const lost = new Promise<void>((resolve) => { lostLease = resolve; });
        let checks = 0;
        const executor = { execute: jest.fn() };
        const dispatch = new MonitoredRunDispatch({
            renewAndObserve: async () => {
                if (++checks === 1) return { kind: 'active', lease };
                lostLease();
                return { kind: 'lost' };
            },
        }, {
            reconstructQueuedRun: async () => ({ request: makeRequest(lease), prepareForDispatch: async () => undefined }),
        }, executor, { intervalMs: 10, timeoutMs: 100, leaseDurationMs: 1000 }, {
            tryAcquire: async () => {
                const lock = await locks.tryAcquire(userId, workflowId, lease.executionId);
                startedAcquire();
                await acquiring;
                return lock;
            },
            release: (lock) => locks.release(lock),
        });
        const work = dispatch.dispatch(lease);
        await started;
        await lost;
        finishAcquire();
        await expect(work).rejects.toThrow('lease_lost');
        expect(executor.execute).not.toHaveBeenCalled();
        expect(release).toHaveBeenCalledTimes(1);
        expect(await locks.tryAcquire(userId, workflowId, 'replacement')).not.toBeNull();
    });

    it.each(['missing', 'error'] as const)(
        'reports %s release failure and never executes after interrupted acquisition',
        async (failure) => {
            const lease = makeLease(`release-${failure}`);
            const locks = new MongoWorkspaceLockService();
            let finishAcquire!: () => void;
            const acquiring = new Promise<void>((resolve) => { finishAcquire = resolve; });
            let startedAcquire!: () => void;
            const started = new Promise<void>((resolve) => { startedAcquire = resolve; });
            let lostLease!: () => void;
            const lost = new Promise<void>((resolve) => { lostLease = resolve; });
            let checks = 0;
            const executor = { execute: jest.fn() };
            const release = failure === 'missing'
                ? jest.fn().mockResolvedValue(false)
                : jest.fn().mockRejectedValue(new Error('Mongo release unavailable'));
            const dispatch = new MonitoredRunDispatch({
                renewAndObserve: async () => {
                    if (++checks === 1) return { kind: 'active', lease };
                    lostLease();
                    return { kind: 'lost' };
                },
            }, {
                reconstructQueuedRun: async () => ({ request: makeRequest(lease), prepareForDispatch: async () => undefined }),
            }, executor, { intervalMs: 10, timeoutMs: 100, leaseDurationMs: 1000 }, {
                tryAcquire: async () => {
                    const lock = await locks.tryAcquire(userId, workflowId, lease.executionId);
                    startedAcquire();
                    await acquiring;
                    return lock;
                },
                release,
            });
            const work = dispatch.dispatch(lease);
            await started;
            await lost;
            finishAcquire();
            await expect(work).rejects.toThrow(
                failure === 'missing' ? 'Workspace lock could not be released' : 'Mongo release unavailable',
            );
            expect(executor.execute).not.toHaveBeenCalled();
            expect(release).toHaveBeenCalledTimes(1);
            expect(await locks.tryAcquire(userId, workflowId, 'replacement')).toBeNull();
        },
    );
});
