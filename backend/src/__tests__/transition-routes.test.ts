import express from 'express';
import passport from 'passport';
import request from 'supertest';
import mongoose from 'mongoose';
import '../middleware/auth.middleware';
import { User } from '../models/User.model';
import { UserTool } from '../models/UserTool.model';
import { UserToolRun } from '../models/UserToolRun.model';
import { Workspace } from '../models/Workspace.model';
import runsRoutes from '../routes/runs.routes';
import toolsRoutes from '../routes/tools.routes';
import workspacesRoutes from '../routes/workspaces.routes';
import { RuntimeHealthService } from '../services/runtimeHealth.service';
import { generateAccessToken } from '../utils/jwt';

const app = express();
app.use(express.json());
app.use(passport.initialize());
app.use('/api/tools', toolsRoutes);
app.use('/api/runs', runsRoutes);
app.use('/api/workspaces', workspacesRoutes);

describe('J8 transition routes', () => {
    const runtimeHealthSpy = jest.spyOn(RuntimeHealthService.prototype, 'getHealthReport');

    beforeEach(() => {
        runtimeHealthSpy.mockResolvedValue({
            status: 'healthy',
            checkedAt: '2026-01-01T00:00:00.000Z',
            summary: 'Runtime ready in dev mode.',
            components: [],
            runtime: {
                node: { available: true, status: 'healthy', executable: 'node', version: '24.8.0' },
                python: { available: true, status: 'healthy', executable: 'python3', version: '3.11.0' },
                docker: {
                    available: true,
                    status: 'healthy',
                    executable: 'docker',
                    version: '27.0.0',
                    rootless: false,
                    mode: 'docker-desktop',
                    securityLevel: 'dev-only',
                    executionReady: true,
                    warning: 'Docker Desktop is dev-only.'
                },
                images: {
                    node: { available: true, status: 'healthy', image: 'airdd2/node' },
                    python: { available: true, status: 'healthy', image: 'airdd2/python' }
                },
                runners: {
                    preferred: 'docker_sandbox',
                    dockerSandbox: { runner: 'docker_sandbox', available: true, status: 'healthy' },
                    firecracker: { runner: 'firecracker', available: false, status: 'degraded', detail: 'Not configured' }
                },
                typescript: { available: true, status: 'healthy', engine: 'node-subprocess' }
            },
            capabilities: {
                build: { typescript: true, python: true },
                run: { typescript: true, python: true, dockerRootless: false }
            },
            python: { available: true, executable: 'python3', version: '3.11.0' },
            typescript: { available: true, engine: 'node-subprocess' }
        } as any);
    });

    afterEach(async () => {
        runtimeHealthSpy.mockReset();
        await UserToolRun.deleteMany({});
        await UserTool.deleteMany({ name: /transition-route-test-/i });
        await Workspace.deleteMany({ logicalRoot: /transition-route-test-/i });
        await User.deleteMany({ email: /transition-route-test-/i });
    });

    it('returns transition tools and runtime compatibility from GET /api/tools', async () => {
        const workflowId = new mongoose.Types.ObjectId();
        const workspaceId = new mongoose.Types.ObjectId();
        const user = await User.create({
            email: `transition-route-test-${Date.now()}@test.com`,
            password: 'test-only-password-123',
            username: `transitionroutes${Date.now()}`
        });

        const tool = await UserTool.create({
            ownerUserId: user._id,
            workspaceId,
            scopeType: 'user',
            workflowId,
            name: `transition-route-test-${Date.now()}`,
            displayName: 'Transition Tool',
            description: 'Tool exposed through J8 routes',
            runtime: 'typescript',
            status: 'ready',
            trustLevel: 'user_private',
            currentVersion: {
                versionTag: 'v1',
                contentHash: 'hash-v1',
                sourceMode: 'inline',
                sourceInline: 'export function run() { return { ok: true }; }',
                createdAt: new Date(),
                buildStatus: 'built',
                validationStatus: 'valid'
            },
            versions: [{
                versionTag: 'v1',
                contentHash: 'hash-v1',
                sourceMode: 'inline',
                sourceInline: 'export function run() { return { ok: true }; }',
                createdAt: new Date(),
                buildStatus: 'built',
                validationStatus: 'valid'
            }],
            inputSchema: { type: 'object' },
            outputSchema: { type: 'object' },
            tags: ['transition'],
            dependencies: { npm: [], python: [] },
            policy: { networkMode: 'restricted', timeoutSeconds: 30, maxMemoryMb: 256 },
            isReadonly: false,
            isEnabled: true
        });

        await Workspace.create({
            _id: workspaceId,
            ownerUserId: user._id,
            scopeType: 'workflow',
            scopeId: workflowId,
            logicalRoot: `transition-route-test-${Date.now()}`,
            runtimeRoots: {
                sourceRoot: 'source',
                manifestsRoot: 'manifests',
                buildRoot: 'build',
                outputRoot: 'output'
            },
            manifests: {
                packageJson: true,
                packageLockJson: false,
                requirementsTxt: false,
                pyprojectToml: false
            },
            status: 'active',
            snapshotVersion: 1,
            lastScanAt: new Date()
        });

        const accessToken = generateAccessToken({ sub: user.id, email: user.email, role: user.role });

        const response = await request(app)
            .get(`/api/tools?workflowId=${workflowId.toString()}`)
            .set('Authorization', `Bearer ${accessToken}`)
            .expect(200);

        expect(response.headers['x-runtime-security-level']).toBe('dev-only');
        expect(response.body.runtimeCompatibility).toEqual(expect.objectContaining({
            mode: 'docker-desktop',
            securityLevel: 'dev-only',
            preferredRunner: 'docker_sandbox'
        }));
        expect(response.body.items).toContainEqual(expect.objectContaining({
            id: tool.id,
            legacyFunctionId: tool.id,
            compatibilityAliases: { functionId: tool.id },
            workspaceContext: expect.objectContaining({
                workspaceId: workspaceId.toString(),
                status: 'active'
            })
        }));
    });

    it('returns owner-scoped runs from GET /api/runs', async () => {
        const workflowId = new mongoose.Types.ObjectId();
        const user = await User.create({
            email: `transition-route-test-runs-${Date.now()}@test.com`,
            password: 'test-only-password-123',
            username: `transitionruns${Date.now()}`
        });

        const tool = await UserTool.create({
            ownerUserId: user._id,
            workspaceId: null,
            scopeType: 'user',
            workflowId,
            name: `transition-route-test-runs-${Date.now()}`,
            description: 'Tool with run history',
            runtime: 'python',
            status: 'ready',
            trustLevel: 'user_private',
            currentVersion: {
                versionTag: 'v1',
                contentHash: 'hash-runs-v1',
                sourceMode: 'inline',
                sourceInline: 'def run(args):\n    return {"ok": True}',
                createdAt: new Date(),
                buildStatus: 'built',
                validationStatus: 'valid'
            },
            versions: [{
                versionTag: 'v1',
                contentHash: 'hash-runs-v1',
                sourceMode: 'inline',
                sourceInline: 'def run(args):\n    return {"ok": True}',
                createdAt: new Date(),
                buildStatus: 'built',
                validationStatus: 'valid'
            }],
            inputSchema: { type: 'object' },
            outputSchema: { type: 'object' },
            tags: [],
            dependencies: { npm: [], python: [] },
            policy: { networkMode: 'restricted', timeoutSeconds: 30, maxMemoryMb: 256 },
            isReadonly: false,
            isEnabled: true
        });

        await UserToolRun.create({
            executionId: `transition-run-${Date.now()}`,
            ownerUserId: user._id,
            toolId: tool._id,
            toolVersionTag: 'v1',
            toolContentHash: 'hash-runs-v1',
            workflowId,
            launchContext: 'workflow_run',
            status: 'completed',
            runtime: 'python',
            runner: 'docker_sandbox',
            inputs: { ok: true },
            outputs: { stdout: 'ok', artifacts: [] },
            policySnapshot: { networkMode: 'restricted', timeoutSeconds: 30, maxMemoryMb: 256, secretAliases: [] },
            timing: { queuedAt: new Date(), startedAt: new Date(), finishedAt: new Date(), durationMs: 12 },
            resourceUsage: { wallTimeMs: 12, memoryLimitMb: 256 }
        });

        const accessToken = generateAccessToken({ sub: user.id, email: user.email, role: user.role });

        const response = await request(app)
            .get(`/api/runs?workflowId=${workflowId.toString()}&limit=10`)
            .set('Authorization', `Bearer ${accessToken}`)
            .expect(200);

        expect(response.body.pagination.total).toBe(1);
        expect(response.body.items[0]).toEqual(expect.objectContaining({
            executionId: expect.stringContaining('transition-run-'),
            status: 'completed',
            runtime: 'python',
            runner: 'docker_sandbox'
        }));
        expect(response.body.runtimeCompatibility).toEqual(expect.objectContaining({
            executionReady: true
        }));
    });
});