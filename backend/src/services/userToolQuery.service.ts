import mongoose from 'mongoose';
import { UserTool, type IUserTool } from '../models/UserTool.model';
import { createWorkspaceManager } from './workspace/WorkspaceManager';
import type { WorkspaceProvisioningResult } from './workspace/types';
import { buildGlobalToolClauses, buildOwnedToolClause } from '../utils/sharedExampleAccess';

interface ListToolsFilter {
    workflowId?: string;
    runtime?: 'python' | 'typescript';
    isEnabled?: boolean;
    status?: IUserTool['status'];
}

export interface ToolWorkspaceContext {
    workspaceId: string;
    logicalRoot: string;
    runtimeRoots: WorkspaceProvisioningResult['runtimeRoots'];
    manifests: WorkspaceProvisioningResult['manifests'];
    status: WorkspaceProvisioningResult['status'];
    lastScanAt?: Date | null;
}

export interface ToolTransitionReadModel {
    id: string;
    legacyFunctionId: string;
    name: string;
    displayName?: string;
    description: string;
    runtime: IUserTool['runtime'];
    origin: 'native' | 'custom';
    scopeType: IUserTool['scopeType'];
    workflowId?: string | null;
    workspaceId?: string | null;
    status: IUserTool['status'];
    trustLevel: IUserTool['trustLevel'];
    currentVersion: IUserTool['currentVersion'];
    versions: IUserTool['versions'];
    inputSchema: Record<string, unknown>;
    outputSchema: Record<string, unknown>;
    tags: string[];
    dependencies: IUserTool['dependencies'];
    policy: IUserTool['policy'];
    isReadonly: boolean;
    isEnabled: boolean;
    compatibilityAliases: {
        functionId: string;
    };
    readinessStatus?: {
        requirement: 'none' | 'author_build' | 'platform_provision';
        state: 'ready' | 'not_ready' | 'waiting_for_provisioning' | 'waiting_for_build';
        prepared: boolean;
        runnable: boolean;
        dependencyReadiness: 'satisfied' | 'missing' | 'not_required';
        runtimeReady: boolean;
        summary: string;
        actionLabel: string;
    };
    workspaceContext?: ToolWorkspaceContext;
    createdAt: Date;
    updatedAt: Date;
}

export class UserToolQueryService {
    private readonly workspaceManager = createWorkspaceManager();

    async listTools(ownerUserId: string, filters: ListToolsFilter = {}): Promise<ToolTransitionReadModel[]> {
        const userObjectId = new mongoose.Types.ObjectId(ownerUserId);
        const query: Record<string, unknown> = {
            $or: [
                ...buildGlobalToolClauses(),
                buildOwnedToolClause(userObjectId)
            ]
        };

        if (filters.runtime) {
            query.runtime = filters.runtime;
        }

        if (filters.status) {
            query.status = filters.status;
        }

        if (filters.isEnabled !== undefined) {
            query.isEnabled = filters.isEnabled;
        }

        if (filters.workflowId) {
            const workflowObjectId = new mongoose.Types.ObjectId(filters.workflowId);
            query.$or = [
                ...buildGlobalToolClauses(),
                { ...buildOwnedToolClause(userObjectId), workflowId: workflowObjectId },
                { ...buildOwnedToolClause(userObjectId), workflowId: null }
            ];
        }

        const tools = await UserTool.find(query)
            .sort({ scopeType: 1, name: 1 })
            .lean<IUserTool[]>();

        return this.attachWorkspaceContext(ownerUserId, tools);
    }

    async getToolById(toolId: string, ownerUserId: string): Promise<ToolTransitionReadModel | null> {
        if (!mongoose.Types.ObjectId.isValid(toolId)) {
            return null;
        }

        const userObjectId = new mongoose.Types.ObjectId(ownerUserId);
        const tool = await UserTool.findOne({
            _id: new mongoose.Types.ObjectId(toolId),
            $or: [
                ...buildGlobalToolClauses(),
                buildOwnedToolClause(userObjectId)
            ]
        }).lean<IUserTool | null>();

        if (!tool) {
            return null;
        }

        const [resolved] = await this.attachWorkspaceContext(ownerUserId, [tool]);
        return resolved;
    }

    async listToolsByIds(ownerUserId: string, toolIds: string[]): Promise<ToolTransitionReadModel[]> {
        const validIds = toolIds.filter((toolId) => mongoose.Types.ObjectId.isValid(toolId));
        if (validIds.length === 0) {
            return [];
        }

        const userObjectId = new mongoose.Types.ObjectId(ownerUserId);
        const tools = await UserTool.find({
            _id: { $in: validIds.map((toolId) => new mongoose.Types.ObjectId(toolId)) },
            $or: [
                ...buildGlobalToolClauses(),
                buildOwnedToolClause(userObjectId)
            ]
        }).lean<IUserTool[]>();

        const attached = await this.attachWorkspaceContext(ownerUserId, tools);
        const byId = new Map(attached.map((tool) => [tool.id, tool]));
        return validIds.map((toolId) => byId.get(toolId)).filter((tool): tool is ToolTransitionReadModel => Boolean(tool));
    }

    private async attachWorkspaceContext(ownerUserId: string, tools: IUserTool[]): Promise<ToolTransitionReadModel[]> {
        const workflowIds = Array.from(new Set(
            tools
                .filter((tool) => tool.scopeType === 'user' && tool.workflowId)
                .map((tool) => tool.workflowId!.toString())
        ));

        const workspaceByWorkflowId = new Map<string, WorkspaceProvisioningResult>();
        for (const workflowId of workflowIds) {
            const existingWorkspace = await this.workspaceManager.getWorkspace({
                ownerUserId,
                scopeType: 'workflow',
                scopeId: workflowId
            });

            const workspace = existingWorkspace
                ?? await this.workspaceManager.ensureWorkflowWorkspace(ownerUserId, workflowId);

            workspaceByWorkflowId.set(workflowId, workspace);
        }

        return tools.map((tool) => {
            const workflowId = tool.workflowId?.toString() ?? null;
            const workspace = workflowId ? workspaceByWorkflowId.get(workflowId) : undefined;

            return {
                id: tool._id.toString(),
                legacyFunctionId: tool._id.toString(),
                name: tool.name,
                displayName: tool.displayName,
                description: tool.description,
                runtime: tool.runtime,
                origin: tool.scopeType === 'native' ? 'native' : 'custom',
                scopeType: tool.scopeType,
                workflowId,
                workspaceId: tool.workspaceId?.toString() ?? null,
                status: tool.status,
                trustLevel: tool.trustLevel,
                currentVersion: tool.currentVersion,
                versions: tool.versions,
                inputSchema: (tool.inputSchema ?? {}) as Record<string, unknown>,
                outputSchema: (tool.outputSchema ?? {}) as Record<string, unknown>,
                tags: tool.tags ?? [],
                dependencies: tool.dependencies,
                policy: tool.policy,
                isReadonly: tool.isReadonly,
                isEnabled: tool.isEnabled,
                compatibilityAliases: {
                    functionId: tool._id.toString()
                },
                workspaceContext: workspace
                    ? {
                        workspaceId: workspace.workspaceId,
                        logicalRoot: workspace.logicalRoot,
                        runtimeRoots: workspace.runtimeRoots,
                        manifests: workspace.manifests,
                        status: workspace.status,
                        lastScanAt: workspace.lastScanAt ?? null
                    }
                    : undefined,
                createdAt: tool.createdAt,
                updatedAt: tool.updatedAt
            };
        });
    }
}