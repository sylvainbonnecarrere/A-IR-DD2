import { promises as fs } from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import type { IUserToolRun, IUserToolRunArtifact } from '../models/UserToolRun.model';
import { UserToolRun } from '../models/UserToolRun.model';
import { FunctionService } from './function.service';
import { UserToolQueryService } from './userToolQuery.service';
import { createWorkspaceManager } from './workspace/WorkspaceManager';

export interface FunctionRunReadModel {
    executionId: string;
    status: IUserToolRun['status'];
    runtime: IUserToolRun['runtime'];
    runner: IUserToolRun['runner'];
    launchContext: IUserToolRun['launchContext'];
    createdAt: Date;
    updatedAt: Date;
    timing: IUserToolRun['timing'];
    error?: IUserToolRun['error'] | null;
    outputs?: Pick<NonNullable<IUserToolRun['outputs']>, 'stdout' | 'stderr' | 'artifacts'> | null;
    resourceUsage?: IUserToolRun['resourceUsage'];
}

export interface FunctionRunListResult {
    items: FunctionRunReadModel[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
        status?: IUserToolRun['status'];
        sortBy: 'createdAt' | 'durationMs' | 'status';
        sortOrder: 'asc' | 'desc';
    };
}

export interface ArtifactPreviewReadModel {
    executionId: string;
    artifact: IUserToolRunArtifact & {
        sizeBytes: number;
        previewable: boolean;
        truncated: boolean;
        contentType: string;
        textContent?: string;
        jsonContent?: unknown;
    };
}

export interface ArtifactFileReadModel {
    executionId: string;
    artifact: IUserToolRunArtifact & {
        absolutePath: string;
        fileName: string;
        contentType: string;
        sizeBytes: number;
    };
}

export class UserToolRunQueryService {
    private readonly functionService = new FunctionService();
    private readonly userToolQueryService = new UserToolQueryService();
    private readonly workspaceManager = createWorkspaceManager();

    async listRuns(
        ownerUserId: string,
        options: {
            workflowId?: string;
            toolId?: string;
            agentInstanceId?: string;
            limit?: number;
            page?: number;
            status?: IUserToolRun['status'];
            sortBy?: 'createdAt' | 'durationMs' | 'status';
            sortOrder?: 'asc' | 'desc';
        } = {}
    ): Promise<FunctionRunListResult> {
        const query: Record<string, unknown> = {
            ownerUserId: new mongoose.Types.ObjectId(ownerUserId)
        };

        if (options.workflowId && mongoose.Types.ObjectId.isValid(options.workflowId)) {
            query.workflowId = new mongoose.Types.ObjectId(options.workflowId);
        }

        if (options.toolId && mongoose.Types.ObjectId.isValid(options.toolId)) {
            query.toolId = new mongoose.Types.ObjectId(options.toolId);
        }

        if (options.agentInstanceId && mongoose.Types.ObjectId.isValid(options.agentInstanceId)) {
            query.agentInstanceId = new mongoose.Types.ObjectId(options.agentInstanceId);
        }

        if (options.status) {
            query.status = options.status;
        }

        return this.buildRunListResult(query, options);
    }

    async listRunsForFunction(
        functionId: string,
        ownerUserId: string,
        options: {
            limit?: number;
            page?: number;
            status?: IUserToolRun['status'];
            sortBy?: 'createdAt' | 'durationMs' | 'status';
            sortOrder?: 'asc' | 'desc';
        } = {}
    ): Promise<FunctionRunListResult | null> {
        const fn = await this.functionService.getFunctionById(functionId, ownerUserId);
        if (!fn) {
            return null;
        }

        const query: Record<string, unknown> = {
            ownerUserId: new mongoose.Types.ObjectId(ownerUserId),
            toolId: new mongoose.Types.ObjectId(functionId)
        };

        if (options.status) {
            query.status = options.status;
        }

        return this.buildRunListResult(query, options);
    }

    async listRunsForTool(
        toolId: string,
        ownerUserId: string,
        options: {
            limit?: number;
            page?: number;
            status?: IUserToolRun['status'];
            sortBy?: 'createdAt' | 'durationMs' | 'status';
            sortOrder?: 'asc' | 'desc';
        } = {}
    ): Promise<FunctionRunListResult | null> {
        const tool = await this.userToolQueryService.getToolById(toolId, ownerUserId);
        if (!tool) {
            return null;
        }

        const query: Record<string, unknown> = {
            ownerUserId: new mongoose.Types.ObjectId(ownerUserId),
            toolId: new mongoose.Types.ObjectId(toolId)
        };

        if (options.status) {
            query.status = options.status;
        }

        return this.buildRunListResult(query, options);
    }

