import { logger } from '../services/logger';
import mongoose from 'mongoose';
import { UserToolRun } from '../models/UserToolRun.model';
import { UserToolRunService } from '../services/userToolRun.service';
import { UserToolRunQueryService } from '../services/userToolRunQuery.service';
import { DurableRunWorker } from '../services/runtime/DurableRunWorker';
import { MongoRunLeaseService } from '../services/runtime/MongoRunLeaseService';
import { MonitoredRunDispatch } from '../services/runtime/MonitoredRunDispatch';
import { RunReconstructionRejection } from '../services/runtime/RunReconstructionRejection';
import { ExecutionOrchestrator } from '../services/runtime/ExecutionOrchestrator';

describe('queued run reconstruction quarantine', () => {
    const runs = new UserToolRunService();
    const leases = new MongoRunLeaseService(30_000);
    const owner = new mongoose.Types.ObjectId();

    async function create(executionId: string) {
        await runs.createQueuedRun({
            executionId, ownerUserId: owner, toolId: new mongoose.Types.ObjectId(),
            toolVersionTag: 'v1', toolContentHash: 'hash', launchContext: 'editor_test',
            runtime: 'typescript', policySnapshot: { networkMode: 'none' },
        });
    }

    afterEach(() => jest.restoreAllMocks());

    it('quarantines only the rejected run, exposes its reason, and executes the next run', async () => {
        jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
        await create('first-rejected');
        await create('second-ready');
        let notify!: () => void;
        const completed = new Promise<void>((resolve) => { notify = resolve; });
        const executor = jest.fn(async (request: { lease?: { executionId: string; owner: string; token: string; expiresAt: Date } }) => {
            if (!request.lease) throw new Error('Missing lease');
            await runs.markRunning(request.lease.executionId, new Date(), undefined, request.lease);
            await runs.completeRun(request.lease.executionId, {}, request.lease);
            notify();
            return { executionId: request.lease.executionId, status: 'completed' as const, success: true,
                output: null, durationMs: 1, exitCode: 0, runner: 'docker_sandbox' as const };
        });
        const dispatch = new MonitoredRunDispatch(leases, {
            reconstructQueuedRun: async (lease) => {
                if (lease.executionId === 'first-rejected') throw new RunReconstructionRejection('RUN_TARGET_CHANGED');
                return { request: {
                    fn: { _id: new mongoose.Types.ObjectId(), name: 'fixture', language: 'typescript', origin: 'custom' },
                    userId: owner.toString(), args: {}, launchContext: 'editor_test',
                    persistedExecutionId: lease.executionId, executeExistingQueued: true,
                }, prepareForDispatch: async () => undefined };
            },
        }, { execute: executor }, { intervalMs: 100, timeoutMs: 1000, leaseDurationMs: 30_000 });
        const worker = new DurableRunWorker('worker', leases, dispatch, 60_000);
        worker.start();
        try {
            await completed;
        } finally {
            await worker.stop();
        }
        expect(worker.getState()).toBe('stopped');
        expect(executor).toHaveBeenCalledTimes(1);
        expect(await runs.getRunByExecutionId('first-rejected')).toMatchObject({
            status: 'queued', lease: null, reconstructionQuarantine: { code: 'RUN_TARGET_CHANGED', quarantinedAt: expect.any(Date) },
        });
        expect(await new UserToolRunQueryService().getRunByExecutionId(owner.toString(), 'first-rejected'))
            .toMatchObject({ reconstructionQuarantine: { code: 'RUN_TARGET_CHANGED' } });
        expect(await new UserToolRunQueryService().getRunByExecutionId(new mongoose.Types.ObjectId().toString(), 'first-rejected')).toBeNull();
        expect((await runs.getRunByExecutionId('second-ready'))?.status).toBe('completed');
        expect(await leases.claimQueued('replacement')).toBeNull();
        await expect(runs.markRunning('first-rejected')).rejects.toThrow();
        await expect(runs.failRun('first-rejected', { error: { message: 'unexpected' } })).rejects.toThrow();
        expect((await runs.requestCancellation('first-rejected', owner)).kind).toBe('stopped');
        expect((await runs.getRunByExecutionId('first-rejected'))?.reconstructionQuarantine).toBeNull();
    });

    it.each(['expired', 'replaced', 'cancelled'] as const)('rejects quarantine with an %s lease', async (scenario) => {
        await create('racing');
        const lease = await leases.claimQueued('worker');
        if (!lease) throw new Error('Expected claim');
        if (scenario === 'cancelled') {
            await runs.requestCancellation('racing', owner);
        } else {
            await UserToolRun.updateOne({ executionId: 'racing' }, { $set: { 'lease.expiresAt': new Date(0) } });
            if (scenario === 'replaced') expect(await leases.claimQueued('replacement')).not.toBeNull();
        }
        expect(await leases.quarantineQueued(lease, 'RUN_TARGET_CHANGED')).toBe(false);
        expect((await runs.getRunByExecutionId('racing'))?.reconstructionQuarantine).toBeNull();
    });

    it.each(['error', 'unconfirmed', 'lost-response'] as const)('does not continue after a %s quarantine write', async (failure) => {
        jest.spyOn(logger, 'error').mockImplementation(() => undefined);
        await create('quarantine-write-failed');
        const dispatch = new MonitoredRunDispatch(leases, {
            reconstructQueuedRun: async () => { throw new RunReconstructionRejection('RUN_TARGET_CHANGED'); },
        }, { execute: jest.fn() }, { intervalMs: 100, timeoutMs: 1000, leaseDurationMs: 30_000 }, undefined, {
            quarantineQueued: async (lease, code) => {
                if (failure === 'unconfirmed') return false;
                if (failure === 'lost-response') await leases.quarantineQueued(lease, code);
                throw new Error('database unavailable');
            },
            deferQueued: async () => false,
        });
        const worker = new DurableRunWorker('worker', leases, dispatch, 100);
        worker.start();
        for (let i = 0; i < 100 && worker.getState() === 'running'; i++) {
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        await worker.stop();
        expect(worker.getState()).toBe('failed');
        expect(worker.getFailure()).toBe('dispatch_failed');
        const run = await runs.getRunByExecutionId('quarantine-write-failed');
        if (failure === 'lost-response') {
            expect(run?.reconstructionQuarantine?.code).toBe('RUN_TARGET_CHANGED');
            expect(await leases.claimQueued('replacement')).toBeNull();
        } else {
            expect(run?.reconstructionQuarantine).toBeNull();
        }
    });

    it('does not schedule a quarantined run again on idempotent enqueue', async () => {
        const orchestrator = new ExecutionOrchestrator();
        const request = {
            persistedExecutionId: 'quarantined-replay', userId: owner.toString(), args: {}, launchContext: 'editor_test' as const,
            fn: { _id: new mongoose.Types.ObjectId(), name: 'fixture', language: 'typescript' as const, origin: 'custom' as const },
        };
        await orchestrator.enqueue(request);
        const lease = await leases.claimQueued('worker');
        if (!lease) throw new Error('Expected claim');
        expect(await leases.quarantineQueued(lease, 'RUN_TARGET_CHANGED')).toBe(true);
        expect(await orchestrator.enqueue(request)).toMatchObject({ status: 'queued', replayed: true });
        const prepare = jest.fn();
        await expect(orchestrator.execute({ ...request, executeExistingQueued: true }, prepare))
            .rejects.toThrow('quarantined');
        expect(prepare).not.toHaveBeenCalled();
    });
});
