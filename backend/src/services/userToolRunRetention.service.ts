import { promises as fs } from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { UserToolRun, type IUserToolRun } from '../models/UserToolRun.model';
import { FunctionService } from './function.service';
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
    private readonly functionService = new FunctionService();
    private readonly userToolQueryService = new UserToolQueryService();
    private readonly workspaceManager = createWorkspaceManager();

    async cleanupRunsForFunction(
        functionId: string,
        ownerUserId: string,
        options: CleanupFunctionRunsOptions
    ): Promise<CleanupFunctionRunsResult | null> {
        if (options.retentionDays == null && options.retainLatest == null) {
            throw new Error('At least one retention policy must be provided.');
        }

        const fn = await this.functionService.getFunctionById(functionId, ownerUserId);
        if (!fn) {
            return null;
        }

        const runs = await UserToolRun.find({
            ownerUserId: new mongoose.Types.ObjectId(ownerUserId),
            toolId: new mongoose.Types.ObjectId(functionId)
        })
            .sort({ createdAt: -1 })
            .lean<IUserToolRun[]>();

        const retainLatest = options.retainLatest ?? 0;
        const protectedIds = new Set(runs.slice(0, retainLatest).map((run) => run.executionId));
        const cutoffDate = options.retentionDays != null
            ? new Date(Date.now() - options.retentionDays * 24 * 60 * 60 * 1000)
            : undefined;

        const runsToDelete = runs.filter((run) => {
            if (protectedIds.has(run.executionId)) {
                return false;
            }

            if (cutoffDate) {
                return run.createdAt.getTime() < cutoffDate.getTime();
            }

            return true;
        });

        const runsToKeep = runs.filter((run) => !runsToDelete.some((candidate) => candidate.executionId === run.executionId));
        const deletedArtifacts = await this.deleteArtifactsForRuns(ownerUserId, runsToDelete, runsToKeep, options.dryRun === true);

        if (!options.dryRun && runsToDelete.length > 0) {
            await UserToolRun.deleteMany({
                executionId: { $in: runsToDelete.map((run) => run.executionId) }
            });
        }

        return {
            deletedRuns: runsToDelete.length,
            deletedArtifacts,
            retainedRuns: runs.length - runsToDelete.length,
            dryRun: options.dryRun === true,
            cutoffDate
        };
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

        const runs = await UserToolRun.find({
            ownerUserId: new mongoose.Types.ObjectId(ownerUserId),
            toolId: new mongoose.Types.ObjectId(toolId)
        })
            .sort({ createdAt: -1 })
            .lean<IUserToolRun[]>();

        const retainLatest = options.retainLatest ?? 0;
        const protectedIds = new Set(runs.slice(0, retainLatest).map((run) => run.executionId));
        const cutoffDate = options.retentionDays != null
            ? new Date(Date.now() - options.retentionDays * 24 * 60 * 60 * 1000)
            : undefined;

        const runsToDelete = runs.filter((run) => {
            if (protectedIds.has(run.executionId)) {
                return false;
            }

            if (cutoffDate) {
                return run.createdAt.getTime() < cutoffDate.getTime();
            }

            return true;
        });

        const runsToKeep = runs.filter((run) => !runsToDelete.some((candidate) => candidate.executionId === run.executionId));
        const deletedArtifacts = await this.deleteArtifactsForRuns(ownerUserId, runsToDelete, runsToKeep, options.dryRun === true);

        if (!options.dryRun && runsToDelete.length > 0) {
            await UserToolRun.deleteMany({
                executionId: { $in: runsToDelete.map((run) => run.executionId) }
            });
        }

        return {
            deletedRuns: runsToDelete.length,
            deletedArtifacts,
            retainedRuns: runs.length - runsToDelete.length,
            dryRun: options.dryRun === true,
            cutoffDate
        };
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
                    try {
                        await fs.rm(absolutePath, { force: true });
                    } catch {
                        // Ignore missing or concurrently removed artifacts.
                    }
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