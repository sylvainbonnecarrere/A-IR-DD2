import { Dirent, promises as fs } from 'fs';
import crypto from 'crypto';
import path from 'path';
import mongoose from 'mongoose';
import ts from 'typescript';
import type { UserToolRunLaunchContext, UserToolRunRunner } from '../../models/UserToolRun.model';
import type { IUserToolRunArtifact } from '../../models/UserToolRun.model';
import { deriveExecutionMetadataFromLegacyFunction } from '../../utils/userToolLegacyMapper';
import { USER_TOOL_RUN_TERMINAL_STATUS_VALUES, isUserToolRunTerminalStatus } from '../../domain/execution/userToolRun.contract';
import { BuildService } from '../build.service';
import { MediaCatalogService } from '../mediaCatalog.service';
import { RuntimeHealthService } from '../runtimeHealth.service';
import { UserToolRunService } from '../userToolRun.service';
import { createWorkspaceManager } from '../workspace/WorkspaceManager';
import type { WorkspaceProvisioningResult } from '../workspace/types';
import { createSandboxRunnerFactory } from './SandboxRunner';
import { DockerSandboxRunner } from './DockerSandboxRunner';
import { FirecrackerRunner } from './FirecrackerRunner';
import type {
  ExecutionFunctionRef,
  OrchestratedExecutionResult,
  SandboxExecutionFailureKind,
  SandboxExecutionRequest,
  SandboxExecutionResourceUsage,
  SandboxSyntaxCheckResult,
} from './execution.types';
import { buildSandboxErrorDetails, inferSandboxFailureSubsystem, RuntimeNotReadyError } from './errors';
import { executionTargetFingerprint } from './executionTargetFingerprint';
import type { RunLease } from './MongoRunLeaseService';
import { MongoWorkspaceLockService, type WorkspaceLock } from './MongoWorkspaceLockService';

export interface ExecutionOrchestratorRequest {
  fn: ExecutionFunctionRef;
  userId: string;
  args: Record<string, unknown>;
  privateContext?: Record<string, unknown>;
  launchContext: UserToolRunLaunchContext;
  agentInstanceId?: string;
  idempotencyKey?: string;
  retryOfExecutionId?: string;
  recoveryAttemptCount?: number;
  persistedExecutionId?: string;
  executeExistingQueued?: boolean;
  verifiedInlineSource?: boolean;
  lease?: RunLease;
  leaseSignal?: AbortSignal;
  workspaceLock?: WorkspaceLock;
}

export interface QueuedRunAcknowledgement {
  executionId: string;
  status: string;
  replayed: boolean;
}

export type RunPreparation = () => Promise<void>;

export class IdempotencyKeyReuseError extends Error {
  readonly code = 'IDEMPOTENCY_KEY_REUSED';

  constructor() {
    super('Idempotency-Key was already used with a different run request.');
    this.name = 'IdempotencyKeyReuseError';
  }
}

export class RunCompletionTimeoutError extends Error {
  constructor(public readonly executionId: string) {
    super(`Run ${executionId} is still active; retrieve its status through the runs API.`);
    this.name = 'RunCompletionTimeoutError';
  }
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(',')}]`;
  }

  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .filter((key) => record[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
      .join(',')}}`;
  }

  return JSON.stringify(value) ?? 'null';
}

export class ExecutionOrchestrator {
  private static readonly workspaceExecutionChains = new Map<string, Promise<void>>();

  private readonly runtimeHealthService = new RuntimeHealthService();
  private readonly buildService = new BuildService();
  private readonly mediaCatalogService = new MediaCatalogService();
  private readonly userToolRunService = new UserToolRunService();
  private readonly workspaceLocks = new MongoWorkspaceLockService();
  private readonly workspaceManager = createWorkspaceManager();
  private readonly sandboxRunnerFactory = createSandboxRunnerFactory();
  private readonly dockerRunner = new DockerSandboxRunner();
  private readonly firecrackerRunner = new FirecrackerRunner();
  private readonly activeRunControllers = new Map<string, AbortController>();
  private readonly activeRunCompletions = new Map<string, Promise<void>>();

