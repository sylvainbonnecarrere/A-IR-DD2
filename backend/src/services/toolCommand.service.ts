import { createHash } from 'crypto';
import mongoose from 'mongoose';
import {
    UserTool,
    type IUserTool,
    type IUserToolDependencies,
    type IUserToolPolicy,
    type IUserToolVersion,
} from '../models/UserTool.model';
import { buildGlobalToolClauses, buildOwnedToolClause } from '../utils/sharedExampleAccess';
import { ToolReadAdapterService } from './toolReadAdapter.service';
import type { ToolTransitionReadModel } from './userToolQuery.service';

type ToolRuntime = 'python' | 'typescript';

const DEFAULT_VERSION_TAG = '1';
const DEFAULT_CUSTOM_POLICY: IUserToolPolicy = {
    networkMode: 'none',
    writablePaths: [],
    secretAliases: [],
};

export interface CreateToolCommandInput {
    name: string;
    description: string;
    language?: ToolRuntime;
    runtime?: ToolRuntime;
    workflowId?: string | null;
    inputSchema?: object;
    outputSchema?: object;
    codeInline?: string | null;
    dependencies?: string[];
    tags?: string[];
}

export interface UpdateToolCommandInput extends Partial<Omit<CreateToolCommandInput, 'name'>> {}

export class ToolCommandService {
    private readonly toolReadAdapterService = new ToolReadAdapterService();

    async createTool(ownerUserId: string, data: CreateToolCommandInput): Promise<ToolTransitionReadModel> {
        const ownerObjectId = new mongoose.Types.ObjectId(ownerUserId);
        const runtime = this.resolveLanguage(data);
        const dependencies = this.normalizeDependencies(data.dependencies, runtime);
        const currentVersion = this.buildVersionPayload({
            name: data.name,
            runtime,
            codeInline: data.codeInline ?? null,
            dependencies,
            versionTag: DEFAULT_VERSION_TAG,
            createdBy: ownerObjectId,
        });

        const created = await UserTool.create({
            ownerUserId: ownerObjectId,
            workspaceId: null,
            scopeType: 'user',
            workflowId: this.resolveWorkflowId(data.workflowId),
            name: data.name,
            description: data.description,
            runtime,
            status: 'ready',
            trustLevel: 'user_private',
            currentVersion,
            versions: [currentVersion],
            inputSchema: data.inputSchema ?? {},
            outputSchema: data.outputSchema ?? {},
            tags: Array.isArray(data.tags) ? data.tags : [],
            dependencies,
            policy: { ...DEFAULT_CUSTOM_POLICY },
            isReadonly: false,
            isEnabled: true,
        });

        return this.requireToolById(created._id.toString(), ownerUserId);
    }

    async updateTool(
        toolId: string,
        ownerUserId: string,
        data: UpdateToolCommandInput
    ): Promise<ToolTransitionReadModel | null> {
        const existing = await this.findOwnedMutableTool(toolId, ownerUserId);
        if (!existing) {
            return null;
        }

        const runtime = data.language || data.runtime
            ? this.resolveLanguage(data)
            : existing.runtime;
        const dependencies = this.normalizeDependencies(data.dependencies, runtime, existing.dependencies);
        const nextVersion = this.buildVersionPayload({
            name: existing.name,
            runtime,
            codeInline: data.codeInline !== undefined ? data.codeInline ?? null : existing.currentVersion.sourceInline ?? null,
            dependencies,
            versionTag: existing.currentVersion?.versionTag || DEFAULT_VERSION_TAG,
            createdBy: existing.currentVersion?.createdBy ?? existing.ownerUserId ?? null,
            createdAt: existing.currentVersion?.createdAt,
            existingVersion: existing.currentVersion,
            existingVersions: existing.versions,
        });

        await UserTool.updateOne(
            { _id: existing._id },
            {
                $set: {
                    description: data.description ?? existing.description,
                    runtime,
                    workflowId: data.workflowId !== undefined
                        ? this.resolveWorkflowId(data.workflowId)
                        : (existing.workflowId ?? null),
                    inputSchema: data.inputSchema ?? existing.inputSchema,
                    outputSchema: data.outputSchema ?? existing.outputSchema,
                    tags: data.tags ?? existing.tags,
                    dependencies,
                    currentVersion: nextVersion,
                    versions: [nextVersion],
                    status: existing.isEnabled ? 'ready' : 'disabled',
                }
            },
            { runValidators: true }
        );

        return this.requireToolById(existing._id.toString(), ownerUserId);
    }

    async deleteTool(toolId: string, ownerUserId: string): Promise<boolean> {
        const result = await UserTool.deleteOne({
            _id: new mongoose.Types.ObjectId(toolId),
            ...buildOwnedToolClause(ownerUserId),
            isReadonly: false,
        });

        return result.deletedCount > 0;
    }

