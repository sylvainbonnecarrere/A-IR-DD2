import { spawn } from 'child_process';
import path from 'path';
import type { RuntimeHealthReport } from '../../types/runtimeHealth.types';
import type { SandboxRunnerPort, SandboxRunnerReadiness } from './SandboxRunner';
import type {
    SandboxExecutionFailureKind,
    SandboxExecutionMetadata,
    SandboxExecutionRequest,
    SandboxExecutionResult,
    SandboxSyntaxCheckResult
} from './execution.types';
import { inferSandboxFailureSubsystem } from './errors';
import {
    buildPythonCustomWrapper,
    buildPythonNativeWrapper,
    buildTypescriptWrapper,
} from './runtimeWrappers';

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

interface SandboxExecutionContextPayload {
    userId: string;
    workflowId?: string;
    depth: number;
    maxDepth: number;
    sessionId: string;
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
        // Debug: log the stdin payload that will be sent to the sandbox (helps verify transformed query propagation)
        try {
            console.debug('[DockerSandboxRunner] stdinPayload:', stdinPayload);
        } catch {}
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

    async checkPythonSyntax(code: string): Promise<SandboxSyntaxCheckResult> {
        const result = await this.processRunner.run('docker', this.buildDockerPythonSyntaxCheckArgs(), {
            stdin: code,
            timeoutMs: 5_000
        });

        if (result.timedOut) {
            return {
                valid: false,
                errors: [{ message: 'Timeout: verification syntaxique Python interrompue dans la sandbox.' }]
            };
        }

        const stdout = result.stdout.trim();
        const stderr = result.stderr.trim();

        try {
            const parsed = stdout ? JSON.parse(stdout) : null;
            if (
                parsed
                && typeof parsed === 'object'
                && 'valid' in parsed
                && 'errors' in parsed
                && Array.isArray((parsed as SandboxSyntaxCheckResult).errors)
            ) {
                return parsed as SandboxSyntaxCheckResult;
            }
        } catch {
            // Fall through to normalized sandbox error response.
        }

        return {
            valid: false,
            errors: [{ message: stderr || result.errorMessage || 'Erreur interne de verification syntaxique Python dans la sandbox.' }]
        };
    }

    private buildDockerArgs(request: SandboxExecutionRequest, maxMemoryMb: number, containerWorkspaceDir: string): string[] {
        const networkMode = this.resolveDockerNetworkMode(request.policySnapshot.networkMode);
        const baseArgs = [
            'run',
            '--rm',
            '--interactive',
            `--network=${networkMode}`,
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
                'airdd2-runtime-python:3.12-ubuntu-noble',
                'python3',
                '-c',
                buildPythonNativeWrapper(CONTAINER_NATIVE_ROOT)
            ];
        }

        if (request.mode === 'python-custom') {
            return [
                ...baseArgs,
                'airdd2-runtime-python:3.12-ubuntu-noble',
                'python3',
                '-c',
                buildPythonCustomWrapper()
            ];
        }

