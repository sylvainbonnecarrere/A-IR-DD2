import { DockerSandboxRunner, type DockerProcessRunner } from '../services/runtime/DockerSandboxRunner';
import type { SandboxExecutionRequest } from '../services/runtime/execution.types';

class FakeDockerProcessRunner implements DockerProcessRunner {
    public calls: Array<{ command: string; args: string[]; stdin?: string; timeoutMs?: number }> = [];

    constructor(private readonly result: { stdout?: string; stderr?: string; exitCode?: number; timedOut?: boolean } = {}) {}

    async run(command: string, args: string[], options: { stdin?: string; timeoutMs?: number } = {}) {
        this.calls.push({ command, args, stdin: options.stdin, timeoutMs: options.timeoutMs });

        return {
            exitCode: this.result.exitCode ?? 0,
            stdout: this.result.stdout ?? JSON.stringify({ success: true, output: { ok: true }, stdout: 'sandbox-log' }),
            stderr: this.result.stderr ?? '',
            timedOut: this.result.timedOut ?? false
        };
    }
}

function createRequest(overrides: Partial<SandboxExecutionRequest> = {}): SandboxExecutionRequest {
    return {
        executionId: 'utr-test',
        userId: 'user-1',
        function: {
            _id: '507f1f77bcf86cd799439011' as any,
            name: 'ts_echo',
            language: 'typescript',
            origin: 'custom',
            codeInline: 'function run(args) { return { echoed: args.value }; }',
            codePath: 'tools/ts_echo.ts'
        },
        runtime: 'typescript',
        launchContext: 'editor_test',
        args: { value: 'hello' },
        policySnapshot: {
            networkMode: 'restricted',
            timeoutSeconds: 12,
            maxMemoryMb: 192,
            secretAliases: []
        },
        workspace: {
            workspaceId: 'workspace-1',
            wasCreated: false,
            logicalRoot: 'C:/sandbox/workspace-root',
            runtimeRoots: {
                sourceRoot: 'C:/sandbox/workspace-root/source',
                manifestsRoot: 'C:/sandbox/workspace-root/manifests',
                buildRoot: 'C:/sandbox/workspace-root/build',
                outputRoot: 'C:/sandbox/workspace-root/output'
            },
            manifests: {
                packageJson: true,
                packageLockJson: false,
                requirementsTxt: false,
                pyprojectToml: false
            },
            status: 'active',
            lastScanAt: null
        },
        sourceCode: 'function run(args) { return { echoed: args.value }; }',
        sourcePath: 'tools/ts_echo.ts',
        mode: 'typescript-custom',
        ...overrides
    };
}

