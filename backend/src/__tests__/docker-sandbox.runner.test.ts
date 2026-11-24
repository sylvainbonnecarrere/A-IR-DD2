import { DockerSandboxRunner, type DockerProcessRunner } from '../services/runtime/DockerSandboxRunner';
import type { SandboxExecutionRequest } from '../services/runtime/execution.types';
import { DockerSupervisedAttemptLauncher } from '../services/runtime/DockerSupervisedAttemptLauncher';

class FakeDockerProcessRunner implements DockerProcessRunner {
  public calls: Array<{ command: string; args: string[]; stdin?: string; timeoutMs?: number }> = [];

  constructor(private readonly result: { stdout?: string; stderr?: string; exitCode?: number; timedOut?: boolean } = {}) {}

  async run(command: string, args: string[], options: { stdin?: string; timeoutMs?: number } = {}) {
    this.calls.push({ command, args, stdin: options.stdin, timeoutMs: options.timeoutMs });
    if (args[0] === 'kill') {
      return { exitCode: 0, stdout: 'container stopped', stderr: '', timedOut: false };
    }

    return {
      exitCode: this.result.exitCode ?? 0,
      stdout: this.result.stdout ?? JSON.stringify({ success: true, output: { ok: true }, stdout: 'sandbox-log' }),
      stderr: this.result.stderr ?? '',
      timedOut: this.result.timedOut ?? false,
    };
  }
}

class AbortableDockerProcessRunner implements DockerProcessRunner {
  public calls: Array<{ command: string; args: string[] }> = [];
  public started!: () => void;
  public readonly startedPromise = new Promise<void>((resolve) => {
    this.started = resolve;
  });

  constructor(private readonly killExitCode = 0) {}

  async run(command: string, args: string[], options: { stdin?: string; timeoutMs?: number; signal?: AbortSignal } = {}) {
    this.calls.push({ command, args });
    if (args[0] === 'kill') {
      return { exitCode: this.killExitCode, stdout: 'container stopped', stderr: '', timedOut: false };
    }
    if (args[0] === 'inspect') {
      return { exitCode: 1, stdout: '', stderr: 'container state unavailable', timedOut: false };
    }

    this.started();
    return new Promise<{ exitCode: number; stdout: string; stderr: string; timedOut: boolean; aborted?: boolean }>((resolve) => {
      options.signal?.addEventListener(
        'abort',
        () =>
          resolve({
            exitCode: 137,
            stdout: '',
            stderr: 'terminated',
            timedOut: false,
            aborted: true,
          }),
        { once: true },
      );
    });
  }
}

function createRequest(overrides: Partial<SandboxExecutionRequest> = {}): SandboxExecutionRequest {
  return {
    executionId: 'utr-test',
    userId: 'user-1',
    function: {
      _id: '507f1f77bcf86cd799439011',
      name: 'ts_echo',
      language: 'typescript',
      origin: 'custom',
      codeInline: 'function run(args) { return { echoed: args.value }; }',
      codePath: 'tools/ts_echo.ts',
    },
    runtime: 'typescript',
    launchContext: 'editor_test',
    args: { value: 'hello' },
    policySnapshot: {
      networkMode: 'restricted',
      timeoutSeconds: 12,
      maxMemoryMb: 192,
      secretAliases: [],
    },
    workspace: {
      workspaceId: 'workspace-1',
      wasCreated: false,
      logicalRoot: 'C:/sandbox/workspace-root',
      runtimeRoots: {
        sourceRoot: 'C:/sandbox/workspace-root/source',
        manifestsRoot: 'C:/sandbox/workspace-root/manifests',
        buildRoot: 'C:/sandbox/workspace-root/build',
        outputRoot: 'C:/sandbox/workspace-root/output',
      },
      manifests: {
        packageJson: true,
        packageLockJson: false,
        requirementsTxt: false,
        pyprojectToml: false,
      },
      status: 'active',
      lastScanAt: null,
    },
    sourceCode: 'function run(args) { return { echoed: args.value }; }',
    sourcePath: 'tools/ts_echo.ts',
    mode: 'typescript-custom',
    ...overrides,
  };
}

