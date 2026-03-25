import { Dirent, promises as fs } from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import type { IUserFunction } from '../../models/UserFunction.model';
import type { UserToolRunLaunchContext } from '../../models/UserToolRun.model';
import type { IUserToolRunArtifact } from '../../models/UserToolRun.model';
import { deriveExecutionMetadataFromLegacyFunction } from '../../utils/userToolLegacyMapper';
import { BuildService } from '../build.service';
import { RuntimeHealthService } from '../runtimeHealth.service';
import { UserToolRunService } from '../userToolRun.service';
import { createWorkspaceManager } from '../workspace/WorkspaceManager';
import type { WorkspaceProvisioningResult } from '../workspace/types';
import { createSandboxRunnerFactory } from './SandboxRunner';
import { DockerSandboxRunner } from './DockerSandboxRunner';
import { FirecrackerRunner } from './FirecrackerRunner';
import type {
    OrchestratedExecutionResult,
    SandboxExecutionFailureKind,
    SandboxExecutionRequest,
    SandboxExecutionResourceUsage
} from './execution.types';
import { RuntimeNotReadyError } from './errors';

export interface ExecutionOrchestratorRequest {
    fn: IUserFunction;
    userId: string;
    args: Record<string, unknown>;
    launchContext: UserToolRunLaunchContext;
    agentInstanceId?: string;
}

export class ExecutionOrchestrator {
    private static readonly workspaceExecutionChains = new Map<string, Promise<void>>();

    private readonly runtimeHealthService = new RuntimeHealthService();
    private readonly buildService = new BuildService();
    private readonly userToolRunService = new UserToolRunService();
    private readonly workspaceManager = createWorkspaceManager();
    private readonly sandboxRunnerFactory = createSandboxRunnerFactory();
    private readonly dockerRunner = new DockerSandboxRunner();
    private readonly firecrackerRunner = new FirecrackerRunner();

    async getPreferredRunnerReadiness(runtime: SandboxExecutionRequest['runtime']) {
        const runtimeReport = await this.runtimeHealthService.getHealthReport();
        const selectedRunnerPort = this.sandboxRunnerFactory.getPreferredRunner(runtimeReport);

        return {
            report: runtimeReport,
            runner: selectedRunnerPort,
            readiness: selectedRunnerPort.getReadiness(runtimeReport, runtime)
        };
    }

    async execute(request: ExecutionOrchestratorRequest): Promise<OrchestratedExecutionResult> {
        const executionMetadata = deriveExecutionMetadataFromLegacyFunction(request.fn);
        const executionId = `utr-${new mongoose.Types.ObjectId().toString()}`;
        const { report: runtimeReport, runner: selectedRunnerPort, readiness } = await this.getPreferredRunnerReadiness(executionMetadata.runtime);
        const selectedRunnerId = this.normalizeRunnerId(selectedRunnerPort.getRunnerId());

        if (!readiness.ready) {
            throw new RuntimeNotReadyError(readiness.reason ?? runtimeReport.summary);
        }

        const executionRequest = await this.buildExecutionRequest({
            ...request,
            executionId,
            executionMetadataRuntime: executionMetadata.runtime,
            executionMetadataPolicy: executionMetadata.policySnapshot,
            launchContext: request.launchContext
        });

        await this.userToolRunService.createQueuedRun({
            executionId,
            ownerUserId: request.userId,
            toolId: executionMetadata.toolId,
            toolVersionTag: executionMetadata.toolVersionTag,
            toolContentHash: executionMetadata.toolContentHash,
            workflowId: executionMetadata.workflowId,
            launchContext: request.launchContext,
            runtime: executionMetadata.runtime,
            runner: selectedRunnerId,
            inputs: request.args,
            agentInstanceId: request.agentInstanceId,
            policySnapshot: executionMetadata.policySnapshot
        });

        return this.executeSerializedForWorkspace(executionRequest.workspace, async () => {
            await this.userToolRunService.markRunning(executionId);
            const artifactBaseline = await this.snapshotOutputArtifacts(executionRequest.workspace);

            try {
                const executionResult = await this.getExecutionRunner(selectedRunnerId).execute(executionRequest);
                const outputArtifacts = await this.collectOutputArtifacts(executionRequest.workspace, artifactBaseline);
                const outputs = {
                    result: executionResult.output,
                    stdout: executionResult.stdout,
                    stderr: executionResult.stderr,
                    ...(outputArtifacts.length > 0 ? { artifacts: outputArtifacts } : {})
                };

                if (executionResult.success) {
                    await this.userToolRunService.completeRun(executionId, {
                        outputs,
                        resourceUsage: this.buildResourceUsage(executionResult)
                    });
                } else if (executionResult.timedOut) {
                    await this.userToolRunService.timeoutRun(executionId, {
                        error: {
                            code: this.toPersistedErrorCode(executionResult.metadata?.failureKind),
                            message: executionResult.stderr || 'Function execution timed out',
                            retryable: false
                        },
                        outputs,
                        resourceUsage: this.buildResourceUsage(executionResult)
                    });
                } else {
                    await this.userToolRunService.failRun(executionId, {
                        error: {
                            code: this.toPersistedErrorCode(executionResult.metadata?.failureKind),
                            message: executionResult.stderr || 'Function execution failed',
                            retryable: false
                        },
                        outputs,
                        resourceUsage: this.buildResourceUsage(executionResult)
                    });
                }

                return {
                    ...executionResult,
                    executionId,
                    metadata: {
                        exitCode: executionResult.exitCode,
                        ...(executionResult.metadata ?? {}),
                        ...(outputArtifacts.length > 0 ? { artifacts: outputArtifacts } : {})
                    }
                };
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                const outputArtifacts = await this.collectOutputArtifacts(executionRequest.workspace, artifactBaseline);
                await this.userToolRunService.failRun(executionId, {
                    error: {
                        code: 'ORCHESTRATOR_ERROR',
                        message,
                        retryable: false
                    },
                    ...(outputArtifacts.length > 0
                        ? {
                            outputs: {
                                artifacts: outputArtifacts
                            }
                        }
                        : {})
                });
                throw error;
            }
        });
    }

