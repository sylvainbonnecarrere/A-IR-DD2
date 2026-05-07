import { FunctionService, type FunctionReadModel } from './function.service';
import { ToolReadAdapterService } from './toolReadAdapter.service';
import type { ToolTransitionReadModel } from './userToolQuery.service';

type ToolRuntime = 'python' | 'typescript';

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
    private readonly functionService = new FunctionService();
    private readonly toolReadAdapterService = new ToolReadAdapterService();

    async createLegacyFunction(ownerUserId: string, data: CreateToolCommandInput): Promise<FunctionReadModel> {
        return this.functionService.createFunction(ownerUserId, this.normalizeCreateInput(data));
    }

    async createTool(ownerUserId: string, data: CreateToolCommandInput): Promise<ToolTransitionReadModel> {
        const created = await this.createLegacyFunction(ownerUserId, data);
        return this.requireToolById(created._id.toString(), ownerUserId);
    }

    async updateLegacyFunction(
        toolId: string,
        ownerUserId: string,
        data: UpdateToolCommandInput
    ): Promise<FunctionReadModel | null> {
        return this.functionService.updateFunction(toolId, ownerUserId, this.normalizeUpdateInput(data));
    }

    async updateTool(
        toolId: string,
        ownerUserId: string,
        data: UpdateToolCommandInput
    ): Promise<ToolTransitionReadModel | null> {
        const updated = await this.updateLegacyFunction(toolId, ownerUserId, data);
        if (!updated) {
            return null;
        }

        return this.requireToolById(updated._id.toString(), ownerUserId);
    }

    async deleteTool(toolId: string, ownerUserId: string): Promise<boolean> {
        return this.functionService.deleteFunction(toolId, ownerUserId);
    }

    async toggleLegacyFunction(
        toolId: string,
        ownerUserId: string,
        options?: { allowBashPy?: boolean }
    ): Promise<FunctionReadModel | null> {
        return this.functionService.toggleFunction(toolId, ownerUserId, options);
    }

    async toggleTool(
        toolId: string,
        ownerUserId: string,
        options?: { allowBashPy?: boolean }
    ): Promise<{ id: string; isEnabled: boolean } | null> {
        const updated = await this.toggleLegacyFunction(toolId, ownerUserId, options);
        if (!updated) {
            return null;
        }

        return {
            id: updated._id.toString(),
            isEnabled: updated.isEnabled,
        };
    }

    private async requireToolById(toolId: string, ownerUserId: string): Promise<ToolTransitionReadModel> {
        const tool = await this.toolReadAdapterService.getToolById(toolId, ownerUserId);
        if (!tool) {
            throw new Error(`Tool ${toolId} introuvable apres ecriture`);
        }

        return tool;
    }

    private normalizeCreateInput(data: CreateToolCommandInput) {
        return {
            name: data.name,
            description: data.description,
            language: this.resolveLanguage(data),
            workflowId: data.workflowId,
            inputSchema: data.inputSchema,
            outputSchema: data.outputSchema,
            codeInline: data.codeInline,
            dependencies: data.dependencies,
            tags: data.tags,
        };
    }

    private normalizeUpdateInput(data: UpdateToolCommandInput) {
        return {
            ...data,
            ...(data.language || data.runtime
                ? { language: this.resolveLanguage(data) }
                : {})
        };
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