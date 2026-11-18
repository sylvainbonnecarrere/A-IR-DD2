import mongoose from 'mongoose';
import { UserTool } from '../models/UserTool.model';
import { BuildPreparationError, BuildService } from './build.service';
import { NativePythonProvisioningService } from './nativePythonProvisioning.service';
import { RuntimeHealthService } from './runtimeHealth.service';
import { ExecutionOrchestrator, type ExecutionOrchestratorRequest, type QueuedRunAcknowledgement, type RunPreparation } from './runtime/ExecutionOrchestrator';
import type { ExecutionFunctionRef, OrchestratedExecutionResult, SandboxExecutionMetadata, SandboxExecutionResourceUsage, SandboxSyntaxCheckResult } from './runtime/execution.types';
import { getSandboxErrorDetailsFromExecutionResult, type SandboxErrorDetails } from './runtime/errors';
import type { IUserToolPolicy, IUserToolVersion } from '../models/UserTool.model';
import { UserToolRun } from '../models/UserToolRun.model';
import { UserToolRunService } from './userToolRun.service';
import { buildGlobalToolClauses, buildOwnedToolClause } from '../utils/sharedExampleAccess';
import { deriveExecutionMetadataFromLegacyFunction } from '../utils/userToolLegacyMapper';
import type { IUserToolRun } from '../models/UserToolRun.model';
import type { RunLease } from './runtime/MongoRunLeaseService';
import { executionTargetFingerprint } from './runtime/executionTargetFingerprint';
import { isReconstructionRejectionCode } from '../domain/execution/runReconstructionQuarantine';
import { USER_TOOL_RUN_RECONCILABLE_TERMINAL_STATUS_VALUES } from '../domain/execution/userToolRun.contract';
import { RunReconstructionRejection } from './runtime/RunReconstructionRejection';

export interface SandboxResult {
    success: boolean;
    output: unknown;
    stdout?: string;
    stderr?: string;
    durationMs: number;
    timedOut?: boolean;
    executionId?: string;
    runner?: string;
    exitCode?: number;
    replayed?: boolean;
    metadata?: SandboxExecutionMetadata;
    resourceUsage?: SandboxExecutionResourceUsage;
    errorDetails?: SandboxErrorDetails;
}

export type SyntaxCheckResult = SandboxSyntaxCheckResult;

export class SandboxServiceError extends Error {
    constructor(
        public readonly code: string,
        public readonly statusCode: number,
        message: string,
    ) {
        super(message);
        this.name = 'SandboxServiceError';
    }
}

interface SandboxToolSelection {
    toolId: string;
    versionRef?: {
        versionTag?: string;
        versionNumber?: number;
        workspaceId?: string | null;
    };
}

interface VersionedExecutionTarget extends ExecutionFunctionRef {
    isEnabled: boolean;
    toolVersionTag?: string;
    toolContentHash?: string;
    toolBuildStatus?: 'not_built' | 'building' | 'built' | 'failed';
    policySnapshot?: IUserToolPolicy;
}

type RetrySnapshot = Pick<IUserToolRun, 'toolVersionTag' | 'toolContentHash' | 'runtime' | 'workflowId' | 'policySnapshot' | 'targetFingerprint'>;

export class SandboxService {
    private readonly buildService = new BuildService();
    private readonly nativePythonProvisioningService = new NativePythonProvisioningService();
    private readonly runtimeHealthService = new RuntimeHealthService();
    private readonly executionOrchestrator = new ExecutionOrchestrator();
    private readonly userToolRunService = new UserToolRunService();

    /**
     * Retourne l'etat de sante du runtime sandbox via le service de health dedie.
     */
    async checkHealth() {
        return this.runtimeHealthService.getHealthReport();
    }

    /**
     *
     * @throws Error si la fonction est introuvable, désactivée, ou si le timeout est dépassé
     */
    async runFunction(
        functionId: string | undefined,
        userId: string,
        testArgs: Record<string, unknown> = {},
        toolSelection?: SandboxToolSelection,
        agentInstanceId?: string,
        privateContext?: Record<string, unknown>,
        authHeader?: string,
        idempotencyKey?: string,
    ): Promise<SandboxResult> {
        const acknowledgement = await this.queueFunctionRun({
            functionId,
            userId,
            testArgs,
            toolSelection,
            agentInstanceId,
            privateContext,
            launchContext: agentInstanceId ? 'workflow_run' : 'editor_test',
            idempotencyKey,
        });
        const executionResult = await this.waitForRunCompletion(acknowledgement.executionId, userId);

        const errorDetails = getSandboxErrorDetailsFromExecutionResult(executionResult);
        return errorDetails
            ? {
                ...executionResult,
                errorDetails
            }
            : executionResult;
    }

