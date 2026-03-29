import apiClient from '../utils/apiClient';
import type {
    BuildPreparationResult,
    CreateFunctionPayload,
    FunctionArtifactPreview,
    FunctionRunCleanupResult,
    FunctionRunListResponse,
    FunctionRunRecord,
    FunctionRunSortField,
    FunctionRunSortOrder,
    RuntimeHealthReport,
    RuntimeCompatibilityContext,
    SandboxRunResult,
    SyntaxCheckResult,
    ToolTransitionRecord,
    ToolsListResponse,
    ToolWorkspaceResponse,
    UpdateFunctionPayload,
    UserFunction,
} from '../types/function.types';

const parseRuntimeCompatibilityFromHeaders = (headers: Record<string, unknown> | undefined): RuntimeCompatibilityContext | null => {
    if (!headers) {
        return null;
    }

    const mode = headers['x-runtime-mode'];
    const securityLevel = headers['x-runtime-security-level'];
    const executionReady = headers['x-runtime-execution-ready'];
    const preferredRunner = headers['x-runtime-preferred-runner'];

    if (
        typeof mode !== 'string'
        || typeof securityLevel !== 'string'
        || typeof executionReady !== 'string'
        || typeof preferredRunner !== 'string'
    ) {
        return null;
    }

    return {
        checkedAt: new Date().toISOString(),
        mode: mode as RuntimeCompatibilityContext['mode'],
        securityLevel: securityLevel as RuntimeCompatibilityContext['securityLevel'],
        executionReady: executionReady === 'true',
        preferredRunner: preferredRunner as RuntimeCompatibilityContext['preferredRunner'],
        warning: typeof headers['x-runtime-warning'] === 'string' ? headers['x-runtime-warning'] : undefined,
        summary: typeof headers['x-runtime-warning'] === 'string'
            ? headers['x-runtime-warning']
            : `Runtime ${securityLevel}`
    };
};

const parseVersionNumber = (tag?: string | null): number => {
    if (!tag) {
        return 1;
    }

    const match = tag.match(/(\d+)/);
    return match ? Number.parseInt(match[1], 10) : 1;
};

const resolveCodePathRoot = (tool: ToolTransitionRecord): UserFunction['codePathRoot'] => {
    const sourcePath = tool.currentVersion.sourcePath;

    if (!sourcePath) {
        return null;
    }

    if (tool.origin === 'native') {
        return 'native_repo';
    }

    return tool.workspaceContext ? 'workspace_source' : 'legacy_relative';
};

const mapToolToUserFunction = (tool: ToolTransitionRecord): UserFunction => {
    const dependencies = tool.runtime === 'python'
        ? Array.isArray((tool.dependencies as { python?: unknown })?.python)
            ? ((tool.dependencies as { python: string[] }).python)
            : []
        : Array.isArray((tool.dependencies as { npm?: unknown })?.npm)
            ? ((tool.dependencies as { npm: string[] }).npm)
            : [];

    const workspaceContext = tool.workspaceContext;
    const currentVersion = tool.currentVersion;

    return {
        _id: tool.legacyFunctionId || tool.id,
        toolId: tool.id,
        name: tool.name,
        description: tool.description,
        language: tool.runtime,
        origin: tool.origin,
        userId: tool.origin === 'native' ? null : null,
        workflowId: tool.workflowId ?? null,
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
        codePath: currentVersion?.sourcePath ?? null,
        resolvedCodePath: currentVersion?.sourcePath ?? null,
        codePathRoot: resolveCodePathRoot(tool),
        codeInline: currentVersion?.sourceInline ?? null,
        dependencies,
        isEnabled: tool.isEnabled,
        isReadonly: tool.isReadonly,
        version: parseVersionNumber(tool.currentVersion.versionTag),
        versionTag: tool.currentVersion.versionTag,
        tags: tool.tags,
        readinessStatus: tool.readinessStatus,
        workspaceContext: workspaceContext ? {
            workspaceId: workspaceContext.workspaceId,
            logicalRoot: workspaceContext.logicalRoot,
            runtimeRoots: workspaceContext.runtimeRoots,
            manifests: workspaceContext.manifests,
            status: workspaceContext.status,
            lastScanAt: workspaceContext.lastScanAt ?? null,
        } : undefined,
        createdAt: String(tool.createdAt),
        updatedAt: String(tool.updatedAt),
    };
};

