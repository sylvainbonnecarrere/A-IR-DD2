import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { UserToolRun, type IUserToolRun } from '../models/UserToolRun.model';
import { MongoWorkspaceLockService, type WorkspaceLock } from './runtime/MongoWorkspaceLockService';
import { UserToolQueryService } from './userToolQuery.service';
import { createWorkspaceManager } from './workspace/WorkspaceManager';

export interface CleanupFunctionRunsOptions {
    retentionDays?: number;
    retainLatest?: number;
    dryRun?: boolean;
}

export interface CleanupFunctionRunsResult {
    deletedRuns: number;
    deletedArtifacts: string[];
    retainedRuns: number;
    dryRun: boolean;
    cutoffDate?: Date;
}

export class UserToolRunRetentionService {
    private readonly userToolQueryService = new UserToolQueryService();
    private readonly workspaceManager = createWorkspaceManager();
    private readonly workspaceLocks = new MongoWorkspaceLockService();

    async cleanupRunsForFunction(
        functionId: string,
        ownerUserId: string,
        options: CleanupFunctionRunsOptions
    ): Promise<CleanupFunctionRunsResult | null> {
        if (options.retentionDays == null && options.retainLatest == null) {
            throw new Error('At least one retention policy must be provided.');
        }

        const resolvedToolId = await this.resolveToolIdFromFunctionAlias(functionId, ownerUserId);
        if (!resolvedToolId) {
            return null;
        }

        return this.cleanupResolvedToolRuns(resolvedToolId, ownerUserId, options);
    }

    private async resolveToolIdFromFunctionAlias(
        functionId: string,
        ownerUserId: string
    ): Promise<mongoose.Types.ObjectId | null> {
        if (!mongoose.Types.ObjectId.isValid(functionId)) {
            return null;
        }

        const tool = await this.userToolQueryService.getToolById(functionId, ownerUserId);
        if (!tool) {
            return null;
        }

        return new mongoose.Types.ObjectId(tool.id);
    }

    async cleanupRunsForTool(
        toolId: string,
        ownerUserId: string,
        options: CleanupFunctionRunsOptions
    ): Promise<CleanupFunctionRunsResult | null> {
        if (options.retentionDays == null && options.retainLatest == null) {
            throw new Error('At least one retention policy must be provided.');
        }

        const tool = await this.userToolQueryService.getToolById(toolId, ownerUserId);
        if (!tool) {
            return null;
        }

        return this.cleanupResolvedToolRuns(new mongoose.Types.ObjectId(toolId), ownerUserId, options);
    }

