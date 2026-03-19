import { spawn } from 'child_process';
import path from 'path';
import type { RuntimeHealthReport } from '../../types/runtimeHealth.types';
import type { SandboxRunnerPort, SandboxRunnerReadiness } from './SandboxRunner';
import type {
    SandboxExecutionFailureKind,
    SandboxExecutionMetadata,
    SandboxExecutionRequest,
    SandboxExecutionResult
} from './execution.types';

const CONTAINER_PERSISTENT_ROOT = '/persistent-workspace';
const CONTAINER_SOURCE_ROOT = `${CONTAINER_PERSISTENT_ROOT}/source`;
const CONTAINER_MANIFESTS_ROOT = `${CONTAINER_PERSISTENT_ROOT}/manifests`;
const CONTAINER_BUILD_ROOT = `${CONTAINER_PERSISTENT_ROOT}/build`;
const CONTAINER_OUTPUT_ROOT = `${CONTAINER_PERSISTENT_ROOT}/output`;
const CONTAINER_FALLBACK_WORKSPACE = '/sandbox/workspace';
const CONTAINER_NATIVE_ROOT = '/opt/airdd2/backend-python';

interface CommandExecutionResult {
    exitCode: number;
    stdout: string;
    stderr: string;
    timedOut: boolean;
    errorMessage?: string;
}

interface ProcessRunOptions {
    stdin?: string;
    timeoutMs?: number;
}

export interface DockerProcessRunner {
    run(command: string, args: string[], options?: ProcessRunOptions): Promise<CommandExecutionResult>;
}

class SpawnDockerProcessRunner implements DockerProcessRunner {
    async run(command: string, args: string[], options: ProcessRunOptions = {}): Promise<CommandExecutionResult> {
        const timeoutMs = options.timeoutMs ?? 15_000;

        return new Promise((resolve) => {
            const child = spawn(command, args, {
                windowsHide: true,
                stdio: ['pipe', 'pipe', 'pipe']
            });

            let stdout = '';
            let stderr = '';
            let settled = false;
            let timedOut = false;

            const timeout = setTimeout(() => {
                timedOut = true;
                child.kill();
            }, timeoutMs);

            child.stdout.on('data', (chunk: Buffer) => {
                stdout += chunk.toString();
            });

            child.stderr.on('data', (chunk: Buffer) => {
                stderr += chunk.toString();
            });

            child.on('error', (error: Error) => {
                if (settled) {
                    return;
                }

                settled = true;
                clearTimeout(timeout);
                resolve({
                    exitCode: 1,
                    stdout,
                    stderr,
                    timedOut,
                    errorMessage: error.message
                });
            });

            child.on('close', (exitCode) => {
                if (settled) {
                    return;
                }

                settled = true;
                clearTimeout(timeout);
                resolve({
                    exitCode: exitCode ?? 1,
                    stdout,
                    stderr,
                    timedOut
                });
            });

            if (options.stdin) {
                child.stdin.write(options.stdin);
            }
            child.stdin.end();
        });
    }
}