    async getRunByExecutionId(
        ownerUserId: string,
        executionId: string,
        options: {
            toolId?: string;
        } = {}
    ): Promise<FunctionRunReadModel | null> {
        const query: Record<string, unknown> = {
            executionId,
            ownerUserId: new mongoose.Types.ObjectId(ownerUserId)
        };

        if (options.toolId && mongoose.Types.ObjectId.isValid(options.toolId)) {
            query.toolId = new mongoose.Types.ObjectId(options.toolId);
        }

        const run = await UserToolRun.findOne(query).lean<IUserToolRun>();
        if (!run) {
            return null;
        }

        return this.mapRunToReadModel(run);
    }

    private async buildRunListResult(
        query: Record<string, unknown>,
        options: {
            limit?: number;
            page?: number;
            status?: IUserToolRun['status'];
            sortBy?: 'createdAt' | 'durationMs' | 'status';
            sortOrder?: 'asc' | 'desc';
        }
    ): Promise<FunctionRunListResult> {
        const limit = options.limit ?? 20;
        const page = options.page ?? 1;
        const sortBy = options.sortBy ?? 'createdAt';
        const sortOrder = options.sortOrder ?? 'desc';

        const allRuns = await UserToolRun.find(query)
            .sort(sortBy === 'createdAt' ? { createdAt: sortOrder === 'asc' ? 1 : -1 } : { createdAt: -1 })
            .lean<IUserToolRun[]>();

        const sortedRuns = this.sortRuns(allRuns, sortBy, sortOrder);
        const total = sortedRuns.length;
        const totalPages = Math.max(1, Math.ceil(total / limit));
        const normalizedPage = Math.min(page, totalPages);
        const skip = (normalizedPage - 1) * limit;
        const runs = sortedRuns.slice(skip, skip + limit);

        return {
            items: runs.map((run) => this.mapRunToReadModel(run)),
            pagination: {
                page: normalizedPage,
                limit,
                total,
                totalPages,
                status: options.status,
                sortBy,
                sortOrder
            }
        };
    }

    private mapRunToReadModel(run: IUserToolRun): FunctionRunReadModel {
        return {
            executionId: run.executionId,
            status: run.status,
            runtime: run.runtime,
            runner: run.runner,
            launchContext: run.launchContext,
            createdAt: run.createdAt,
            updatedAt: run.updatedAt,
            timing: run.timing,
            error: run.error
                ? {
                    code: run.error.code,
                    subsystem: run.error.subsystem,
                    failureKind: run.error.failureKind,
                    message: run.error.message,
                    retryable: run.error.retryable
                }
                : null,
            outputs: run.outputs
                ? {
                    stdout: run.outputs.stdout,
                    stderr: run.outputs.stderr,
                    artifacts: run.outputs.artifacts
                }
                : null,
            resourceUsage: run.resourceUsage
        };
    }

    private sortRuns(
        runs: IUserToolRun[],
        sortBy: 'createdAt' | 'durationMs' | 'status',
        sortOrder: 'asc' | 'desc'
    ): IUserToolRun[] {
        if (sortBy === 'createdAt') {
            return runs;
        }

        const direction = sortOrder === 'asc' ? 1 : -1;
        const statusRank: Record<IUserToolRun['status'], number> = {
            queued: 0,
            running: 1,
            completed: 2,
            failed: 3,
            timed_out: 4,
            stopped: 5
        };

        return [...runs].sort((left, right) => {
            if (sortBy === 'durationMs') {
                const leftValue = left.timing.durationMs ?? -1;
                const rightValue = right.timing.durationMs ?? -1;
                if (leftValue === rightValue) {
                    return right.createdAt.getTime() - left.createdAt.getTime();
                }

                return (leftValue - rightValue) * direction;
            }

            const leftValue = statusRank[left.status] ?? Number.MAX_SAFE_INTEGER;
            const rightValue = statusRank[right.status] ?? Number.MAX_SAFE_INTEGER;
            if (leftValue === rightValue) {
                return right.createdAt.getTime() - left.createdAt.getTime();
            }

            return (leftValue - rightValue) * direction;
        });
    }

