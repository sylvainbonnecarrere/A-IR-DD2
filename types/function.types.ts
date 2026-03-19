/**
 * Types — Fonctions Personnalisées (Tools V2) côté Frontend
 *
 * Miroir des types backend IUserFunction.
 * Source de vérité côté frontend — utilisée par le store, les composants et les services.
 */

export type FunctionLanguage = 'python' | 'typescript';
export type FunctionOrigin = 'native' | 'custom';

export type RuntimeHealthStatus = 'healthy' | 'degraded' | 'unhealthy';
export type RuntimeDockerMode = 'rootless' | 'docker-desktop' | 'rootful-linux' | 'unknown';
export type RuntimeSecurityLevel = 'production-ready' | 'dev-only' | 'unavailable';
export type RuntimeRunnerId = 'docker_sandbox' | 'firecracker';

export interface RuntimeCompatibilityContext {
    checkedAt: string;
    mode: RuntimeDockerMode;
    securityLevel: RuntimeSecurityLevel;
    executionReady: boolean;
    preferredRunner: RuntimeRunnerId;
    warning?: string;
    summary: string;
}

export interface UserFunction {
    _id: string;
    name: string;
    description: string;
    language: FunctionLanguage;
    origin: FunctionOrigin;
    userId: string | null;
    workflowId: string | null;
    inputSchema: Record<string, unknown>;
    outputSchema: Record<string, unknown>;
    codePath: string | null;
    resolvedCodePath?: string | null;
    codePathRoot?: 'workspace_source' | 'absolute' | 'native_repo' | 'legacy_relative' | null;
    codeInline: string | null;
    dependencies: string[];
    isEnabled: boolean;
    isReadonly: boolean;
    version: number;
    versionTag?: string;
    tags: string[];
    runtimeCompatibility?: RuntimeCompatibilityContext;
    workspaceContext?: {
        workspaceId: string;
        logicalRoot: string;
        runtimeRoots: {
            sourceRoot: string;
            manifestsRoot: string;
            buildRoot: string;
            outputRoot: string;
        };
        manifests: {
            packageJson?: boolean;
            packageLockJson?: boolean;
            requirementsTxt?: boolean;
            pyprojectToml?: boolean;
        };
        status: 'active' | 'missing' | 'corrupted' | 'archived';
        lastScanAt?: string | Date | null;
    };
    createdAt: string;
    updatedAt: string;
}

export interface ToolTransitionRecord {
    id: string;
    legacyFunctionId: string;
    name: string;
    displayName?: string;
    description: string;
    runtime: FunctionLanguage;
    origin: FunctionOrigin;
    scopeType: 'native' | 'user';
    workflowId?: string | null;
    workspaceId?: string | null;
    status: 'draft' | 'ready' | 'disabled' | 'deprecated';
    trustLevel: 'trusted' | 'user' | 'restricted';
    currentVersion: number;
    versions: Array<{
        tag: string;
        contentHash: string;
        createdAt: string | Date;
        createdBy?: string | null;
        changelog?: string | null;
    }>;
    inputSchema: Record<string, unknown>;
    outputSchema: Record<string, unknown>;
    tags: string[];
    dependencies: unknown;
    policy: unknown;
    isReadonly: boolean;
    isEnabled: boolean;
    compatibilityAliases: {
        functionId: string;
    };
    workspaceContext?: UserFunction['workspaceContext'];
    createdAt: string | Date;
    updatedAt: string | Date;
}

export interface ToolWorkspaceSummary {
    id: string;
    logicalRoot: string;
    runtimeRoots: {
        sourceRoot: string;
        manifestsRoot: string;
        buildRoot: string;
        outputRoot: string;
    };
    manifests: {
        packageJson?: boolean;
        packageLockJson?: boolean;
        requirementsTxt?: boolean;
        pyprojectToml?: boolean;
    };
    status: 'active' | 'missing' | 'corrupted' | 'archived';
    lastScanAt?: string | Date | null;
    workflowId: string;
}

export interface ToolsListResponse {
    items: ToolTransitionRecord[];
    runtimeCompatibility: RuntimeCompatibilityContext;
}

export interface ToolDetailResponse {
    tool: ToolTransitionRecord;
    runtimeCompatibility: RuntimeCompatibilityContext;
}

export interface RunsListResponse extends FunctionRunListResponse {
    runtimeCompatibility?: RuntimeCompatibilityContext;
}

export interface ToolWorkspaceResponse {
    workspace: ToolWorkspaceSummary;
    metrics: {
        toolCount: number;
        runCount: number;
    };
    runtimeCompatibility: RuntimeCompatibilityContext;
}

export interface CreateFunctionPayload {
    name: string;
    description: string;
    language: FunctionLanguage;
    workflowId?: string | null;
    inputSchema?: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
    codeInline?: string | null;
    dependencies?: string[];
    tags?: string[];
}

export interface UpdateFunctionPayload extends Partial<Omit<CreateFunctionPayload, 'name'>> {}

