/**
 * Types — Tools V2 côté frontend
 *
 * Types de lecture et de compatibilité utilisés par le store, les composants et les services.
 * `UserFunction` reste un read model transitoire pendant la convergence vers le registry outillé et versionné.
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

export interface ToolReadinessStatus {
    requirement: 'none' | 'author_build' | 'platform_provision';
    state: 'ready' | 'not_ready' | 'waiting_for_provisioning' | 'waiting_for_build';
    prepared: boolean;
    runnable: boolean;
    dependencyReadiness: 'satisfied' | 'missing' | 'not_required';
    runtimeReady: boolean;
    summary: string;
    actionLabel: string;
}

export interface UserFunction {
    _id: string;
    toolId?: string;
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
    readinessStatus?: ToolReadinessStatus;
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
    trustLevel: 'internal' | 'user_private' | 'unverified';
    currentVersion: ToolVersionRecord;
    versions: ToolVersionRecord[];
    inputSchema: Record<string, unknown>;
    outputSchema: Record<string, unknown>;
    tags: string[];
    dependencies: {
        npm?: string[];
        python?: string[];
    };
    policy: {
        networkMode?: 'none' | 'restricted';
        writablePaths?: string[];
        secretAliases?: string[];
        timeoutSeconds?: number;
        maxMemoryMb?: number;
    };
    isReadonly: boolean;
    isEnabled: boolean;
    compatibilityAliases: {
        functionId: string;
    };
    readinessStatus?: ToolReadinessStatus;
    workspaceContext?: UserFunction['workspaceContext'];
    createdAt: string | Date;
    updatedAt: string | Date;
}

export interface ToolVersionRecord {
    versionTag: string;
    versionNumber?: number;
        contentHash: string;
        sourceMode?: 'inline' | 'path';
        sourcePath?: string | null;
        sourceInline?: string | null;
        entrypoint?: string | null;
        createdAt: string | Date;
        createdBy?: string | null;
    buildStatus?: 'not_built' | 'building' | 'built' | 'failed';
    validationStatus?: 'unknown' | 'valid' | 'invalid';
    changelog?: string | null;
}

export interface ToolRegistryReadModel {
    id: string;
    legacyFunctionId?: string;
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    isEnabled: boolean;
    versionTag?: string;
    versionNumber?: number;
    workspaceId?: string | null;
}

export type PromptToolReadModel = ToolRegistryReadModel;

export function mapUserFunctionToToolRegistry(fn: UserFunction): ToolRegistryReadModel {
    return {
        id: fn.toolId ?? fn._id,
        legacyFunctionId: fn._id,
        name: fn.name,
        description: fn.description,
        inputSchema: fn.inputSchema,
        isEnabled: fn.isEnabled,
        versionTag: fn.versionTag,
        versionNumber: fn.version,
        workspaceId: fn.workspaceContext?.workspaceId ?? null,
    };
}

export function mapUserFunctionToPromptTool(fn: UserFunction): PromptToolReadModel {
    return mapUserFunctionToToolRegistry(fn);
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
    errorDetails?: {
        code: string;
        subsystem: 'runner' | 'wrapper' | 'user_code' | 'dependency' | 'sandbox_runtime' | 'unknown' | 'build_preparation' | 'runtime_readiness' | 'validation';
        message: string;
        retryable: boolean;
        failureKind?: string;
        errorType?: string;
        traceback?: string;
    };
    metadata?: {
        exitCode?: number;
        failureKind?: string;
        failureSubsystem?: string;
        errorType?: string;
        traceback?: string;
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

/**
 * Statuts canoniques d'un run (contrat backend `USER_TOOL_RUN_STATUS_VALUES`, US-J7-05..J7-09).
 * `worker_lost` et `quarantined` sont terminaux mais conservent le verrou workspace
 * (`lockHeld`) jusqu'au `fence-and-retry` (US-J7-07).
 */
