import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import mongoose from 'mongoose';
import { randomUUID } from 'crypto';
import { User } from '../models/User.model';
import { UserTool } from '../models/UserTool.model';
import { Workspace } from '../models/Workspace.model';
import { UserToolRun } from '../models/UserToolRun.model';
import { UserToolRunRetentionService } from '../services/userToolRunRetention.service';
import { DockerAttemptReservation } from '../services/runtime/DockerAttemptReservation';
import { MongoDockerOperationJournal } from '../services/runtime/MongoDockerOperationJournal';
import { MongoRunLeaseService } from '../services/runtime/MongoRunLeaseService';
import { MongoWorkspaceLockService } from '../services/runtime/MongoWorkspaceLockService';
import { UserToolRunService } from '../services/userToolRun.service';

describe('UserToolRunRetentionService', () => {
    const service = new UserToolRunRetentionService();
    let tempRoot = '';

    afterEach(async () => {
        await UserToolRun.deleteMany({});
        await UserTool.deleteMany({});
        await Workspace.deleteMany({});
        await User.deleteMany({ email: /retention-test-/i });
        if (tempRoot) {
            await fs.rm(tempRoot, { recursive: true, force: true });
            tempRoot = '';
        }
    });

    async function createFixture() {
        tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'airdd2-retention-'));
        const outputRoot = path.join(tempRoot, 'output');
        await fs.mkdir(outputRoot, { recursive: true });
        await fs.writeFile(path.join(outputRoot, 'old.log'), 'old artifact', 'utf-8');
        await fs.writeFile(path.join(outputRoot, 'shared.json'), '{"shared":true}', 'utf-8');

        const user = await User.create({
            email: `retention-test-${Date.now()}@test.com`,
            password: 'test-only-password-123',
            username: `retention${Date.now()}`
        });

        const workflowId = new mongoose.Types.ObjectId();
        const sourceInline = 'function run() { return { ok: true }; }';
        const fn = await UserTool.create({
            _id: new mongoose.Types.ObjectId(),
            ownerUserId: user._id,
            workspaceId: null,
            scopeType: 'user',
            workflowId,
            name: `retention-test-${Date.now()}`,
            description: 'Retention cleanup test',
            runtime: 'typescript',
            status: 'ready',
            trustLevel: 'user_private',
            currentVersion: {
                versionTag: '1',
                contentHash: 'hash-retention-test',
                sourceMode: 'inline',
                sourcePath: null,
                sourceInline,
                entrypoint: null,
                createdAt: new Date(),
                createdBy: user._id,
                buildStatus: 'built',
                validationStatus: 'unknown'
            },
            versions: [{
                versionTag: '1',
                contentHash: 'hash-retention-test',
                sourceMode: 'inline',
                sourcePath: null,
                sourceInline,
                entrypoint: null,
                createdAt: new Date(),
                createdBy: user._id,
                buildStatus: 'built',
                validationStatus: 'unknown'
            }],
            inputSchema: { type: 'object' },
            outputSchema: { type: 'object' },
            tags: ['test'],
            dependencies: { npm: [], python: [] },
            policy: {
                networkMode: 'restricted',
                timeoutSeconds: 30,
                maxMemoryMb: 256,
                secretAliases: []
            },
            isReadonly: false,
            isEnabled: true
        });

        await Workspace.create({
            ownerUserId: user._id,
            scopeType: 'workflow',
            scopeId: workflowId,
            logicalRoot: tempRoot,
            runtimeRoots: {
                sourceRoot: path.join(tempRoot, 'source'),
                manifestsRoot: path.join(tempRoot, 'manifests'),
                buildRoot: path.join(tempRoot, 'build'),
                outputRoot
            },
            manifests: {
                packageJson: false,
                packageLockJson: false,
                requirementsTxt: false,
                pyprojectToml: false
            },
            status: 'active',
            snapshotVersion: 1,
            lastScanAt: new Date()
        });

        const oldRun = await UserToolRun.create({
            executionId: 'utr-retention-old',
            ownerUserId: user._id,
            toolId: fn._id,
            toolVersionTag: '1',
            toolContentHash: 'hash-old',
            workflowId,
            launchContext: 'editor_test',
            status: 'completed',
            runtime: 'typescript',
            runner: 'docker_sandbox',
            inputs: {},
            outputs: {
                artifacts: [
                    { path: 'output/old.log', kind: 'log' },
                    { path: 'output/shared.json', kind: 'json' }
                ]
            },
            policySnapshot: {
                networkMode: 'restricted',
                timeoutSeconds: 30,
                maxMemoryMb: 256,
                secretAliases: []
            },
            timing: {
                queuedAt: new Date(),
                startedAt: new Date(),
                finishedAt: new Date(),
                durationMs: 10
            }
        });

        const newRun = await UserToolRun.create({
            executionId: 'utr-retention-new',
            ownerUserId: user._id,
            toolId: fn._id,
            toolVersionTag: '1',
            toolContentHash: 'hash-new',
            workflowId,
            launchContext: 'editor_test',
            status: 'completed',
            runtime: 'typescript',
            runner: 'docker_sandbox',
            inputs: {},
            outputs: {
                artifacts: [
                    { path: 'output/shared.json', kind: 'json' }
                ]
            },
            policySnapshot: {
                networkMode: 'restricted',
                timeoutSeconds: 30,
                maxMemoryMb: 256,
                secretAliases: []
            },
            timing: {
                queuedAt: new Date(),
                startedAt: new Date(),
                finishedAt: new Date(),
                durationMs: 12
            }
        });

        const oldDate = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
        await UserToolRun.collection.updateOne({ _id: oldRun._id }, { $set: { createdAt: oldDate, updatedAt: oldDate } });

        return { user, fn, oldRun, newRun, outputRoot };
    }

    it('deletes old runs and orphan artifacts while preserving shared artifacts', async () => {
        const fixture = await createFixture();

        const result = await service.cleanupRunsForFunction(fixture.fn.id, fixture.user.id, {
            retentionDays: 14,
            retainLatest: 1
        });

        expect(result).toEqual(expect.objectContaining({
            deletedRuns: 1,
            retainedRuns: 1,
            deletedArtifacts: ['output/old.log']
        }));

        await expect(fs.access(path.join(fixture.outputRoot, 'old.log'))).rejects.toBeTruthy();
        await expect(fs.access(path.join(fixture.outputRoot, 'shared.json'))).resolves.toBeUndefined();
        expect(await UserToolRun.countDocuments({ toolId: fixture.fn._id })).toBe(1);
    });

    it('supports dry-run cleanup without deleting runs or artifacts', async () => {
        const fixture = await createFixture();

        const result = await service.cleanupRunsForFunction(fixture.fn.id, fixture.user.id, {
            retentionDays: 14,
            retainLatest: 1,
            dryRun: true
        });

        expect(result).toEqual(expect.objectContaining({
            deletedRuns: 1,
            dryRun: true,
            deletedArtifacts: ['output/old.log']
        }));

        await expect(fs.access(path.join(fixture.outputRoot, 'old.log'))).resolves.toBeUndefined();
        expect(await UserToolRun.countDocuments({ toolId: fixture.fn._id })).toBe(2);
    });

    it.each(['function', 'tool'] as const)('protects active runs and unreconciled attempts for %s cleanup', async (kind) => {
        const fixture = await createFixture();
        await UserToolRun.updateOne({ _id: fixture.oldRun._id }, {
            $set: { status: 'running' },
        });
        await UserToolRun.updateOne({ _id: fixture.newRun._id }, {
            $set: {
                supervisedAttempt: {
                    attemptId: 'attempt', leaseOwner: 'worker',
                    leaseTokenDigest: 'digest', createdAt: new Date(),
                },
            },
        });
        const cleanup = kind === 'function'
            ? service.cleanupRunsForFunction.bind(service)
            : service.cleanupRunsForTool.bind(service);
        for (const dryRun of [true, false]) {
            const result = await cleanup(fixture.fn.id, fixture.user.id, { retainLatest: 0, dryRun });
            expect(result).toEqual(expect.objectContaining({ deletedRuns: 0, retainedRuns: 2, deletedArtifacts: [] }));
        }
        expect(await UserToolRun.countDocuments({ toolId: fixture.fn._id })).toBe(2);
        await expect(fs.access(path.join(fixture.outputRoot, 'old.log'))).resolves.toBeUndefined();
    });

    it.each(['queued', 'running'] as const)('never removes a %s run or its artifacts', async (status) => {
        const fixture = await createFixture();
        await UserToolRun.updateOne({ _id: fixture.oldRun._id }, { $set: { status } });
        const result = await service.cleanupRunsForTool(fixture.fn.id, fixture.user.id, {
            retentionDays: 14, retainLatest: 1,
        });
        expect(result).toEqual(expect.objectContaining({ deletedRuns: 0, retainedRuns: 2, deletedArtifacts: [] }));
        expect(await UserToolRun.exists({ _id: fixture.oldRun._id })).not.toBeNull();
        await expect(fs.access(path.join(fixture.outputRoot, 'old.log'))).resolves.toBeUndefined();
    });

    it('retains the embedded journal and pending operation even on a terminal run', async () => {
        const fixture = await createFixture();
        const attemptId = randomUUID();
        const identity = {
            executionId: fixture.oldRun.executionId,
            attemptId,
            containerName: DockerAttemptReservation.containerName(attemptId),
        };
        await UserToolRun.updateOne({ _id: fixture.oldRun._id }, {
            $set: { supervisedAttempt: {
                attemptId, leaseOwner: 'worker', leaseTokenDigest: 'digest', createdAt: new Date(),
                dockerJournal: { admission: 'open', pending: null, lastOutcome: null, hasUnknownOutcome: false },
            } },
        });
        const journal = new MongoDockerOperationJournal();
        const operation = await journal.admit(identity, 'create');
        await journal.close(identity);
        const result = await service.cleanupRunsForTool(fixture.fn.id, fixture.user.id, {
            retentionDays: 14, retainLatest: 1,
        });
        expect(result).toEqual(expect.objectContaining({ deletedRuns: 0, retainedRuns: 2 }));
        expect(await journal.read(identity)).toMatchObject({ admission: 'closed', pending: operation });
        await expect(fs.access(path.join(fixture.outputRoot, 'old.log'))).resolves.toBeUndefined();
    });

    it.each(['cancelled', 'completed'] as const)('retains a %s claimed workspace run and its artifacts', async (outcome) => {
        const fixture = await createFixture();
        await UserToolRun.updateOne({ _id: fixture.oldRun._id }, { $set: { status: 'queued' } });
        const lease = await new MongoRunLeaseService(30_000).claimQueued('worker');
        expect(lease?.executionId).toBe(fixture.oldRun.executionId);
        const locks = new MongoWorkspaceLockService();
        const lock = await locks.tryAcquire(fixture.user.id, fixture.oldRun.workflowId!.toString(), fixture.oldRun.executionId);
        expect(lock).not.toBeNull();
        try {
            const run = await UserToolRun.findById(fixture.oldRun._id).select('+workspaceRetentionProtected').lean();
            expect(run?.workspaceRetentionProtected).toBe(true);
            const runs = new UserToolRunService();
            if (outcome === 'cancelled') {
                expect((await runs.requestCancellation(fixture.oldRun.executionId, fixture.user.id)).kind).toBe('stopped');
            } else {
                await runs.markRunning(fixture.oldRun.executionId, new Date(), undefined, lease!);
                await runs.completeRun(fixture.oldRun.executionId, {}, lease!);
            }
            for (const dryRun of [true, false]) {
                const result = await service.cleanupRunsForTool(fixture.fn.id, fixture.user.id, {
                    retentionDays: 14, retainLatest: 1, dryRun,
                });
                expect(result).toEqual(expect.objectContaining({ deletedRuns: 0, retainedRuns: 2, deletedArtifacts: [] }));
            }
            expect(await UserToolRun.exists({ _id: fixture.oldRun._id })).not.toBeNull();
            await expect(fs.access(path.join(fixture.outputRoot, 'old.log'))).resolves.toBeUndefined();
            expect(await locks.tryAcquire(fixture.user.id, fixture.oldRun.workflowId!.toString(), 'other')).toBeNull();
        } finally {
            if (lock) {
                await locks.release(lock);
            }
        }
    });

    it('does not delete terminal runs or artifacts while their workspace is locked', async () => {
        const fixture = await createFixture();
        const locks = new MongoWorkspaceLockService();
        const lock = await locks.tryAcquire(
            fixture.user.id,
            fixture.oldRun.workflowId!.toString(),
            fixture.oldRun.executionId,
        );
        expect(lock).not.toBeNull();

        try {
            const result = await service.cleanupRunsForTool(fixture.fn.id, fixture.user.id, {
                retentionDays: 14, retainLatest: 1,
            });

            expect(result).toEqual(expect.objectContaining({ deletedRuns: 0, retainedRuns: 2, deletedArtifacts: [] }));
            expect(await UserToolRun.exists({ _id: fixture.oldRun._id })).not.toBeNull();
            await expect(fs.access(path.join(fixture.outputRoot, 'old.log'))).resolves.toBeUndefined();
            expect(await locks.tryAcquire(fixture.user.id, fixture.oldRun.workflowId!.toString(), 'other')).toBeNull();
        } finally {
            if (lock) await locks.release(lock);
        }
    });

    it.each(['status', 'attempt', 'workspace'] as const)('rechecks %s atomically before deleting and removing artifacts', async (change) => {
        const fixture = await createFixture();
        const original = UserToolRun.findOneAndDelete.bind(UserToolRun);
        const spy = jest.spyOn(UserToolRun, 'findOneAndDelete').mockImplementationOnce((...args) => {
            const query = original(...args);
            query.pre(async () => {
                const patch = change === 'status'
                    ? { status: 'running' }
                    : change === 'workspace'
                        ? { workspaceRetentionProtected: true }
                        : { supervisedAttempt: { attemptId: 'attempt', leaseOwner: 'worker', leaseTokenDigest: 'digest', createdAt: new Date() } };
                await UserToolRun.collection.updateOne({ _id: fixture.oldRun._id }, { $set: patch });
            });
            return query;
        });
        try {
            const result = await service.cleanupRunsForTool(fixture.fn.id, fixture.user.id, {
                retentionDays: 14, retainLatest: 1,
            });
            expect(result).toEqual(expect.objectContaining({ deletedRuns: 0, retainedRuns: 2, deletedArtifacts: [] }));
            expect(await UserToolRun.exists({ _id: fixture.oldRun._id })).not.toBeNull();
            await expect(fs.access(path.join(fixture.outputRoot, 'old.log'))).resolves.toBeUndefined();
        } finally {
            spy.mockRestore();
        }
    });

    it('surfaces filesystem cleanup errors rather than reporting success', async () => {
        const fixture = await createFixture();
        const remove = jest.spyOn(fs, 'rm').mockRejectedValueOnce(new Error('filesystem unavailable'));
        try {
            await expect(service.cleanupRunsForTool(fixture.fn.id, fixture.user.id, {
                retentionDays: 14, retainLatest: 1,
            })).rejects.toThrow('filesystem unavailable');
            await expect(fs.access(path.join(fixture.outputRoot, 'old.log'))).resolves.toBeUndefined();
        } finally {
            remove.mockRestore();
        }
    });

    it('preserves artifacts referenced by a run of another tool in the same workspace', async () => {
        const fixture = await createFixture();
        await UserToolRun.create({
            executionId: 'other-tool-active', ownerUserId: fixture.user._id,
            toolId: new mongoose.Types.ObjectId(), toolVersionTag: '1', toolContentHash: 'hash',
            workflowId: fixture.oldRun.workflowId, launchContext: 'editor_test',
            status: 'running', runtime: 'typescript', runner: 'docker_sandbox', inputs: {},
            policySnapshot: { networkMode: 'none' },
            outputs: { artifacts: [{ path: 'output/old.log', kind: 'log' }] },
        });
        for (const dryRun of [true, false]) {
            const result = await service.cleanupRunsForTool(fixture.fn.id, fixture.user.id, {
                retentionDays: 14, retainLatest: 1, dryRun,
            });
            expect(result).toEqual(expect.objectContaining({ deletedRuns: 1, deletedArtifacts: [] }));
            await expect(fs.access(path.join(fixture.outputRoot, 'old.log'))).resolves.toBeUndefined();
        }
    });
});