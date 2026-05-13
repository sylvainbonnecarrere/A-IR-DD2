import path from 'path';
import mongoose from 'mongoose';
import { AgentPrototype } from '../models/AgentPrototype.model';
import { UserToolQueryService, type ToolTransitionReadModel } from './userToolQuery.service';
import type { LegacyFunctionReadModel as FunctionReadModel } from '../types/legacyFunctionReadModel';
import { isSharedCustomFunctionName } from '../utils/sharedExampleAccess';

interface LegacyFunctionFilter {
    workflowId?: string;
    origin?: 'native' | 'custom';
    language?: 'python' | 'typescript';
    isEnabled?: boolean;
}

interface TargetToolFilter {
    workflowId?: string;
    runtime?: 'python' | 'typescript';
    isEnabled?: boolean;
    status?: 'draft' | 'ready' | 'disabled' | 'deprecated';
}

export class ToolReadAdapterService {
    private readonly userToolQueryService = new UserToolQueryService();

    async listLegacyFunctions(ownerUserId: string, filters: LegacyFunctionFilter = {}): Promise<FunctionReadModel[]> {
        const tools = await this.userToolQueryService.listTools(ownerUserId, {
            workflowId: filters.workflowId,
            runtime: filters.language,
            isEnabled: filters.isEnabled,
            status: undefined
        });

        const filteredTools = filters.origin
            ? tools.filter((tool) => tool.origin === filters.origin)
            : tools;

        return this.mapToolsToLegacyFunctions(ownerUserId, filteredTools);
    }

    async getLegacyFunctionById(functionId: string, ownerUserId: string): Promise<FunctionReadModel | null> {
        const tool = await this.userToolQueryService.getToolById(functionId, ownerUserId);
        if (!tool) {
            return null;
        }

        const [mapped] = await this.mapToolsToLegacyFunctions(ownerUserId, [tool]);
        return mapped ?? null;
    }

    async getLegacyFunctionsForAgent(agentId: string, ownerUserId: string): Promise<FunctionReadModel[]> {
        if (!mongoose.Types.ObjectId.isValid(agentId)) {
            return [];
        }

        const prototype = await AgentPrototype.findOne({
            _id: new mongoose.Types.ObjectId(agentId),
            userId: new mongoose.Types.ObjectId(ownerUserId)
        }).lean();

        const toolIds = Array.isArray(prototype?.tools)
            ? prototype.tools.map((toolId: any) => toolId?.toString?.() ?? String(toolId))
            : [];

        if (toolIds.length === 0) {
            return [];
        }

        const tools = await this.userToolQueryService.listToolsByIds(ownerUserId, toolIds);
        return this.mapToolsToLegacyFunctions(ownerUserId, tools);
    }

    async listTools(ownerUserId: string, filters: TargetToolFilter = {}): Promise<ToolTransitionReadModel[]> {
        return this.userToolQueryService.listTools(ownerUserId, filters);
    }

    async getToolById(toolId: string, ownerUserId: string): Promise<ToolTransitionReadModel | null> {
        return this.userToolQueryService.getToolById(toolId, ownerUserId);
    }

    private async mapToolsToLegacyFunctions(ownerUserId: string, tools: ToolTransitionReadModel[]): Promise<FunctionReadModel[]> {
        if (tools.length === 0) {
            return [];
        }

        return tools.map((tool) => {
            const runtimeDependencies = tool.runtime === 'python'
                ? tool.dependencies?.python ?? []
                : tool.dependencies?.npm ?? [];
            const versionFromTag = this.parseLegacyVersion(tool.currentVersion?.versionTag);
            const codePath = tool.currentVersion?.sourcePath ?? null;
            const userId = tool.origin === 'native' || (tool.isReadonly && isSharedCustomFunctionName(tool.name))
                ? null
                : ownerUserId;

            const legacyReadModel = {
                _id: tool.id,
                name: tool.name,
                displayName: tool.displayName,
                description: tool.description,
                language: tool.runtime,
                origin: tool.origin,
                userId,
                workflowId: tool.workflowId ?? null,
                inputSchema: tool.inputSchema,
                outputSchema: tool.outputSchema,
                codePath,
                resolvedCodePath: this.resolveCodePath(codePath, tool),
                codePathRoot: this.resolveCodePathRoot(codePath, tool),
                codeInline: tool.currentVersion?.sourceInline ?? null,
                dependencies: runtimeDependencies,
                isEnabled: tool.isEnabled,
                isReadonly: tool.isReadonly,
                version: versionFromTag,
                tags: tool.tags,
                workspaceContext: tool.workspaceContext,
                createdAt: tool.createdAt,
                updatedAt: tool.updatedAt
            };

            return legacyReadModel as unknown as FunctionReadModel;
        });
    }

    private parseLegacyVersion(versionTag?: string | null): number {
        if (!versionTag) {
            return 1;
        }

        const match = versionTag.match(/(\d+)/);
        return match ? Number.parseInt(match[1], 10) : 1;
    }

    private resolveCodePath(codePath: string | null | undefined, tool: ToolTransitionReadModel): string | null {
        if (!codePath) {
            return null;
        }

        if (path.isAbsolute(codePath)) {
            return codePath;
        }

        if (tool.origin === 'native') {
            return codePath;
        }

        if (tool.workspaceContext) {
            return path.resolve(tool.workspaceContext.runtimeRoots.sourceRoot, codePath);
        }

        return codePath;
    }

    private resolveCodePathRoot(codePath: string | null | undefined, tool: ToolTransitionReadModel): FunctionReadModel['codePathRoot'] {
        if (!codePath) {
            return null;
        }

        if (path.isAbsolute(codePath)) {
            return 'absolute';
        }

        if (tool.origin === 'native') {
            return 'native_repo';
        }

        if (tool.workspaceContext) {
            return 'workspace_source';
        }

        return 'legacy_relative';
    }
}