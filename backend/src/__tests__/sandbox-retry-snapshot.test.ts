import mongoose from 'mongoose';
import { UserTool } from '../models/UserTool.model';
import { UserToolRun } from '../models/UserToolRun.model';
import { ExecutionOrchestrator } from '../services/runtime/ExecutionOrchestrator';
import { BuildService } from '../services/build.service';
import { MongoRunLeaseService } from '../services/runtime/MongoRunLeaseService';
import { MonitoredRunDispatch } from '../services/runtime/MonitoredRunDispatch';
import { executionTargetFingerprint } from '../services/runtime/executionTargetFingerprint';
import { SandboxService } from '../services/sandbox.service';
import { encrypt } from '../utils/encryption';

describe('retry target snapshot', () => {
    const ownerId = new mongoose.Types.ObjectId();
    const executionId = 'retry-snapshot-parent';
    const policy = { networkMode: 'none' as const, timeoutSeconds: 30, maxMemoryMb: 256, secretAliases: ['secret-b', 'secret-a'] };

    async function createFixture() {
        const version = {
            versionTag: 'v1',
            contentHash: 'hash-v1',
            sourceMode: 'inline' as const,
            sourceInline: 'export default () => 1',
            createdAt: new Date(),
            buildStatus: 'built' as const,
            validationStatus: 'valid' as const,
        };
        const tool = await UserTool.create({
            ownerUserId: ownerId,
            scopeType: 'user',
            name: 'retry-fixture',
            description: 'Retry fixture',
            runtime: 'typescript',
            currentVersion: version,
            versions: [version],
            policy,
        });
        await UserToolRun.create({
            executionId,
            ownerUserId: ownerId,
            toolId: tool._id,
            toolVersionTag: version.versionTag,
            toolContentHash: version.contentHash,
            launchContext: 'editor_test',
            status: 'failed',
            runtime: 'typescript',
            inputs: { value: 42 },
            privateContextCiphertext: encrypt(JSON.stringify({ token: 'private-value' }), ownerId.toString()),
            policySnapshot: policy,
            targetFingerprint: executionTargetFingerprint({
                _id: tool._id,
                name: tool.name,
                language: tool.runtime,
                origin: 'custom',
                codeInline: version.sourceInline,
                dependencies: tool.dependencies,
                toolVersionTag: version.versionTag,
                toolContentHash: version.contentHash,
                policySnapshot: tool.policy,
            }),
            timing: { queuedAt: new Date(), startedAt: new Date(), finishedAt: new Date(), durationMs: 1 },
            error: { code: 'WORKER_LOST', message: 'worker lost', retryable: true },
        });
        return tool;
    }

    afterEach(() => jest.restoreAllMocks());

    it('reconstructs the same target and private context without changing the parent', async () => {
        await createFixture();
        const enqueue = jest.spyOn(ExecutionOrchestrator.prototype, 'enqueue').mockResolvedValue({
            executionId: 'retry-child', status: 'queued', replayed: false,
        });

        await expect(new SandboxService().retryRun(executionId, ownerId.toString(), 'retry-key'))
            .resolves.toEqual({ executionId: 'retry-child', status: 'queued', replayed: false });
        expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({
            args: { value: 42 },
            privateContext: { token: 'private-value' },
            retryOfExecutionId: executionId,
            fn: expect.objectContaining({ toolVersionTag: 'v1', toolContentHash: 'hash-v1' }),
        }));
        expect((await UserToolRun.findOne({ executionId }).lean())?.status).toBe('failed');
    });

    it.each([
        ['content hash', { 'versions.0.contentHash': 'changed-hash' }],
        ['network policy', { 'policy.networkMode': 'restricted' }],
        ['timeout', { 'policy.timeoutSeconds': 31 }],
        ['memory limit', { 'policy.maxMemoryMb': 512 }],
        ['secret aliases', { 'policy.secretAliases': ['another-secret'] }],
        ['runtime', { runtime: 'python' }],
        ['workflow', { workflowId: new mongoose.Types.ObjectId() }],
        ['version alias', { 'versions.0.versionTag': '1' }],
        ['inline source without hash update', { 'versions.0.sourceInline': 'export default () => 2' }],
        ['dependencies without hash update', { 'dependencies.npm': ['different@1.0.0'] }],
        ['writable paths', { 'policy.writablePaths': ['different'] }],
    ])('refuses retry when %s changed', async (_label, change) => {
        const tool = await createFixture();
        await UserTool.updateOne({ _id: tool._id }, { $set: change });
        const enqueue = jest.spyOn(ExecutionOrchestrator.prototype, 'enqueue');

        await expect(new SandboxService().retryRun(executionId, ownerId.toString(), 'retry-key'))
            .rejects.toMatchObject({ code: 'RUN_RETRY_TARGET_CHANGED', statusCode: 409 });
        expect(enqueue).not.toHaveBeenCalled();
        expect((await UserToolRun.findOne({ executionId }).lean())?.status).toBe('failed');
    });

    it('reports a removed target version without enqueueing a child', async () => {
        const tool = await createFixture();
        await UserTool.updateOne({ _id: tool._id }, { $set: { versions: [] } });
        const enqueue = jest.spyOn(ExecutionOrchestrator.prototype, 'enqueue');

        await expect(new SandboxService().retryRun(executionId, ownerId.toString(), 'retry-key'))
            .rejects.toMatchObject({ code: 'RUN_TARGET_VERSION_NOT_FOUND', statusCode: 409 });
        expect(enqueue).not.toHaveBeenCalled();
    });

    describe('queued run reconstruction', () => {
        async function claimFixture() {
            const tool = await createFixture();
            await UserToolRun.updateOne({ executionId }, { $set: { status: 'queued', error: null } });
            const lease = await new MongoRunLeaseService(30_000).claimQueued('worker');
            if (!lease) {
                throw new Error('Expected queued run lease');
            }
            return { tool, lease };
        }

        it('restores persisted execution fields and encrypted context without executing the run', async () => {
            const { lease } = await claimFixture();
            const enqueue = jest.spyOn(ExecutionOrchestrator.prototype, 'enqueue');
            const execute = jest.spyOn(ExecutionOrchestrator.prototype, 'execute');
            const reconstructed = await new SandboxService().reconstructQueuedRun(lease);
            expect(reconstructed.request).toEqual(expect.objectContaining({
                userId: ownerId.toString(),
                args: { value: 42 },
                privateContext: { token: 'private-value' },
                persistedExecutionId: executionId,
                executeExistingQueued: true,
                verifiedInlineSource: true,
                fn: expect.objectContaining({ toolVersionTag: 'v1', toolContentHash: 'hash-v1' }),
            }));
            expect(reconstructed.prepareForDispatch).toEqual(expect.any(Function));
            expect(enqueue).not.toHaveBeenCalled();
            expect(execute).not.toHaveBeenCalled();
        });

        it('refuses execution when the selected target changes during build preparation', async () => {
            const { tool, lease } = await claimFixture();
            const sandbox = new SandboxService();
            const reconstructed = await sandbox.reconstructQueuedRun(lease);
            jest.spyOn(BuildService.prototype, 'ensureBuildReadyForTool').mockImplementation(async () => {
                await UserTool.updateOne(
                    { _id: tool._id, 'versions.versionTag': 'v1' },
                    { $set: { 'versions.$.sourceInline': 'export default () => 2' } },
                );
            });

            await expect(reconstructed.prepareForDispatch()).rejects.toMatchObject({
                code: 'RUN_TARGET_CHANGED',
                statusCode: 409,
            });
        });

        it('passes a reconstructed run through a Mongo-backed monitor to the executor', async () => {
            const { lease } = await claimFixture();
            const executor = {
                execute: jest.fn().mockResolvedValue({
                    executionId, success: true, output: 1, durationMs: 1, exitCode: 0, runner: 'docker_sandbox',
                }),
            };
            const dispatch = new MonitoredRunDispatch(
                new MongoRunLeaseService(30_000),
                new SandboxService(),
                executor,
                { intervalMs: 100, timeoutMs: 1000, leaseDurationMs: 30_000 },
            );
            await dispatch.dispatch(lease);
            expect(executor.execute).toHaveBeenCalledWith(expect.objectContaining({
                persistedExecutionId: executionId,
                privateContext: { token: 'private-value' },
                lease,
                leaseSignal: expect.any(AbortSignal),
            }), expect.any(Function));
            expect((await UserToolRun.findOne({ executionId }).lean())?.status).toBe('queued');
        });

        it('rejects a stale or incorrect lease', async () => {
            const { lease } = await claimFixture();
            await expect(new SandboxService().reconstructQueuedRun({ ...lease, token: 'other' }))
                .rejects.toMatchObject({ code: 'RUN_LEASE_LOST' });
            await UserToolRun.updateOne({ executionId }, { $set: { 'lease.expiresAt': new Date(0) } });
            await expect(new SandboxService().reconstructQueuedRun(lease))
                .rejects.toMatchObject({ code: 'RUN_LEASE_LOST' });
        });

        it('rejects changed source metadata and an ownership change', async () => {
            const { lease, tool } = await claimFixture();
            await UserTool.updateOne({ _id: tool._id }, { $set: { 'versions.0.contentHash': 'different' } });
            await expect(new SandboxService().reconstructQueuedRun(lease))
                .rejects.toMatchObject({ code: 'RUN_TARGET_CHANGED' });
            await UserTool.updateOne({ _id: tool._id }, { $set: { ownerUserId: new mongoose.Types.ObjectId() } });
            await expect(new SandboxService().reconstructQueuedRun(lease))
                .rejects.toMatchObject({ code: 'RUN_TARGET_NOT_FOUND' });
        });

        it.each([
            ['source', { 'versions.0.sourceInline': 'export default () => 2' }],
            ['dependencies', { 'dependencies.npm': ['other@1.0.0'] }],
            ['writable paths', { 'policy.writablePaths': ['different'] }],
        ])('rejects a changed %s even when the version hash was not updated', async (_label, change) => {
            const { lease, tool } = await claimFixture();
            await UserTool.updateOne({ _id: tool._id }, { $set: change });
            await expect(new SandboxService().reconstructQueuedRun(lease))
                .rejects.toMatchObject({ code: 'RUN_TARGET_CHANGED' });
        });

        it('refuses to reconstruct historical runs without an integrity fingerprint', async () => {
            const { lease } = await claimFixture();
            await UserToolRun.updateOne({ executionId }, { $set: { targetFingerprint: null } });
            await expect(new SandboxService().reconstructQueuedRun(lease))
                .rejects.toMatchObject({ code: 'RUN_TARGET_SNAPSHOT_MISSING' });
        });

        it('refuses reconstruction of a path-only target whose bytes were not snapshotted', async () => {
            const { lease, tool } = await claimFixture();
            await UserTool.updateOne({ _id: tool._id }, {
                $set: { 'versions.0.sourceInline': null, 'versions.0.sourcePath': 'tools/example.ts' },
            });
            await UserToolRun.updateOne({ executionId }, {
                $set: {
                    targetFingerprint: executionTargetFingerprint({
                        _id: tool._id,
                        name: tool.name,
                        language: tool.runtime,
                        origin: 'custom',
                        codePath: 'tools/example.ts',
                        dependencies: tool.dependencies,
                        toolVersionTag: 'v1',
                        toolContentHash: 'hash-v1',
                        policySnapshot: tool.policy,
                    }),
                },
            });
            await expect(new SandboxService().reconstructQueuedRun(lease))
                .rejects.toMatchObject({ code: 'RUN_TARGET_SOURCE_UNVERIFIED' });
        });
    });
});