export interface LoadPhilFunctionsResult {
    functions: UserFunction[];
    runtimeCompatibility: RuntimeCompatibilityContext | null;
    workspace: ToolWorkspaceResponse['workspace'] | null;
}

class ToolRepository {
    async loadPhilFunctions(workflowId?: string): Promise<LoadPhilFunctionsResult> {
        const params = new URLSearchParams();
        if (workflowId) {
            params.append('workflowId', workflowId);
        }

        const toolsResponse = await apiClient.get<ToolsListResponse>(`/api/tools${params.size > 0 ? `?${params}` : ''}`);
        const runtimeCompatibility = toolsResponse.data.runtimeCompatibility
            ?? parseRuntimeCompatibilityFromHeaders(toolsResponse.headers as Record<string, unknown>);

        let workspace: ToolWorkspaceResponse['workspace'] | null = null;
        if (workflowId) {
            try {
                const workspaceResponse = await apiClient.get<ToolWorkspaceResponse>(`/api/workspaces/${workflowId}`);
                workspace = workspaceResponse.data.workspace;
            } catch {
                workspace = null;
            }
        }

        return {
            functions: toolsResponse.data.items.map(mapToolToUserFunction),
            runtimeCompatibility,
            workspace,
        };
    }

    async createFunction(payload: CreateFunctionPayload) {
        return apiClient.post<UserFunction>('/api/functions', payload);
    }

    async updateFunction(id: string, payload: UpdateFunctionPayload) {
        return apiClient.put<UserFunction>(`/api/functions/${id}`, payload);
    }

    async deleteFunction(id: string) {
        return apiClient.delete(`/api/functions/${id}`);
    }

    async toggleFunction(id: string, allowBashPy = false) {
        return apiClient.patch<{ id: string; isEnabled: boolean }>(`/api/functions/${id}/toggle`, { allowBashPy });
    }

    async runInSandbox(functionId: string, testArgs: Record<string, unknown>) {
        return apiClient.post<SandboxRunResult>('/api/sandbox/run', { functionId, testArgs });
    }

    async checkSyntax(language: 'python' | 'typescript', code: string) {
        return apiClient.post<SyntaxCheckResult>('/api/sandbox/check', { language, code });
    }

    async loadFunctionRuns(
        functionId: string,
        options: {
            limit?: number;
            page?: number;
            status?: FunctionRunRecord['status'];
            sortBy?: FunctionRunSortField;
            sortOrder?: FunctionRunSortOrder;
        } = {}
    ) {
        return apiClient.get<FunctionRunListResponse & { runtimeCompatibility?: RuntimeCompatibilityContext }>(
            '/api/runs',
            {
                params: {
                    toolId: functionId,
                    limit: options.limit,
                    page: options.page,
                    status: options.status,
                    sortBy: options.sortBy,
                    sortOrder: options.sortOrder,
                }
            }
        );
    }

    async loadFunctionRunByExecutionId(executionId: string, toolId?: string) {
        return apiClient.get<FunctionRunRecord>(
            `/api/runs/executions/${executionId}`,
            {
                params: {
                    toolId,
                }
            }
        );
    }

    async loadArtifactPreview(functionId: string, executionId: string, artifactPath: string) {
        return apiClient.get<FunctionArtifactPreview>(
            `/api/runs/tool/${functionId}/${executionId}/artifacts/content`,
            {
                params: { path: artifactPath }
            }
        );
    }

    async downloadArtifact(functionId: string, executionId: string, artifactPath: string) {
        return apiClient.get<Blob>(
            `/api/runs/tool/${functionId}/${executionId}/artifacts/download`,
            {
                params: { path: artifactPath },
                responseType: 'blob'
            }
        );
    }

    async cleanupFunctionRuns(functionId: string, options: { retentionDays?: number; retainLatest?: number; dryRun?: boolean }) {
        return apiClient.post<FunctionRunCleanupResult>(`/api/runs/tool/${functionId}/cleanup`, options);
    }

    async runBuild(functionId: string) {
        return apiClient.post<BuildPreparationResult>(`/api/tools/${functionId}/build`, {});
    }

    async loadBuildStatus(functionId: string) {
        return apiClient.get<BuildPreparationResult>(`/api/tools/${functionId}/build-status`);
    }

    async loadRuntimeHealth() {
        return apiClient.get<RuntimeHealthReport>('/api/sandbox/health');
    }
}

export const toolRepository = new ToolRepository();
export { parseRuntimeCompatibilityFromHeaders };