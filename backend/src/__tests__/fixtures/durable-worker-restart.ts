import mongoose from 'mongoose';
import { DurableRunWorker } from '../../services/runtime/DurableRunWorker';
import { MongoRunLeaseService } from '../../services/runtime/MongoRunLeaseService';
import { MonitoredRunDispatch } from '../../services/runtime/MonitoredRunDispatch';
import { UserToolRunService } from '../../services/userToolRun.service';
import { ExecutionOrchestrator, type ExecutionOrchestratorRequest } from '../../services/runtime/ExecutionOrchestrator';
import { SandboxService } from '../../services/sandbox.service';

async function main(): Promise<void> {
    const uri = process.env.MONGODB_URI;
    const [mode, userId, workflowId] = process.argv.slice(2);
    if (!uri || !mode || !userId || !workflowId || !process.send) throw new Error('Missing test fixture parameters');
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5_000 });
    const send = (event: string, executionId: string) => {
        if (!process.send || !process.connected) throw new Error('Test IPC channel is unavailable');
        process.send({ event, executionId });
    };
    const leases = new MongoRunLeaseService(1500);
    const runs = new UserToolRunService();
    const sandbox = new SandboxService();
    const orchestrator = new ExecutionOrchestrator();
    Reflect.set(orchestrator, 'getPreferredRunnerReadiness', async () => ({
        report: { summary: 'ready' },
        runner: { getRunnerId: () => 'docker_sandbox' },
        readiness: { ready: true },
    }));
    Reflect.set(orchestrator, 'buildExecutionRequest', async (request: ExecutionOrchestratorRequest & { executionId: string }) => ({
        executionId: request.executionId, userId: request.userId, runtime: 'typescript', workspace: null,
        args: request.args, privateContext: request.privateContext, policySnapshot: { networkMode: 'none' },
    }));
    Reflect.set(orchestrator, 'getExecutionRunner', () => ({
        execute: async (request: { args: Record<string, unknown>; privateContext?: Record<string, unknown> }) => {
            if (request.args.value !== 42 || request.privateContext?.token !== 'restart-private') {
                throw new Error('Reconstructed execution inputs do not match');
            }
            return { success: true, output: { restored: true }, durationMs: 1, exitCode: 0, runner: 'docker_sandbox' };
        },
    }));
    const reconstructed = new MonitoredRunDispatch(leases, {
        reconstructQueuedRun: async (lease) => {
            const result = await sandbox.reconstructQueuedRun(lease);
            return { ...result, prepareForDispatch: async () => undefined };
        },
    }, orchestrator, { intervalMs: 200, timeoutMs: 500, leaseDurationMs: 1500 });
    const monitored = new MonitoredRunDispatch(leases, {
        reconstructQueuedRun: async (lease) => ({
            request: {
                fn: {
                    _id: new mongoose.Types.ObjectId(), name: 'restart-fixture', language: 'typescript',
                    origin: 'custom', workflowId,
                },
                userId, args: {}, launchContext: 'workflow_run',
                persistedExecutionId: lease.executionId, executeExistingQueued: true,
            },
            prepareForDispatch: async () => undefined,
        }),
    }, {
        execute: async (request: ExecutionOrchestratorRequest) => {
            if (!request.lease) throw new Error('Test execution requires a lease');
            await runs.markRunning(request.lease.executionId, new Date(), undefined, request.lease);
            send('running', request.lease.executionId);
            return new Promise(() => undefined);
        },
    }, { intervalMs: 200, timeoutMs: 500, leaseDurationMs: 1500 });
    const worker = new DurableRunWorker(`fixture-${mode}`, leases, {
        dispatch: async (lease) => {
            if (mode === 'queued-hold') {
                send('claimed', lease.executionId);
                return new Promise(() => undefined);
            }
            if (mode === 'running-hold') return monitored.dispatch(lease);
            if (mode === 'reconstruct-complete' || mode === 'reconstruct-reject') {
                const result = await reconstructed.dispatch(lease);
                send('kind' in result && result.kind === 'quarantined' ? 'rejected' : 'completed', lease.executionId);
                return result;
            }
            if (mode === 'deferred') {
                const result = await monitored.dispatch(lease);
                if ('kind' in result && result.kind === 'deferred') send('deferred', lease.executionId);
                return result;
            }
            if (mode !== 'complete') throw new Error('Unknown fixture mode');
            await runs.markRunning(lease.executionId, new Date(), undefined, lease);
            await runs.completeRun(lease.executionId, {}, lease);
            send('completed', lease.executionId);
            return {
                executionId: lease.executionId, status: 'completed', success: true,
                output: null, durationMs: 0, exitCode: 0, runner: 'docker_sandbox',
            };
        },
    }, 100);
    process.on('disconnect', () => process.exit(1));
    worker.start();
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? `${error.name}: ${error.message}` : 'UnknownError');
    process.exitCode = 1;
});