function escapeForSingleQuotedPython(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function buildTypescriptWrapper(): string {
    return [
        'const chunks = [];',
        "process.stdin.setEncoding('utf8');",
        "process.stdin.on('data', (chunk) => chunks.push(chunk));",
        "process.stdin.on('end', async () => {",
        '  const payload = JSON.parse(chunks.join(\'\'));',
        '  const args = payload.args ?? {};',
        '  const source = String(payload.code ?? \"\").replace(/\\bexport\\s+(?=(async\\s+)?function\\s+run\\b)/g, \"\");',
        '  const logs = [];',
        '  const console = {',
        '    log: (...items) => logs.push(items.map(stringify).join(\' \')),',
        '    warn: (...items) => logs.push(items.map(stringify).join(\' \')),',
        '    error: (...items) => logs.push(items.map(stringify).join(\' \'));',
        '  };',
        '  function stringify(value) {',
        '    if (typeof value === \"string\") return value;',
        '    try { return JSON.stringify(value); } catch { return String(value); }',
        '  }',
        '  let result;',
        '  try {',
        '    eval(source);',
        '    if (typeof run === \"function\") {',
        '      result = await Promise.resolve(run(args));',
        '    }',
        '    process.stdout.write(JSON.stringify({ success: true, output: result ?? null, stdout: logs.join(\'\\n\') }));',
        '  } catch (error) {',
        '    process.stdout.write(JSON.stringify({ success: false, output: null, stdout: logs.join(\'\\n\'), stderr: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }));',
        '    process.exitCode = 1;',
        '  }',
        '});'
    ].join('\n');
}

function buildPythonCustomWrapper(): string {
    return [
        'import json',
        'import sys',
        'import traceback',
        'payload = json.loads(sys.stdin.read() or "{}")',
        'args = payload.get("args") or {}',
        'code = payload.get("code") or ""',
        'namespace = {}',
        'try:',
        '    exec(code, namespace)',
        '    result = namespace.get("run")',
        '    output = result(args) if callable(result) else namespace.get("__result__")',
        '    print(json.dumps({"success": True, "output": output, "stdout": ""}, ensure_ascii=False))',
        'except Exception as exc:',
        '    print(json.dumps({"success": False, "output": None, "stderr": str(exc), "stdout": "", "traceback": traceback.format_exc()}, ensure_ascii=False))',
        '    sys.exit(1)'
    ].join('\n');
}

function buildPythonNativeWrapper(nativeRoot: string): string {
    return [
        'import json',
        'import os',
        'import sys',
        'import traceback',
        `sys.path.insert(0, '${escapeForSingleQuotedPython(nativeRoot)}')`,
        'from runner import FUNCTION_REGISTRY, FunctionContext',
        'payload = json.loads(sys.stdin.read() or "{}")',
        'function_name = payload.get("functionName")',
        'args = payload.get("args") or {}',
        'workspace_dir = os.environ.get("SANDBOX_WORKSPACE_DIR", "/sandbox/workspace")',
        'try:',
        '    if function_name not in FUNCTION_REGISTRY:',
        '        raise ValueError(f"Fonction \'{function_name}\' non trouvée dans le registre")',
        '    context = FunctionContext(workspace_dir=workspace_dir, function_name=function_name)',
        '    output = FUNCTION_REGISTRY[function_name](context, args)',
        '    print(json.dumps({"success": True, "output": output, "stdout": ""}, ensure_ascii=False))',
        'except Exception as exc:',
        '    print(json.dumps({"success": False, "output": None, "stderr": str(exc), "stdout": "", "traceback": traceback.format_exc()}, ensure_ascii=False))',
        '    sys.exit(1)'
    ].join('\n');
}

export class DockerSandboxRunner implements SandboxRunnerPort {
    constructor(
        private readonly processRunner: DockerProcessRunner = new SpawnDockerProcessRunner(),
        private readonly backendPythonRoot: string = path.resolve(__dirname, '../../../python')
    ) {}

    getRunnerId() {
        return 'docker_sandbox' as const;
    }

    getLabel(): string {
        return 'Docker sandbox';
    }

    supportsRuntime(runtime: SandboxExecutionRequest['runtime']): boolean {
        return runtime === 'python' || runtime === 'typescript';
    }

    getReadiness(report: RuntimeHealthReport, runtime: SandboxExecutionRequest['runtime']): SandboxRunnerReadiness {
        if (!this.supportsRuntime(runtime)) {
            return {
                ready: false,
                reason: `Runner ${this.getRunnerId()} ne supporte pas le runtime ${runtime}.`
            };
        }

        if (!report.runtime.docker.executionReady || !report.capabilities.run[runtime]) {
            return {
                ready: false,
                reason: report.summary
            };
        }

        return {
            ready: true,
            warning: report.runtime.docker.warning
        };
    }

    async execute(request: SandboxExecutionRequest): Promise<SandboxExecutionResult> {
        const startedAt = Date.now();
        const timeoutMs = Math.max((request.policySnapshot.timeoutSeconds ?? 15) * 1000, 1_000);
        const maxMemoryMb = Math.max(request.policySnapshot.maxMemoryMb ?? 256, 64);
        const containerWorkspaceDir = request.workspace ? CONTAINER_SOURCE_ROOT : CONTAINER_FALLBACK_WORKSPACE;
        const stdinPayload = this.buildStdinPayload(request);
        const args = this.buildDockerArgs(request, maxMemoryMb, containerWorkspaceDir);

        const result = await this.processRunner.run('docker', args, {
            stdin: stdinPayload,
            timeoutMs
        });

        const durationMs = Date.now() - startedAt;
        const normalized = this.normalizeResult(result, request.mode, durationMs);
        return {
            ...normalized,
            runner: this.getRunnerId(),
            metadata: {
                exitCode: normalized.exitCode,
                containerWorkspaceDir,
                timeoutMs,
                maxMemoryMb,
                ...(normalized.metadata ?? {})
            },
            resourceUsage: {
                wallTimeMs: durationMs,
                memoryLimitMb: maxMemoryMb
            }
        };
    }

    private buildDockerArgs(request: SandboxExecutionRequest, maxMemoryMb: number, containerWorkspaceDir: string): string[] {
        const baseArgs = [
            'run',
            '--rm',
            '--interactive',
            '--network=none',
            '--cpus=0.50',
            '--pids-limit=128',
            `--memory=${maxMemoryMb}m`,
            '--read-only',
            '--tmpfs', '/sandbox/tmp:size=64m,noexec,nosuid,nodev',
            '--security-opt', 'no-new-privileges',
            '--cap-drop=ALL',
            '--workdir', containerWorkspaceDir,
            '--env', `SANDBOX_WORKSPACE_DIR=${containerWorkspaceDir}`,
            '--env', `PERSISTENT_WORKSPACE_ROOT=${request.workspace ? CONTAINER_PERSISTENT_ROOT : ''}`,
            '--env', `PERSISTENT_WORKSPACE_SOURCE_ROOT=${request.workspace ? CONTAINER_SOURCE_ROOT : ''}`,
            '--env', `PERSISTENT_WORKSPACE_MANIFESTS_ROOT=${request.workspace ? CONTAINER_MANIFESTS_ROOT : ''}`,
            '--env', `PERSISTENT_WORKSPACE_BUILD_ROOT=${request.workspace ? CONTAINER_BUILD_ROOT : ''}`,
            '--env', `PERSISTENT_WORKSPACE_OUTPUT_ROOT=${request.workspace ? CONTAINER_OUTPUT_ROOT : ''}`,
            '--env', 'PYTHONDONTWRITEBYTECODE=1',
            '--env', 'PYTHONUNBUFFERED=1'
        ];

        if (request.workspace) {
            baseArgs.push('--mount', `type=bind,src=${request.workspace.logicalRoot},dst=${CONTAINER_PERSISTENT_ROOT}`);
        }

        if (request.mode === 'python-native') {
            baseArgs.push('--mount', `type=bind,src=${this.backendPythonRoot},dst=${CONTAINER_NATIVE_ROOT},readonly`);
            return [
                ...baseArgs,
                'airdd2-runtime-python:3.12-slim',
                'python3',
                '-c',
                buildPythonNativeWrapper(CONTAINER_NATIVE_ROOT)
            ];
        }

        if (request.mode === 'python-custom') {
            return [
                ...baseArgs,
                'airdd2-runtime-python:3.12-slim',
                'python3',
                '-c',
                buildPythonCustomWrapper()
            ];
        }

        return [
            ...baseArgs,
            'airdd2-runtime-node:bookworm-slim',
            'node',
            '--input-type=commonjs',
            '--eval',
            buildTypescriptWrapper()
        ];
    }

    private buildStdinPayload(request: SandboxExecutionRequest): string {
        if (request.mode === 'python-native') {
            return JSON.stringify({
                functionName: request.function.name,
                args: request.args
            });
        }

        return JSON.stringify({
            args: request.args,
            code: request.sourceCode ?? ''
        });
    }

    private normalizeResult(
        commandResult: CommandExecutionResult,
        mode: SandboxExecutionRequest['mode'],
        durationMs: number
    ): Omit<SandboxExecutionResult, 'runner' | 'resourceUsage'> {
        if (commandResult.timedOut) {
            return {
                success: false,
                output: null,
                stdout: commandResult.stdout,
                stderr: 'Timeout: la sandbox éphémère a dépassé la limite autorisée.',
                durationMs,
                timedOut: true,
                exitCode: 124,
                metadata: {
                    exitCode: 124,
                    failureKind: 'timeout'
                }
            };
        }

        const stdout = commandResult.stdout.trim();
        const stderr = commandResult.stderr.trim();
        const processFailureKind = this.classifyProcessFailure(commandResult.errorMessage, stderr);

        try {
            const parsed = stdout ? JSON.parse(stdout) : null;
            if (parsed && typeof parsed === 'object' && 'success' in parsed) {
                const payload = parsed as { success: boolean; output?: unknown; stdout?: string; stderr?: string };
                return {
                    success: payload.success,
                    output: payload.output ?? null,
                    stdout: payload.stdout,
                    stderr: payload.stderr || stderr || commandResult.errorMessage,
                    durationMs,
                    exitCode: commandResult.exitCode,
                    metadata: {
                        exitCode: commandResult.exitCode,
                        ...(payload.success ? {} : { failureKind: 'sandbox_runtime_error' as const })
                    }
                };
            }

            if (mode === 'python-native') {
                return {
                    success: commandResult.exitCode === 0,
                    output: parsed,
                    stdout,
                    stderr: stderr || commandResult.errorMessage,
                    durationMs,
                    exitCode: commandResult.exitCode,
                    metadata: {
                        exitCode: commandResult.exitCode,
                        ...(commandResult.exitCode === 0
                            ? {}
                            : { failureKind: processFailureKind ?? 'sandbox_non_zero_exit' as const })
                    }
                };
            }
        } catch {
            // Fall through to error normalization below.
        }

        if (commandResult.exitCode === 0) {
            return {
                success: false,
                output: null,
                stdout,
                stderr: stderr || commandResult.errorMessage || 'La sandbox a renvoyé une sortie non JSON.',
                durationMs,
                exitCode: commandResult.exitCode,
                metadata: {
                    exitCode: commandResult.exitCode,
                    failureKind: 'sandbox_invalid_output'
                }
            };
        }

        return {
            success: false,
            output: null,
            stdout,
            stderr: stderr || commandResult.errorMessage || 'La sandbox a renvoyé une sortie non JSON.',
            durationMs,
            exitCode: commandResult.exitCode,
            metadata: {
                exitCode: commandResult.exitCode,
                failureKind: processFailureKind ?? 'sandbox_non_zero_exit'
            }
        };
    }

    private classifyProcessFailure(errorMessage?: string, stderr?: string): SandboxExecutionFailureKind | undefined {
        const normalized = `${errorMessage ?? ''} ${stderr ?? ''}`.toLowerCase();

        if (!normalized.trim()) {
            return undefined;
        }

        if (
            normalized.includes('pull access denied')
            || normalized.includes('unable to find image')
            || normalized.includes('manifest for')
        ) {
            return 'runner_image_missing';
        }

        if (
            normalized.includes('invalid mount config')
            || normalized.includes('mounts denied')
            || normalized.includes('bind source path does not exist')
        ) {
            return 'runner_mount_failed';
        }

        if (
            normalized.includes('permission denied')
            || normalized.includes('access is denied')
        ) {
            return 'runner_permission_denied';
        }

        if (normalized.includes('enoent') || normalized.includes('not recognized') || normalized.includes('cannot find')) {
            return 'runner_unavailable';
        }

        if (normalized.includes('failed to start') || normalized.includes('spawn')) {
            return 'runner_spawn_failed';
        }

        return 'sandbox_non_zero_exit';
    }
}