export type FunctionRunStatus =
    | 'queued'
    | 'running'
    | 'completed'
    | 'failed'
    | 'stopped'
    | 'timed_out'
    | 'worker_lost'
    | 'quarantined';

export const FUNCTION_RUN_ACTIVE_STATUSES: readonly FunctionRunStatus[] = ['queued', 'running'];

export const FUNCTION_RUN_TERMINAL_STATUSES: readonly FunctionRunStatus[] = [
    'completed',
    'failed',
    'stopped',
    'timed_out',
];

/** Statuts de quarantaine : run incertain, verrou workspace potentiellement tenu. */
export const FUNCTION_RUN_QUARANTINE_STATUSES: readonly FunctionRunStatus[] = ['worker_lost', 'quarantined'];

export interface FunctionRunRecord {
    executionId: string;
    status: FunctionRunStatus;
    runtime: FunctionLanguage;
    runner: string;
    launchContext: 'editor_test' | 'workflow_run' | 'system_validation';
    /** Présent quand le run est scopingué à un workflow (filtrage UI strict par workflowId). */
    workflowId?: string | null;
    /** Instance d'agent déclenchée par ce run (badge de statut du nœud). */
    agentInstanceId?: string | null;
    /** Run parent quand ce run est une relance (`retry` / `fence-and-retry`). */
    retryOfExecutionId?: string | null;
    recoveryAttemptCount?: number | null;
    /** Vrai quand le verrou workspace est tenu (renseigné par les événements `run:quarantined`/`run:fenced`). */
    lockHeld?: boolean | null;
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
        subsystem?: 'runner' | 'wrapper' | 'user_code' | 'dependency' | 'sandbox_runtime' | 'unknown' | 'build_preparation' | 'runtime_readiness' | 'validation';
        failureKind?: string;
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

/** Codes d'erreur du contrat de commandes de runs (US-J7-05..J7-09). */
export type RunCommandErrorCode =
    | 'RUN_NOT_CANCELLABLE'
    | 'RUN_NOT_QUARANTINED'
    | 'WORKSPACE_LOCKED_BY_OTHER_RUN'
    | 'FENCING_TIMEOUT_ESCALATED'
    | 'IDEMPOTENCY_KEY_REQUIRED'
    | 'FENCE_AND_RETRY_FAILED'
    | 'RUN_COMMAND_FAILED';

/** Réponse 202/200 de `POST /api/workspaces/:workspaceId/runs/:runId/fence-and-retry` (US-J7-07). */
export interface FenceAndRetryResponse {
    fencedRunId: string;
    newExecutionId: string;
    status: 'queued';
    recoveryAttemptCount: number;
    idempotency?: { key: string | null; replayed: boolean };
}

/** Réponse 202/200 de `POST /api/runs/executions/:executionId/retry`. */
export interface RetryRunResponse {
    executionId: string;
    retryOfExecutionId: string;
    status: FunctionRunStatus;
    idempotency?: { key: string | null; replayed: boolean };
}

/** Réponse de `POST /api/runs/executions/:executionId/cancel`. */
export interface CancelRunResponse {
    success: boolean;
    executionId: string;
    status: FunctionRunStatus;
    cancellationRequested?: boolean;
}
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

export interface RuntimeNativePythonImportCheck {
    dependency: string;
    module: string;
    available: boolean;
    detail?: string;
}

export interface RuntimeNativePythonDependencyProbe {
    toolName: string;
    status: RuntimeHealthStatus;
    summary: string;
    checkedAt: string;
    imports: RuntimeNativePythonImportCheck[];
}

export interface RuntimeNativePythonHealth {
    available: boolean;
    status: RuntimeHealthStatus;
    summary: string;
    probes: RuntimeNativePythonDependencyProbe[];
}

export interface RuntimeHealthReport {
    status: RuntimeHealthStatus;
    checkedAt: string;
    summary: string;
    components: RuntimeHealthComponent[];
    nativePython?: RuntimeNativePythonHealth;
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
