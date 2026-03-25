import mongoose from 'mongoose';
import { User } from '../models/User.model';
import { UserFunction } from '../models/UserFunction.model';
import { ExecutionOrchestrator } from '../services/runtime/ExecutionOrchestrator';
import { executeFunctionById } from '../pythonExecutor';

describe('pythonExecutor.executeFunctionById', () => {
    afterEach(async () => {
        jest.restoreAllMocks();
        await UserFunction.deleteMany({ name: /python-executor-test-/i });
        await User.deleteMany({ email: /python-executor-test-/i });
    });

    it('delegates function execution to the orchestrator with workflow context', async () => {
        const user = await User.create({
            email: `python-executor-test-${Date.now()}@test.com`,
            password: 'test-only-password-123',
            username: `pyexec${Date.now()}`
        });
        const fn = await UserFunction.create({
            userId: user._id,
            workflowId: new mongoose.Types.ObjectId(),
            name: `python-executor-test-${Date.now()}`,
            description: 'pythonExecutor integration test',
            language: 'python',
            origin: 'custom',
            tags: ['test'],
            inputSchema: { type: 'object' },
            outputSchema: { type: 'object' },
            codeInline: 'def run(args):\n    return {"value": args.get("value")}',
            isEnabled: true,
            isReadonly: false,
            version: 1
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

        const result = await executeFunctionById(fn.id, { value: 'ok' }, user.id, 'agent-123');

        expect(result).toEqual({ value: 'ok' });
        expect(executeSpy).toHaveBeenCalledWith(expect.objectContaining({
            userId: user.id,
            args: { value: 'ok' },
            launchContext: 'workflow_run',
            agentInstanceId: 'agent-123',
            fn: expect.objectContaining({
                _id: expect.anything(),
                name: fn.name,
                language: 'python'
            })
        }));
    });

    it('uses system_validation launch context when no agent id is provided', async () => {
        const user = await User.create({
            email: `python-executor-test-${Date.now()}-system@test.com`,
            password: 'test-only-password-123',
            username: `pyexecsystem${Date.now()}`
        });
        const fn = await UserFunction.create({
            userId: user._id,
            workflowId: null,
            name: `python-executor-test-system-${Date.now()}`,
            description: 'pythonExecutor system validation test',
            language: 'typescript',
            origin: 'custom',
            tags: ['test'],
            inputSchema: { type: 'object' },
            outputSchema: { type: 'object' },
            codeInline: 'function run(args) { return args; }',
            isEnabled: true,
            isReadonly: false,
            version: 1
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