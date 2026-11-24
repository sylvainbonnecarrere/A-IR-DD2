import { logger } from '../services/logger';
import mongoose from 'mongoose';
import { UserToolRun } from '../models/UserToolRun.model';
import { MongoRunLeaseService } from '../services/runtime/MongoRunLeaseService';
import { ExecutionOrchestrator, type ExecutionOrchestratorRequest } from '../services/runtime/ExecutionOrchestrator';
import { MonitoredRunDispatch } from '../services/runtime/MonitoredRunDispatch';
import { DurableRunWorker } from '../services/runtime/DurableRunWorker';
import { MongoWorkspaceLockService } from '../services/runtime/MongoWorkspaceLockService';
import { UserToolRunService } from '../services/userToolRun.service';

describe('leased execution orchestration', () => {
    const runs = new UserToolRunService();
    const leases = new MongoRunLeaseService(30_000);

    async function fixture() {
        const owner = new mongoose.Types.ObjectId();
        const tool = new mongoose.Types.ObjectId();
        const executionId = 'leased-orchestration';
        await runs.createQueuedRun({
            executionId, ownerUserId: owner, toolId: tool, toolVersionTag: 'v1',
            toolContentHash: 'hash', launchContext: 'editor_test', runtime: 'typescript',
            policySnapshot: { networkMode: 'none' },
        });
        const lease = await leases.claimQueued('worker');
        if (!lease) {
            throw new Error('Expected lease');
        }
        const controller = new AbortController();
        const request: ExecutionOrchestratorRequest = {
            fn: {
                _id: tool, name: 'fixture', language: 'typescript', origin: 'custom',
                toolVersionTag: 'v1', toolContentHash: 'hash',
                policySnapshot: { networkMode: 'none' }, codeInline: 'function run() { return 1; }',
            },
            userId: owner.toString(), args: {}, launchContext: 'editor_test',
            persistedExecutionId: executionId, executeExistingQueued: true,
            lease, leaseSignal: controller.signal,
        };
        const orchestrator = new ExecutionOrchestrator();
        const runner = jest.fn().mockResolvedValue({
            success: true, output: 1, durationMs: 1, exitCode: 0, runner: 'docker_sandbox',
        });
        Reflect.set(orchestrator, 'getPreferredRunnerReadiness', jest.fn().mockResolvedValue({
            report: { summary: 'ready' },
            runner: { getRunnerId: () => 'docker_sandbox' },
            readiness: { ready: true },
        }));
        Reflect.set(orchestrator, 'buildExecutionRequest', jest.fn().mockResolvedValue({
            executionId, userId: owner.toString(), workspace: null, runtime: 'typescript',
            policySnapshot: { networkMode: 'none' },
        }));
        Reflect.set(orchestrator, 'getExecutionRunner', jest.fn().mockReturnValue({ execute: runner }));
        return { orchestrator, request, controller, runner, executionId, lease };
    }

    it('uses the lease to start and finish a persisted run', async () => {
        const { orchestrator, request, runner, executionId } = await fixture();
        const result = await orchestrator.execute(request);
        expect(result).toMatchObject({ status: 'completed' });
        expect(runner).toHaveBeenCalledTimes(1);
        expect(await UserToolRun.findOne({ executionId }).lean()).toMatchObject({ status: 'completed', lease: null });
    });

    it('coordinates legacy execution before preparation and releases after a terminal runner result', async () => {
        const { orchestrator, request, runner, executionId, lease } = await fixture();
        await leases.releaseQueued(lease);
        const legacyRequest = { ...request, lease: undefined, leaseSignal: undefined };
        const owner = request.userId;
        const workflowId = new mongoose.Types.ObjectId().toHexString();
        legacyRequest.fn.workflowId = workflowId;
        const locks = new MongoWorkspaceLockService();
        const prepare = jest.fn(async () => {
            expect(await locks.tryAcquire(owner, workflowId, 'competing-process')).toBeNull();
        });

        const result = await orchestrator.execute(legacyRequest, prepare);
        expect(result).toMatchObject({ status: 'completed' });
        expect(prepare).toHaveBeenCalledTimes(1);
        expect(runner).toHaveBeenCalledTimes(1);
        const after = await locks.tryAcquire(owner, workflowId, 'after-terminal');
        expect(after).not.toBeNull();
        if (after) await locks.release(after);
        expect(await UserToolRun.findOne({ executionId }).lean()).toMatchObject({ status: 'completed' });
    });

    it('retains the workspace lock when the legacy runner outcome is unknown', async () => {
        const { orchestrator, request, runner, lease } = await fixture();
        await leases.releaseQueued(lease);
        const legacyRequest = { ...request, lease: undefined, leaseSignal: undefined };
        const workflowId = new mongoose.Types.ObjectId().toHexString();
        legacyRequest.fn.workflowId = workflowId;
        runner.mockRejectedValue(new Error('runner outcome unknown'));
        const locks = new MongoWorkspaceLockService();
        await expect(orchestrator.execute(legacyRequest)).rejects.toThrow('runner outcome unknown');
        expect(await locks.tryAcquire(legacyRequest.userId, workflowId, 'competing-process')).toBeNull();
    });

    it('respects a pre-existing workspace lock and does not invoke preparation or runner', async () => {
        const { orchestrator, request, runner, lease } = await fixture();
        await leases.releaseQueued(lease);
        const legacyRequest = { ...request, lease: undefined, leaseSignal: undefined };
        const workflowId = new mongoose.Types.ObjectId().toHexString();
        legacyRequest.fn.workflowId = workflowId;
        const locks = new MongoWorkspaceLockService();
        const oldLock = await locks.tryAcquire(legacyRequest.userId, workflowId, 'old-process');
        expect(oldLock).not.toBeNull();
        const prepare = jest.fn();
        try {
            await expect(orchestrator.execute(legacyRequest, prepare)).rejects.toThrow('Workspace is locked');
            expect(prepare).not.toHaveBeenCalled();
            expect(runner).not.toHaveBeenCalled();
        } finally {
            if (oldLock) await locks.release(oldLock);
        }
    });

    it('dispatches through a real Mongo lease monitor and the orchestrator', async () => {
        const { orchestrator, request, runner, executionId, lease } = await fixture();
        const dispatch = new MonitoredRunDispatch(
            leases,
            { reconstructQueuedRun: async () => ({ request, prepareForDispatch: async () => undefined }) },
            orchestrator,
            { intervalMs: 100, timeoutMs: 1000, leaseDurationMs: 30_000 },
        );
        const result = await dispatch.dispatch(lease);
        expect(result).toMatchObject({ status: 'completed' });
        expect(runner).toHaveBeenCalledTimes(1);
        expect(await UserToolRun.findOne({ executionId }).lean()).toMatchObject({ status: 'completed', lease: null });
    });

    it('connects the worker, Mongo claim, monitor and orchestrator without the legacy dispatcher', async () => {
        const { orchestrator, request, runner, executionId, lease } = await fixture();
        expect(await leases.releaseQueued(lease)).toBe(true);
        const dispatch = new MonitoredRunDispatch(
            leases,
            { reconstructQueuedRun: async () => ({ request, prepareForDispatch: async () => undefined }) },
            orchestrator,
            { intervalMs: 100, timeoutMs: 1000, leaseDurationMs: 30_000 },
        );
        let finished!: () => void;
        let failed!: (error: unknown) => void;
        const completed = new Promise<void>((resolve, reject) => { finished = resolve; failed = reject; });
        const worker = new DurableRunWorker('new-worker', leases, {
            dispatch: async (current) => {
                try {
                    const result = await dispatch.dispatch(current);
                    finished();
                    return result;
                } catch (error) {
                    failed(error);
                    throw error;
                }
            },
        }, 60_000);
        worker.start();
        try {
            await completed;
        } finally {
            await worker.stop();
        }
        expect(worker.getState()).toBe('stopped');
        expect(runner).toHaveBeenCalledTimes(1);
        expect(await UserToolRun.findOne({ executionId }).lean()).toMatchObject({ status: 'completed', lease: null });
    });

    it('does not terminalize or report success when the runner cannot prove termination', async () => {
        const { orchestrator, request, runner, executionId } = await fixture();
        runner.mockResolvedValue({
            success: true, output: 1, durationMs: 1, exitCode: 0, runner: 'docker_sandbox',
            metadata: { runnerTerminationConfirmed: false },
        });
        const result = await orchestrator.execute(request);
        expect(result).toMatchObject({ success: false, status: 'running' });
        expect(await UserToolRun.findOne({ executionId }).lean()).toMatchObject({ status: 'running' });
    });

    it('never invokes the runner or reclaims the run after lease expiry during preparation', async () => {
        const { orchestrator, request, runner, executionId } = await fixture();
        let resume!: () => void;
        const gate = new Promise<void>((resolve) => { resume = resolve; });
        let started!: () => void;
        const preparing = new Promise<void>((resolve) => { started = resolve; });
        const work = orchestrator.execute(request, async () => {
            await UserToolRun.updateOne({ executionId }, { $set: { 'lease.expiresAt': new Date(0) } });
            started();
            await gate;
        });
        await preparing;
        expect((await UserToolRun.findOne({ executionId }).lean())?.status).toBe('running');
        expect(await leases.claimQueued('replacement')).toBeNull();
        resume();
        await expect(work).rejects.toThrow('transition or lease');
        expect(runner).not.toHaveBeenCalled();
        expect((await UserToolRun.findOne({ executionId }).lean())?.status).toBe('running');
    });

    it('does not start the runner when the running transition response is lost after commit', async () => {
        const { orchestrator, request, runner, executionId } = await fixture();
        const prepare = jest.fn();
        const original = UserToolRunService.prototype.markRunning;
        const markRunning = jest.spyOn(UserToolRunService.prototype, 'markRunning')
            .mockImplementation(async function (this: UserToolRunService, ...args) {
                await original.apply(this, args);
                throw new Error('simulated lost response after acknowledged transition');
            });
        try {
            await expect(orchestrator.execute(request, prepare)).rejects.toThrow('simulated lost response');
            expect(prepare).not.toHaveBeenCalled();
            expect(runner).not.toHaveBeenCalled();
            expect((await UserToolRun.findOne({ executionId }).lean())?.status).toBe('running');
        } finally {
            markRunning.mockRestore();
        }
    });

    it('does not launch if cancellation is persisted during preparation before the monitor observes it', async () => {
        const { orchestrator, request, runner, executionId } = await fixture();
        await expect(orchestrator.execute(request, async () => {
            expect((await runs.requestCancellation(executionId, request.userId)).kind).toBe('requested');
        })).rejects.toThrow('transition or lease');
        expect(runner).not.toHaveBeenCalled();
        expect(await UserToolRun.findOne({ executionId }).lean()).toMatchObject({
            status: 'running', cancellationRequestedAt: expect.any(Date),
        });
    });

    it('leaves preparation failures unclassified and does not launch or permit reclaim', async () => {
        const { orchestrator, request, runner, executionId } = await fixture();
        const log = jest.spyOn(logger, 'error').mockImplementation(() => undefined);
        try {
            await expect(orchestrator.execute(request, async () => {
                throw new Error('private preparation data');
            })).rejects.toThrow('private preparation data');
            expect(runner).not.toHaveBeenCalled();
            expect(await UserToolRun.findOne({ executionId }).lean()).toMatchObject({
                status: 'running', error: null,
            });
            await UserToolRun.updateOne({ executionId }, { $set: { 'lease.expiresAt': new Date(0) } });
            expect(await leases.claimQueued('replacement')).toBeNull();
            expect(JSON.stringify(log.mock.calls)).not.toContain('private preparation data');
        } finally {
            log.mockRestore();
        }
    });

    it('retains the workspace lock after a monitored preparation failure', async () => {
        const { orchestrator, request, runner, executionId, lease } = await fixture();
        const workflowId = new mongoose.Types.ObjectId().toHexString();
        request.fn.workflowId = workflowId;
        const locks = new MongoWorkspaceLockService();
        const log = jest.spyOn(logger, 'error').mockImplementation(() => undefined);
        const warning = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
        try {
            const dispatch = new MonitoredRunDispatch(leases, {
                reconstructQueuedRun: async () => ({
                    request,
                    prepareForDispatch: async () => { throw new Error('preparation outcome unknown'); },
                }),
            }, orchestrator, { intervalMs: 100, timeoutMs: 1000, leaseDurationMs: 30_000 }, locks);
            await expect(dispatch.dispatch(lease)).rejects.toThrow('preparation outcome unknown');
            expect(runner).not.toHaveBeenCalled();
            expect((await UserToolRun.findOne({ executionId }).lean())?.status).toBe('running');
            expect(await locks.tryAcquire(request.userId, workflowId, 'replacement')).toBeNull();
        } finally {
            log.mockRestore();
            warning.mockRestore();
            if (!mongoose.connection.db) throw new Error('Test database is unavailable');
            await mongoose.connection.db.collection<{ _id: string }>('workspace_execution_locks')
                .deleteOne({ _id: `${request.userId}:${workflowId}` });
        }
    });

    it('does not turn a preparation failure after lease expiration into a terminal write', async () => {
        const { orchestrator, request, executionId } = await fixture();
        await expect(orchestrator.execute(request, async () => {
            await UserToolRun.updateOne({ executionId }, { $set: { 'lease.expiresAt': new Date(0) } });
            throw new Error('preparation failed');
        })).rejects.toThrow('preparation failed');
        expect((await UserToolRun.findOne({ executionId }).lean())?.status).toBe('running');
    });

    it('does not run or terminalize when the lease monitor aborts during preparation', async () => {
        const { orchestrator, request, runner, controller, executionId } = await fixture();
        await expect(orchestrator.execute(request, async () => controller.abort()))
            .rejects.toThrow('lease monitor was interrupted');
        expect(runner).not.toHaveBeenCalled();
        expect((await UserToolRun.findOne({ executionId }).lean())?.status).toBe('running');
    });

    it('propagates monitor abort to a running runner and leaves the outcome unclassified', async () => {
        const { orchestrator, request, runner, controller, executionId } = await fixture();
        runner.mockImplementation(async ({ signal }: { signal: AbortSignal }) => {
            controller.abort();
            expect(signal.aborted).toBe(true);
            return { success: false, output: null, durationMs: 1, exitCode: 130, runner: 'docker_sandbox',
                metadata: { failureKind: 'cancelled', cancellationConfirmed: true } };
        });
        const result = await orchestrator.execute(request);
        expect(result.status).toBe('running');
        expect((await UserToolRun.findOne({ executionId }).lean())?.status).toBe('running');
    });

    it('keeps an unexpected runner failure unclassified and does not log the lease token', async () => {
        const { orchestrator, request, runner, executionId, lease } = await fixture();
        const log = jest.spyOn(logger, 'error').mockImplementation(() => undefined);
        runner.mockRejectedValue(new Error('runner failed'));
        try {
            await expect(orchestrator.execute(request)).rejects.toThrow('runner failed');
            expect((await UserToolRun.findOne({ executionId }).lean())?.status).toBe('running');
            expect(log).toHaveBeenCalled();
            expect(JSON.stringify(log.mock.calls)).not.toContain(lease.token);
        } finally {
            log.mockRestore();
        }
    });

    it('does not terminalize an unexpected runner failure after lease expiration', async () => {
        const { orchestrator, request, runner, executionId } = await fixture();
        const log = jest.spyOn(logger, 'error').mockImplementation(() => undefined);
        runner.mockImplementation(async () => {
            await UserToolRun.updateOne({ executionId }, { $set: { 'lease.expiresAt': new Date(0) } });
            throw new Error('runner failed');
        });
        try {
            await expect(orchestrator.execute(request)).rejects.toThrow('runner failed');
            expect((await UserToolRun.findOne({ executionId }).lean())?.status).toBe('running');
        } finally {
            log.mockRestore();
        }
    });

    it('fences an error after runner completion when the lease expires', async () => {
        const { orchestrator, request, executionId } = await fixture();
        const log = jest.spyOn(logger, 'error').mockImplementation(() => undefined);
        Reflect.set(orchestrator, 'collectOutputArtifacts', jest.fn()
            .mockImplementationOnce(async () => {
                await UserToolRun.updateOne({ executionId }, { $set: { 'lease.expiresAt': new Date(0) } });
                throw new Error('artifact read failed');
            })
            .mockResolvedValueOnce([]));
        try {
            await expect(orchestrator.execute(request)).rejects.toThrow('transition or lease');
            expect((await UserToolRun.findOne({ executionId }).lean())?.status).toBe('running');
        } finally {
            log.mockRestore();
        }
    });

    it('rejects a lease without its matching execution or a monitor signal', async () => {
        const { orchestrator, request } = await fixture();
        await expect(orchestrator.execute({ ...request, leaseSignal: undefined })).rejects.toThrow('monitor signal');
        await expect(orchestrator.execute({ ...request, persistedExecutionId: 'other' })).rejects.toThrow('matching persisted execution');
    });
});
