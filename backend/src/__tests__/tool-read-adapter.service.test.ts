import os from 'os';
import path from 'path';
import { User } from '../models/User.model';
import { Workflow } from '../models/Workflow.model';
import { Workspace } from '../models/Workspace.model';
import { UserTool } from '../models/UserTool.model';
import { ToolReadAdapterService } from '../services/toolReadAdapter.service';

function createVersion(overrides: Record<string, unknown> = {}) {
    return {
        versionTag: 'v1',
        contentHash: 'hash-v1',
        sourceMode: 'path',
        sourcePath: 'tools/workflow_custom_tool.py',
        sourceInline: null,
        entrypoint: 'tools/workflow_custom_tool.py',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        createdBy: null,
        buildStatus: 'built',
        validationStatus: 'valid',
        ...overrides,
    };
}

describe('ToolReadAdapterService legacy read projection', () => {
    const toolReadAdapterService = new ToolReadAdapterService();
    const originalWorkspaceStoragePath = process.env.WORKSPACE_STORAGE_PATH;

    beforeEach(() => {
        process.env.WORKSPACE_STORAGE_PATH = path.join(
            os.tmpdir(),
            `airdd2-j4-tool-read-adapter-tests-${process.pid}`,
        );
    });

    afterEach(async () => {
        if (originalWorkspaceStoragePath === undefined) {
            delete process.env.WORKSPACE_STORAGE_PATH;
        } else {
            process.env.WORKSPACE_STORAGE_PATH = originalWorkspaceStoragePath;
        }

        await Workspace.deleteMany({});
        await UserTool.deleteMany({});
        await Workflow.deleteMany({});
        await User.deleteMany({});
    });

    it('enriches workflow-scoped custom tool projections with workspace-backed path context', async () => {
        const user = await User.create({
            email: `tool-read-adapter-${Date.now()}@test.com`,
            password: 'hashedpassword12345',
            username: `toolreadadapter${Date.now()}`,
        });

        const workflow = await Workflow.create({
            userId: user._id,
            name: 'Tool Read Adapter Workspace',
            isActive: true,
            isDefault: true,
            canvasState: { zoom: 1, panX: 0, panY: 0 },
        });

        await UserTool.create({
            ownerUserId: user._id,
            workspaceId: null,
            scopeType: 'user',
            workflowId: workflow._id,
            name: 'workflow_custom_tool',
            description: 'Workflow custom tool',
            runtime: 'python',
            status: 'ready',
            trustLevel: 'user_private',
            currentVersion: createVersion(),
            versions: [createVersion()],
            inputSchema: {},
            outputSchema: {},
            tags: [],
            dependencies: { python: ['requests'], npm: [] },
            policy: { networkMode: 'none' },
            isReadonly: false,
            isEnabled: true,
        });

        await UserTool.create({
            ownerUserId: null,
            workspaceId: null,
            scopeType: 'native',
            workflowId: null,
            name: 'native_repo_tool',
            description: 'Native repo tool',
            runtime: 'python',
            status: 'ready',
            trustLevel: 'internal',
            currentVersion: createVersion({
                contentHash: 'hash-native',
                sourcePath: 'backend/python/native/native_repo_tool.py',
                entrypoint: 'backend/python/native/native_repo_tool.py',
            }),
            versions: [createVersion({
                contentHash: 'hash-native',
                sourcePath: 'backend/python/native/native_repo_tool.py',
                entrypoint: 'backend/python/native/native_repo_tool.py',
            })],
            inputSchema: {},
            outputSchema: {},
            tags: [],
            dependencies: { python: [], npm: [] },
            policy: { networkMode: 'none' },
            isReadonly: true,
            isEnabled: true,
        });

        const functions = await toolReadAdapterService.listLegacyFunctions(user.id);
        const workflowFunction = functions.find((fn) => fn.name === 'workflow_custom_tool');
        const nativeFunction = functions.find((fn) => fn.name === 'native_repo_tool');

        expect(workflowFunction).toBeDefined();
        expect(workflowFunction?.workspaceContext).toEqual(expect.objectContaining({
            status: 'active',
            runtimeRoots: expect.objectContaining({
                sourceRoot: expect.stringContaining(path.join('workspaces', 'users')),
            }),
        }));
        expect(workflowFunction?.codePathRoot).toBe('workspace_source');
        expect(workflowFunction?.resolvedCodePath).toBe(
            path.resolve(
                workflowFunction!.workspaceContext!.runtimeRoots.sourceRoot,
                'tools/workflow_custom_tool.py',
            ),
        );

        const persistedWorkspace = await Workspace.findOne({
            ownerUserId: user._id,
            scopeType: 'workflow',
            scopeId: workflow._id,
        });
        expect(persistedWorkspace).not.toBeNull();

        expect(nativeFunction).toBeDefined();
        expect(nativeFunction?.workspaceContext).toBeUndefined();
        expect(nativeFunction?.codePathRoot).toBe('native_repo');
        expect(nativeFunction?.resolvedCodePath).toBe('backend/python/native/native_repo_tool.py');
    });

    it('exposes shared hello_test globally but keeps foreign custom tools private', async () => {
        const requester = await User.create({
            email: `tool-read-adapter-requester-${Date.now()}@test.com`,
            password: 'hashedpassword12345',
            username: `toolreadadapterrequester${Date.now()}`,
        });

        const foreignOwner = await User.create({
            email: `tool-read-adapter-foreign-${Date.now()}@test.com`,
            password: 'hashedpassword12345',
            username: `toolreadadapterforeign${Date.now()}`,
        });

        await UserTool.create({
            ownerUserId: null,
            workspaceId: null,
            scopeType: 'user',
            workflowId: null,
            name: 'hello_test',
            description: 'Shared hello test example',
            runtime: 'typescript',
            status: 'ready',
            trustLevel: 'internal',
            currentVersion: createVersion({
                sourceMode: 'inline',
                sourcePath: null,
                sourceInline: 'export function run(context, args) { return { result: `Ton nom, ${args.user_name}, est maintenant enregistré dans ma mémoire` }; }',
                entrypoint: null,
            }),
            versions: [createVersion({
                sourceMode: 'inline',
                sourcePath: null,
                sourceInline: 'export function run(context, args) { return { result: `Ton nom, ${args.user_name}, est maintenant enregistré dans ma mémoire` }; }',
                entrypoint: null,
            })],
            inputSchema: {},
            outputSchema: {},
            tags: ['shared'],
            dependencies: { python: [], npm: [] },
            policy: { networkMode: 'none' },
            isReadonly: true,
            isEnabled: true,
        });

        await UserTool.create({
            ownerUserId: foreignOwner._id,
            workspaceId: null,
            scopeType: 'user',
            workflowId: null,
            name: `foreign_private_${Date.now()}`,
            description: 'Foreign private custom tool',
            runtime: 'typescript',
            status: 'ready',
            trustLevel: 'user_private',
            currentVersion: createVersion({
                sourceMode: 'inline',
                sourcePath: null,
                sourceInline: 'export function run() { return { ok: true }; }',
                entrypoint: null,
            }),
            versions: [createVersion({
                sourceMode: 'inline',
                sourcePath: null,
                sourceInline: 'export function run() { return { ok: true }; }',
                entrypoint: null,
            })],
            inputSchema: {},
            outputSchema: {},
            tags: [],
            dependencies: { python: [], npm: [] },
            policy: { networkMode: 'none' },
            isReadonly: false,
            isEnabled: true,
        });

        const functions = await toolReadAdapterService.listLegacyFunctions(requester.id);

        expect(functions.find((fn) => fn.name === 'hello_test')).toEqual(expect.objectContaining({
            userId: null,
            isReadonly: true,
            origin: 'custom',
        }));
        expect(functions.some((fn) => fn.name.startsWith('foreign_private_'))).toBe(false);
    });
});