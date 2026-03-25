import type { IUserFunction } from '../../models/UserFunction.model';
import type {
    IUserToolRunArtifact,
    IUserToolRunPolicySnapshot,
    IUserToolRunResourceUsage,
    UserToolRunLaunchContext,
    UserToolRunRunner,
    UserToolRunRuntime
} from '../../models/UserToolRun.model';
import type { WorkspaceProvisioningResult } from '../workspace/types';

export type SandboxExecutionMode = 'python-native' | 'python-custom' | 'typescript-custom';
export type SandboxExecutionFailureKind =
    | 'timeout'
    | 'runner_unavailable'
    | 'runner_spawn_failed'
    | 'runner_image_missing'
    | 'runner_mount_failed'
    | 'runner_permission_denied'
    | 'sandbox_runtime_error'
    | 'sandbox_invalid_output'
    | 'sandbox_non_zero_exit'
    | 'unknown';

export interface SandboxExecutionMetadata {
    exitCode?: number;
    containerWorkspaceDir?: string;
    timeoutMs?: number;
    maxMemoryMb?: number;
    failureKind?: SandboxExecutionFailureKind;
    artifacts?: IUserToolRunArtifact[];
}

export interface SandboxExecutionResourceUsage extends IUserToolRunResourceUsage {}

export interface SandboxExecutionRequest {
    executionId: string;
    userId: string;
    function: Pick<IUserFunction, '_id' | 'name' | 'language' | 'origin' | 'codeInline' | 'codePath'>;
    runtime: UserToolRunRuntime;
    launchContext: UserToolRunLaunchContext;
    args: Record<string, unknown>;
    policySnapshot: IUserToolRunPolicySnapshot;
    workspace: WorkspaceProvisioningResult | null;
    sourceCode?: string;
    sourcePath?: string | null;
    mode: SandboxExecutionMode;
}

export interface SandboxExecutionResult {
    success: boolean;
    output: unknown;
    stdout?: string;
    stderr?: string;
    durationMs: number;
    timedOut?: boolean;
    exitCode: number;
    runner: UserToolRunRunner;
    metadata?: SandboxExecutionMetadata;
    resourceUsage?: SandboxExecutionResourceUsage;
}

export interface OrchestratedExecutionResult extends SandboxExecutionResult {
    executionId: string;
}