describe('DockerSandboxRunner', () => {
  it('passes a supervised attempt identity to Docker without automatic container removal', async () => {
    const processRunner = new FakeDockerProcessRunner();
    const runner = new DockerSandboxRunner(processRunner, 'C:/repo/backend/python');
    const attemptId = 'c91e377e-b884-4a12-a298-a558eaa63430';
    const attempt = { executionId: 'utr-test', attemptId, containerName: `airdd2-j7-attempt-${attemptId}` };
    const launcher = new DockerSupervisedAttemptLauncher(createRequest(), runner);
    await launcher.launch(attempt, new AbortController().signal);
    expect(processRunner.calls[0].args).toEqual(
      expect.arrayContaining([`--name=${attempt.containerName}`, '--label', `airdd2.execution.attempt=${attemptId}`]),
    );
    expect(processRunner.calls[0].args).not.toContain('--rm');
  });

  it('refuses mismatched supervised identity before invoking Docker', async () => {
    const processRunner = new FakeDockerProcessRunner();
    const runner = new DockerSandboxRunner(processRunner);
    const attemptId = 'c91e377e-b884-4a12-a298-a558eaa63430';
    const signal = new AbortController().signal;
    const valid = { executionId: 'utr-test', attemptId, containerName: `airdd2-j7-attempt-${attemptId}` };
    await expect(runner.executeForAttempt(createRequest({ signal }), { ...valid, executionId: 'other' })).rejects.toThrow(
      'matching attempt',
    );
    await expect(runner.executeForAttempt(createRequest({ signal }), { ...valid, containerName: 'other' })).rejects.toThrow(
      'matching attempt',
    );
    await expect(runner.executeForAttempt(createRequest(), valid)).rejects.toThrow('monitor signal');
    expect(processRunner.calls).toEqual([]);
  });

  it('does not present a successful kill as proof of supervised cancellation', async () => {
    const processRunner = new AbortableDockerProcessRunner();
    const runner = new DockerSandboxRunner(processRunner);
    const controller = new AbortController();
    const attemptId = 'c91e377e-b884-4a12-a298-a558eaa63430';
    const work = runner.executeForAttempt(createRequest({ signal: controller.signal }), {
      executionId: 'utr-test',
      attemptId,
      containerName: `airdd2-j7-attempt-${attemptId}`,
    });
    await processRunner.startedPromise;
    controller.abort();
    const result = await work;
    expect(processRunner.calls.some(({ args }) => args[0] === 'kill')).toBe(true);
    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        metadata: expect.objectContaining({ failureKind: 'cancelled', cancellationConfirmed: false }),
      }),
    );
  });

  it('does not present a successful kill after supervised timeout as proof of termination', async () => {
    const runner = new DockerSandboxRunner(new FakeDockerProcessRunner({ timedOut: true }));
    const attemptId = 'c91e377e-b884-4a12-a298-a558eaa63430';
    const result = await runner.executeForAttempt(createRequest({ signal: new AbortController().signal }), {
      executionId: 'utr-test',
      attemptId,
      containerName: `airdd2-j7-attempt-${attemptId}`,
    });
    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        timedOut: false,
        metadata: expect.objectContaining({ runnerTerminationConfirmed: false }),
      }),
    );
  });

  it('does not report success when a supervised launch resolves after cancellation', async () => {
    const controller = new AbortController();
    const run: DockerProcessRunner['run'] = jest.fn().mockImplementation(async (_command, args) => {
      if (args[0] === 'kill') {
        return { exitCode: 0, stdout: '', stderr: '', timedOut: false };
      }
      controller.abort();
      return { exitCode: 0, stdout: JSON.stringify({ success: true, output: 1 }), stderr: '', timedOut: false };
    });
    const runner = new DockerSandboxRunner({ run });
    const attemptId = 'c91e377e-b884-4a12-a298-a558eaa63430';
    const result = await runner.executeForAttempt(createRequest({ signal: controller.signal }), {
      executionId: 'utr-test',
      attemptId,
      containerName: `airdd2-j7-attempt-${attemptId}`,
    });
    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        metadata: expect.objectContaining({ failureKind: 'cancelled', cancellationConfirmed: false }),
      }),
    );
  });

  it('does not treat an observed stopped container as proof against a late start', async () => {
    const controller = new AbortController();
    let runStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      runStarted = resolve;
    });
    let finishRun!: () => void;
    const finish = new Promise<void>((resolve) => {
      finishRun = resolve;
    });
    const calls: string[] = [];
    const run: DockerProcessRunner['run'] = jest.fn().mockImplementation(async (_command, args) => {
      calls.push(args[0]);
      if (args[0] === 'kill') {
        return { exitCode: 1, stdout: '', stderr: 'not running', timedOut: false };
      }
      if (args[0] === 'inspect') {
        return { exitCode: 0, stdout: 'false', stderr: '', timedOut: false };
      }
      runStarted();
      await finish;
      calls.push('late-start');
      return { exitCode: 0, stdout: JSON.stringify({ success: true, output: 1 }), stderr: '', timedOut: false, aborted: true };
    });
    const runner = new DockerSandboxRunner({ run });
    const attemptId = 'c91e377e-b884-4a12-a298-a558eaa63430';
    const work = runner.executeForAttempt(createRequest({ signal: controller.signal }), {
      executionId: 'utr-test',
      attemptId,
      containerName: `airdd2-j7-attempt-${attemptId}`,
    });
    await started;
    controller.abort();
    await Promise.resolve();
    await Promise.resolve();
    finishRun();
    const result = await work;
    expect(calls).toEqual(['run', 'kill', 'inspect', 'late-start']);
    expect(result).toMatchObject({ success: false, metadata: { cancellationConfirmed: false } });
  });

  it('does not treat a successful supervised Docker response as neutralization proof', async () => {
    const runner = new DockerSandboxRunner(new FakeDockerProcessRunner());
    const attemptId = 'c91e377e-b884-4a12-a298-a558eaa63430';
    const result = await runner.executeForAttempt(createRequest({ signal: new AbortController().signal }), {
      executionId: 'utr-test',
      attemptId,
      containerName: `airdd2-j7-attempt-${attemptId}`,
    });
    expect(result.success).toBe(true);
    expect(result.metadata?.runnerTerminationConfirmed).toBe(false);
  });

  it('does not log sandbox inputs, source code, or private context', async () => {
    const processRunner = new FakeDockerProcessRunner();
    const runner = new DockerSandboxRunner(processRunner, 'C:/repo/backend/python');
    const debug = jest.spyOn(console, 'debug').mockImplementation(() => undefined);
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      const result = await runner.execute(
        createRequest({
          args: { value: 'sensitive-test-input' },
          sourceCode: 'function run() { return "sensitive-test-source"; }',
        }),
      );
      const nativeResult = await runner.execute(
        createRequest({
          mode: 'python-native',
          runtime: 'python',
          privateContext: { credential: 'sensitive-test-secret' },
        }),
      );

      expect(result.success).toBe(true);
      expect(nativeResult.success).toBe(true);
      expect(processRunner.calls[1].stdin).toContain('sensitive-test-secret');
      const messages = JSON.stringify([debug.mock.calls, log.mock.calls, warn.mock.calls, error.mock.calls]);
      expect(messages).not.toContain('sensitive-test-input');
      expect(messages).not.toContain('sensitive-test-secret');
      expect(messages).not.toContain('sensitive-test-source');
    } finally {
      debug.mockRestore();
      log.mockRestore();
      warn.mockRestore();
      error.mockRestore();
    }
  });

  it('never launches Docker when cancellation has already been requested', async () => {
    const processRunner = new FakeDockerProcessRunner();
    const runner = new DockerSandboxRunner(processRunner, 'C:/repo/backend/python');
    const controller = new AbortController();
    controller.abort();

    const result = await runner.execute(createRequest({ signal: controller.signal }));

    expect(processRunner.calls).toEqual([]);
    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        exitCode: 130,
        metadata: expect.objectContaining({ failureKind: 'cancelled', cancellationConfirmed: false }),
      }),
    );
  });

  it('kills the named container and reports cancellation only after the process exits', async () => {
    const processRunner = new AbortableDockerProcessRunner();
    const runner = new DockerSandboxRunner(processRunner, 'C:/repo/backend/python');
    const controller = new AbortController();
    const execution = runner.execute(createRequest({ signal: controller.signal }));

    await processRunner.startedPromise;
    controller.abort();
    const result = await execution;

    expect(processRunner.calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ command: 'docker', args: expect.arrayContaining(['run', '--name=airdd2-utr-test']) }),
        expect.objectContaining({ command: 'docker', args: ['kill', 'airdd2-utr-test'] }),
      ]),
    );
    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        exitCode: 130,
        stderr: 'Sandbox execution cancelled.',
        metadata: expect.objectContaining({ failureKind: 'cancelled', cancellationConfirmed: true }),
      }),
    );
  });

  it('does not claim cancellation when Docker cannot confirm the container stopped', async () => {
    const processRunner = new AbortableDockerProcessRunner(1);
    const runner = new DockerSandboxRunner(processRunner, 'C:/repo/backend/python');
    const controller = new AbortController();
    const execution = runner.execute(createRequest({ signal: controller.signal }));

    await processRunner.startedPromise;
    controller.abort();
    const result = await execution;

    expect(result.metadata).toEqual(
      expect.objectContaining({
        failureKind: 'cancelled',
        cancellationConfirmed: false,
      }),
    );
    expect(processRunner.calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ command: 'docker', args: ['inspect', '--format', '{{.State.Running}}', 'airdd2-utr-test'] }),
      ]),
    );
  });

  it('preserves a completed result when an abort races in after docker has exited', async () => {
    const processRunner = new FakeDockerProcessRunner();
    const runner = new DockerSandboxRunner(processRunner, 'C:/repo/backend/python');
    const controller = new AbortController();
    const execution = runner.execute(createRequest({ signal: controller.signal }));
    controller.abort();

    const result = await execution;

    expect(result.success).toBe(true);
    expect(result.metadata?.failureKind).toBeUndefined();
  });

  it('runs custom TypeScript in an ephemeral Docker sandbox with hardened flags', async () => {
    const processRunner = new FakeDockerProcessRunner();
    const runner = new DockerSandboxRunner(processRunner, 'C:/repo/backend/python');

    const result = await runner.execute(createRequest());

    expect(result.success).toBe(true);
    expect(result.runner).toBe('docker_sandbox');
    expect(result.exitCode).toBe(0);
    expect(result.resourceUsage).toEqual(
      expect.objectContaining({
        wallTimeMs: expect.any(Number),
        memoryLimitMb: 192,
      }),
    );
    expect(result.metadata).toEqual(
      expect.objectContaining({
        exitCode: 0,
        maxMemoryMb: 192,
        timeoutMs: 12000,
      }),
    );

    const call = processRunner.calls[0];
    expect(call.command).toBe('docker');
    expect(call.args).toEqual(
      expect.arrayContaining([
        'run',
        '--rm',
        '--interactive',
        '--network=bridge',
        '--cap-drop=ALL',
        '--security-opt',
        'no-new-privileges',
        '--tmpfs',
        '/sandbox/tmp:size=64m,noexec,nosuid,nodev',
        '--workdir',
        '/persistent-workspace/source',
        'airdd2-runtime-node:24.19.0-ubuntu-noble',
      ]),
    );
    expect(call.args.join(' ')).toContain('type=bind,src=C:/sandbox/workspace-root,dst=/persistent-workspace');
    expect(call.timeoutMs).toBe(12000);
    expect(JSON.parse(call.stdin ?? '{}')).toEqual({
      context: {
        userId: 'user-1',
        workflowId: undefined,
        depth: 0,
        maxDepth: 8,
        sessionId: 'utr-test',
      },
      args: { value: 'hello' },
      code: 'function run(args) { return { echoed: args.value }; }',
    });
  });

  it('keeps network disabled for tools whose policy forbids outbound access', async () => {
    const processRunner = new FakeDockerProcessRunner();
    const runner = new DockerSandboxRunner(processRunner, 'C:/repo/backend/python');

    await runner.execute(
      createRequest({
        policySnapshot: {
          networkMode: 'none',
          timeoutSeconds: 12,
          maxMemoryMb: 192,
          secretAliases: [],
        },
      }),
    );

    const call = processRunner.calls[0];
    expect(call.args).toEqual(expect.arrayContaining(['--network=none']));
  });

  it('classifies invalid non-JSON sandbox output as a runner contract error', async () => {
    const processRunner = new FakeDockerProcessRunner({
      stdout: 'plain-text-output',
      exitCode: 0,
    });
    const runner = new DockerSandboxRunner(processRunner, 'C:/repo/backend/python');

    const result = await runner.execute(createRequest());

    expect(result.success).toBe(false);
    expect(result.metadata).toEqual(
      expect.objectContaining({
        exitCode: 0,
        failureKind: 'sandbox_invalid_output',
        failureSubsystem: 'sandbox_runtime',
      }),
    );
  });

  it('classifies eval syntax failures as wrapper syntax errors', async () => {
    const processRunner = new FakeDockerProcessRunner({
      stdout: '',
      stderr: "[eval]:12\nSyntaxError: Unexpected token ';'",
      exitCode: 1,
    });
    const runner = new DockerSandboxRunner(processRunner, 'C:/repo/backend/python');

    const result = await runner.execute(createRequest());

    expect(result.success).toBe(false);
    expect(result.metadata).toEqual(
      expect.objectContaining({
        exitCode: 1,
        failureKind: 'wrapper_syntax_error',
        failureSubsystem: 'wrapper',
      }),
    );
  });

  it('preserves dependency-missing failures emitted by the sandbox payload', async () => {
    const processRunner = new FakeDockerProcessRunner({
      stdout: JSON.stringify({
        success: false,
        output: null,
        stdout: '',
        stderr: 'ModuleNotFoundError: No module named requests',
        failureKind: 'dependency_missing',
        errorType: 'ModuleNotFoundError',
        traceback: 'Traceback...',
      }),
      exitCode: 1,
    });
    const runner = new DockerSandboxRunner(processRunner, 'C:/repo/backend/python');

    const result = await runner.execute(
      createRequest({
        function: {
          _id: '507f1f77bcf86cd799439011',
          name: 'web_fetch_py',
          language: 'python',
          origin: 'native',
          codeInline: undefined,
          codePath: 'backend/python/native/web_fetch_py.py',
        },
        runtime: 'python',
        sourceCode: undefined,
        mode: 'python-native',
      }),
    );

    expect(result.success).toBe(false);
    expect(result.metadata).toEqual(
      expect.objectContaining({
        exitCode: 1,
        failureKind: 'dependency_missing',
        failureSubsystem: 'dependency',
        errorType: 'ModuleNotFoundError',
        traceback: 'Traceback...',
      }),
    );
  });

  it('classifies missing runtime images with a dedicated runner failure kind', async () => {
    const processRunner = new FakeDockerProcessRunner({
      stdout: '',
      stderr:
        'Error response from daemon: pull access denied for airdd2-runtime-node, repository does not exist or may require docker login',
      exitCode: 125,
    });
    const runner = new DockerSandboxRunner(processRunner, 'C:/repo/backend/python');

    const result = await runner.execute(createRequest());

    expect(result.success).toBe(false);
    expect(result.metadata).toEqual(
      expect.objectContaining({
        exitCode: 125,
        failureKind: 'runner_image_missing',
        failureSubsystem: 'runner',
      }),
    );
  });

  it('classifies mount configuration failures separately from generic runner errors', async () => {
    const processRunner = new FakeDockerProcessRunner({
      stdout: '',
      stderr: 'docker: Error response from daemon: invalid mount config for type "bind": bind source path does not exist',
      exitCode: 125,
    });
    const runner = new DockerSandboxRunner(processRunner, 'C:/repo/backend/python');

    const result = await runner.execute(createRequest());

    expect(result.success).toBe(false);
    expect(result.metadata).toEqual(
      expect.objectContaining({
        exitCode: 125,
        failureKind: 'runner_mount_failed',
        failureSubsystem: 'runner',
      }),
    );
  });

  it('classifies timeouts with a normalized timeout exit code', async () => {
    const processRunner = new FakeDockerProcessRunner({
      timedOut: true,
    });
    const runner = new DockerSandboxRunner(processRunner, 'C:/repo/backend/python');

    const result = await runner.execute(createRequest());

    expect(result.success).toBe(false);
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBe(124);
    expect(result.metadata).toEqual(
      expect.objectContaining({
        exitCode: 124,
        failureKind: 'timeout',
        failureSubsystem: 'sandbox_runtime',
      }),
    );
  });

  it('mounts the native Python runtime and registry when executing native functions', async () => {
    const processRunner = new FakeDockerProcessRunner({
      stdout: JSON.stringify({ success: true, output: { files: [] }, stdout: '' }),
    });
    const runner = new DockerSandboxRunner(processRunner, 'C:/repo/backend/python');

    await runner.execute(
      createRequest({
        function: {
          _id: '507f1f77bcf86cd799439011',
          name: 'read_py',
          language: 'python',
          origin: 'native',
          codeInline: undefined,
          codePath: 'backend/python/native/read_py.py',
        },
        runtime: 'python',
        sourceCode: undefined,
        mode: 'python-native',
      }),
    );

    const call = processRunner.calls[0];
    expect(call.args).toEqual(expect.arrayContaining(['airdd2-runtime-python:3.12-ubuntu-noble', 'python3', '-c']));
    expect(call.args.join(' ')).toContain('type=bind,src=C:/repo/backend/python,dst=/opt/airdd2/backend-python,readonly');
    expect(JSON.parse(call.stdin ?? '{}')).toEqual({
      functionName: 'read_py',
      args: { value: 'hello' },
    });
  });

  it('checks Python syntax inside the Docker runtime image instead of relying on the host interpreter', async () => {
    const processRunner = new FakeDockerProcessRunner({
      stdout: JSON.stringify({ valid: true, errors: [] }),
    });
    const runner = new DockerSandboxRunner(processRunner, 'C:/repo/backend/python');

    const result = await runner.checkPythonSyntax('def run(args):\n    return {"ok": True}');

    expect(result).toEqual({ valid: true, errors: [] });
    const call = processRunner.calls[0];
    expect(call.command).toBe('docker');
    expect(call.args).toEqual(
      expect.arrayContaining([
        'run',
        '--rm',
        '--interactive',
        '--network=none',
        'airdd2-runtime-python:3.12-ubuntu-noble',
        'python3',
        '-c',
      ]),
    );
    expect(call.stdin).toBe('def run(args):\n    return {"ok": True}');
  });

  it('returns normalized syntax errors when the sandbox parser rejects Python code', async () => {
    const processRunner = new FakeDockerProcessRunner({
      stdout: JSON.stringify({
        valid: false,
        errors: [{ line: 2, message: 'expected an indented block' }],
      }),
    });
    const runner = new DockerSandboxRunner(processRunner, 'C:/repo/backend/python');

    const result = await runner.checkPythonSyntax('def run(args):\nreturn {"ok": True}');

    expect(result).toEqual({
      valid: false,
      errors: [{ line: 2, message: 'expected an indented block' }],
    });
  });
});