    private async buildExecutionRequest(input: ExecutionOrchestratorRequest & {
        executionId: string;
        executionMetadataRuntime: SandboxExecutionRequest['runtime'];
        executionMetadataPolicy: SandboxExecutionRequest['policySnapshot'];
    }): Promise<SandboxExecutionRequest> {
        const workspace = await this.resolveWorkspace(input.fn, input.userId);
        const sourceCode = await this.resolveSourceCode(input.fn, input.userId, workspace);
        const mode = this.resolveExecutionMode(input.fn);

        return {
            executionId: input.executionId,
            userId: input.userId,
            function: {
                _id: input.fn._id,
                name: input.fn.name,
                language: input.fn.language,
                origin: input.fn.origin,
                codeInline: input.fn.codeInline,
                codePath: input.fn.codePath
            },
            runtime: input.executionMetadataRuntime,
            launchContext: input.launchContext,
            args: input.args,
            policySnapshot: input.executionMetadataPolicy,
            workspace,
            sourceCode,
            sourcePath: input.fn.codePath ?? null,
            mode
        };
    }

    private async resolveWorkspace(fn: IUserFunction, userId: string): Promise<WorkspaceProvisioningResult | null> {
        if (!fn.workflowId) {
            return null;
        }

        return this.workspaceManager.ensureWorkflowWorkspace(userId, fn.workflowId.toString());
    }

    private async resolveSourceCode(
        fn: IUserFunction,
        userId: string,
        workspace: WorkspaceProvisioningResult | null
    ): Promise<string | undefined> {
        if (fn.language === 'python' && fn.origin === 'native') {
            return undefined;
        }

        const buildStatus = await this.buildService.getBuildStatus(fn._id.toString(), userId).catch(() => null);
        const preferredArtifact = buildStatus?.artifactPaths?.[0];

        if (preferredArtifact) {
            return fs.readFile(preferredArtifact, 'utf-8');
        }

        if (typeof fn.codeInline === 'string') {
            return fn.codeInline;
        }

        const resolvedPath = this.resolveSourcePath(fn, workspace);
        if (!resolvedPath) {
            throw new Error(`No source available for function '${fn.name}'.`);
        }

        return fs.readFile(resolvedPath, 'utf-8');
    }

    private resolveSourcePath(fn: Pick<IUserFunction, 'codePath' | 'origin'>, workspace: WorkspaceProvisioningResult | null): string | null {
        if (!fn.codePath) {
            return null;
        }

        if (path.isAbsolute(fn.codePath)) {
            return fn.codePath;
        }

        if (fn.origin === 'native') {
            return path.resolve(process.cwd(), '..', fn.codePath);
        }

        if (workspace) {
            return path.resolve(workspace.runtimeRoots.sourceRoot, fn.codePath);
        }

        return path.resolve(process.cwd(), fn.codePath);
    }

    private resolveExecutionMode(fn: Pick<IUserFunction, 'language' | 'origin'>): SandboxExecutionRequest['mode'] {
        if (fn.language === 'python') {
            return fn.origin === 'native' ? 'python-native' : 'python-custom';
        }

        return 'typescript-custom';
    }

    private getExecutionRunner(runnerId: ReturnType<DockerSandboxRunner['getRunnerId']> | ReturnType<FirecrackerRunner['getRunnerId']>) {
        return runnerId === 'firecracker' ? this.firecrackerRunner : this.dockerRunner;
    }