    async queueFunctionRun(input: {
        functionId?: string;
        userId: string;
        testArgs?: Record<string, unknown>;
        toolSelection?: SandboxToolSelection;
        agentInstanceId?: string;
        privateContext?: Record<string, unknown>;
        idempotencyKey?: string;
        retryOfExecutionId?: string;
        recoveryAttemptCount?: number;
        launchContext?: 'editor_test' | 'workflow_run' | 'system_validation';
        retrySnapshot?: RetrySnapshot;
    }): Promise<QueuedRunAcknowledgement> {
        const fn = await this.resolveExecutionTarget(input.functionId, input.userId, input.toolSelection);
        if (input.retrySnapshot) {
            this.assertTargetMatchesSnapshot(fn, input.retrySnapshot, 'RUN_RETRY_TARGET_CHANGED');
        }
        return this.executionOrchestrator.enqueue({
            fn,
            userId: input.userId,
            args: input.testArgs ?? {},
            agentInstanceId: input.agentInstanceId,
            privateContext: input.privateContext,
            launchContext: input.launchContext ?? (input.agentInstanceId ? 'workflow_run' : 'editor_test'),
            idempotencyKey: input.idempotencyKey,
            retryOfExecutionId: input.retryOfExecutionId,
            recoveryAttemptCount: input.recoveryAttemptCount,
        });
    }

    async waitForRunCompletion(executionId: string, userId: string, timeoutMs?: number): Promise<OrchestratedExecutionResult> {
        return this.executionOrchestrator.waitForRunCompletion(executionId, userId, timeoutMs);
    }

    async executeLeasedRun(
        request: ExecutionOrchestratorRequest,
        prepareForDispatch: RunPreparation,
    ): Promise<OrchestratedExecutionResult> {
        return this.executionOrchestrator.execute(request, prepareForDispatch);
    }

    async cancelRun(executionId: string, userId: string) {
        return this.executionOrchestrator.requestCancellation(executionId, userId);
    }

    async reconstructQueuedRun(lease: RunLease): Promise<{
        request: ExecutionOrchestratorRequest;
        prepareForDispatch: RunPreparation;
    }> {
        try {
            return await this.reconstructQueuedRunUnchecked(lease);
        } catch (error) {
            if (error instanceof SandboxServiceError && isReconstructionRejectionCode(error.code)) {
                throw new RunReconstructionRejection(error.code);
            }
            throw error;
        }
    }

    private async reconstructQueuedRunUnchecked(lease: RunLease): Promise<{
        request: ExecutionOrchestratorRequest;
        prepareForDispatch: RunPreparation;
    }> {
        const run = await UserToolRun.findOne({
            executionId: lease.executionId,
            status: 'queued',
            'lease.owner': lease.owner,
            'lease.token': lease.token,
            $expr: { $gt: ['$lease.expiresAt', '$$NOW'] },
        }).select('+privateContextCiphertext');
        if (!run) {
            throw new SandboxServiceError('RUN_LEASE_LOST', 409, 'Le lease du run est absent ou expiré.');
        }

        const userId = run.ownerUserId.toString();
        const toolSelection: SandboxToolSelection = {
            toolId: run.toolId.toString(),
            versionRef: { versionTag: run.toolVersionTag },
        };
        const fn = await this.resolveExecutionTarget(undefined, userId, toolSelection);
        this.assertTargetMatchesSnapshot(fn, run, 'RUN_TARGET_CHANGED');
        if (!run.targetFingerprint) {
            throw new SandboxServiceError(
                'RUN_TARGET_SNAPSHOT_MISSING',
                409,
                'Le run ne contient pas l’empreinte de sa cible ; sa reconstruction sûre est impossible.',
            );
        }
        if (executionTargetFingerprint(fn) !== run.targetFingerprint) {
            throw new SandboxServiceError(
                'RUN_TARGET_CHANGED',
                409,
                'La cible enregistrée a changé ; sa reconstruction est refusée.',
            );
        }
        if (fn.origin !== 'custom' || typeof fn.codeInline !== 'string') {
            throw new SandboxServiceError(
                'RUN_TARGET_SOURCE_UNVERIFIED',
                409,
                'Le contenu de la source sur disque ne peut pas encore être vérifié pour ce run.',
            );
        }
        const privateContext = await this.userToolRunService.getPrivateContext(run);

        return {
            request: {
                fn,
                userId,
                args: run.inputs,
                agentInstanceId: run.agentInstanceId?.toString(),
                privateContext,
                launchContext: run.launchContext,
                retryOfExecutionId: run.retryOfExecutionId ?? undefined,
                persistedExecutionId: run.executionId,
                executeExistingQueued: true,
                verifiedInlineSource: true,
            },
            prepareForDispatch: async () => {
                await this.prepareResolvedExecutionTarget(fn, userId, undefined, toolSelection);
                const currentTarget = await this.resolveExecutionTarget(undefined, userId, toolSelection);
                this.assertTargetMatchesSnapshot(currentTarget, run, 'RUN_TARGET_CHANGED');
                if (executionTargetFingerprint(currentTarget) !== run.targetFingerprint) {
                    throw new SandboxServiceError(
                        'RUN_TARGET_CHANGED',
                        409,
                        'La cible du run a changé pendant sa préparation ; son exécution est refusée.',
                    );
                }
            },
        };
    }

