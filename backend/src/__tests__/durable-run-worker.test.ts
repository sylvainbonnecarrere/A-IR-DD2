import { logger } from '../services/logger';
import mongoose from 'mongoose';
import { UserToolRun } from '../models/UserToolRun.model';
import { DurableRunWorker } from '../services/runtime/DurableRunWorker';
import { MongoRunLeaseService, type RunLease } from '../services/runtime/MongoRunLeaseService';
import { UserToolRunService } from '../services/userToolRun.service';
import type { OrchestratedExecutionResult } from '../services/runtime/execution.types';

describe('DurableRunWorker', () => {
    const lease: RunLease = { executionId: 'run', owner: 'worker', token: 'token', expiresAt: new Date() };
    const completed: OrchestratedExecutionResult = {
        executionId: 'run', status: 'completed', success: true, output: 1, durationMs: 1, exitCode: 0, runner: 'docker_sandbox',
    };
    const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    it('polls when idle and waits for dispatch before claiming again', async () => {
        jest.useFakeTimers();
        let finish!: (value: OrchestratedExecutionResult) => void;
        const dispatch = jest.fn().mockReturnValue(new Promise<OrchestratedExecutionResult>((resolve) => { finish = resolve; }));
        const claimQueued = jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(lease).mockResolvedValue(null);
        const worker = new DurableRunWorker('worker', { claimQueued, releaseQueued: jest.fn() }, { dispatch }, 100);
        worker.start();
        await flush();
        expect(claimQueued).toHaveBeenCalledTimes(1);
        await jest.advanceTimersByTimeAsync(100);
        expect(dispatch).toHaveBeenCalledWith(lease);
        await jest.advanceTimersByTimeAsync(1000);
        expect(claimQueued).toHaveBeenCalledTimes(2);
        finish(completed);
        await flush();
        expect(claimQueued).toHaveBeenCalledTimes(3);
        await worker.stop();
        expect(worker.getState()).toBe('stopped');
    });

    it('releases without dispatching a claim received after stop was requested', async () => {
        let finish!: (value: RunLease) => void;
        const claimQueued = jest.fn().mockReturnValue(new Promise<RunLease>((resolve) => { finish = resolve; }));
        const dispatch = jest.fn();
        const releaseQueued = jest.fn().mockResolvedValue(true);
        const worker = new DurableRunWorker('worker', { claimQueued, releaseQueued }, { dispatch }, 100);
        worker.start();
        const stopped = worker.stop();
        expect(worker.getState()).toBe('stopping');
        finish(lease);
        await stopped;
        expect(dispatch).not.toHaveBeenCalled();
        expect(releaseQueued).toHaveBeenCalledWith(lease);
        expect(worker.getState()).toBe('stopped');
    });

    it.each(['rejected', 'unconfirmed'] as const)('reports a %s release of an unstarted claim', async (outcome) => {
        jest.spyOn(logger, 'error').mockImplementation(() => undefined);
        let finish!: (value: RunLease) => void;
        const claimQueued = jest.fn().mockReturnValue(new Promise<RunLease>((resolve) => { finish = resolve; }));
        const releaseQueued = outcome === 'rejected'
            ? jest.fn().mockRejectedValue(new Error('private data'))
            : jest.fn().mockResolvedValue(false);
        const dispatch = jest.fn();
        const worker = new DurableRunWorker('worker', { claimQueued, releaseQueued }, { dispatch }, 100);
        worker.start();
        const stopped = worker.stop();
        finish(lease);
        await stopped;
        expect(dispatch).not.toHaveBeenCalled();
        expect(releaseQueued).toHaveBeenCalledWith(lease);
        expect(worker.getState()).toBe('failed');
        expect(worker.getFailure()).toBe('release_failed');
    });

    it('waits for an active dispatch on stop without reclaiming or releasing it', async () => {
        let finish!: (value: OrchestratedExecutionResult) => void;
        const dispatch = jest.fn().mockReturnValue(new Promise<OrchestratedExecutionResult>((resolve) => { finish = resolve; }));
        const claimQueued = jest.fn().mockResolvedValue(lease);
        const releaseQueued = jest.fn();
        const worker = new DurableRunWorker('worker', { claimQueued, releaseQueued }, { dispatch }, 100);
        worker.start();
        await flush();
        const stopped = worker.stop();
        expect(worker.getState()).toBe('stopping');
        finish(completed);
        await stopped;
        expect(claimQueued).toHaveBeenCalledTimes(1);
        expect(releaseQueued).not.toHaveBeenCalled();
        expect(worker.getState()).toBe('stopped');
    });

    it('keeps polling after a dispatch is deferred for temporary workspace maintenance', async () => {
        jest.useFakeTimers();
        const deferred = { kind: 'deferred' as const, executionId: lease.executionId };
        const claimQueued = jest.fn().mockResolvedValue(lease);
        const dispatch = jest.fn().mockResolvedValue(deferred);
        const worker = new DurableRunWorker('worker', { claimQueued, releaseQueued: jest.fn() }, { dispatch }, 100);
        worker.start();
        await flush();
        await flush();

        expect(dispatch).toHaveBeenCalledWith(lease);
        expect(worker.getState()).toBe('running');
        await worker.stop();
        expect(worker.getState()).toBe('stopped');
    });

    it.each(['claim', 'dispatch'])('stops visibly after a %s error without retrying', async (failure) => {
        const log = jest.spyOn(logger, 'error').mockImplementation(() => undefined);
        const claimQueued = failure === 'claim' ? jest.fn().mockRejectedValue(new Error('private data')) : jest.fn().mockResolvedValue(lease);
        const dispatch = jest.fn().mockRejectedValue(new Error('private data'));
        const worker = new DurableRunWorker('worker', { claimQueued, releaseQueued: jest.fn() }, { dispatch }, 100);
        worker.start();
        await flush();
        await flush();
        expect(worker.getState()).toBe('failed');
        expect(worker.getFailure()).toBe(failure === 'claim' ? 'claim_failed' : 'dispatch_failed');
        await worker.stop();
        expect(claimQueued).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(log.mock.calls)).not.toContain('private data');
    });

    it('never dispatches when a committed claim response is lost', async () => {
        jest.spyOn(logger, 'error').mockImplementation(() => undefined);
        const runs = new UserToolRunService();
        await runs.createQueuedRun({
            executionId: 'lost-claim-response', ownerUserId: new mongoose.Types.ObjectId(), toolId: new mongoose.Types.ObjectId(),
            toolVersionTag: 'v1', toolContentHash: 'hash', launchContext: 'editor_test',
            runtime: 'typescript', policySnapshot: { networkMode: 'none' },
        });
        const leases = new MongoRunLeaseService(30_000);
        let committed!: () => void;
        const claimCommitted = new Promise<void>((resolve) => { committed = resolve; });
        const dispatch = jest.fn();
        const worker = new DurableRunWorker('worker', {
            claimQueued: async (owner) => {
                await leases.claimQueued(owner);
                committed();
                throw new Error('simulated lost claim response');
            },
            releaseQueued: (claimed) => leases.releaseQueued(claimed),
        }, { dispatch }, 100);
        worker.start();
        await claimCommitted;
        await worker.stop();
        expect(worker.getState()).toBe('failed');
        expect(worker.getFailure()).toBe('claim_failed');
        expect(dispatch).not.toHaveBeenCalled();
        expect(await leases.claimQueued('other-worker')).toBeNull();
        expect((await runs.getRunByExecutionId('lost-claim-response'))?.status).toBe('queued');
    });

    it('releases a committed but unstarted claim for immediate replacement by another worker', async () => {
        const runs = new UserToolRunService();
        await runs.createQueuedRun({
            executionId: 'stopped-before-dispatch', ownerUserId: new mongoose.Types.ObjectId(), toolId: new mongoose.Types.ObjectId(),
            toolVersionTag: 'v1', toolContentHash: 'hash', launchContext: 'editor_test',
            runtime: 'typescript', policySnapshot: { networkMode: 'none' },
        });
        const leases = new MongoRunLeaseService(30_000);
        let notifyClaimed!: (claimed: RunLease) => void;
        const claimed = new Promise<RunLease>((resolve) => { notifyClaimed = resolve; });
        let returnClaim!: () => void;
        const barrier = new Promise<void>((resolve) => { returnClaim = resolve; });
        const dispatch = jest.fn();
        const worker = new DurableRunWorker('old-worker', {
            claimQueued: async (owner) => {
                const result = await leases.claimQueued(owner);
                if (!result) throw new Error('Expected a claim');
                notifyClaimed(result);
                await barrier;
                return result;
            },
            releaseQueued: (claimedLease) => leases.releaseQueued(claimedLease),
        }, { dispatch }, 100);
        worker.start();
        try {
            const oldLease = await claimed;
            const stopped = worker.stop();
            returnClaim();
            await stopped;
            expect(worker.getState()).toBe('stopped');
            expect(dispatch).not.toHaveBeenCalled();
            const replacement = await leases.claimQueued('replacement-worker');
            expect(replacement?.executionId).toBe(oldLease.executionId);
            expect(replacement?.token).not.toBe(oldLease.token);
            await expect(runs.markRunning(oldLease.executionId, new Date(), undefined, oldLease)).rejects.toThrow();
            expect((await runs.getRunByExecutionId(oldLease.executionId))?.status).toBe('queued');
        } finally {
            returnClaim();
            await worker.stop();
        }
    });

    it('does not release another claim when cancellation races with an unstarted claim', async () => {
        jest.spyOn(logger, 'error').mockImplementation(() => undefined);
        const owner = new mongoose.Types.ObjectId();
        const runs = new UserToolRunService();
        await runs.createQueuedRun({
            executionId: 'cancel-before-dispatch', ownerUserId: owner, toolId: new mongoose.Types.ObjectId(),
            toolVersionTag: 'v1', toolContentHash: 'hash', launchContext: 'editor_test',
            runtime: 'typescript', policySnapshot: { networkMode: 'none' },
        });
        const leases = new MongoRunLeaseService(30_000);
        let notifyClaimed!: () => void;
        const claimed = new Promise<void>((resolve) => { notifyClaimed = resolve; });
        let returnClaim!: () => void;
        const barrier = new Promise<void>((resolve) => { returnClaim = resolve; });
        const dispatch = jest.fn();
        const worker = new DurableRunWorker('old-worker', {
            claimQueued: async (workerOwner) => {
                const result = await leases.claimQueued(workerOwner);
                if (!result) throw new Error('Expected a claim');
                notifyClaimed();
                await barrier;
                return result;
            },
            releaseQueued: (claimedLease) => leases.releaseQueued(claimedLease),
        }, { dispatch }, 100);
        worker.start();
        try {
            await claimed;
            const stopped = worker.stop();
            expect((await runs.requestCancellation('cancel-before-dispatch', owner)).kind).toBe('stopped');
            returnClaim();
            await stopped;
            expect(dispatch).not.toHaveBeenCalled();
            expect(worker.getState()).toBe('failed');
            expect(worker.getFailure()).toBe('release_failed');
            expect((await runs.getRunByExecutionId('cancel-before-dispatch'))?.status).toBe('stopped');
            expect(await leases.claimQueued('replacement-worker')).toBeNull();
        } finally {
            returnClaim();
            await worker.stop();
        }
    });

    it('keeps processing after an uncertain running outcome', async () => {
        const secondLease = { ...lease, executionId: 'second-run' };
        const claimQueued = jest.fn().mockResolvedValueOnce(lease).mockResolvedValueOnce(secondLease).mockResolvedValue(null);
        const dispatch = jest.fn()
            .mockResolvedValueOnce({ ...completed, status: 'running' as const })
            .mockResolvedValueOnce({ ...completed, executionId: secondLease.executionId });
        const worker = new DurableRunWorker('worker', { claimQueued, releaseQueued: jest.fn() }, { dispatch }, 100);
        worker.start();
        await flush();
        await flush();
        expect(worker.getState()).toBe('running');
        expect(worker.getFailure()).toBeUndefined();
        expect(claimQueued).toHaveBeenCalledTimes(3);
        expect(dispatch).toHaveBeenNthCalledWith(1, lease);
        expect(dispatch).toHaveBeenNthCalledWith(2, secondLease);
        await worker.stop();
    });

    it.each([
        ['queued', { ...completed, status: 'queued' as const }],
        ['missing status', { ...completed, status: undefined }],
        ['different execution', { ...completed, executionId: 'other' }],
    ])('stops before claiming further work on %s outcome', async (_label, result) => {
        const log = jest.spyOn(logger, 'error').mockImplementation(() => undefined);
        const claimQueued = jest.fn().mockResolvedValue(lease);
        const dispatch = jest.fn().mockResolvedValue(result);
        const worker = new DurableRunWorker('worker', { claimQueued, releaseQueued: jest.fn() }, { dispatch }, 100);
        worker.start();
        await flush();
        await flush();
        expect(worker.getState()).toBe('failed');
        expect(worker.getFailure()).toBe('unexpected_dispatch_result');
        expect(claimQueued).toHaveBeenCalledTimes(1);
        expect(log).toHaveBeenCalled();
        await worker.stop();
    });

    it('lets only one of two consumers dispatch a run persisted in Mongo', async () => {
        const runs = new UserToolRunService();
        await runs.createQueuedRun({
            executionId: 'worker-compete', ownerUserId: new mongoose.Types.ObjectId(), toolId: new mongoose.Types.ObjectId(),
            toolVersionTag: 'v1', toolContentHash: 'hash', launchContext: 'editor_test',
            runtime: 'typescript', policySnapshot: { networkMode: 'none' },
        });
        const leases = new MongoRunLeaseService(30_000);
        const dispatch = jest.fn();
        const first = new DurableRunWorker('worker-a', leases, { dispatch }, 60_000);
        const second = new DurableRunWorker('worker-b', leases, { dispatch }, 60_000);
        let delivered!: () => void;
        const delivery = new Promise<void>((resolve) => { delivered = resolve; });
        dispatch.mockImplementation(async (claimed: RunLease) => {
            delivered();
            return { ...completed, executionId: claimed.executionId };
        });
        first.start();
        second.start();
        await delivery;
        await Promise.all([first.stop(), second.stop()]);
        expect(dispatch).toHaveBeenCalledTimes(1);
        expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ executionId: 'worker-compete' }));
    });

    it('reclaims an expired queued lease but leaves an expired running lease untouched', async () => {
        const runs = new UserToolRunService();
        const create = async (executionId: string) => runs.createQueuedRun({
            executionId, ownerUserId: new mongoose.Types.ObjectId(), toolId: new mongoose.Types.ObjectId(),
            toolVersionTag: 'v1', toolContentHash: 'hash', launchContext: 'editor_test',
            runtime: 'typescript', policySnapshot: { networkMode: 'none' },
        });
        const leases = new MongoRunLeaseService(30_000);
        await create('abandoned-running');
        const runningLease = (await leases.claimQueued('old-worker'))!;
        await runs.markRunning(runningLease.executionId, new Date(), undefined, runningLease);
        await create('abandoned-queued');
        const queuedLease = (await leases.claimQueued('old-worker'))!;
        await UserToolRun.updateMany(
            { executionId: { $in: [runningLease.executionId, queuedLease.executionId] } },
            { $set: { 'lease.expiresAt': new Date(0) } },
        );
        let delivered!: () => void;
        const delivery = new Promise<void>((resolve) => { delivered = resolve; });
        const dispatch = jest.fn().mockImplementation(async (claimed: RunLease) => {
            delivered();
            return { ...completed, executionId: claimed.executionId };
        });
        const worker = new DurableRunWorker('new-worker', leases, { dispatch }, 60_000);
        worker.start();
        await delivery;
        await worker.stop();
        expect(dispatch).toHaveBeenCalledTimes(1);
        expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ executionId: 'abandoned-queued' }));
        expect((await runs.getRunByExecutionId('abandoned-running'))?.status).toBe('running');
    });

    it('validates configuration and does not restart an instance', async () => {
        const leases = { claimQueued: jest.fn().mockResolvedValue(null), releaseQueued: jest.fn() };
        const dispatcher = { dispatch: jest.fn() };
        expect(() => new DurableRunWorker(' ', leases, dispatcher, 10)).toThrow('owner');
        expect(() => new DurableRunWorker('worker', leases, dispatcher, 0)).toThrow('interval');
        const worker = new DurableRunWorker('worker', leases, dispatcher, 10);
        await worker.stop();
        expect(() => worker.start()).toThrow('only be started once');
    });
});