    private normalizeRunnerId(runnerId: string): ReturnType<DockerSandboxRunner['getRunnerId']> | ReturnType<FirecrackerRunner['getRunnerId']> {
        return runnerId === 'firecracker' ? 'firecracker' : 'docker_sandbox';
    }

    private async executeSerializedForWorkspace<T>(
        workspace: WorkspaceProvisioningResult | null,
        operation: () => Promise<T>
    ): Promise<T> {
        const lockKey = this.getWorkspaceExecutionLockKey(workspace);
        if (!lockKey) {
            return operation();
        }

        const previous = ExecutionOrchestrator.workspaceExecutionChains.get(lockKey) ?? Promise.resolve();
        let releaseCurrent!: () => void;
        const current = new Promise<void>((resolve) => {
            releaseCurrent = resolve;
        });
        const tail = previous.catch(() => undefined).then(() => current);

        ExecutionOrchestrator.workspaceExecutionChains.set(lockKey, tail);
        await previous.catch(() => undefined);

        try {
            return await operation();
        } finally {
            releaseCurrent();
            if (ExecutionOrchestrator.workspaceExecutionChains.get(lockKey) === tail) {
                ExecutionOrchestrator.workspaceExecutionChains.delete(lockKey);
            }
        }
    }

    private getWorkspaceExecutionLockKey(workspace: WorkspaceProvisioningResult | null): string | null {
        if (!workspace) {
            return null;
        }

        return workspace.workspaceId || workspace.logicalRoot || workspace.runtimeRoots.outputRoot;
    }

    private async snapshotOutputArtifacts(workspace: WorkspaceProvisioningResult | null): Promise<Map<string, string>> {
        if (!workspace) {
            return new Map();
        }

        return this.walkOutputArtifacts(workspace.runtimeRoots.outputRoot);
    }

    private async collectOutputArtifacts(
        workspace: WorkspaceProvisioningResult | null,
        baseline: Map<string, string>
    ): Promise<IUserToolRunArtifact[]> {
        if (!workspace) {
            return [];
        }

        const current = await this.walkOutputArtifacts(workspace.runtimeRoots.outputRoot);
        const artifacts: IUserToolRunArtifact[] = [];

        for (const [relativePath, fingerprint] of current.entries()) {
            if (baseline.get(relativePath) === fingerprint) {
                continue;
            }

            artifacts.push({
                path: `output/${relativePath}`.replace(/\\/g, '/'),
                kind: this.inferArtifactKind(relativePath)
            });
        }

        return artifacts.sort((left, right) => left.path.localeCompare(right.path));
    }

    private async walkOutputArtifacts(outputRoot: string): Promise<Map<string, string>> {
        const artifacts = new Map<string, string>();

        const visit = async (currentDir: string) => {
            let entries: Dirent[];
            try {
                entries = await fs.readdir(currentDir, { withFileTypes: true });
            } catch (error) {
                const code = (error as NodeJS.ErrnoException).code;
                if (code === 'ENOENT') {
                    return;
                }
                throw error;
            }

            for (const entry of entries) {
                const absolutePath = path.join(currentDir, entry.name);

                if (entry.isDirectory()) {
                    await visit(absolutePath);
                    continue;
                }

                if (!entry.isFile()) {
                    continue;
                }

                const stats = await fs.stat(absolutePath);
                const relativePath = path.relative(outputRoot, absolutePath).replace(/\\/g, '/');
                artifacts.set(relativePath, `${stats.size}:${stats.mtimeMs}`);
            }
        };

        await visit(outputRoot);
        return artifacts;
    }

    private inferArtifactKind(relativePath: string): IUserToolRunArtifact['kind'] {
        const normalizedPath = relativePath.toLowerCase();

        if (normalizedPath.endsWith('.json')) {
            return 'json';
        }

        if (normalizedPath.endsWith('.log') || normalizedPath.endsWith('.txt')) {
            return 'log';
        }

        return 'file';
    }

    private buildResourceUsage(result: Pick<OrchestratedExecutionResult, 'resourceUsage' | 'durationMs' | 'metadata'>): SandboxExecutionResourceUsage | undefined {
        const baseUsage = result.resourceUsage ?? {};
        const wallTimeMs = baseUsage.wallTimeMs ?? result.durationMs;
        const memoryLimitMb = baseUsage.memoryLimitMb
            ?? (typeof result.metadata?.maxMemoryMb === 'number' ? result.metadata.maxMemoryMb : undefined);

        if (
            baseUsage.peakMemoryMb == null
            && baseUsage.cpuMs == null
            && wallTimeMs == null
            && memoryLimitMb == null
        ) {
            return undefined;
        }

        return {
            ...baseUsage,
            wallTimeMs,
            memoryLimitMb
        };
    }

    private toPersistedErrorCode(failureKind?: SandboxExecutionFailureKind): string | undefined {
        return failureKind ? failureKind.toUpperCase() : undefined;
    }
}
