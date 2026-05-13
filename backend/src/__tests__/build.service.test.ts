import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import { User } from '../models/User.model';
import { Workflow } from '../models/Workflow.model';
import { UserTool } from '../models/UserTool.model';
import { Workspace } from '../models/Workspace.model';
import { BuildPreparationError, BuildService } from '../services/build.service';

function createToolVersion(overrides: Record<string, unknown> = {}) {
    return {
        versionTag: 'v1',
        contentHash: 'hash-v1',
        sourceMode: 'inline',
        sourcePath: null,
        sourceInline: 'function run(args) { return args; }',
        entrypoint: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        createdBy: null,
        buildStatus: 'not_built',
        validationStatus: 'unknown',
        ...overrides,
    };
}

async function createOwnedWorkflowFixture() {
    const suffix = Date.now().toString();
    const user = await User.create({
        email: `build-service-${suffix}@test.com`,
        password: 'hashedpassword12345',
        username: `buildservice${suffix}`
    });

    const workflow = await Workflow.create({
        userId: user._id,
        name: `Build Workspace ${suffix}`,
        isActive: true,
        isDefault: true,
        canvasState: { zoom: 1, panX: 0, panY: 0 }
    });

    return { user, workflow };
}

describe('BuildService', () => {
    const buildService = new BuildService();
    const originalWorkspaceStoragePath = process.env.WORKSPACE_STORAGE_PATH;

    beforeEach(() => {
        process.env.WORKSPACE_STORAGE_PATH = path.join(
            os.tmpdir(),
            `airdd2-j5-build-tests-${process.pid}`
        );
    });

    afterEach(async () => {
        if (originalWorkspaceStoragePath === undefined) {
            delete process.env.WORKSPACE_STORAGE_PATH;
        } else {
            process.env.WORKSPACE_STORAGE_PATH = originalWorkspaceStoragePath;
        }

        await fs.rm(
            path.join(
                path.resolve(__dirname, '../../python'),
                '.provisioned',
                'native-tools',
                'native_versioned_tool_report_recovery'
            ),
            { recursive: true, force: true }
        );

        await Workspace.deleteMany({});
        await UserTool.deleteMany({});
        await Workflow.deleteMany({});
        await User.deleteMany({});
    });

    it('prepares a workflow-scoped typescript tool through the legacy function build alias', async () => {
        const { user, workflow } = await createOwnedWorkflowFixture();

        const fn = await UserTool.create({
            name: 'ts_buildable_tool',
            description: 'TypeScript buildable tool',
            runtime: 'typescript',
            ownerUserId: user._id,
            workspaceId: null,
            scopeType: 'user',
            workflowId: workflow._id,
            status: 'ready',
            trustLevel: 'user_private',
            currentVersion: createToolVersion({
                versionTag: 'v2',
                contentHash: 'hash-ts-v2',
                sourceInline: 'function run(args) { return { echoed: args.value ?? null }; }',
            }),
            versions: [createToolVersion({
                versionTag: 'v2',
                contentHash: 'hash-ts-v2',
                sourceInline: 'function run(args) { return { echoed: args.value ?? null }; }',
            })],
            inputSchema: {},
            outputSchema: {},
            dependencies: { python: [], npm: ['zod@3.22.4'] },
            policy: { networkMode: 'none', writablePaths: [], secretAliases: [] },
            isEnabled: true,
            isReadonly: false,
            tags: []
        });

        const result = await buildService.prepareFunction(fn._id.toString(), user.id);

        expect(result.status).toBe('ready');
        expect(result.sourcePath).toContain(path.join('source', 'tools', 'ts_buildable_tool.ts'));
        expect(result.manifestPaths).toEqual(expect.arrayContaining([
            expect.stringContaining(path.join('manifests', 'tools', 'ts_buildable_tool', 'package.json')),
            expect.stringContaining(path.join('manifests', 'tools', 'ts_buildable_tool', 'tsconfig.json'))
        ]));
        expect(result.artifactPaths).toEqual([
            expect.stringContaining(path.join('build', 'tools', 'ts_buildable_tool', 'index.js'))
        ]);

        const emittedArtifact = await fs.readFile(result.artifactPaths[0], 'utf-8');
        expect(emittedArtifact).toContain('function run(args)');

        const persistedTool = await UserTool.findById(fn._id).lean();
        expect(persistedTool?.currentVersion.sourcePath).toBe(path.join('tools', 'ts_buildable_tool.ts'));

        const buildStatus = await buildService.getBuildStatus(fn._id.toString(), user.id);
        expect(buildStatus?.status).toBe('ready');
        expect(buildStatus?.functionId).toBe(fn._id.toString());
    });

    it('prepares a workflow-scoped python tool through the legacy function build alias', async () => {
        const { user, workflow } = await createOwnedWorkflowFixture();

        const fn = await UserTool.create({
            name: 'py_buildable_tool',
            description: 'Python buildable tool',
            runtime: 'python',
            ownerUserId: user._id,
            workspaceId: null,
            scopeType: 'user',
            workflowId: workflow._id,
            status: 'ready',
            trustLevel: 'user_private',
            currentVersion: createToolVersion({
                sourceInline: 'def run(args):\n    return {"echoed": args.get("value")}',
            }),
            versions: [createToolVersion({
                sourceInline: 'def run(args):\n    return {"echoed": args.get("value")}',
            })],
            inputSchema: {},
            outputSchema: {},
            dependencies: { python: ['httpx==0.27.0'], npm: [] },
            policy: { networkMode: 'none', writablePaths: [], secretAliases: [] },
            isEnabled: true,
            isReadonly: false,
            tags: []
        });

        const result = await buildService.prepareFunction(fn._id.toString(), user.id);

        expect(result.status).toBe('ready');
        expect(result.language).toBe('python');
        expect(result.manifestPaths).toEqual([
            expect.stringContaining(path.join('manifests', 'tools', 'py_buildable_tool', 'requirements.txt'))
        ]);
        expect(result.artifactPaths).toEqual([
            expect.stringContaining(path.join('build', 'tools', 'py_buildable_tool', 'py_buildable_tool.py'))
        ]);

        const requirements = await fs.readFile(result.manifestPaths[0], 'utf-8');
        expect(requirements.trim()).toBe('httpx==0.27.0');

        const emittedArtifact = await fs.readFile(result.artifactPaths[0], 'utf-8');
        expect(emittedArtifact).toContain('def run(args):');
    });

    it('blocks runtime preparation for dependency-bearing tools when accessed through the legacy function alias until an explicit build has been completed', async () => {
        const { user, workflow } = await createOwnedWorkflowFixture();

        const fn = await UserTool.create({
            name: 'guarded_ts_tool',
            description: 'Function guarded by build preparation',
            runtime: 'typescript',
            ownerUserId: user._id,
            workspaceId: null,
            scopeType: 'user',
            workflowId: workflow._id,
            status: 'ready',
            trustLevel: 'user_private',
            currentVersion: createToolVersion({
                sourceInline: 'function run(args) { return { ok: true, args }; }',
            }),
            versions: [createToolVersion({
                sourceInline: 'function run(args) { return { ok: true, args }; }',
            })],
            inputSchema: {},
            outputSchema: {},
            dependencies: { python: [], npm: ['zod@3.22.4'] },
            policy: { networkMode: 'none', writablePaths: [], secretAliases: [] },
            isEnabled: true,
            isReadonly: false,
            tags: []
        });

        await expect(buildService.ensureBuildReadyForRun(fn._id.toString(), user.id))
            .rejects
            .toThrow(BuildPreparationError);

        await buildService.prepareFunction(fn._id.toString(), user.id);

        await expect(buildService.ensureBuildReadyForRun(fn._id.toString(), user.id))
            .resolves
            .toBeUndefined();
    });

    it('prepares a versioned user tool and marks that version as built', async () => {
        const { user, workflow } = await createOwnedWorkflowFixture();

        const tool = await UserTool.create({
            ownerUserId: user._id,
            workspaceId: null,
            scopeType: 'user',
            workflowId: workflow._id,
            name: 'tool_buildable_v2',
            description: 'Versioned buildable tool',
            runtime: 'typescript',
            status: 'ready',
            trustLevel: 'user_private',
            currentVersion: {
                versionTag: 'v2',
                contentHash: 'hash-v2',
                sourceMode: 'inline',
                sourcePath: null,
                sourceInline: 'function run(args) { return { echoed: args.value ?? null }; }',
                entrypoint: null,
                createdAt: new Date(),
                createdBy: user._id,
                buildStatus: 'not_built',
                validationStatus: 'unknown'
            },
            versions: [{
                versionTag: 'v2',
                contentHash: 'hash-v2',
                sourceMode: 'inline',
                sourcePath: null,
                sourceInline: 'function run(args) { return { echoed: args.value ?? null }; }',
                entrypoint: null,
                createdAt: new Date(),
                createdBy: user._id,
                buildStatus: 'not_built',
                validationStatus: 'unknown'
            }],
            inputSchema: {},
            outputSchema: {},
            tags: [],
            dependencies: { python: [], npm: ['zod@3.22.4'] },
            policy: { networkMode: 'none', writablePaths: [], secretAliases: [] },
            isReadonly: false,
            isEnabled: true
        });

        const result = await buildService.prepareToolVersion(tool._id.toString(), user.id, 'v2');

        expect(result.toolId).toBe(tool._id.toString());
        expect(result.toolVersionTag).toBe('v2');
        expect(result.artifactPaths).toEqual([
            expect.stringContaining(path.join('build', 'tools', 'tool_buildable_v2_v2', 'index.js'))
        ]);

        const refreshed = await UserTool.findById(tool._id).lean();
        expect(refreshed?.currentVersion.buildStatus).toBe('built');

        await expect(buildService.ensureBuildReadyForTool(tool._id.toString(), user.id, 'v2'))
            .resolves
            .toBeUndefined();
    });

    it('rejects author build for native readonly tools with a platform provisioning message', async () => {
        const { user, workflow } = await createOwnedWorkflowFixture();

        const tool = await UserTool.create({
            ownerUserId: null,
            workspaceId: null,
            scopeType: 'native',
            workflowId: workflow._id,
            name: 'native_python_tool',
            description: 'Native platform managed tool',
            runtime: 'python',
            status: 'ready',
            trustLevel: 'internal',
            currentVersion: {
                versionTag: 'v1',
                contentHash: 'native-hash',
                sourceMode: 'inline',
                sourcePath: null,
                sourceInline: 'def run(args):\n    return {"ok": True}',
                entrypoint: null,
                createdAt: new Date(),
                createdBy: null,
                buildStatus: 'not_built',
                validationStatus: 'unknown'
            },
            versions: [{
                versionTag: 'v1',
                contentHash: 'native-hash',
                sourceMode: 'inline',
                sourcePath: null,
                sourceInline: 'def run(args):\n    return {"ok": True}',
                entrypoint: null,
                createdAt: new Date(),
                createdBy: null,
                buildStatus: 'not_built',
                validationStatus: 'unknown'
            }],
            inputSchema: {},
            outputSchema: {},
            tags: [],
            dependencies: { python: ['requests==2.32.3'], npm: [] },
            policy: { networkMode: 'restricted', writablePaths: [], secretAliases: [] },
            isReadonly: true,
            isEnabled: true
        });

        await expect(buildService.prepareToolVersion(tool._id.toString(), user.id, 'v1'))
            .rejects
            .toThrow('Native readonly tools cannot be prepared by the author build workflow. They require platform provisioning instead.');
    });

    it('requires platform provisioning for dependency-bearing native tool versions until they are marked built', async () => {
        const { user, workflow } = await createOwnedWorkflowFixture();

        const tool = await UserTool.create({
            ownerUserId: null,
            workspaceId: null,
            scopeType: 'native',
            workflowId: workflow._id,
            name: 'native_versioned_tool',
            description: 'Native versioned tool requiring platform provisioning',
            runtime: 'python',
            status: 'ready',
            trustLevel: 'internal',
            currentVersion: {
                versionTag: 'v3',
                contentHash: 'native-v3',
                sourceMode: 'inline',
                sourcePath: null,
                sourceInline: 'def run(args):\n    return {"ok": True}',
                entrypoint: null,
                createdAt: new Date(),
                createdBy: null,
                buildStatus: 'not_built',
                validationStatus: 'unknown'
            },
            versions: [{
                versionTag: 'v3',
                contentHash: 'native-v3',
                sourceMode: 'inline',
                sourcePath: null,
                sourceInline: 'def run(args):\n    return {"ok": True}',
                entrypoint: null,
                createdAt: new Date(),
                createdBy: null,
                buildStatus: 'not_built',
                validationStatus: 'unknown'
            }],
            inputSchema: {},
            outputSchema: {},
            tags: [],
            dependencies: { python: ['requests==2.32.3'], npm: [] },
            policy: { networkMode: 'restricted', writablePaths: [], secretAliases: [] },
            isReadonly: true,
            isEnabled: true
        });

        await expect(buildService.ensureBuildReadyForTool(tool._id.toString(), user.id, 'v3'))
            .rejects
            .toThrow('This native tool version declares dependencies and requires platform provisioning before sandbox execution.');

        await UserTool.updateOne(
            { _id: tool._id, 'versions.versionTag': 'v3' },
            {
                $set: {
                    'currentVersion.buildStatus': 'built',
                    'versions.$.buildStatus': 'built'
                }
            }
        );

        await expect(buildService.ensureBuildReadyForTool(tool._id.toString(), user.id, 'v3'))
            .resolves
            .toBeUndefined();
    });

    it('reconciles a native tool version from a ready provisioning report before blocking sandbox execution', async () => {
        const { user, workflow } = await createOwnedWorkflowFixture();

        const tool = await UserTool.create({
            ownerUserId: null,
            workspaceId: null,
            scopeType: 'native',
            workflowId: workflow._id,
            name: 'native_versioned_tool_report_recovery',
            description: 'Native versioned tool recovered from provision report',
            runtime: 'python',
            status: 'ready',
            trustLevel: 'internal',
            currentVersion: {
                versionTag: 'v3',
                contentHash: 'native-v3-report',
                sourceMode: 'inline',
                sourcePath: null,
                sourceInline: 'def run(args):\n    return {"ok": True}',
                entrypoint: null,
                createdAt: new Date(),
                createdBy: null,
                buildStatus: 'not_built',
                validationStatus: 'unknown'
            },
            versions: [{
                versionTag: 'v3',
                contentHash: 'native-v3-report',
                sourceMode: 'inline',
                sourcePath: null,
                sourceInline: 'def run(args):\n    return {"ok": True}',
                entrypoint: null,
                createdAt: new Date(),
                createdBy: null,
                buildStatus: 'not_built',
                validationStatus: 'unknown'
            }],
            inputSchema: {},
            outputSchema: {},
            tags: [],
            dependencies: { python: ['requests==2.32.3'], npm: [] },
            policy: { networkMode: 'restricted', writablePaths: [], secretAliases: [] },
            isReadonly: true,
            isEnabled: true
        });

        const reportPath = path.join(
            path.resolve(__dirname, '../../python'),
            '.provisioned',
            'native-tools',
            'native_versioned_tool_report_recovery',
            'v3',
            'provision-report.json'
        );

        await fs.mkdir(path.dirname(reportPath), { recursive: true });
        await fs.writeFile(reportPath, JSON.stringify({
            toolId: tool._id.toString(),
            toolName: tool.name,
            toolVersionTag: 'v3',
            status: 'ready',
            provisionedAt: new Date().toISOString(),
            dependencies: ['requests==2.32.3'],
            criticalModules: ['requests'],
            sitePackagesPath: '/opt/airdd2/backend-python/.provisioned/native-tools/native_versioned_tool_report_recovery/v3/site-packages',
            reportPath
        }, null, 2), 'utf-8');

        await expect(buildService.ensureBuildReadyForTool(tool._id.toString(), user.id, 'v3'))
            .resolves
            .toBeUndefined();

        const refreshed = await UserTool.findById(tool._id).lean();
        expect(refreshed?.currentVersion.buildStatus).toBe('built');
        expect(refreshed?.currentVersion.validationStatus).toBe('valid');
        expect(refreshed?.versions[0]?.buildStatus).toBe('built');
    });

    it('requires platform provisioning for dependency-bearing native legacy build aliases until the canonical tool is marked built', async () => {
        const { user, workflow } = await createOwnedWorkflowFixture();

        const fn = await UserTool.create({
            name: 'native_legacy_tool',
            description: 'Legacy native function requiring platform provisioning',
            runtime: 'python',
            ownerUserId: null,
            workspaceId: null,
            scopeType: 'native',
            workflowId: workflow._id,
            status: 'ready',
            trustLevel: 'internal',
            currentVersion: createToolVersion({
                versionTag: '1',
                contentHash: 'legacy-native-hash',
                sourceInline: 'def run(args):\n    return {"ok": True}',
            }),
            versions: [createToolVersion({
                versionTag: '1',
                contentHash: 'legacy-native-hash',
                sourceInline: 'def run(args):\n    return {"ok": True}',
            })],
            inputSchema: {},
            outputSchema: {},
            dependencies: { python: ['requests==2.32.3'], npm: [] },
            policy: { networkMode: 'restricted', writablePaths: [], secretAliases: [] },
            isEnabled: true,
            isReadonly: true,
            tags: []
        });

        await expect(buildService.ensureBuildReadyForRun(fn._id.toString(), user.id))
            .rejects
            .toThrow('This native function declares dependencies and requires platform provisioning before sandbox execution.');

        await UserTool.updateOne(
            { _id: fn._id, 'versions.versionTag': '1' },
            {
                $set: {
                    'currentVersion.buildStatus': 'built',
                    'versions.$.buildStatus': 'built'
                }
            }
        );

        await expect(buildService.ensureBuildReadyForRun(fn._id.toString(), user.id))
            .resolves
            .toBeUndefined();
    });
});