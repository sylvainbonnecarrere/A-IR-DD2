import mongoose from 'mongoose';
import { UserTool } from '../models/UserTool.model';
import { BuildPreparationError, BuildService } from './build.service';
import { NativePythonProvisioningService } from './nativePythonProvisioning.service';
import { RuntimeHealthService } from './runtimeHealth.service';
import { ExecutionOrchestrator, type QueuedRunAcknowledgement } from './runtime/ExecutionOrchestrator';
import type { ExecutionFunctionRef, SandboxExecutionMetadata, SandboxExecutionResourceUsage, SandboxSyntaxCheckResult } from './runtime/execution.types';
import { getSandboxErrorDetailsFromExecutionResult, RuntimeNotReadyError, type SandboxErrorDetails } from './runtime/errors';
import type { IUserToolPolicy, IUserToolVersion } from '../models/UserTool.model';
import { UserToolRun } from '../models/UserToolRun.model';
import { UserToolRunService } from './userToolRun.service';
import { buildGlobalToolClauses, buildOwnedToolClause } from '../utils/sharedExampleAccess';

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
        const fn = await this.resolveExecutionTarget(functionId, userId, toolSelection);
        await this.prepareResolvedExecutionTarget(fn, userId, functionId, toolSelection);
        await this.ensureRuntimeReadyForRun(fn.language);

        const executionResult = await this.executionOrchestrator.execute({
            fn,
            userId,
            args: testArgs,
            agentInstanceId,
            privateContext,
            launchContext: agentInstanceId ? 'workflow_run' : 'editor_test',
            idempotencyKey,
        });

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
        launchContext?: 'editor_test' | 'workflow_run' | 'system_validation';
    }): Promise<QueuedRunAcknowledgement> {
        const fn = await this.resolveExecutionTarget(input.functionId, input.userId, input.toolSelection);
        return this.executionOrchestrator.enqueue({
            fn,
            userId: input.userId,
            args: input.testArgs ?? {},
            agentInstanceId: input.agentInstanceId,
            privateContext: input.privateContext,
            launchContext: input.launchContext ?? (input.agentInstanceId ? 'workflow_run' : 'editor_test'),
            idempotencyKey: input.idempotencyKey,
            retryOfExecutionId: input.retryOfExecutionId,
        }, async () => {
            await this.prepareResolvedExecutionTarget(fn, input.userId, input.functionId, input.toolSelection);
        });
    }

    async cancelRun(executionId: string, userId: string) {
        return this.executionOrchestrator.requestCancellation(executionId, userId);
    }

    async retryRun(executionId: string, userId: string, idempotencyKey: string): Promise<QueuedRunAcknowledgement> {
        const ownerUserId = new mongoose.Types.ObjectId(userId);
        const parentRun = await UserToolRun.findOne({ executionId, ownerUserId }).select('+privateContextCiphertext');
        if (!parentRun) {
            const error = new Error('Run introuvable');
            Object.assign(error, { statusCode: 404, code: 'RUN_NOT_FOUND' });
            throw error;
        }

        const isRetryableTerminal = ['failed', 'timed_out'].includes(parentRun.status)
            && parentRun.error?.retryable === true;
        if (!isRetryableTerminal) {
            const error = new Error('Ce run terminal ne peut pas être relancé');
            Object.assign(error, { statusCode: 409, code: 'RUN_NOT_RETRYABLE' });
            throw error;
        }

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
            launchContext: parentRun.launchContext,
        });
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
            throw new Error(`Version de tool introuvable pour '${tool.name}' (${requestedVersionTag})`);
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

    private async ensureRuntimeReadyForRun(language: 'python' | 'typescript'): Promise<void> {
        const { report, readiness } = await this.executionOrchestrator.getPreferredRunnerReadiness(language);

        if (!readiness.ready) {
            throw new RuntimeNotReadyError(readiness.reason ?? report.summary);
        }
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
