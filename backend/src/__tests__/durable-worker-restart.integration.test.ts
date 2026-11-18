import { fork, type ChildProcess } from 'child_process';
import path from 'path';
import mongoose from 'mongoose';
import { UserToolRun } from '../models/UserToolRun.model';
import { UserTool } from '../models/UserTool.model';
import { MongoWorkspaceLockService } from '../services/runtime/MongoWorkspaceLockService';
import { ExecutionOrchestrator } from '../services/runtime/ExecutionOrchestrator';
import { UserToolRunService } from '../services/userToolRun.service';

describe('durable worker process restart', () => {
    const owner = new mongoose.Types.ObjectId();
    const workflow = new mongoose.Types.ObjectId();
    const runs = new UserToolRunService();
    const children: ChildProcess[] = [];

    async function createRun(executionId: string): Promise<void> {
        await runs.createQueuedRun({
            executionId, ownerUserId: owner, workflowId: workflow, toolId: new mongoose.Types.ObjectId(),
            toolVersionTag: 'v1', toolContentHash: 'hash', launchContext: 'workflow_run',
            runtime: 'typescript', policySnapshot: { networkMode: 'none' },
        });
    }

    async function createReconstructableRun(executionId: string) {
        const version = {
            versionTag: 'v1', contentHash: 'hash-v1', sourceMode: 'inline' as const,
            sourceInline: 'export default () => 1', createdAt: new Date(),
            buildStatus: 'built' as const, validationStatus: 'valid' as const,
        };
        const policy = { networkMode: 'none' as const, timeoutSeconds: 30, maxMemoryMb: 256, secretAliases: [] };
        const tool = await UserTool.create({
            ownerUserId: owner, scopeType: 'user', name: 'restart-fixture', description: 'Restart fixture',
            runtime: 'typescript', currentVersion: version, versions: [version], policy,
        });
        const producer = new ExecutionOrchestrator();
        const persistedTool = await UserTool.findById(tool._id).lean();
        if (!persistedTool) throw new Error('Expected persisted tool');
        const request = {
            persistedExecutionId: executionId, userId: owner.toString(), launchContext: 'editor_test' as const,
            args: { value: 42 }, privateContext: { token: 'restart-private' },
            fn: {
                _id: persistedTool._id, name: persistedTool.name, language: persistedTool.runtime, origin: 'custom',
                codeInline: version.sourceInline, dependencies: persistedTool.dependencies,
                toolVersionTag: version.versionTag, toolContentHash: version.contentHash, policySnapshot: persistedTool.policy,
            } as const,
        };
        expect(await producer.enqueue(request)).toMatchObject({ executionId, status: 'queued', replayed: false });
        expect(await producer.enqueue(request)).toMatchObject({ executionId, status: 'queued', replayed: true });
        await expect(producer.enqueue({ ...request, args: { value: 43 } })).rejects.toMatchObject({
            code: 'IDEMPOTENCY_KEY_REUSED',
        });
        return tool;
    }

    function start(mode: string, event: string): { child: ChildProcess; result: Promise<string> } {
        const child = fork(
            path.join(__dirname, 'fixtures', 'durable-worker-restart.ts'),
            [mode, owner.toHexString(), workflow.toHexString()],
            { execArgv: ['--import', 'tsx'], env: process.env, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] },
        );
        children.push(child);
        const result = new Promise<string>((resolve, reject) => {
            let stderr = '';
            child.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });
            const timeout = setTimeout(() => finish(new Error(`Worker fixture ${mode} timed out: ${stderr}`)), 20_000);
            const onMessage = (message: unknown) => {
                if (typeof message !== 'object' || message === null || !('event' in message)
                    || message.event !== event || !('executionId' in message) || typeof message.executionId !== 'string') return;
                finish(undefined, message.executionId);
            };
            const onExit = (code: number | null, signal: NodeJS.Signals | null) =>
                finish(new Error(`Worker fixture ${mode} exited before ${event}: ${code ?? signal}; ${stderr}`));
            const onError = (error: Error) => finish(error);
            const finish = (error?: Error, executionId?: string) => {
                clearTimeout(timeout);
                child.off('message', onMessage);
                child.off('exit', onExit);
                child.off('error', onError);
                if (error) reject(error);
                else resolve(executionId!);
            };
            child.on('message', onMessage);
            child.on('exit', onExit);
            child.on('error', onError);
        });
        return { child, result };
    }

    async function terminate(child: ChildProcess): Promise<void> {
        if (child.exitCode !== null || child.signalCode !== null) return;
        const exited = new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Worker fixture did not exit')), 10_000);
            child.once('exit', () => { clearTimeout(timeout); resolve(); });
        });
        if (!child.kill()) throw new Error('Could not terminate worker fixture');
        await exited;
    }

    async function waitForLeaseExpiry(executionId: string): Promise<void> {
        const deadline = Date.now() + 10_000;
        while (Date.now() < deadline) {
            const expired = await UserToolRun.exists({
                executionId,
                $expr: { $lte: ['$lease.expiresAt', '$$NOW'] },
            });
            if (expired) return;
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        throw new Error(`Lease did not expire for ${executionId}`);
    }

    afterEach(async () => {
        await Promise.all(children.splice(0).map(terminate));
        if (!mongoose.connection.db) throw new Error('Test database is unavailable');
        await mongoose.connection.db.collection('workspace_execution_locks').deleteMany({});
    });

    it('reclaims a queued run after killing the original worker and waiting for its real lease expiry', async () => {
        await createRun('restart-queued');
        const original = start('queued-hold', 'claimed');
        expect(await original.result).toBe('restart-queued');
        const first = await UserToolRun.findOne({ executionId: 'restart-queued' }).select('+lease.token').lean();
        expect(first?.status).toBe('queued');
        expect(first?.lease?.token).toBeTruthy();
        await terminate(original.child);

        const replacement = start('complete', 'completed');
        expect(await replacement.result).toBe('restart-queued');
        expect(await runs.getRunByExecutionId('restart-queued')).toMatchObject({ status: 'completed', lease: null });
        expect(await UserToolRun.countDocuments({ executionId: 'restart-queued' })).toBe(1);
    });

    it('keeps a running run quarantined while deferring same-workspace runs after worker restart', async () => {
        await createRun('restart-running');
        const original = start('running-hold', 'running');
        expect(await original.result).toBe('restart-running');
        await terminate(original.child);
        await waitForLeaseExpiry('restart-running');
        await createRun('restart-next');
        const replacement = start('deferred', 'deferred');
        expect(await replacement.result).toBe('restart-next');
        expect((await runs.getRunByExecutionId('restart-running'))?.status).toBe('running');
        const deferredRun = await UserToolRun.findOne({ executionId: 'restart-next' })
            .select('+lease +workspaceRetentionProtected')
            .lean();
        expect(deferredRun).toMatchObject({
            status: 'queued',
            lease: null,
            workspaceRetentionProtected: false,
        });
        expect(await new MongoWorkspaceLockService().tryAcquire(owner.toHexString(), workflow.toHexString(), 'third'))
            .toBeNull();
    });

    it('reconstructs the persisted target and executes via the orchestrator after a process restart', async () => {
        await createReconstructableRun('restart-reconstructed');
        const original = start('queued-hold', 'claimed');
        expect(await original.result).toBe('restart-reconstructed');
        await terminate(original.child);
        const replacement = start('reconstruct-complete', 'completed');
        expect(await replacement.result).toBe('restart-reconstructed');
        expect(await runs.getRunByExecutionId('restart-reconstructed')).toMatchObject({
            status: 'completed', lease: null, outputs: { result: { restored: true } },
        });
        expect(await UserToolRun.countDocuments({ executionId: 'restart-reconstructed' })).toBe(1);
    });

    it('refuses a changed target after restart without executing it', async () => {
        const tool = await createReconstructableRun('restart-changed-target');
        const original = start('queued-hold', 'claimed');
        expect(await original.result).toBe('restart-changed-target');
        await terminate(original.child);
        await UserTool.updateOne({ _id: tool._id }, { $set: { 'versions.0.sourceInline': 'export default () => 2' } });
        const replacement = start('reconstruct-reject', 'rejected');
        expect(await replacement.result).toBe('restart-changed-target');
        expect(await runs.getRunByExecutionId('restart-changed-target')).toMatchObject({
            status: 'queued', lease: null, reconstructionQuarantine: { code: 'RUN_TARGET_CHANGED', quarantinedAt: expect.any(Date) },
        });
        expect(await UserToolRun.countDocuments({ executionId: 'restart-changed-target' })).toBe(1);
    });
});