export interface SandboxRunResult {
    success: boolean;
    output: unknown;
    stdout?: string;
    stderr?: string;
    durationMs: number;
    timedOut?: boolean;
    executionId?: string;
    runner?: string;
    exitCode?: number;
    metadata?: {
        exitCode?: number;
        failureKind?: string;
        containerWorkspaceDir?: string;
        timeoutMs?: number;
        maxMemoryMb?: number;
        artifacts?: Array<{
            path: string;
            kind: 'file' | 'json' | 'log';
        }>;
    };
    resourceUsage?: {
        peakMemoryMb?: number | null;
        cpuMs?: number | null;
        wallTimeMs?: number | null;
        memoryLimitMb?: number | null;
    };
}

export interface FunctionRunRecord {
    executionId: string;
    status: 'queued' | 'running' | 'completed' | 'failed' | 'stopped' | 'timed_out';
    runtime: FunctionLanguage;
    runner: string;
    launchContext: 'editor_test' | 'workflow_run' | 'system_validation';
    createdAt: string;
    updatedAt: string;
    timing: {
        queuedAt?: string | null;
        startedAt?: string | null;
        finishedAt?: string | null;
        durationMs?: number | null;
    };
    error?: {
        code?: string;
        message: string;
        retryable?: boolean;
    } | null;
    outputs?: {
        stdout?: string;
        stderr?: string;
        artifacts?: Array<{
            path: string;
            kind: 'file' | 'json' | 'log';
        }>;
    } | null;
    resourceUsage?: {
        peakMemoryMb?: number | null;
        cpuMs?: number | null;
        wallTimeMs?: number | null;
        memoryLimitMb?: number | null;
    };
}

export type FunctionRunSortField = 'createdAt' | 'durationMs' | 'status';
export type FunctionRunSortOrder = 'asc' | 'desc';

export interface FunctionRunListResponse {
    items: FunctionRunRecord[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
        status?: FunctionRunRecord['status'];
        sortBy: FunctionRunSortField;
        sortOrder: FunctionRunSortOrder;
    };
}

export interface FunctionRunCleanupResult {
    deletedRuns: number;
    deletedArtifacts: string[];
    retainedRuns: number;
    dryRun: boolean;
    cutoffDate?: string | Date;
}

export interface FunctionArtifactPreview {
    executionId: string;
    artifact: {
        path: string;
        kind: 'file' | 'json' | 'log';
        sizeBytes: number;
        previewable: boolean;
        truncated: boolean;
        contentType: string;
        textContent?: string;
        jsonContent?: unknown;
    };
}

export interface SyntaxCheckResult {
    valid: boolean;
    errors: Array<{ line?: number; message: string }>;
}

export interface BuildPreparationResult {
    toolId?: string;
    toolVersionTag?: string;
    functionId: string;
    functionName: string;
    language: FunctionLanguage;
    workspaceId: string;
    workflowId: string;
    buildRoot: string;
    sourcePath: string;
    status: 'ready' | 'failed';
    builtAt: string;
    manifestPaths: string[];
    artifactPaths: string[];
    warnings: string[];
    error?: string;
}

export interface RuntimeHealthComponent {
    key: string;
    label: string;
    status: RuntimeHealthStatus;
    required: boolean;
    summary: string;
    checkedAt: string;
    command?: string;
    version?: string;
    detail?: string;
    metadata?: Record<string, unknown>;
}

export interface RuntimeBinaryHealth {
    available: boolean;
    status: RuntimeHealthStatus;
    executable: string;
    version?: string;
}

export interface RuntimeImageHealth {
    available: boolean;
    status: RuntimeHealthStatus;
    image: string;
    detail?: string;
}

export interface RuntimeRunnerHealth {
    runner: RuntimeRunnerId;
    available: boolean;
    status: RuntimeHealthStatus;
    detail?: string;
}

export interface RuntimeHealthReport {
    status: RuntimeHealthStatus;
    checkedAt: string;
    summary: string;
    components: RuntimeHealthComponent[];
    runtime: {
        node: RuntimeBinaryHealth;
        python: RuntimeBinaryHealth;
        docker: RuntimeBinaryHealth & {
            rootless: boolean;
            mode: RuntimeDockerMode;
            securityLevel: RuntimeSecurityLevel;
            executionReady: boolean;
            warning?: string;
        };
        images: {
            node: RuntimeImageHealth;
            python: RuntimeImageHealth;
        };
        runners: {
            preferred: RuntimeRunnerId;
            dockerSandbox: RuntimeRunnerHealth;
            firecracker: RuntimeRunnerHealth;
        };
        typescript: {
            available: boolean;
            status: RuntimeHealthStatus;
            engine: 'node-subprocess';
        };
    };
    capabilities: {
        build: {
            typescript: boolean;
            python: boolean;
        };
        run: {
            typescript: boolean;
            python: boolean;
            dockerRootless: boolean;
        };
    };
    python: {
        available: boolean;
        version?: string;
        executable: string;
    };
    typescript: {
        available: boolean;
        engine: 'node-subprocess';
    };
}

export type FunctionFilter = {
    origin?: FunctionOrigin | 'all';
    language?: FunctionLanguage | 'all';
    isEnabled?: boolean | 'all';
    search?: string;
};
