import mongoose from 'mongoose';
import { User } from '../models/User.model';
import { UserTool } from '../models/UserTool.model';
import { Workspace } from '../models/Workspace.model';
import { ExecutionOrchestrator } from '../services/runtime/ExecutionOrchestrator';
import * as userToolMirrorService from '../services/userToolMirror.service';
import { executeFunctionById } from '../pythonExecutor';

function createToolVersion(overrides: Record<string, unknown> = {}) {
    return {
        versionTag: 'v1',
        contentHash: 'hash-v1',
        sourceMode: 'inline',
        sourcePath: null,
        sourceInline: 'export function run(args) { return args; }',
        entrypoint: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        createdBy: null,
        buildStatus: 'not_built',
        validationStatus: 'valid',
        ...overrides,
    };
}

describe('pythonExecutor.executeFunctionById', () => {
    afterEach(async () => {
        jest.restoreAllMocks();
        await Workspace.deleteMany({});
        await UserTool.deleteMany({ name: /python-executor-test-/i });
        await User.deleteMany({ email: /python-executor-test-/i });
    });

    it('delegates function execution to the orchestrator with workflow context', async () => {
        const user = await User.create({
            email: `python-executor-test-${Date.now()}@test.com`,
            password: 'test-only-password-123',
            username: `pyexec${Date.now()}`
        });
        const fn = await UserTool.create({
            ownerUserId: user._id,
            scopeType: 'user',
            workflowId: new mongoose.Types.ObjectId(),
            name: `python-executor-test-${Date.now()}`,
            description: 'pythonExecutor integration test',
            runtime: 'python',
            status: 'ready',
            trustLevel: 'user_private',
            currentVersion: createToolVersion({
                versionTag: 'v7',
                contentHash: 'hash-python-executor-v7',
                sourceInline: 'def run(args):\n    return {"value": args.get("value")}',
            }),
            versions: [createToolVersion({
                versionTag: 'v7',
                contentHash: 'hash-python-executor-v7',
                sourceInline: 'def run(args):\n    return {"value": args.get("value")}',
            })],
            tags: ['test'],
            inputSchema: { type: 'object' },
            outputSchema: { type: 'object' },
            dependencies: { python: ['requests'], npm: [] },
            policy: { networkMode: 'restricted', timeoutSeconds: 45 },
            isEnabled: true,
            isReadonly: false,
        });

        const executeSpy = jest.spyOn(ExecutionOrchestrator.prototype, 'execute').mockResolvedValue({
            success: true,
            output: { value: 'ok' },
            stdout: 'sandbox ok',
            stderr: '',
            durationMs: 19,
            exitCode: 0,
            runner: 'docker_sandbox',
            executionId: 'utr-python-executor',
            metadata: {
                exitCode: 0
            },
            resourceUsage: {
                wallTimeMs: 19,
                memoryLimitMb: 256
            }
        });
        const syncMirrorSpy = jest.spyOn(userToolMirrorService, 'syncUserToolMirrorFromLegacyFunction').mockResolvedValue();

        const result = await executeFunctionById(fn.id, { value: 'ok' }, user.id, 'agent-123');

        expect(result).toEqual({ value: 'ok' });
        expect(syncMirrorSpy).not.toHaveBeenCalled();
        expect(executeSpy).toHaveBeenCalledWith(expect.objectContaining({
            userId: user.id,
            args: { value: 'ok' },
            launchContext: 'workflow_run',
            agentInstanceId: 'agent-123',
            fn: expect.objectContaining({
                _id: expect.anything(),
                name: fn.name,
                language: 'python',
                toolVersionTag: 'v7',
                toolContentHash: 'hash-python-executor-v7',
                policySnapshot: expect.objectContaining({
                    networkMode: 'restricted',
                    timeoutSeconds: 45
                })
            })
        }));
    });

    it('uses system_validation launch context when no agent id is provided', async () => {
        const user = await User.create({
            email: `python-executor-test-${Date.now()}-system@test.com`,
            password: 'test-only-password-123',
            username: `pyexecsystem${Date.now()}`
        });
        const fn = await UserTool.create({
            ownerUserId: user._id,
            scopeType: 'user',
            workflowId: null,
            name: `python-executor-test-system-${Date.now()}`,
            description: 'pythonExecutor system validation test',
            runtime: 'typescript',
            status: 'ready',
            trustLevel: 'user_private',
            currentVersion: createToolVersion({
                sourceInline: 'function run(args) { return args; }',
            }),
            versions: [createToolVersion({
                sourceInline: 'function run(args) { return args; }',
            })],
            tags: ['test'],
            inputSchema: { type: 'object' },
            outputSchema: { type: 'object' },
            dependencies: { python: [], npm: [] },
            policy: { networkMode: 'none' },
            isEnabled: true,
            isReadonly: false,
        });

        const executeSpy = jest.spyOn(ExecutionOrchestrator.prototype, 'execute').mockResolvedValue({
            success: true,
            output: { ok: true },
            stdout: '',
            stderr: '',
            durationMs: 11,
            exitCode: 0,
            runner: 'docker_sandbox',
            executionId: 'utr-python-system-validation',
            metadata: {
                exitCode: 0
            }
        });

        await executeFunctionById(fn.id, { ok: true }, user.id);

        expect(executeSpy).toHaveBeenCalledWith(expect.objectContaining({
            launchContext: 'system_validation',
            agentInstanceId: undefined
        }));
    });
});