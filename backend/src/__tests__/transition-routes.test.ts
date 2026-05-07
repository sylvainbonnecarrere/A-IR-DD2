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
        await UserTool.deleteMany({
            $or: [
                { name: 'hello_test' },
                { name: /transition-route-test-/i },
                { name: /web_(search|fetch)_py/i }
            ]
        });
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
            readinessStatus: expect.objectContaining({
                requirement: 'none',
                state: 'ready',
                runnable: true
            }),
            workspaceContext: expect.objectContaining({
                workspaceId: workspaceId.toString(),
                status: 'active'
            })
        }));
    });

    it('exposes shared hello_test but hides foreign private custom tools from GET /api/tools', async () => {
        const requester = await User.create({
            email: `transition-route-test-shared-${Date.now()}@test.com`,
            password: 'test-only-password-123',
            username: `transitionshared${Date.now()}`
        });

        const foreignOwner = await User.create({
            email: `transition-route-test-foreign-${Date.now()}@test.com`,
            password: 'test-only-password-123',
            username: `transitionforeign${Date.now()}`
        });

        await UserTool.create({
            ownerUserId: null,
            workspaceId: null,
            scopeType: 'user',
            workflowId: null,
            name: 'hello_test',
            displayName: 'Hello Test Shared',
            description: 'Shared custom hello test example',
            runtime: 'typescript',
            status: 'ready',
            trustLevel: 'internal',
            currentVersion: {
                versionTag: 'v2',
                contentHash: 'hello-test-shared-v2',
                sourceMode: 'inline',
                sourceInline: 'export function run(context, args) { return { result: `Ton nom, ${args.user_name}, est maintenant enregistré dans ma mémoire` }; }',
                createdAt: new Date(),
                buildStatus: 'built',
                validationStatus: 'valid'
            },
            versions: [{
                versionTag: 'v2',
                contentHash: 'hello-test-shared-v2',
                sourceMode: 'inline',
                sourceInline: 'export function run(context, args) { return { result: `Ton nom, ${args.user_name}, est maintenant enregistré dans ma mémoire` }; }',
                createdAt: new Date(),
                buildStatus: 'built',
                validationStatus: 'valid'
            }],
            inputSchema: { type: 'object' },
            outputSchema: { type: 'object' },
            tags: ['shared'],
            dependencies: { npm: [], python: [] },
            policy: { networkMode: 'none' },
            isReadonly: true,
            isEnabled: true
        });

        await UserTool.create({
            ownerUserId: foreignOwner._id,
            workspaceId: null,
            scopeType: 'user',
            workflowId: null,
            name: `transition-route-test-private-${Date.now()}`,
            displayName: 'Foreign Private Tool',
            description: 'Should stay private to its owner',
            runtime: 'typescript',
            status: 'ready',
            trustLevel: 'user_private',
            currentVersion: {
                versionTag: 'v1',
                contentHash: 'foreign-private-v1',
                sourceMode: 'inline',
                sourceInline: 'export function run() { return { ok: true }; }',
                createdAt: new Date(),
                buildStatus: 'built',
                validationStatus: 'valid'
            },
            versions: [{
                versionTag: 'v1',
                contentHash: 'foreign-private-v1',
                sourceMode: 'inline',
                sourceInline: 'export function run() { return { ok: true }; }',
                createdAt: new Date(),
                buildStatus: 'built',
                validationStatus: 'valid'
            }],
            inputSchema: { type: 'object' },
            outputSchema: { type: 'object' },
            tags: [],
            dependencies: { npm: [], python: [] },
            policy: { networkMode: 'none' },
            isReadonly: false,
            isEnabled: true
        });

        const accessToken = generateAccessToken({ sub: requester.id, email: requester.email, role: requester.role });

        const response = await request(app)
            .get('/api/tools')
            .set('Authorization', `Bearer ${accessToken}`)
            .expect(200);

        expect(response.body.items.some((item: any) => item.name === 'hello_test')).toBe(true);
        expect(response.body.items.some((item: any) => String(item.name).startsWith('transition-route-test-private-'))).toBe(false);
    });

    it('exposes a unified readiness status for web_fetch_py when platform provisioning is still missing', async () => {
        const user = await User.create({
            email: `transition-route-test-web-search-missing-${Date.now()}@test.com`,
            password: 'test-only-password-123',
            username: `transitionwebsearchmissing${Date.now()}`
        });

        const tool = await UserTool.create({
            ownerUserId: null,
            workspaceId: null,
            scopeType: 'native',
            workflowId: null,
            name: 'web_fetch_py',
            displayName: 'Web Fetch',
            description: 'Recuperation web native',
            runtime: 'python',
            status: 'ready',
            trustLevel: 'internal',
            currentVersion: {
                versionTag: 'v1',
                contentHash: 'web-fetch-v1-missing',
                sourceMode: 'path',
                sourcePath: 'backend/python/native/web_fetch_py.py',
                sourceInline: null,
                createdAt: new Date(),
                buildStatus: 'not_built',
                validationStatus: 'valid'
            },
            versions: [{
                versionTag: 'v1',
                contentHash: 'web-fetch-v1-missing',
                sourceMode: 'path',
                sourcePath: 'backend/python/native/web_fetch_py.py',
                sourceInline: null,
                createdAt: new Date(),
                buildStatus: 'not_built',
                validationStatus: 'valid'
            }],
            inputSchema: { type: 'object' },
            outputSchema: { type: 'object' },
            tags: ['fetch', 'native'],
            dependencies: { npm: [], python: ['requests==2.32.3'] },
            policy: { networkMode: 'restricted', timeoutSeconds: 30, maxMemoryMb: 256 },
            isReadonly: true,
            isEnabled: true
        });

        const accessToken = generateAccessToken({ sub: user.id, email: user.email, role: user.role });

        const response = await request(app)
            .get(`/api/tools/${tool.id}`)
            .set('Authorization', `Bearer ${accessToken}`)
            .expect(200);

        expect(response.body.tool).toEqual(expect.objectContaining({
            id: tool.id,
            name: 'web_fetch_py',
            readinessStatus: expect.objectContaining({
                requirement: 'platform_provision',
                state: 'waiting_for_provisioning',
                prepared: false,
                runnable: false,
                dependencyReadiness: 'missing',
                actionLabel: 'Provisionnement plateforme requis'
            })
        }));
    });

    it('exposes web_fetch_py readiness from GET /api/tools when platform provisioning is still missing', async () => {
        const user = await User.create({
            email: `transition-route-test-web-search-list-missing-${Date.now()}@test.com`,
            password: 'test-only-password-123',
            username: `transitionwebsearchlistmissing${Date.now()}`
        });

        const tool = await UserTool.create({
            ownerUserId: null,
            workspaceId: null,
            scopeType: 'native',
            workflowId: null,
            name: 'web_fetch_py',
            displayName: 'Web Fetch',
            description: 'Recuperation web native',
            runtime: 'python',
            status: 'ready',
            trustLevel: 'internal',
            currentVersion: {
                versionTag: 'v-list-missing',
                contentHash: 'web-fetch-list-missing',
                sourceMode: 'path',
                sourcePath: 'backend/python/native/web_fetch_py.py',
                sourceInline: null,
                createdAt: new Date(),
                buildStatus: 'not_built',
                validationStatus: 'valid'
            },
            versions: [{
                versionTag: 'v-list-missing',
                contentHash: 'web-fetch-list-missing',
                sourceMode: 'path',
                sourcePath: 'backend/python/native/web_fetch_py.py',
                sourceInline: null,
                createdAt: new Date(),
                buildStatus: 'not_built',
                validationStatus: 'valid'
            }],
            inputSchema: { type: 'object' },
            outputSchema: { type: 'object' },
            tags: ['fetch', 'native'],
            dependencies: { npm: [], python: ['requests==2.32.3'] },
            policy: { networkMode: 'restricted', timeoutSeconds: 30, maxMemoryMb: 256 },
            isReadonly: true,
            isEnabled: true
        });

        const accessToken = generateAccessToken({ sub: user.id, email: user.email, role: user.role });

        const response = await request(app)
            .get('/api/tools?runtime=python')
            .set('Authorization', `Bearer ${accessToken}`)
            .expect(200);

        expect(response.body.items).toEqual(expect.arrayContaining([
            expect.objectContaining({
                id: tool.id,
                name: 'web_fetch_py',
                readinessStatus: expect.objectContaining({
                    requirement: 'platform_provision',
                    state: 'waiting_for_provisioning',
                    prepared: false,
                    runnable: false,
                    dependencyReadiness: 'missing',
                    actionLabel: 'Provisionnement plateforme requis'
                })
            })
        ]));
    });

    it('exposes a unified readiness status for web_fetch_py when platform provisioning is complete', async () => {
        const user = await User.create({
            email: `transition-route-test-web-search-ready-${Date.now()}@test.com`,
            password: 'test-only-password-123',
            username: `transitionwebsearchready${Date.now()}`
        });

        const tool = await UserTool.create({
            ownerUserId: null,
            workspaceId: null,
            scopeType: 'native',
            workflowId: null,
            name: 'web_fetch_py',
            displayName: 'Web Fetch',
            description: 'Recuperation web native',
            runtime: 'python',
            status: 'ready',
            trustLevel: 'internal',
            currentVersion: {
                versionTag: 'v2',
                contentHash: 'web-fetch-v2-ready',
                sourceMode: 'path',
                sourcePath: 'backend/python/native/web_fetch_py.py',
                sourceInline: null,
                createdAt: new Date(),
                buildStatus: 'built',
                validationStatus: 'valid'
            },
            versions: [{
                versionTag: 'v2',
                contentHash: 'web-fetch-v2-ready',
                sourceMode: 'path',
                sourcePath: 'backend/python/native/web_fetch_py.py',
                sourceInline: null,
                createdAt: new Date(),
                buildStatus: 'built',
                validationStatus: 'valid'
            }],
            inputSchema: { type: 'object' },
            outputSchema: { type: 'object' },
            tags: ['fetch', 'native'],
            dependencies: { npm: [], python: ['requests==2.32.3'] },
            policy: { networkMode: 'restricted', timeoutSeconds: 30, maxMemoryMb: 256 },
            isReadonly: true,
            isEnabled: true
        });

        const accessToken = generateAccessToken({ sub: user.id, email: user.email, role: user.role });

        const response = await request(app)
            .get(`/api/tools/${tool.id}`)
            .set('Authorization', `Bearer ${accessToken}`)
            .expect(200);

        expect(response.body.tool).toEqual(expect.objectContaining({
            id: tool.id,
            name: 'web_fetch_py',
            readinessStatus: expect.objectContaining({
                requirement: 'platform_provision',
                state: 'ready',
                prepared: true,
                runnable: true,
                dependencyReadiness: 'satisfied',
                actionLabel: 'Executable'
            })
        }));
    });

    it('allows explicit platform provisioning through POST /api/tools/:id/provision', async () => {
        const user = await User.create({
            email: `transition-route-test-web-search-provision-${Date.now()}@test.com`,
            password: 'test-only-password-123',
            username: `transitionwebsearchprovision${Date.now()}`
        });

        const tool = await UserTool.create({
            ownerUserId: null,
            workspaceId: null,
            scopeType: 'native',
            workflowId: null,
            name: 'web_fetch_py',
            displayName: 'Web Fetch',
            description: 'Recuperation web native',
            runtime: 'python',
            status: 'ready',
            trustLevel: 'internal',
            currentVersion: {
                versionTag: 'v-provision',
                contentHash: 'web-fetch-provision',
                sourceMode: 'path',
                sourcePath: 'backend/python/native/web_fetch_py.py',
                sourceInline: null,
                createdAt: new Date(),
                buildStatus: 'not_built',
                validationStatus: 'valid'
            },
            versions: [{
                versionTag: 'v-provision',
                contentHash: 'web-fetch-provision',
                sourceMode: 'path',
                sourcePath: 'backend/python/native/web_fetch_py.py',
                sourceInline: null,
                createdAt: new Date(),
                buildStatus: 'not_built',
                validationStatus: 'valid'
            }],
            inputSchema: { type: 'object' },
            outputSchema: { type: 'object' },
            tags: ['fetch', 'native'],
            dependencies: { npm: [], python: ['requests==2.32.3'] },
            policy: { networkMode: 'restricted', timeoutSeconds: 30, maxMemoryMb: 256 },
            isReadonly: true,
            isEnabled: true
        });

        const accessToken = generateAccessToken({ sub: user.id, email: user.email, role: user.role });
        const provisionSpy = jest.spyOn(
            require('../services/nativePythonProvisioning.service').NativePythonProvisioningService.prototype,
            'provisionToolVersion'
        ).mockResolvedValue({
            toolId: tool.id,
            toolName: 'web_fetch_py',
            toolVersionTag: 'v-provision',
            status: 'ready',
            provisionedAt: '2026-03-31T12:00:00.000Z',
            dependencies: ['requests==2.32.3'],
            criticalModules: ['requests'],
            sitePackagesPath: '/tmp/site-packages',
            reportPath: '/tmp/provision-report.json'
        });

        const response = await request(app)
            .post(`/api/tools/${tool.id}/provision?versionTag=v-provision`)
            .set('Authorization', `Bearer ${accessToken}`)
            .expect(200);

        expect(response.body).toEqual(expect.objectContaining({
            toolId: tool.id,
            toolVersionTag: 'v-provision',
            status: 'ready'
        }));
        expect(provisionSpy).toHaveBeenCalledWith(tool.id, user.id, 'v-provision');
        provisionSpy.mockRestore();
    });

    it('exposes web_fetch_py readiness from GET /api/tools when platform provisioning is complete', async () => {
        const user = await User.create({
            email: `transition-route-test-web-search-list-ready-${Date.now()}@test.com`,
            password: 'test-only-password-123',
            username: `transitionwebsearchlistready${Date.now()}`
        });

        const tool = await UserTool.create({
            ownerUserId: null,
            workspaceId: null,
            scopeType: 'native',
            workflowId: null,
            name: 'web_fetch_py',
            displayName: 'Web Fetch',
            description: 'Recuperation web native',
            runtime: 'python',
            status: 'ready',
            trustLevel: 'internal',
            currentVersion: {
                versionTag: 'v-list-ready',
                contentHash: 'web-fetch-list-ready',
                sourceMode: 'path',
                sourcePath: 'backend/python/native/web_fetch_py.py',
                sourceInline: null,
                createdAt: new Date(),
                buildStatus: 'built',
                validationStatus: 'valid'
            },
            versions: [{
                versionTag: 'v-list-ready',
                contentHash: 'web-fetch-list-ready',
                sourceMode: 'path',
                sourcePath: 'backend/python/native/web_fetch_py.py',
                sourceInline: null,
                createdAt: new Date(),
                buildStatus: 'built',
                validationStatus: 'valid'
            }],
            inputSchema: { type: 'object' },
            outputSchema: { type: 'object' },
            tags: ['fetch', 'native'],
            dependencies: { npm: [], python: ['requests==2.32.3'] },
            policy: { networkMode: 'restricted', timeoutSeconds: 30, maxMemoryMb: 256 },
            isReadonly: true,
            isEnabled: true
        });

        const accessToken = generateAccessToken({ sub: user.id, email: user.email, role: user.role });

        const response = await request(app)
            .get('/api/tools?runtime=python')
            .set('Authorization', `Bearer ${accessToken}`)
            .expect(200);

        expect(response.body.items).toEqual(expect.arrayContaining([
            expect.objectContaining({
                id: tool.id,
                name: 'web_fetch_py',
                readinessStatus: expect.objectContaining({
                    requirement: 'platform_provision',
                    state: 'ready',
                    prepared: true,
                    runnable: true,
                    dependencyReadiness: 'satisfied',
                    actionLabel: 'Executable'
                })
            })
        ]));
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