    private async cleanupResolvedToolRuns(
        toolId: mongoose.Types.ObjectId,
        ownerUserId: string,
        options: CleanupFunctionRunsOptions,
    ): Promise<CleanupFunctionRunsResult> {
        const ownerId = new mongoose.Types.ObjectId(ownerUserId);
        const runs = await UserToolRun.find({
            ownerUserId: ownerId,
            toolId,
        })
            .select('+supervisedAttempt +workspaceRetentionProtected')
            .sort({ createdAt: -1 })
            .lean<IUserToolRun[]>();

        const retainLatest = options.retainLatest ?? 0;
        const protectedIds = new Set(runs.slice(0, retainLatest).map((run) => run.executionId));
        const cutoffDate = options.retentionDays != null
            ? new Date(Date.now() - options.retentionDays * 24 * 60 * 60 * 1000)
            : undefined;

        const runsToDelete = runs.filter((run) => {
            if (protectedIds.has(run.executionId)
                || !['completed', 'failed', 'stopped', 'timed_out'].includes(run.status)
                || run.workspaceRetentionProtected === true
                || run.supervisedAttempt != null) {
                return false;
            }

            if (cutoffDate) {
                return run.createdAt.getTime() < cutoffDate.getTime();
            }

            return true;
        });

        const heldWorkspaceLocks: WorkspaceLock[] = [];
        const blockedWorkflows = new Set<string>();
        try {
            const workflowIds = Array.from(new Set(
                runsToDelete.flatMap((run) => run.workflowId ? [run.workflowId.toString()] : []),
            )).sort();
            for (const workflowId of workflowIds) {
                const lock = await this.workspaceLocks.tryAcquire(ownerUserId, workflowId, `retention:${randomUUID()}`);
                if (lock) {
                    heldWorkspaceLocks.push(lock);
                } else {
                    blockedWorkflows.add(workflowId);
                }
            }
            const deletableRuns = runsToDelete.filter((run) =>
                !run.workflowId || !blockedWorkflows.has(run.workflowId.toString()),
            );
            const deletedRuns: IUserToolRun[] = [];
            if (options.dryRun) {
                deletedRuns.push(...deletableRuns);
            } else {
                for (const run of deletableRuns) {
                    const deleted = await UserToolRun.findOneAndDelete({
                        _id: run._id,
                        ownerUserId: ownerId,
                        toolId,
                        status: { $in: ['completed', 'failed', 'stopped', 'timed_out'] },
                        workspaceRetentionProtected: { $ne: true },
                        supervisedAttempt: null,
                    }).lean<IUserToolRun>();
                    if (deleted) {
                        deletedRuns.push(deleted);
                    }
                }
            }
            const deletedIds = new Set(deletedRuns.map((run) => run.executionId));
            const workflows = deletedRuns.flatMap((run) => run.workflowId ? [run.workflowId] : []);
            const runsToKeep = options.dryRun
                ? [
                    ...runs.filter((run) => !deletedIds.has(run.executionId)),
                    ...await UserToolRun.find({ ownerUserId: ownerId, toolId: { $ne: toolId }, workflowId: { $in: workflows } }).lean<IUserToolRun[]>(),
                ]
                : await UserToolRun.find({
                    ownerUserId: ownerId,
                    $or: [{ toolId }, { workflowId: { $in: workflows } }],
                }).lean<IUserToolRun[]>();
            const deletedArtifacts = await this.deleteArtifactsForRuns(ownerUserId, deletedRuns, runsToKeep, options.dryRun === true);

            return {
                deletedRuns: deletedRuns.length,
                deletedArtifacts,
                retainedRuns: runs.length - deletedRuns.length,
                dryRun: options.dryRun === true,
                cutoffDate
            };
        } finally {
            const released = await Promise.all(heldWorkspaceLocks.map((lock) => this.workspaceLocks.release(lock)));
            if (released.some((wasReleased) => !wasReleased)) {
                throw new Error('Workspace lock release was not confirmed after run retention');
            }
        }
    }

    private async deleteArtifactsForRuns(
        ownerUserId: string,
        runsToDelete: IUserToolRun[],
        runsToKeep: IUserToolRun[],
        dryRun: boolean
    ): Promise<string[]> {
        const keptArtifacts = new Set(
            runsToKeep.flatMap((run) => (run.outputs?.artifacts ?? []).map((artifact) => `${run.workflowId?.toString() ?? 'none'}:${artifact.path}`))
        );

        const deletedArtifacts: string[] = [];
        const workspaceRoots = new Map<string, string>();

        for (const run of runsToDelete) {
            for (const artifact of run.outputs?.artifacts ?? []) {
                const workflowKey = run.workflowId?.toString() ?? 'none';
                const artifactKey = `${workflowKey}:${artifact.path}`;
                if (keptArtifacts.has(artifactKey) || !run.workflowId) {
                    continue;
                }

                let outputRoot = workspaceRoots.get(workflowKey);
                if (!outputRoot) {
                    const workspace = await this.workspaceManager.getWorkspace({
                        ownerUserId,
                        scopeType: 'workflow',
                        scopeId: workflowKey
                    });

                    if (!workspace) {
                        continue;
                    }

                    outputRoot = workspace.runtimeRoots.outputRoot;
                    workspaceRoots.set(workflowKey, outputRoot);
                }

                const absolutePath = this.resolveArtifactPath(outputRoot, artifact.path);
                deletedArtifacts.push(artifact.path);

                if (!dryRun) {
                    await fs.rm(absolutePath, { force: true });
                }
            }
        }

        return Array.from(new Set(deletedArtifacts));
    }

    private resolveArtifactPath(outputRoot: string, artifactPath: string): string {
        const normalizedArtifactPath = artifactPath.replace(/\\/g, '/');
        if (!normalizedArtifactPath.startsWith('output/')) {
            throw new Error('Artifact path must be rooted under output/.');
        }

        const relativePath = normalizedArtifactPath.slice('output/'.length);
        if (!relativePath || relativePath.includes('..')) {
            throw new Error('Artifact path is invalid.');
        }

        const resolvedOutputRoot = path.resolve(outputRoot);
        const resolvedArtifactPath = path.resolve(resolvedOutputRoot, relativePath);
        const relativeToRoot = path.relative(resolvedOutputRoot, resolvedArtifactPath);
        if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
            throw new Error('Artifact path escapes output root.');
        }

        return resolvedArtifactPath;
    }
}