  async getPreferredRunnerReadiness(runtime: SandboxExecutionRequest['runtime']) {
    const runtimeReport = await this.runtimeHealthService.getHealthReport();
    const selectedRunnerPort = this.sandboxRunnerFactory.getPreferredRunner(runtimeReport);

    return {
      report: runtimeReport,
      runner: selectedRunnerPort,
      readiness: selectedRunnerPort.getReadiness(runtimeReport, runtime),
    };
  }

  async checkSyntax(language: 'python' | 'typescript', code: string): Promise<SandboxSyntaxCheckResult> {
    if (language === 'typescript') {
      return { valid: true, errors: [] };
    }

    const { report: runtimeReport, runner: selectedRunnerPort, readiness } = await this.getPreferredRunnerReadiness('python');
    if (!readiness.ready) {
      throw new RuntimeNotReadyError(readiness.reason ?? runtimeReport.summary);
    }

    const selectedRunnerId = this.normalizeRunnerId(selectedRunnerPort.getRunnerId());
    if (selectedRunnerId !== 'docker_sandbox') {
      throw new RuntimeNotReadyError(
        `Le runner prefere '${selectedRunnerPort.getLabel()}' ne supporte pas encore la verification syntaxique Python.`,
      );
    }

    return this.dockerRunner.checkPythonSyntax(code);
  }

