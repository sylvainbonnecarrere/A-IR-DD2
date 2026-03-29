import type {
    SandboxExecutionFailureKind,
    SandboxExecutionFailureSubsystem,
    SandboxExecutionMetadata,
    SandboxExecutionResult,
} from './execution.types';

export class RuntimeNotReadyError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'RuntimeNotReadyError';
    }
}

export type SandboxErrorSubsystem = SandboxExecutionFailureSubsystem | 'build_preparation' | 'runtime_readiness' | 'validation';

export interface SandboxErrorDetails {
    code: string;
    subsystem: SandboxErrorSubsystem;
    message: string;
    retryable: boolean;
    failureKind?: SandboxExecutionFailureKind;
    errorType?: string;
    traceback?: string;
}

export function inferSandboxFailureSubsystem(failureKind?: SandboxExecutionFailureKind): SandboxExecutionFailureSubsystem {
    switch (failureKind) {
        case 'runner_unavailable':
        case 'runner_spawn_failed':
        case 'runner_image_missing':
        case 'runner_mount_failed':
        case 'runner_permission_denied':
            return 'runner';
        case 'wrapper_syntax_error':
            return 'wrapper';
        case 'user_code_syntax_error':
            return 'user_code';
        case 'dependency_missing':
            return 'dependency';
        case 'sandbox_runtime_error':
        case 'sandbox_invalid_output':
        case 'sandbox_non_zero_exit':
        case 'timeout':
            return 'sandbox_runtime';
        default:
            return 'unknown';
    }
}

export function buildSandboxErrorDetails(input: {
    message: string;
    code?: string;
    subsystem?: SandboxErrorSubsystem;
    retryable?: boolean;
    failureKind?: SandboxExecutionFailureKind;
    errorType?: string;
    traceback?: string;
}): SandboxErrorDetails {
    const failureKind = input.failureKind;
    return {
        code: input.code ?? (failureKind ? failureKind.toUpperCase() : 'SANDBOX_ERROR'),
        subsystem: input.subsystem ?? inferSandboxFailureSubsystem(failureKind),
        message: input.message,
        retryable: input.retryable ?? false,
        ...(failureKind ? { failureKind } : {}),
        ...(input.errorType ? { errorType: input.errorType } : {}),
        ...(input.traceback ? { traceback: input.traceback } : {}),
    };
}

export function getSandboxErrorDetailsFromExecutionResult(
    result: Pick<SandboxExecutionResult, 'success' | 'stderr' | 'timedOut' | 'metadata'>
): SandboxErrorDetails | undefined {
    if (result.success) {
        return undefined;
    }

    const metadata: SandboxExecutionMetadata | undefined = result.metadata;
    const failureKind = metadata?.failureKind ?? (result.timedOut ? 'timeout' : undefined);
    return buildSandboxErrorDetails({
        message: result.stderr || 'Sandbox execution failed.',
        failureKind,
        retryable: false,
        errorType: metadata?.errorType,
        traceback: metadata?.traceback,
    });
}