    async getArtifactPreview(
        functionId: string,
        ownerUserId: string,
        executionId: string,
        artifactPath: string
    ): Promise<ArtifactPreviewReadModel | null> {
        this.validateArtifactPathFormat(artifactPath);

        const fn = await this.functionService.getFunctionById(functionId, ownerUserId);
        if (!fn) {
            return null;
        }

        const run = await UserToolRun.findOne({
            executionId,
            ownerUserId: new mongoose.Types.ObjectId(ownerUserId),
            toolId: new mongoose.Types.ObjectId(functionId)
        }).lean<IUserToolRun>();

        if (!run) {
            return null;
        }

        const declaredArtifact = run.outputs?.artifacts?.find((artifact) => artifact.path === artifactPath);
        if (!declaredArtifact) {
            return null;
        }

        if (!run.workflowId) {
            throw new Error('Artifact preview is only available for workflow-scoped runs.');
        }

        const workspace = await this.workspaceManager.getWorkspace({
            ownerUserId,
            scopeType: 'workflow',
            scopeId: run.workflowId.toString()
        });

        if (!workspace) {
            throw new Error('Workspace introuvable pour ce run.');
        }

        const resolvedArtifactPath = this.resolveArtifactPath(workspace.runtimeRoots.outputRoot, artifactPath);
        const stats = await fs.stat(resolvedArtifactPath);
        const maxPreviewBytes = 256_000;
        const raw = await fs.readFile(resolvedArtifactPath);
        const truncated = raw.byteLength > maxPreviewBytes;
        const previewBuffer = truncated ? raw.subarray(0, maxPreviewBytes) : raw;
        const contentType = this.getContentType(declaredArtifact, resolvedArtifactPath);
        const previewable = this.isPreviewable(declaredArtifact, resolvedArtifactPath);

        const artifact: ArtifactPreviewReadModel['artifact'] = {
            ...declaredArtifact,
            sizeBytes: stats.size,
            previewable,
            truncated,
            contentType
        };

        if (previewable) {
            const textContent = previewBuffer.toString('utf-8');
            artifact.textContent = textContent;
            if (declaredArtifact.kind === 'json') {
                try {
                    artifact.jsonContent = JSON.parse(textContent);
                } catch {
                    artifact.jsonContent = undefined;
                }
            }
        }

        return {
            executionId: run.executionId,
            artifact
        };
    }

    async getArtifactPreviewForTool(
        toolId: string,
        ownerUserId: string,
        executionId: string,
        artifactPath: string
    ): Promise<ArtifactPreviewReadModel | null> {
        const resolved = await this.resolveArtifactContextForTool(toolId, ownerUserId, executionId, artifactPath);
        if (!resolved) {
            return null;
        }

        const stats = await fs.stat(resolved.absolutePath);
        const maxPreviewBytes = 256_000;
        const raw = await fs.readFile(resolved.absolutePath);
        const truncated = raw.byteLength > maxPreviewBytes;
        const previewBuffer = truncated ? raw.subarray(0, maxPreviewBytes) : raw;
        const contentType = this.getContentType(resolved.artifact, resolved.absolutePath);
        const previewable = this.isPreviewable(resolved.artifact, resolved.absolutePath);

        const artifact: ArtifactPreviewReadModel['artifact'] = {
            ...resolved.artifact,
            sizeBytes: stats.size,
            previewable,
            truncated,
            contentType
        };

        if (previewable) {
            const textContent = previewBuffer.toString('utf-8');
            artifact.textContent = textContent;
            if (resolved.artifact.kind === 'json') {
                try {
                    artifact.jsonContent = JSON.parse(textContent);
                } catch {
                    artifact.jsonContent = undefined;
                }
            }
        }

        return {
            executionId: resolved.run.executionId,
            artifact
        };
    }

    async getArtifactFile(
        functionId: string,
        ownerUserId: string,
        executionId: string,
        artifactPath: string
    ): Promise<ArtifactFileReadModel | null> {
        const resolved = await this.resolveArtifactContext(functionId, ownerUserId, executionId, artifactPath);
        if (!resolved) {
            return null;
        }

        const stats = await fs.stat(resolved.absolutePath);

        return {
            executionId: resolved.run.executionId,
            artifact: {
                ...resolved.artifact,
                absolutePath: resolved.absolutePath,
                fileName: path.basename(resolved.absolutePath),
                contentType: this.getContentType(resolved.artifact, resolved.absolutePath),
                sizeBytes: stats.size
            }
        };
    }

    async getArtifactFileForTool(
        toolId: string,
        ownerUserId: string,
        executionId: string,
        artifactPath: string
    ): Promise<ArtifactFileReadModel | null> {
        const resolved = await this.resolveArtifactContextForTool(toolId, ownerUserId, executionId, artifactPath);
        if (!resolved) {
            return null;
        }

        const stats = await fs.stat(resolved.absolutePath);

        return {
            executionId: resolved.run.executionId,
            artifact: {
                ...resolved.artifact,
                absolutePath: resolved.absolutePath,
                fileName: path.basename(resolved.absolutePath),
                contentType: this.getContentType(resolved.artifact, resolved.absolutePath),
                sizeBytes: stats.size
            }
        };
    }

