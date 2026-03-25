import os from 'os';
import path from 'path';
import mongoose from 'mongoose';
import { User } from '../models/User.model';
import { Workflow } from '../models/Workflow.model';
import { UserFunction } from '../models/UserFunction.model';
import { Workspace } from '../models/Workspace.model';
import { FunctionService } from '../services/function.service';

describe('FunctionService workspace path migration', () => {
    const functionService = new FunctionService();
    const originalWorkspaceStoragePath = process.env.WORKSPACE_STORAGE_PATH;

    beforeEach(() => {
        process.env.WORKSPACE_STORAGE_PATH = path.join(
            os.tmpdir(),
            `airdd2-j4-function-tests-${process.pid}`
        );
    });

    afterEach(async () => {
        if (originalWorkspaceStoragePath === undefined) {
            delete process.env.WORKSPACE_STORAGE_PATH;
        } else {
            process.env.WORKSPACE_STORAGE_PATH = originalWorkspaceStoragePath;
        }

        await Workspace.deleteMany({});
        await UserFunction.deleteMany({});
        await Workflow.deleteMany({});
        await User.deleteMany({});
    });

    it('enriches workflow-scoped custom functions with workspace-backed path context', async () => {
        const user = await User.create({
            email: `function-service-${Date.now()}@test.com`,
            password: 'hashedpassword12345',
            username: `functionservice${Date.now()}`
        });

        const workflow = await Workflow.create({
            userId: user._id,
            name: 'Function Workspace',
            isActive: true,
            isDefault: true,
            canvasState: { zoom: 1, panX: 0, panY: 0 }
        });

        await UserFunction.create({
            name: 'workflow_custom_tool',
            description: 'Workflow custom tool',
            language: 'python',
            origin: 'custom',
            userId: user._id,
            workflowId: workflow._id,
            inputSchema: {},
            outputSchema: {},
            codePath: 'tools/workflow_custom_tool.py',
            codeInline: null,
            dependencies: { python: ['requests'], npm: [] },
            isEnabled: true,
            isReadonly: false,
            version: 1,
            tags: []
        });

        await UserFunction.create({
            name: 'native_repo_tool',
            description: 'Native repo tool',
            language: 'python',
            origin: 'native',
            userId: null,
            workflowId: null,
            inputSchema: {},
            outputSchema: {},
            codePath: 'backend/python/native/native_repo_tool.py',
            codeInline: null,
            dependencies: { python: [], npm: [] },
            isEnabled: true,
            isReadonly: true,
            version: 1,
            tags: []
        });

        const functions = await functionService.listFunctions(user.id);
        const workflowFunction = functions.find((fn) => fn.name === 'workflow_custom_tool');
        const nativeFunction = functions.find((fn) => fn.name === 'native_repo_tool');

        expect(workflowFunction).toBeDefined();
        expect(workflowFunction?.workspaceContext).toEqual(expect.objectContaining({
            status: 'active',
            runtimeRoots: expect.objectContaining({
                sourceRoot: expect.stringContaining(path.join('workspaces', 'users'))
            })
        }));
        expect(workflowFunction?.codePathRoot).toBe('workspace_source');
        expect(workflowFunction?.resolvedCodePath).toBe(
            path.resolve(
                workflowFunction!.workspaceContext!.runtimeRoots.sourceRoot,
                'tools/workflow_custom_tool.py'
            )
        );

        const persistedWorkspace = await Workspace.findOne({
            ownerUserId: user._id,
            scopeType: 'workflow',
            scopeId: workflow._id
        });
        expect(persistedWorkspace).not.toBeNull();

        expect(nativeFunction).toBeDefined();
        expect(nativeFunction?.workspaceContext).toBeUndefined();
        expect(nativeFunction?.codePathRoot).toBe('native_repo');
        expect(nativeFunction?.resolvedCodePath).toBe('backend/python/native/native_repo_tool.py');
    });
});