    async retryRun(executionId: string, userId: string, idempotencyKey: string): Promise<QueuedRunAcknowledgement> {
        const parentRun = await this.loadOwnedRun(executionId, userId);

        const isRetryableTerminal = ['failed', 'timed_out'].includes(parentRun.status)
            && parentRun.error?.retryable === true;
        if (!isRetryableTerminal) {
            const error = new Error('Ce run terminal ne peut pas être relancé');
            Object.assign(error, { statusCode: 409, code: 'RUN_NOT_RETRYABLE' });
            throw error;
        }

        return this.enqueueRetry(parentRun, userId, idempotencyKey);
    }

    /**
     * Retry d'un run terminal réconciliable (`worker_lost`/`quarantined`) après
     * fencing prouvé (US-J7-07) : nouveau run `queued`, parent strictement immutable.
     */
    async retryQuarantinedRun(executionId: string, userId: string, idempotencyKey: string): Promise<QueuedRunAcknowledgement> {
        const parentRun = await this.loadOwnedRun(executionId, userId);

        const isReconciliableTerminal = (USER_TOOL_RUN_RECONCILABLE_TERMINAL_STATUS_VALUES as readonly string[]).includes(parentRun.status)
            && parentRun.error?.retryable === true;
        if (!isReconciliableTerminal) {
            const error = new Error('Seul un run worker_lost ou quarantined peut être fence-and-retry');
            Object.assign(error, { statusCode: 409, code: 'RUN_NOT_QUARANTINED', status: parentRun.status });
            throw error;
        }

        return this.enqueueRetry(parentRun, userId, idempotencyKey);
    }

    private async loadOwnedRun(executionId: string, userId: string) {
        const ownerUserId = new mongoose.Types.ObjectId(userId);
        const parentRun = await UserToolRun.findOne({ executionId, ownerUserId }).select('+privateContextCiphertext');
        if (!parentRun) {
            const error = new Error('Run introuvable');
            Object.assign(error, { statusCode: 404, code: 'RUN_NOT_FOUND' });
            throw error;
        }
        return parentRun;
    }

    private async enqueueRetry(
        parentRun: Awaited<ReturnType<typeof this.loadOwnedRun>>,
        userId: string,
        idempotencyKey: string,
    ): Promise<QueuedRunAcknowledgement> {
        const privateContext = await this.userToolRunService.getPrivateContext(parentRun);
        return this.queueFunctionRun({
            userId,
            testArgs: parentRun.inputs,
            toolSelection: {
                toolId: parentRun.toolId.toString(),
                versionRef: { versionTag: parentRun.toolVersionTag },
            },
            agentInstanceId: parentRun.agentInstanceId?.toString(),
            privateContext,
            idempotencyKey,
            retryOfExecutionId: parentRun.executionId,
            recoveryAttemptCount: (parentRun.recoveryAttemptCount ?? 0) + 1,
            launchContext: parentRun.launchContext,
            retrySnapshot: {
                toolVersionTag: parentRun.toolVersionTag,
                toolContentHash: parentRun.toolContentHash,
                runtime: parentRun.runtime,
                workflowId: parentRun.workflowId,
                policySnapshot: parentRun.policySnapshot,
                targetFingerprint: parentRun.targetFingerprint,
            },
        });
    }