  async enqueue(request: ExecutionOrchestratorRequest): Promise<QueuedRunAcknowledgement> {
    const executionMetadata = deriveExecutionMetadataFromLegacyFunction(request.fn);
    const executionId = request.persistedExecutionId ?? this.buildExecutionId(request, executionMetadata.toolId.toString());
    const requestFingerprint = this.buildRequestFingerprint(request, executionMetadata);
    const existingRun =
      request.idempotencyKey || request.persistedExecutionId
        ? await this.userToolRunService.getRunByExecutionId(executionId, 'majority')
        : null;

    if (existingRun) {
      this.assertMatchingRequestFingerprint(existingRun.requestFingerprint, requestFingerprint);
      return { executionId, status: existingRun.status, replayed: true };
    }

    const selectedRunnerId: UserToolRunRunner = 'docker_sandbox';

    try {
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
        retryOfExecutionId: request.retryOfExecutionId,
        recoveryAttemptCount: request.recoveryAttemptCount,
        requestFingerprint,
        targetFingerprint: executionTargetFingerprint(request.fn),
        privateContext: request.privateContext,
        policySnapshot: executionMetadata.policySnapshot,
      });
    } catch (error) {
      if (!this.isDuplicateKeyError(error)) {
        throw error;
      }

      const duplicateRun = await this.userToolRunService.getRunByExecutionId(executionId, 'majority');
      if (!duplicateRun) {
        throw error;
      }
      this.assertMatchingRequestFingerprint(duplicateRun.requestFingerprint, requestFingerprint);
      return { executionId, status: duplicateRun.status, replayed: true };
    }

    return { executionId, status: 'queued', replayed: false };
  }

  async requestCancellation(executionId: string, ownerUserId: string) {
    const cancellation = await this.userToolRunService.requestCancellation(executionId, ownerUserId);
    if (cancellation.kind === 'not_found' || cancellation.kind === 'not_cancellable') {
      return cancellation;
    }

    this.activeRunControllers.get(executionId)?.abort();
    const workCompleted = await this.waitForRunWork(executionId);
    if (workCompleted) {
      const currentRun = await this.userToolRunService.getRunByExecutionId(executionId, 'majority');
      if (currentRun?.status === 'stopped' && currentRun.error?.code === 'RUN_CANCELLED') {
        return { kind: 'stopped' as const, run: currentRun };
      }
      if (currentRun && !['queued', 'running'].includes(currentRun.status)) {
        return { kind: 'not_cancellable' as const, run: currentRun };
      }
      if (currentRun) {
        return { kind: 'requested' as const, run: currentRun };
      }
    }

    return cancellation;
  }

  private async waitForRunWork(executionId: string, timeoutMs = 10_000): Promise<boolean> {
    const activeCompletion = this.activeRunCompletions.get(executionId);
    if (!activeCompletion) {
      return true;
    }

    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        activeCompletion.then(() => true),
        new Promise<boolean>((resolve) => {
          timeout = setTimeout(() => resolve(false), timeoutMs);
        }),
      ]);
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }

  async waitForRunCompletion(
    executionId: string,
    ownerUserId: string,
    timeoutMs = 300_000,
    pollIntervalMs = 250,
  ): Promise<OrchestratedExecutionResult> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const run = await this.userToolRunService.getRunByExecutionId(executionId, 'majority', ownerUserId);
      if (!run) {
        throw new Error('Run not found or access denied');
      }
      if (isUserToolRunTerminalStatus(run.status)) {
        return this.mapPersistedRun(run, true);
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(pollIntervalMs, Math.max(0, deadline - Date.now()))));
    }

    throw new RunCompletionTimeoutError(executionId);
  }

  async execute(request: ExecutionOrchestratorRequest, prepareForDispatch?: RunPreparation): Promise<OrchestratedExecutionResult> {
    if (request.workspaceLock || !request.fn.workflowId) {
      return this.executeCore(request, prepareForDispatch);
    }

    const metadata = deriveExecutionMetadataFromLegacyFunction(request.fn);
    const executionId = request.persistedExecutionId ?? this.buildExecutionId(request, metadata.toolId.toString());
    const ownerUserId = request.userId;
    const workflowId = request.fn.workflowId.toString();
    const lock = await this.workspaceLocks.tryAcquire(ownerUserId, workflowId, executionId);
    if (!lock) {
      throw new Error('Workspace is locked by another execution or requires reconciliation');
    }

    let runnerStarted = false;
    let safeToRelease = false;
    try {
      const result = await this.executeCore(
        {
          ...request,
          workspaceLock: lock,
        },
        prepareForDispatch,
        () => {
          runnerStarted = true;
        },
        executionId,
      );
      safeToRelease =
        !request.lease &&
        (USER_TOOL_RUN_TERMINAL_STATUS_VALUES as readonly string[]).includes(result.status ?? '') &&
        result.metadata?.runnerTerminationConfirmed !== false;
      return result;
    } finally {
      if (!runnerStarted || safeToRelease) {
        if (!(await this.workspaceLocks.release(lock))) {
          throw new Error(`Workspace lock release was not confirmed for ${executionId}`);
        }
      }
    }
  }

  private async executeCore(
    request: ExecutionOrchestratorRequest,
    prepareForDispatch?: RunPreparation,
    onRunnerStart?: () => void,
    executionIdOverride?: string,
  ): Promise<OrchestratedExecutionResult> {
    if (
      request.lease &&
      (!request.executeExistingQueued || request.persistedExecutionId !== request.lease.executionId || !request.leaseSignal)
    ) {
      throw new Error('A leased dispatch requires a matching persisted execution and a lease monitor signal');
    }
    const assertLeaseMonitorActive = () => {
      if (request.leaseSignal?.aborted) {
        throw new Error('Leased dispatch stopped because the lease monitor was interrupted');
      }
    };
    assertLeaseMonitorActive();
    const executionMetadata = deriveExecutionMetadataFromLegacyFunction(request.fn);
    const executionId =
      executionIdOverride ?? request.persistedExecutionId ?? this.buildExecutionId(request, executionMetadata.toolId.toString());
    const requestFingerprint = this.buildRequestFingerprint(request, executionMetadata);
    const existingRun =
      request.idempotencyKey || request.persistedExecutionId ? await this.userToolRunService.getRunByExecutionId(executionId) : null;
    const isQueuedDispatch = request.executeExistingQueued === true && existingRun?.status === 'queued';
    if (request.lease && !isQueuedDispatch) {
      throw new Error('Leased dispatch requires an existing queued run');
    }

    if (existingRun) {
      this.assertMatchingRequestFingerprint(existingRun.requestFingerprint, requestFingerprint);
      if (isQueuedDispatch && existingRun.reconstructionQuarantine) {
        throw new Error('Queued run is quarantined pending reconciliation');
      }
      if (!isQueuedDispatch) {
        return this.mapPersistedRun(existingRun, true);
      }
    }

    const {
      report: runtimeReport,
      runner: selectedRunnerPort,
      readiness,
    } = await this.getPreferredRunnerReadiness(executionMetadata.runtime);
    const selectedRunnerId = this.normalizeRunnerId(selectedRunnerPort.getRunnerId());

    if (!readiness.ready) {
      throw new RuntimeNotReadyError(readiness.reason ?? runtimeReport.summary);
    }

    console.info('[ExecutionOrchestrator] queue execution', {
      executionId,
      userId: request.userId,
      functionName: request.fn.name,
      toolId: executionMetadata.toolId,
      runtime: executionMetadata.runtime,
      launchContext: request.launchContext,
      runner: selectedRunnerId,
    });

    if (request.lease) {
      assertLeaseMonitorActive();
      await this.userToolRunService.markRunning(executionId, new Date(), selectedRunnerId, request.lease);
    }

    let executionRequest: SandboxExecutionRequest;
    try {
      assertLeaseMonitorActive();
      await prepareForDispatch?.();
      assertLeaseMonitorActive();
      executionRequest = await this.buildExecutionRequest({
        ...request,
        executionId,
        executionMetadataRuntime: executionMetadata.runtime,
        executionMetadataToolVersionTag: executionMetadata.toolVersionTag,
        executionMetadataPolicy: executionMetadata.policySnapshot,
        launchContext: request.launchContext,
      });
      assertLeaseMonitorActive();
    } catch (error) {
      if (request.lease) {
        console.error('[ExecutionOrchestrator] Leased preparation outcome is unknown', {
          executionId,
          errorType: error instanceof Error ? error.name : 'UnknownError',
        });
      } else if (isQueuedDispatch && !request.leaseSignal?.aborted) {
        await this.userToolRunService.failRun(executionId, {
          error: buildSandboxErrorDetails({
            code: 'RUN_PREPARATION_FAILED',
            message: error instanceof Error ? error.message : String(error),
            subsystem: 'build_preparation',
            retryable: false,
          }),
        });
      }
      throw error;
    }

    try {
      if (isQueuedDispatch) {
        const persistedRun = await this.userToolRunService.getRunByExecutionId(executionId);
        const expectedStatus = request.lease ? 'running' : 'queued';
        if (persistedRun?.status !== expectedStatus) {
          if (persistedRun) {
            return this.mapPersistedRun(persistedRun, true);
          }
          const refetchedRun = await this.userToolRunService.getRunByExecutionId(executionId);
          if (!refetchedRun) {
            throw new Error(`Queued run ${executionId} introuvable après relecture (fail-closed)`);
          }
          return this.mapPersistedRun(refetchedRun, true);
        }
      } else {
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
          retryOfExecutionId: request.retryOfExecutionId,
          recoveryAttemptCount: request.recoveryAttemptCount,
          requestFingerprint,
          targetFingerprint: executionTargetFingerprint(request.fn),
          privateContext: request.privateContext,
          policySnapshot: executionMetadata.policySnapshot,
        });
      }
    } catch (error) {
      if (request.idempotencyKey && this.isDuplicateKeyError(error)) {
        const existingRun = await this.userToolRunService.getRunByExecutionId(executionId);
        if (existingRun) {
          return this.mapPersistedRun(existingRun, true);
        }
      }

      throw error;
    }

    let resolveActiveCompletion!: () => void;
    const activeCompletion = new Promise<void>((resolve) => {
      resolveActiveCompletion = resolve;
    });
    this.activeRunCompletions.set(executionId, activeCompletion);

    try {
      return await this.executeSerializedForWorkspace(executionRequest.workspace, async () => {
        const controller = new AbortController();
        const abortFromLease = () => controller.abort();
        request.leaseSignal?.addEventListener('abort', abortFromLease, { once: true });
        if (request.leaseSignal?.aborted) {
          controller.abort();
        }
        this.activeRunControllers.set(executionId, controller);
        try {
          assertLeaseMonitorActive();
          if (!request.lease) {
            await this.userToolRunService.markRunning(executionId, new Date(), selectedRunnerId);
          }
          const artifactBaseline = await this.snapshotOutputArtifacts(executionRequest.workspace);
          let runnerCompleted = false;

          try {
            assertLeaseMonitorActive();
            if (request.lease) {
              await this.userToolRunService.assertRunningLease(request.lease);
              assertLeaseMonitorActive();
            }
            onRunnerStart?.();
            const executionResult = await this.getExecutionRunner(selectedRunnerId).execute({
              ...executionRequest,
              signal: controller.signal,
            });
            runnerCompleted = true;
            if (request.leaseSignal?.aborted) {
              return {
                ...executionResult,
                success: false,
                executionId,
                replayed: false,
                status: 'running',
              };
            }
            const outputArtifacts = await this.collectOutputArtifacts(executionRequest.workspace, artifactBaseline);
            const outputs = {
              result: executionResult.output,
              stdout: executionResult.stdout,
              stderr: executionResult.stderr,
              ...(outputArtifacts.length > 0 ? { artifacts: outputArtifacts } : {}),
            };
            const cancellationOutcome = executionResult.metadata?.failureKind === 'cancelled';

            if (cancellationOutcome) {
              if (executionResult.metadata?.cancellationConfirmed !== true) {
                return {
                  ...executionResult,
                  success: false,
                  executionId,
                  replayed: false,
                  status: 'running',
                  cancellationRequested: true,
                };
              }

              await this.userToolRunService.stopRun(
                executionId,
                {
                  error: {
                    code: 'RUN_CANCELLED',
                    subsystem: 'runner',
                    failureKind: 'cancelled',
                    message: 'Sandbox stopped after cancellation request',
                    retryable: false,
                  },
                  outputs,
                  resourceUsage: this.buildResourceUsage(executionResult),
                },
                ...(request.lease ? ([request.lease] as const) : []),
              );
            } else if (executionResult.metadata?.runnerTerminationConfirmed === false) {
              return {
                ...executionResult,
                success: false,
                executionId,
                replayed: false,
                status: 'running',
              };
            } else if (executionResult.success) {
              await this.userToolRunService.completeRun(
                executionId,
                {
                  outputs,
                  resourceUsage: this.buildResourceUsage(executionResult),
                },
                ...(request.lease ? ([request.lease] as const) : []),
              );
            } else if (executionResult.timedOut) {
              await this.userToolRunService.timeoutRun(
                executionId,
                {
                  error: this.buildPersistedRunError(
                    executionResult.stderr || 'Function execution timed out',
                    executionResult.metadata?.failureKind ?? 'timeout',
                  ),
                  outputs,
                  resourceUsage: this.buildResourceUsage(executionResult),
                },
                ...(request.lease ? ([request.lease] as const) : []),
              );
            } else {
              await this.userToolRunService.failRun(
                executionId,
                {
                  error: this.buildPersistedRunError(
                    executionResult.stderr || 'Function execution failed',
                    executionResult.metadata?.failureKind,
                  ),
                  outputs,
                  resourceUsage: this.buildResourceUsage(executionResult),
                },
                ...(request.lease ? ([request.lease] as const) : []),
              );
            }

            await this.catalogOutputArtifacts({
              executionId,
              userId: request.userId,
              workflowId: request.fn.workflowId?.toString(),
              agentInstanceId: request.agentInstanceId,
              workspace: executionRequest.workspace,
              outputArtifacts,
            });

            console.info('[ExecutionOrchestrator] finished execution', {
              executionId,
              success: executionResult.success,
              timedOut: executionResult.timedOut ?? false,
              runner: selectedRunnerId,
              exitCode: executionResult.exitCode ?? null,
              failureKind: executionResult.metadata?.failureKind ?? null,
            });

            return {
              ...executionResult,
              executionId,
              replayed: false,
              status: cancellationOutcome
                ? 'stopped'
                : executionResult.success
                  ? 'completed'
                  : executionResult.timedOut
                    ? 'timed_out'
                    : 'failed',
              metadata: {
                exitCode: executionResult.exitCode,
                ...(executionResult.metadata ?? {}),
                runnerTerminationConfirmed: executionResult.metadata?.runnerTerminationConfirmed ?? true,
                ...(outputArtifacts.length > 0 ? { artifacts: outputArtifacts } : {}),
              },
            };
          } catch (error) {
            if (request.leaseSignal?.aborted) {
              throw error;
            }
            if (request.lease && !runnerCompleted) {
              console.error('[ExecutionOrchestrator] Leased runner outcome is unknown', {
                executionId,
                runner: selectedRunnerId,
                errorType: error instanceof Error ? error.name : 'UnknownError',
              });
              throw error;
            }
            if (controller.signal.aborted && !runnerCompleted) {
              const currentRun = await this.userToolRunService.getRunByExecutionId(executionId);
              if (currentRun?.status === 'stopped' && currentRun.error?.code === 'RUN_CANCELLED') {
                return this.mapPersistedRun(currentRun, false);
              }
              return {
                success: false,
                output: null,
                stderr: 'Cancellation requested; runner termination has not been confirmed.',
                durationMs: 0,
                timedOut: false,
                exitCode: 130,
                runner: selectedRunnerId,
                executionId,
                replayed: false,
                status: 'running',
                cancellationRequested: true,
              };
            }
            const message = error instanceof Error ? error.message : String(error);
            const outputArtifacts = await this.collectOutputArtifacts(executionRequest.workspace, artifactBaseline);
            console.error('[ExecutionOrchestrator] failed execution', {
              executionId,
              runner: selectedRunnerId,
              message,
            });
            await this.userToolRunService.failRun(
              executionId,
              {
                error: buildSandboxErrorDetails({
                  code: 'ORCHESTRATOR_ERROR',
                  message,
                  subsystem: 'unknown',
                  retryable: false,
                }),
                ...(outputArtifacts.length > 0
                  ? {
                      outputs: {
                        artifacts: outputArtifacts,
                      },
                    }
                  : {}),
              },
              ...(request.lease ? ([request.lease] as const) : []),
            );

            await this.catalogOutputArtifacts({
              executionId,
              userId: request.userId,
              workflowId: request.fn.workflowId?.toString(),
              agentInstanceId: request.agentInstanceId,
              workspace: executionRequest.workspace,
              outputArtifacts,
            });

            throw error;
          }
        } finally {
          request.leaseSignal?.removeEventListener('abort', abortFromLease);
          if (this.activeRunControllers.get(executionId) === controller) {
            this.activeRunControllers.delete(executionId);
          }
        }
      });
    } finally {
      resolveActiveCompletion();
      if (this.activeRunCompletions.get(executionId) === activeCompletion) {
        this.activeRunCompletions.delete(executionId);
      }
    }
  }

  private async catalogOutputArtifacts(params: {
    executionId: string;
    userId: string;
    workflowId?: string;
    agentInstanceId?: string;
    workspace: WorkspaceProvisioningResult | null;
    outputArtifacts: IUserToolRunArtifact[];
  }): Promise<void> {
    if (!params.workspace || !params.workflowId || !params.agentInstanceId || params.outputArtifacts.length === 0) {
      return;
    }

    try {
      await this.mediaCatalogService.registerRuntimeOutputArtifacts({
        userId: params.userId,
        workflowId: params.workflowId,
        agentInstanceId: params.agentInstanceId,
        executionId: params.executionId,
        workspaceOutputRoot: params.workspace.runtimeRoots.outputRoot,
        artifacts: params.outputArtifacts,
      });
    } catch (error) {
      console.warn('[ExecutionOrchestrator] Runtime artifact catalog projection skipped after error:', error);
    }
  }

  private async buildExecutionRequest(
    input: ExecutionOrchestratorRequest & {
      executionId: string;
      executionMetadataRuntime: SandboxExecutionRequest['runtime'];
      executionMetadataToolVersionTag: string;
      executionMetadataPolicy: SandboxExecutionRequest['policySnapshot'];
    },
  ): Promise<SandboxExecutionRequest> {
    const workspace = await this.resolveWorkspace(input.fn, input.userId);
    const sourceCode = await this.resolveSourceCode(input.fn, input.userId, workspace, input.verifiedInlineSource);
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
        codePath: input.fn.codePath,
        workflowId: input.fn.workflowId,
      },
      toolVersionTag: input.executionMetadataToolVersionTag,
      runtime: input.executionMetadataRuntime,
      launchContext: input.launchContext,
      args: input.args,
      privateContext: input.privateContext,
      policySnapshot: input.executionMetadataPolicy,
      workspace,
      sourceCode,
      sourcePath: input.fn.codePath ?? null,
      mode,
    };
  }

  private async resolveWorkspace(
    fn: Pick<ExecutionFunctionRef, 'workflowId'>,
    userId: string,
  ): Promise<WorkspaceProvisioningResult | null> {
    if (!fn.workflowId) {
      return null;
    }

    return this.workspaceManager.ensureWorkflowWorkspace(userId, fn.workflowId.toString());
  }

  private async resolveSourceCode(
    fn: ExecutionFunctionRef,
    userId: string,
    workspace: WorkspaceProvisioningResult | null,
    verifiedInlineSource = false,
  ): Promise<string | undefined> {
    if (verifiedInlineSource) {
      if (fn.origin !== 'custom' || typeof fn.codeInline !== 'string') {
        throw new Error('Verified inline execution requires a custom tool with inline source');
      }
      return fn.language === 'typescript' ? this.transpileTypescriptSource(fn.codeInline, `${fn.name || 'tool'}.ts`) : fn.codeInline;
    }

    if (fn.language === 'python' && fn.origin === 'native') {
      return undefined;
    }

    const buildStatus = await this.buildService.getBuildStatus(fn._id.toString(), userId).catch(() => null);
    const preferredArtifact = buildStatus?.artifactPaths?.[0];

    if (preferredArtifact) {
      return fs.readFile(preferredArtifact, 'utf-8');
    }

    if (typeof fn.codeInline === 'string') {
      return fn.language === 'typescript' ? this.transpileTypescriptSource(fn.codeInline, `${fn.name || 'tool'}.ts`) : fn.codeInline;
    }

    const resolvedPath = this.resolveSourcePath(fn, workspace);
    if (!resolvedPath) {
      throw new Error(`No source available for function '${fn.name}'.`);
    }

    const sourceCode = await fs.readFile(resolvedPath, 'utf-8');
    return fn.language === 'typescript' ? this.transpileTypescriptSource(sourceCode, resolvedPath) : sourceCode;
  }

  private transpileTypescriptSource(sourceCode: string, sourceName: string): string {
    const transpiled = ts.transpileModule(sourceCode, {
      fileName: sourceName,
      reportDiagnostics: true,
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
        strict: false,
        skipLibCheck: true,
      },
    });

    const diagnostics = transpiled.diagnostics?.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error) ?? [];
    if (diagnostics.length > 0) {
      const formattedMessage = diagnostics
        .map((diagnostic) => {
          const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
          if (diagnostic.file && typeof diagnostic.start === 'number') {
            const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
            return `${position.line + 1}:${position.character + 1} ${message}`;
          }

          return message;
        })
        .join('\n');

      throw new SyntaxError(`TypeScript transpilation failed: ${formattedMessage}`);
    }

    return transpiled.outputText;
  }

  private resolveSourcePath(
    fn: Pick<ExecutionFunctionRef, 'codePath' | 'origin'>,
    workspace: WorkspaceProvisioningResult | null,
  ): string | null {
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

  private resolveExecutionMode(fn: Pick<ExecutionFunctionRef, 'language' | 'origin'>): SandboxExecutionRequest['mode'] {
    if (fn.language === 'python') {
      return fn.origin === 'native' ? 'python-native' : 'python-custom';
    }

    return 'typescript-custom';
  }

  private getExecutionRunner(runnerId: ReturnType<DockerSandboxRunner['getRunnerId']> | ReturnType<FirecrackerRunner['getRunnerId']>) {
    return runnerId === 'firecracker' ? this.firecrackerRunner : this.dockerRunner;
  }

  private normalizeRunnerId(
    runnerId: string,
  ): ReturnType<DockerSandboxRunner['getRunnerId']> | ReturnType<FirecrackerRunner['getRunnerId']> {
    return runnerId === 'firecracker' ? 'firecracker' : 'docker_sandbox';
  }

  private async executeSerializedForWorkspace<T>(workspace: WorkspaceProvisioningResult | null, operation: () => Promise<T>): Promise<T> {
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
    baseline: Map<string, string>,
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
        kind: this.inferArtifactKind(relativePath),
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

  private buildResourceUsage(
    result: Pick<OrchestratedExecutionResult, 'resourceUsage' | 'durationMs' | 'metadata'>,
  ): SandboxExecutionResourceUsage | undefined {
    const baseUsage = result.resourceUsage ?? {};
    const wallTimeMs = baseUsage.wallTimeMs ?? result.durationMs;
    const memoryLimitMb =
      baseUsage.memoryLimitMb ?? (typeof result.metadata?.maxMemoryMb === 'number' ? result.metadata.maxMemoryMb : undefined);

    if (baseUsage.peakMemoryMb == null && baseUsage.cpuMs == null && wallTimeMs == null && memoryLimitMb == null) {
      return undefined;
    }

    return {
      ...baseUsage,
      wallTimeMs,
      memoryLimitMb,
    };
  }

  private toPersistedErrorCode(failureKind?: SandboxExecutionFailureKind): string | undefined {
    return failureKind ? failureKind.toUpperCase() : undefined;
  }

  private buildPersistedRunError(message: string, failureKind?: SandboxExecutionFailureKind) {
    return buildSandboxErrorDetails({
      message,
      code: this.toPersistedErrorCode(failureKind),
      subsystem: inferSandboxFailureSubsystem(failureKind),
      retryable:
        failureKind === 'runner_unavailable' ||
        failureKind === 'runner_spawn_failed' ||
        failureKind === 'runner_image_missing' ||
        failureKind === 'runner_mount_failed',
      failureKind,
    });
  }

  private buildRequestFingerprint(
    request: ExecutionOrchestratorRequest,
    metadata: ReturnType<typeof deriveExecutionMetadataFromLegacyFunction>,
  ): string {
    return crypto
      .createHash('sha256')
      .update(
        stableSerialize({
          userId: request.userId,
          toolId: metadata.toolId.toString(),
          toolVersionTag: metadata.toolVersionTag,
          toolContentHash: metadata.toolContentHash,
          workflowId: request.fn.workflowId?.toString() ?? null,
          agentInstanceId: request.agentInstanceId ?? null,
          launchContext: request.launchContext,
          retryOfExecutionId: request.retryOfExecutionId ?? null,
          args: request.args,
          policySnapshot: metadata.policySnapshot,
          privateContext: request.privateContext ?? null,
        }),
      )
      .digest('hex');
  }

  private assertMatchingRequestFingerprint(existing: string | null | undefined, requested: string): void {
    if (existing && existing !== requested) {
      throw new IdempotencyKeyReuseError();
    }
  }

  private buildExecutionId(request: ExecutionOrchestratorRequest, toolId: string): string {
    if (!request.idempotencyKey) {
      return `utr-${new mongoose.Types.ObjectId().toString()}`;
    }

    const digest = crypto
      .createHash('sha256')
      .update(
        JSON.stringify({
          userId: request.userId,
          toolId,
          agentInstanceId: request.agentInstanceId ?? null,
          launchContext: request.launchContext,
          retryOfExecutionId: request.retryOfExecutionId ?? null,
          idempotencyKey: request.idempotencyKey,
        }),
      )
      .digest('hex')
      .slice(0, 32);

    return `utr-idem-${digest}`;
  }

  private isDuplicateKeyError(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) {
      return false;
    }

    const code = 'code' in error ? (error as { code?: number }).code : undefined;
    const message = error instanceof Error ? error.message : '';
    return code === 11000 || /E11000|duplicate key/i.test(message);
  }

  private mapPersistedRun(
    run: Awaited<ReturnType<UserToolRunService['getRunByExecutionId']>> extends infer T ? NonNullable<T> : never,
    replayed: boolean,
  ): OrchestratedExecutionResult {
    return {
      success: run.status === 'completed',
      output: run.outputs?.result ?? null,
      stdout: run.outputs?.stdout,
      stderr: run.outputs?.stderr ?? run.error?.message,
      durationMs: run.timing.durationMs ?? 0,
      timedOut: run.status === 'timed_out',
      status: run.status,
      retryOfExecutionId: run.retryOfExecutionId ?? null,
      exitCode: run.status === 'completed' ? 0 : 1,
      runner: run.runner,
      executionId: run.executionId,
      replayed,
      metadata: run.outputs?.artifacts ? { artifacts: run.outputs.artifacts } : undefined,
      resourceUsage: run.resourceUsage,
    };
  }
}