describe('DockerSandboxRunner', () => {
    it('runs custom TypeScript in an ephemeral Docker sandbox with hardened flags', async () => {
        const processRunner = new FakeDockerProcessRunner();
        const runner = new DockerSandboxRunner(processRunner, 'C:/repo/backend/python');

        const result = await runner.execute(createRequest());

        expect(result.success).toBe(true);
        expect(result.runner).toBe('docker_sandbox');
        expect(result.exitCode).toBe(0);
        expect(result.resourceUsage).toEqual(expect.objectContaining({
            wallTimeMs: expect.any(Number),
            memoryLimitMb: 192
        }));
        expect(result.metadata).toEqual(expect.objectContaining({
            exitCode: 0,
            maxMemoryMb: 192,
            timeoutMs: 12000
        }));

        const call = processRunner.calls[0];
        expect(call.command).toBe('docker');
        expect(call.args).toEqual(expect.arrayContaining([
            'run',
            '--rm',
            '--interactive',
            '--network=none',
            '--cap-drop=ALL',
            '--security-opt',
            'no-new-privileges',
            '--tmpfs',
            '/sandbox/tmp:size=64m,noexec,nosuid,nodev',
            '--workdir',
            '/persistent-workspace/source',
            'airdd2-runtime-node:bookworm-slim'
        ]));
        expect(call.args.join(' ')).toContain('type=bind,src=C:/sandbox/workspace-root,dst=/persistent-workspace');
        expect(call.timeoutMs).toBe(12000);
        expect(JSON.parse(call.stdin ?? '{}')).toEqual({
            args: { value: 'hello' },
            code: 'function run(args) { return { echoed: args.value }; }'
        });
    });

    it('classifies invalid non-JSON sandbox output as a runner contract error', async () => {
        const processRunner = new FakeDockerProcessRunner({
            stdout: 'plain-text-output',
            exitCode: 0
        });
        const runner = new DockerSandboxRunner(processRunner, 'C:/repo/backend/python');

        const result = await runner.execute(createRequest());

        expect(result.success).toBe(false);
        expect(result.metadata).toEqual(expect.objectContaining({
            exitCode: 0,
            failureKind: 'sandbox_invalid_output'
        }));
    });

    it('classifies missing runtime images with a dedicated runner failure kind', async () => {
        const processRunner = new FakeDockerProcessRunner({
            stdout: '',
            stderr: 'Error response from daemon: pull access denied for airdd2-runtime-node, repository does not exist or may require docker login',
            exitCode: 125
        });
        const runner = new DockerSandboxRunner(processRunner, 'C:/repo/backend/python');

        const result = await runner.execute(createRequest());

        expect(result.success).toBe(false);
        expect(result.metadata).toEqual(expect.objectContaining({
            exitCode: 125,
            failureKind: 'runner_image_missing'
        }));
    });

    it('classifies mount configuration failures separately from generic runner errors', async () => {
        const processRunner = new FakeDockerProcessRunner({
            stdout: '',
            stderr: 'docker: Error response from daemon: invalid mount config for type "bind": bind source path does not exist',
            exitCode: 125
        });
        const runner = new DockerSandboxRunner(processRunner, 'C:/repo/backend/python');

        const result = await runner.execute(createRequest());

        expect(result.success).toBe(false);
        expect(result.metadata).toEqual(expect.objectContaining({
            exitCode: 125,
            failureKind: 'runner_mount_failed'
        }));
    });

    it('classifies timeouts with a normalized timeout exit code', async () => {
        const processRunner = new FakeDockerProcessRunner({
            timedOut: true
        });
        const runner = new DockerSandboxRunner(processRunner, 'C:/repo/backend/python');

        const result = await runner.execute(createRequest());

        expect(result.success).toBe(false);
        expect(result.timedOut).toBe(true);
        expect(result.exitCode).toBe(124);
        expect(result.metadata).toEqual(expect.objectContaining({
            exitCode: 124,
            failureKind: 'timeout'
        }));
    });

    it('mounts the native Python runtime and registry when executing native functions', async () => {
        const processRunner = new FakeDockerProcessRunner({
            stdout: JSON.stringify({ success: true, output: { files: [] }, stdout: '' })
        });
        const runner = new DockerSandboxRunner(processRunner, 'C:/repo/backend/python');

        await runner.execute(createRequest({
            function: {
                _id: '507f1f77bcf86cd799439011' as any,
                name: 'read_py',
                language: 'python',
                origin: 'native',
                codeInline: undefined,
                codePath: 'backend/python/native/read_py.py'
            },
            runtime: 'python',
            sourceCode: undefined,
            mode: 'python-native'
        }));

        const call = processRunner.calls[0];
        expect(call.args).toEqual(expect.arrayContaining([
            'airdd2-runtime-python:3.12-slim',
            'python3',
            '-c'
        ]));
        expect(call.args.join(' ')).toContain('type=bind,src=C:/repo/backend/python,dst=/opt/airdd2/backend-python,readonly');
        expect(JSON.parse(call.stdin ?? '{}')).toEqual({
            functionName: 'read_py',
            args: { value: 'hello' }
        });
    });
});