    private assertTargetMatchesSnapshot(
        fn: VersionedExecutionTarget,
        snapshot: RetrySnapshot,
        errorCode: 'RUN_RETRY_TARGET_CHANGED' | 'RUN_TARGET_CHANGED',
    ): void {
        const target = deriveExecutionMetadataFromLegacyFunction(fn);
        const targetPolicy = target.policySnapshot;
        const savedPolicy = snapshot.policySnapshot;
        const aliases = (values?: string[]) => JSON.stringify([...(values ?? [])].sort());
        const matches = target.toolVersionTag === snapshot.toolVersionTag
            && target.toolContentHash === snapshot.toolContentHash
            && target.runtime === snapshot.runtime
            && (target.workflowId?.toString() ?? null) === (snapshot.workflowId?.toString() ?? null)
            && targetPolicy.networkMode === savedPolicy.networkMode
            && (targetPolicy.timeoutSeconds ?? null) === (savedPolicy.timeoutSeconds ?? null)
            && (targetPolicy.maxMemoryMb ?? null) === (savedPolicy.maxMemoryMb ?? null)
            && aliases(targetPolicy.secretAliases) === aliases(savedPolicy.secretAliases)
            && (!snapshot.targetFingerprint || executionTargetFingerprint(fn) === snapshot.targetFingerprint);

        if (!matches) {
            throw new SandboxServiceError(
                errorCode,
                409,
                'La version ou la politique de l’outil a changé depuis le run initial ; l’exécution est refusée.',
            );
        }
    }

    private async resolveExecutionTarget(
        functionId: string | undefined,
        userId: string,
        toolSelection?: SandboxToolSelection,
    ): Promise<VersionedExecutionTarget> {
        const fn = toolSelection
            ? await this.resolveVersionedExecutionTarget(toolSelection, userId)
            : functionId
                ? await this.resolveLegacyFunctionExecutionTarget(functionId, userId)
                : null;

        if (!fn) {
            const targetIdentity = toolSelection?.toolId ?? functionId ?? 'unknown';
            throw new SandboxServiceError('RUN_TARGET_NOT_FOUND', 404, `Fonction introuvable ou accès non autorisé (id: ${targetIdentity})`);
        }

        if (!fn.isEnabled) {
            throw new SandboxServiceError('RUN_TARGET_DISABLED', 409, `La fonction '${fn.name}' est désactivée. Activez-la dans la bibliothèque avant d'exécuter.`);
        }

        return fn;
    }

    private async prepareResolvedExecutionTarget(
        fn: VersionedExecutionTarget,
        userId: string,
        functionId?: string,
        toolSelection?: SandboxToolSelection,
    ): Promise<void> {
        const resolvedVersionTag = toolSelection ? fn.toolVersionTag : undefined;
        try {
            if (toolSelection) {
                await this.buildService.ensureBuildReadyForTool(toolSelection.toolId, userId, resolvedVersionTag);
            } else if (functionId) {
                await this.buildService.ensureBuildReadyForRun(functionId, userId);
            }
        } catch (error) {
            if (error instanceof BuildPreparationError
                && error.code === 'PLATFORM_PROVISION_REQUIRED'
                && toolSelection) {
                await this.nativePythonProvisioningService.provisionToolVersion(
                    toolSelection.toolId,
                    userId,
                    resolvedVersionTag,
                );
                await this.buildService.ensureBuildReadyForTool(toolSelection.toolId, userId, resolvedVersionTag);
            } else {
                throw error;
            }
        }

    }