    private async resolveArtifactContext(
        functionId: string,
        ownerUserId: string,
        executionId: string,
        artifactPath: string
    ): Promise<{ run: IUserToolRun; artifact: IUserToolRunArtifact; absolutePath: string } | null> {
        this.validateArtifactPathFormat(artifactPath);

        const fn = await this.functionService.getFunctionById(functionId, ownerUserId);
        if (!fn) {
            return null;
        }

        const run = await UserToolRun.findOne({
            executionId,
            ownerUserId: new mongoose.Types.ObjectId(ownerUserId),
            toolId: new mongoose.Types.ObjectId(functionId)
        }).lean<IUserToolRun>();

        if (!run) {
            return null;
        }

        const declaredArtifact = run.outputs?.artifacts?.find((artifact) => artifact.path === artifactPath);
        if (!declaredArtifact) {
            return null;
        }

        if (!run.workflowId) {
            throw new Error('Artifact preview is only available for workflow-scoped runs.');
        }

        const workspace = await this.workspaceManager.getWorkspace({
            ownerUserId,
            scopeType: 'workflow',
            scopeId: run.workflowId.toString()
        });

        if (!workspace) {
            throw new Error('Workspace introuvable pour ce run.');
        }

        return {
            run,
            artifact: declaredArtifact,
            absolutePath: this.resolveArtifactPath(workspace.runtimeRoots.outputRoot, artifactPath)
        };
    }

    private async resolveArtifactContextForTool(
        toolId: string,
        ownerUserId: string,
        executionId: string,
        artifactPath: string
    ): Promise<{ run: IUserToolRun; artifact: IUserToolRunArtifact; absolutePath: string } | null> {
        this.validateArtifactPathFormat(artifactPath);

        const tool = await this.userToolQueryService.getToolById(toolId, ownerUserId);
        if (!tool) {
            return null;
        }

        const run = await UserToolRun.findOne({
            executionId,
            ownerUserId: new mongoose.Types.ObjectId(ownerUserId),
            toolId: new mongoose.Types.ObjectId(toolId)
        }).lean<IUserToolRun>();

        if (!run) {
            return null;
        }

        const declaredArtifact = run.outputs?.artifacts?.find((artifact) => artifact.path === artifactPath);
        if (!declaredArtifact) {
            return null;
        }

        if (!run.workflowId) {
            throw new Error('Artifact preview is only available for workflow-scoped runs.');
        }

        const workspace = await this.workspaceManager.getWorkspace({
            ownerUserId,
            scopeType: 'workflow',
            scopeId: run.workflowId.toString()
        });

        if (!workspace) {
            throw new Error('Workspace introuvable pour ce run.');
        }

        return {
            run,
            artifact: declaredArtifact,
            absolutePath: this.resolveArtifactPath(workspace.runtimeRoots.outputRoot, artifactPath)
        };
    }

    private resolveArtifactPath(outputRoot: string, artifactPath: string): string {
        const normalizedArtifactPath = this.validateArtifactPathFormat(artifactPath);
        const relativePath = normalizedArtifactPath.slice('output/'.length);

        const resolvedOutputRoot = path.resolve(outputRoot);
        const resolvedArtifactPath = path.resolve(resolvedOutputRoot, relativePath);
        const relativeToRoot = path.relative(resolvedOutputRoot, resolvedArtifactPath);
        if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
            throw new Error('Artifact path escapes output root.');
        }

        return resolvedArtifactPath;
    }

    private validateArtifactPathFormat(artifactPath: string): string {
        const normalizedArtifactPath = artifactPath.replace(/\\/g, '/');
        if (!normalizedArtifactPath.startsWith('output/')) {
            throw new Error('Artifact path must be rooted under output/.');
        }

        const relativePath = normalizedArtifactPath.slice('output/'.length);
        if (!relativePath || relativePath.includes('..')) {
            throw new Error('Artifact path is invalid.');
        }

        return normalizedArtifactPath;
    }

    private isPreviewable(artifact: IUserToolRunArtifact, absolutePath: string): boolean {
        if (artifact.kind === 'json' || artifact.kind === 'log') {
            return true;
        }

        return /\.(txt|md|json|log|ya?ml|csv|xml|html|css|js|ts|py)$/i.test(absolutePath);
    }

    private getContentType(artifact: IUserToolRunArtifact, absolutePath: string): string {
        if (artifact.kind === 'json' || absolutePath.endsWith('.json')) {
            return 'application/json';
        }

        if (artifact.kind === 'log' || /\.(log|txt|md)$/i.test(absolutePath)) {
            return 'text/plain; charset=utf-8';
        }

        if (/\.(html)$/i.test(absolutePath)) {
            return 'text/html; charset=utf-8';
        }

        if (/\.(csv)$/i.test(absolutePath)) {
            return 'text/csv; charset=utf-8';
        }

        return 'application/octet-stream';
    }
}