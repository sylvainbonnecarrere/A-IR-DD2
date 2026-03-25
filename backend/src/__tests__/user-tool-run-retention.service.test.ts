import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import mongoose from 'mongoose';
import { User } from '../models/User.model';
import { UserFunction } from '../models/UserFunction.model';
import { Workspace } from '../models/Workspace.model';
import { UserToolRun } from '../models/UserToolRun.model';
import { UserToolRunRetentionService } from '../services/userToolRunRetention.service';

describe('UserToolRunRetentionService', () => {
    const service = new UserToolRunRetentionService();
    let tempRoot = '';

    afterEach(async () => {
        await UserToolRun.deleteMany({});
        await Workspace.deleteMany({});
        await UserFunction.deleteMany({ name: /retention-test-/i });
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
        const fn = await UserFunction.create({
            userId: user._id,
            workflowId,
            name: `retention-test-${Date.now()}`,
            description: 'Retention cleanup test',
            language: 'typescript',
            origin: 'custom',
            tags: ['test'],
            inputSchema: { type: 'object' },
            outputSchema: { type: 'object' },
            codeInline: 'function run() { return { ok: true }; }',
            isEnabled: true,
            isReadonly: false,
            version: 1
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
});