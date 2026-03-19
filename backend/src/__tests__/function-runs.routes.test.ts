import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import passport from 'passport';
import request from 'supertest';
import '../middleware/auth.middleware';
import { User } from '../models/User.model';
import { UserFunction } from '../models/UserFunction.model';
import { UserTool } from '../models/UserTool.model';
import { UserToolRun } from '../models/UserToolRun.model';
import { Workspace } from '../models/Workspace.model';
import functionsRoutes from '../routes/functions.routes';
import runsRoutes from '../routes/runs.routes';
import { generateAccessToken } from '../utils/jwt';

const app = express();
app.use(express.json());
app.use(passport.initialize());
app.use('/api/functions', functionsRoutes);
app.use('/api/runs', runsRoutes);

describe('Function run routes', () => {
    let tempRoot: string;

    afterEach(async () => {
        await UserToolRun.deleteMany({});
        await UserTool.deleteMany({});
        await Workspace.deleteMany({});
        await UserFunction.deleteMany({ name: /function-runs-test-/i });
        await User.deleteMany({ email: /function-runs-test-/i });
        if (tempRoot) {
            await fs.rm(tempRoot, { recursive: true, force: true });
        }
    });

    async function createFixture() {
        tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'airdd2-function-runs-'));
        const outputRoot = path.join(tempRoot, 'output');
        await fs.mkdir(path.join(outputRoot, 'nested'), { recursive: true });
        await fs.writeFile(path.join(outputRoot, 'nested', 'result.json'), '{"ok":true}', 'utf-8');
        await fs.writeFile(path.join(outputRoot, 'run.log'), 'sandbox ok', 'utf-8');
        await fs.writeFile(path.join(outputRoot, 'stale.log'), 'stale output', 'utf-8');

        const user = await User.create({
            email: `function-runs-test-${Date.now()}@test.com`,
            password: 'test-only-password-123',
            username: `functionruns${Date.now()}`
        });

        const workflowId = new (require('mongoose').Types.ObjectId)();
        const fn = await UserFunction.create({
            userId: user._id,
            workflowId,
            name: `function-runs-test-${Date.now()}`,
            description: 'Function run route test',
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

        await UserTool.create({
            _id: fn._id,
            ownerUserId: user._id,
            workspaceId: null,
            scopeType: 'user',
            workflowId,
            name: fn.name,
            description: fn.description,
            runtime: 'typescript',
            status: 'ready',
            trustLevel: 'user_private',
            currentVersion: {
                versionTag: '1',
                contentHash: 'hash-function-run',
                sourceMode: 'inline',
                sourcePath: null,
                sourceInline: fn.codeInline,
                entrypoint: null,
                createdAt: new Date(),
                createdBy: user._id,
                buildStatus: 'built',
                validationStatus: 'unknown'
            },
            versions: [{
                versionTag: '1',
                contentHash: 'hash-function-run',
                sourceMode: 'inline',
                sourcePath: null,
                sourceInline: fn.codeInline,
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

        await UserToolRun.create({
            executionId: 'utr-function-runs-1',
            ownerUserId: user._id,
            toolId: fn._id,
            toolVersionTag: '1',
            toolContentHash: 'hash-function-run',
            workflowId,
            launchContext: 'editor_test',
            status: 'completed',
            runtime: 'typescript',
            runner: 'docker_sandbox',
            inputs: { value: 'ok' },
            outputs: {
                stdout: 'sandbox ok',
                result: { ok: true },
                artifacts: [
                    { path: 'output/nested/result.json', kind: 'json' },
                    { path: 'output/run.log', kind: 'log' }
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
                durationMs: 42
            },
            resourceUsage: {
                wallTimeMs: 42,
                memoryLimitMb: 256
            }
        });

        await UserToolRun.create({
            executionId: 'utr-function-runs-2',
            ownerUserId: user._id,
            toolId: fn._id,
            toolVersionTag: '1',
            toolContentHash: 'hash-function-run-2',
            workflowId,
            launchContext: 'workflow_run',
            status: 'failed',
            runtime: 'typescript',
            runner: 'docker_sandbox',
            inputs: { value: 'bad' },
            outputs: {
                stdout: '',
                stderr: 'boom',
                artifacts: []
            },
            error: {
                message: 'boom',
                code: 'sandbox_runtime_error',
                retryable: false
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
                durationMs: 21
            },
            resourceUsage: {
                wallTimeMs: 21,
                memoryLimitMb: 256
            }
        });

        const staleRun = await UserToolRun.create({
            executionId: 'utr-function-runs-3',
            ownerUserId: user._id,
            toolId: fn._id,
            toolVersionTag: '1',
            toolContentHash: 'hash-function-run-3',
            workflowId,
            launchContext: 'editor_test',
            status: 'completed',
            runtime: 'typescript',
            runner: 'docker_sandbox',
            inputs: { value: 'stale' },
            outputs: {
                stdout: 'stale output',
                artifacts: [
                    { path: 'output/stale.log', kind: 'log' }
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
                durationMs: 5
            },
            resourceUsage: {
                wallTimeMs: 5,
                memoryLimitMb: 256
            }
        });

        const staleDate = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
        await UserToolRun.collection.updateOne({ _id: staleRun._id }, { $set: { createdAt: staleDate, updatedAt: staleDate } });

        return {
            fn,
            accessToken: generateAccessToken({
                sub: user.id,
                email: user.email,
                role: user.role
            })
        };
    }

    it('lists recent runs for a function', async () => {
        const fixture = await createFixture();

        const response = await request(app)
            .get(`/api/functions/${fixture.fn.id}/runs?limit=5`)
            .set('Authorization', `Bearer ${fixture.accessToken}`)
            .expect(200);

        expect(response.body.pagination).toEqual(expect.objectContaining({
            page: 1,
            limit: 5,
            total: 3,
            totalPages: 1
        }));
        expect(response.body.items).toHaveLength(3);
        expect(response.body.items[0]).toEqual(expect.objectContaining({
            executionId: 'utr-function-runs-2',
            runner: 'docker_sandbox',
            status: 'failed'
        }));
        expect(response.body.items[1]).toEqual(expect.objectContaining({
            executionId: 'utr-function-runs-1',
            runner: 'docker_sandbox',
            status: 'completed'
        }));
        expect(response.body.items[1].outputs.artifacts).toEqual(expect.arrayContaining([
            expect.objectContaining({ path: 'output/nested/result.json', kind: 'json' })
        ]));
    });

    it('filters and paginates runs for a function', async () => {
        const fixture = await createFixture();

        const response = await request(app)
            .get(`/api/functions/${fixture.fn.id}/runs?limit=1&page=1&status=completed`)
            .set('Authorization', `Bearer ${fixture.accessToken}`)
            .expect(200);

        expect(response.body.pagination).toEqual(expect.objectContaining({
            page: 1,
            limit: 1,
            total: 2,
            totalPages: 2,
            status: 'completed'
        }));
        expect(response.body.items).toHaveLength(1);
        expect(response.body.items[0].executionId).toBe('utr-function-runs-1');
    });

    it('sorts runs by duration ascending', async () => {
        const fixture = await createFixture();

        const response = await request(app)
            .get(`/api/functions/${fixture.fn.id}/runs?limit=5&sortBy=durationMs&sortOrder=asc`)
            .set('Authorization', `Bearer ${fixture.accessToken}`)
            .expect(200);

        expect(response.body.pagination).toEqual(expect.objectContaining({
            sortBy: 'durationMs',
            sortOrder: 'asc'
        }));
        expect(response.body.items.map((item: any) => item.executionId)).toEqual([
            'utr-function-runs-3',
            'utr-function-runs-2',
            'utr-function-runs-1'
        ]);
    });

    it('returns an artifact preview for a recorded run output', async () => {
        const fixture = await createFixture();

        const response = await request(app)
            .get(`/api/functions/${fixture.fn.id}/runs/utr-function-runs-1/artifacts/content`)
            .query({ path: 'output/nested/result.json' })
            .set('Authorization', `Bearer ${fixture.accessToken}`)
            .expect(200);

        expect(response.body.executionId).toBe('utr-function-runs-1');
        expect(response.body.artifact).toEqual(expect.objectContaining({
            path: 'output/nested/result.json',
            kind: 'json',
            previewable: true,
            contentType: 'application/json'
        }));
        expect(response.body.artifact.jsonContent).toEqual({ ok: true });
    });

    it('rejects artifact paths that escape the output root', async () => {
        const fixture = await createFixture();

        const response = await request(app)
            .get(`/api/functions/${fixture.fn.id}/runs/utr-function-runs-1/artifacts/content`)
            .query({ path: 'output/../secret.txt' })
            .set('Authorization', `Bearer ${fixture.accessToken}`)
            .expect(400);

        expect(response.body.error).toContain('Artifact path');
    });

    it('downloads an artifact for a recorded run output', async () => {
        const fixture = await createFixture();

        const response = await request(app)
            .get(`/api/functions/${fixture.fn.id}/runs/utr-function-runs-1/artifacts/download`)
            .query({ path: 'output/run.log' })
            .set('Authorization', `Bearer ${fixture.accessToken}`)
            .expect(200);

        expect(response.headers['content-type']).toContain('text/plain');
        expect(response.headers['content-disposition']).toContain('run.log');
        expect(response.text).toBe('sandbox ok');
    });

    it('cleans up old runs and their orphan artifacts', async () => {
        const fixture = await createFixture();

        const response = await request(app)
            .post(`/api/functions/${fixture.fn.id}/runs/cleanup`)
            .set('Authorization', `Bearer ${fixture.accessToken}`)
            .send({ retentionDays: 14, retainLatest: 2 })
            .expect(200);

        expect(response.body).toEqual(expect.objectContaining({
            deletedRuns: 1,
            retainedRuns: 2,
            deletedArtifacts: ['output/stale.log'],
            dryRun: false
        }));

        expect(await UserToolRun.countDocuments({ toolId: fixture.fn._id })).toBe(2);
        await expect(fs.access(path.join(tempRoot, 'output', 'stale.log'))).rejects.toBeTruthy();
    });

    it('returns an artifact preview via the target runs route', async () => {
        const fixture = await createFixture();

        const response = await request(app)
            .get(`/api/runs/tool/${fixture.fn.id}/utr-function-runs-1/artifacts/content`)
            .query({ path: 'output/nested/result.json' })
            .set('Authorization', `Bearer ${fixture.accessToken}`)
            .expect(200);

        expect(response.body.executionId).toBe('utr-function-runs-1');
        expect(response.body.artifact).toEqual(expect.objectContaining({
            path: 'output/nested/result.json',
            kind: 'json',
            previewable: true
        }));
    });

    it('cleans up old runs via the target runs route', async () => {
        const fixture = await createFixture();

        const response = await request(app)
            .post(`/api/runs/tool/${fixture.fn.id}/cleanup`)
            .set('Authorization', `Bearer ${fixture.accessToken}`)
            .send({ retentionDays: 14, retainLatest: 2 })
            .expect(200);

        expect(response.body).toEqual(expect.objectContaining({
            deletedRuns: 1,
            retainedRuns: 2,
            deletedArtifacts: ['output/stale.log']
        }));
    });
});