        return [
            ...baseArgs,
            'airdd2-runtime-node:22.22.2-ubuntu-noble',
            'node',
            '--input-type=commonjs',
            '--eval',
            buildTypescriptWrapper()
        ];
    }

    private buildDockerPythonSyntaxCheckArgs(): string[] {
        return [
            'run',
            '--rm',
            '--interactive',
            '--network=none',
            '--cpus=0.25',
            '--pids-limit=64',
            '--memory=128m',
            '--read-only',
            '--tmpfs', '/sandbox/tmp:size=16m,noexec,nosuid,nodev',
            '--security-opt', 'no-new-privileges',
            '--cap-drop=ALL',
            '--workdir', '/sandbox/tmp',
            '--env', 'PYTHONDONTWRITEBYTECODE=1',
            '--env', 'PYTHONUNBUFFERED=1',
            'airdd2-runtime-python:3.12-ubuntu-noble',
            'python3',
            '-c',
            [
                'import ast, json, sys',
                'try:',
                '    ast.parse(sys.stdin.read())',
                '    print(json.dumps({"valid": True, "errors": []}))',
                'except SyntaxError as exc:',
                '    print(json.dumps({"valid": False, "errors": [{"line": exc.lineno, "message": str(exc.msg)}]}))',
            ].join('\n')
        ];
    }

    private resolveDockerNetworkMode(networkMode: SandboxExecutionRequest['policySnapshot']['networkMode'] | undefined): 'none' | 'bridge' {
        return networkMode === 'restricted' ? 'bridge' : 'none';
    }

    private buildStdinPayload(request: SandboxExecutionRequest): string {
        if (request.mode === 'python-native') {
            const payload: any = {
                functionName: request.function.name,
                toolVersionTag: request.toolVersionTag,
                args: request.args,
            };
            if (request.privateContext !== undefined) {
                payload.privateContext = request.privateContext;
            }
            return JSON.stringify(payload);
        }

        return JSON.stringify({
            context: this.buildExecutionContext(request),
            args: request.args,
            code: request.sourceCode ?? ''
        });
    }

    private buildExecutionContext(request: SandboxExecutionRequest): SandboxExecutionContextPayload {
        return {
            userId: request.userId,
            workflowId: request.function.workflowId?.toString(),
            depth: 0,
            maxDepth: 8,
            sessionId: request.executionId
        };
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
                    failureKind: 'timeout',
                    failureSubsystem: inferSandboxFailureSubsystem('timeout')
                }
            };
        }

        const stdout = commandResult.stdout.trim();
        const stderr = commandResult.stderr.trim();
        const processFailureKind = this.classifyProcessFailure(commandResult.errorMessage, stderr);

        try {
            const parsed = stdout ? JSON.parse(stdout) : null;
            if (parsed && typeof parsed === 'object' && 'success' in parsed) {
                const payload = parsed as {
                    success: boolean;
                    output?: unknown;
                    stdout?: string;
                    stderr?: string;
                    failureKind?: SandboxExecutionFailureKind;
                    errorType?: string;
                    traceback?: string;
                };
                return {
                    success: payload.success,
                    output: payload.output ?? null,
                    stdout: payload.stdout,
                    stderr: payload.stderr || stderr || commandResult.errorMessage,
                    durationMs,
                    exitCode: commandResult.exitCode,
                    metadata: {
                        exitCode: commandResult.exitCode,
                        ...(payload.success
                            ? {}
                            : {
                                failureKind: payload.failureKind ?? 'sandbox_runtime_error' as const,
                                failureSubsystem: inferSandboxFailureSubsystem(payload.failureKind ?? 'sandbox_runtime_error'),
                                ...(payload.errorType ? { errorType: payload.errorType } : {}),
                                ...(payload.traceback ? { traceback: payload.traceback } : {}),
                            })
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
                            : {
                                failureKind: processFailureKind ?? 'sandbox_non_zero_exit' as const,
                                failureSubsystem: inferSandboxFailureSubsystem(processFailureKind ?? 'sandbox_non_zero_exit')
                            })
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
                    failureKind: 'sandbox_invalid_output',
                    failureSubsystem: inferSandboxFailureSubsystem('sandbox_invalid_output')
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
                failureKind: processFailureKind ?? 'sandbox_non_zero_exit',
                failureSubsystem: inferSandboxFailureSubsystem(processFailureKind ?? 'sandbox_non_zero_exit')
            }
        };
    }

    private classifyProcessFailure(errorMessage?: string, stderr?: string): SandboxExecutionFailureKind | undefined {
        const normalized = `${errorMessage ?? ''} ${stderr ?? ''}`.toLowerCase();

        if (!normalized.trim()) {
            return undefined;
        }

        if (
            (normalized.includes('[eval]') || normalized.includes('--eval'))
            && normalized.includes('syntaxerror')
        ) {
            return 'wrapper_syntax_error';
        }

        if (
            normalized.includes('no module named')
            || normalized.includes('modulenotfounderror')
            || normalized.includes('module_not_found')
        ) {
            return 'dependency_missing';
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