    async toggleTool(
        toolId: string,
        ownerUserId: string,
        options?: { allowBashPy?: boolean }
    ): Promise<{ id: string; isEnabled: boolean } | null> {
        const tool = await UserTool.findOne({
            _id: new mongoose.Types.ObjectId(toolId),
            $or: [
                ...buildGlobalToolClauses(),
                buildOwnedToolClause(ownerUserId)
            ]
        });

        if (!tool) {
            return null;
        }

        const wouldEnable = !tool.isEnabled;
        if (tool.name === 'bash_py' && wouldEnable && !options?.allowBashPy) {
            throw new Error('bash_py requiert un consentement explicite (allowBashPy: true)');
        }

        tool.isEnabled = wouldEnable;
        tool.status = wouldEnable ? 'ready' : 'disabled';
        await tool.save();

        return {
            id: tool._id.toString(),
            isEnabled: tool.isEnabled,
        };
    }

    private async requireToolById(toolId: string, ownerUserId: string): Promise<ToolTransitionReadModel> {
        const tool = await this.toolReadAdapterService.getToolById(toolId, ownerUserId);
        if (!tool) {
            throw new Error(`Tool ${toolId} introuvable apres ecriture`);
        }

        return tool;
    }

    private async findOwnedMutableTool(toolId: string, ownerUserId: string): Promise<IUserTool | null> {
        return UserTool.findOne({
            _id: new mongoose.Types.ObjectId(toolId),
            ...buildOwnedToolClause(ownerUserId),
            isReadonly: false,
        });
    }

    private resolveWorkflowId(workflowId?: string | null): mongoose.Types.ObjectId | null {
        if (!workflowId) {
            return null;
        }

        return new mongoose.Types.ObjectId(workflowId);
    }

    private normalizeDependencies(
        dependencies: string[] | undefined,
        runtime: ToolRuntime,
        fallback?: IUserToolDependencies
    ): IUserToolDependencies {
        if (!dependencies) {
            return fallback ?? { npm: [], python: [] };
        }

        return runtime === 'python'
            ? { npm: [], python: dependencies }
            : { npm: dependencies, python: [] };
    }

    private buildVersionPayload(options: {
        name: string;
        runtime: ToolRuntime;
        codeInline: string | null;
        dependencies: IUserToolDependencies;
        versionTag: string;
        createdBy: mongoose.Types.ObjectId | null;
        createdAt?: Date;
        existingVersion?: IUserToolVersion | null;
        existingVersions?: IUserToolVersion[] | null;
    }): IUserToolVersion {
        const contentHash = this.buildContentHash({
            name: options.name,
            runtime: options.runtime,
            codeInline: options.codeInline,
            dependencies: options.dependencies,
            versionTag: options.versionTag,
        });

        const baseVersion: IUserToolVersion = {
            versionTag: options.versionTag,
            contentHash,
            sourceMode: 'inline',
            sourcePath: null,
            sourceInline: options.codeInline,
            entrypoint: null,
            createdAt: options.createdAt ?? new Date(),
            createdBy: options.createdBy,
            buildStatus: 'not_built',
            validationStatus: 'unknown',
        };

        const matchingExistingVersion = options.existingVersions?.find(
            (candidate) => candidate.versionTag === baseVersion.versionTag && candidate.contentHash === baseVersion.contentHash
        );
        const existingVersion = matchingExistingVersion ?? options.existingVersion;

        if (
            existingVersion
            && existingVersion.versionTag === baseVersion.versionTag
            && existingVersion.contentHash === baseVersion.contentHash
        ) {
            return {
                ...baseVersion,
                createdAt: existingVersion.createdAt ?? baseVersion.createdAt,
                createdBy: existingVersion.createdBy ?? baseVersion.createdBy,
                buildStatus: existingVersion.buildStatus ?? baseVersion.buildStatus,
                validationStatus: existingVersion.validationStatus ?? baseVersion.validationStatus,
            };
        }

        return baseVersion;
    }

    private buildContentHash(options: {
        name: string;
        runtime: ToolRuntime;
        codeInline: string | null;
        dependencies: IUserToolDependencies;
        versionTag: string;
    }): string {
        return createHash('sha256')
            .update(JSON.stringify({
                name: options.name,
                runtime: options.runtime,
                sourceMode: 'inline',
                sourcePath: null,
                sourceInline: options.codeInline,
                dependencies: options.dependencies,
                version: options.versionTag,
            }))
            .digest('hex');
    }

    private resolveLanguage(data: Pick<CreateToolCommandInput, 'language' | 'runtime'>): ToolRuntime {
        if (data.language && data.runtime && data.language !== data.runtime) {
            throw new Error('language et runtime doivent etre alignes lorsqu\'ils sont tous les deux fournis');
        }

        const resolved = data.language ?? data.runtime;
        if (!resolved) {
            throw new Error('language ou runtime est requis');
        }

        return resolved;
    }
}

export const toolCommandService = new ToolCommandService();