    private async resolveVersionedExecutionTarget(
        toolSelection: SandboxToolSelection,
        userId: string
    ): Promise<VersionedExecutionTarget | null> {
        const tool = await this.loadOwnedOrNativeTool(toolSelection.toolId, userId);

        if (!tool) {
            return null;
        }

        const requestedVersionTag = toolSelection.versionRef?.versionTag;
        const resolvedVersion = requestedVersionTag
            ? this.findMatchingToolVersion(tool.versions, requestedVersionTag, toolSelection.versionRef?.versionNumber) || null
            : tool.currentVersion;

        if (!resolvedVersion) {
            throw new SandboxServiceError(
                'RUN_TARGET_VERSION_NOT_FOUND',
                409,
                `Version de tool introuvable pour '${tool.name}' (${requestedVersionTag})`,
            );
        }

        const versionNumber = toolSelection.versionRef?.versionNumber
            ?? this.parseVersionNumber(resolvedVersion.versionTag);

        return this.mapToolVersionToExecutionTarget(tool, resolvedVersion, versionNumber);
    }

    private async resolveLegacyFunctionExecutionTarget(
        functionId: string,
        userId: string
    ): Promise<VersionedExecutionTarget | null> {
        const tool = await this.loadOwnedOrNativeTool(functionId, userId);
        if (!tool) {
            return null;
        }

        return this.mapToolVersionToExecutionTarget(
            tool,
            tool.currentVersion,
            this.parseVersionNumber(tool.currentVersion.versionTag)
        );
    }

    private async loadOwnedOrNativeTool(toolId: string, userId: string) {
        if (!mongoose.Types.ObjectId.isValid(toolId)) {
            return null;
        }

        return UserTool.findOne({
            _id: toolId,
            $or: [
                ...buildGlobalToolClauses(),
                buildOwnedToolClause(userId)
            ]
        }).lean();
    }

    private mapToolVersionToExecutionTarget(
        tool: Awaited<ReturnType<SandboxService['loadOwnedOrNativeTool']>> extends infer T ? NonNullable<T> : never,
        version: IUserToolVersion,
        versionNumber: number
    ): VersionedExecutionTarget {
        return {
            _id: tool._id,
            name: tool.name,
            language: tool.runtime,
            origin: tool.scopeType === 'native' ? 'native' : 'custom',
            workflowId: tool.workflowId,
            codePath: version.sourcePath ?? undefined,
            codeInline: version.sourceInline ?? undefined,
            dependencies: tool.dependencies,
            version: versionNumber,
            toolVersionTag: version.versionTag,
            toolContentHash: version.contentHash,
            toolBuildStatus: version.buildStatus,
            policySnapshot: tool.policy,
            isEnabled: tool.isEnabled,
        };
    }

    private parseVersionNumber(versionTag?: string): number {
        if (!versionTag) {
            return 1;
        }

        const match = versionTag.match(/(\d+)/);
        return match ? Number.parseInt(match[1], 10) : 1;
    }

    private normalizeVersionAlias(versionTag?: string): string | null {
        if (typeof versionTag !== 'string') {
            return null;
        }

        const normalized = versionTag.trim().toLowerCase();
        if (!normalized) {
            return null;
        }

        const withoutPrefix = normalized.startsWith('v') ? normalized.slice(1) : normalized;
        const simpleMajor = withoutPrefix.match(/^(\d+)(?:\.0+)*$/);
        if (simpleMajor) {
            return simpleMajor[1];
        }

        return withoutPrefix;
    }

    private findMatchingToolVersion(
        versions: IUserToolVersion[],
        requestedVersionTag?: string,
        requestedVersionNumber?: number
    ) {
        if (!requestedVersionTag && !requestedVersionNumber) {
            return null;
        }

        const exactMatch = requestedVersionTag
            ? versions.find((version) => version.versionTag === requestedVersionTag)
            : undefined;
        if (exactMatch) {
            return exactMatch;
        }

        const normalizedRequestedTag = this.normalizeVersionAlias(requestedVersionTag);
        if (normalizedRequestedTag) {
            const aliasMatch = versions.find((version) => this.normalizeVersionAlias(version.versionTag) === normalizedRequestedTag);
            if (aliasMatch) {
                return aliasMatch;
            }
        }

        if (Number.isFinite(requestedVersionNumber)) {
            return versions.find((version) => this.parseVersionNumber(version.versionTag) === requestedVersionNumber);
        }

        return null;
    }

    /**
     * Vérifie la syntaxe d'un snippet de code sans l'exécuter.
     */
    async checkSyntax(
        language: 'python' | 'typescript',
        code: string
    ): Promise<SyntaxCheckResult> {
        return this.executionOrchestrator.checkSyntax(language, code);
    }

}
