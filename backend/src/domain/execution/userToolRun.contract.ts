import { z } from 'zod';

export const USER_TOOL_RUN_STATUS_VALUES = [
    'queued',
    'running',
    'completed',
    'failed',
    'stopped',
    'timed_out'
] as const;

export const USER_TOOL_RUN_RUNTIME_VALUES = ['typescript', 'python'] as const;
export const USER_TOOL_RUN_RUNNER_VALUES = ['docker_sandbox', 'docker_rootless', 'firecracker'] as const;
export const USER_TOOL_RUN_NETWORK_MODE_VALUES = ['none', 'restricted'] as const;

export const UserToolRunStatusSchema = z.enum(USER_TOOL_RUN_STATUS_VALUES);
export const UserToolRunRuntimeSchema = z.enum(USER_TOOL_RUN_RUNTIME_VALUES);
export const UserToolRunRunnerSchema = z.enum(USER_TOOL_RUN_RUNNER_VALUES);
export const UserToolRunNetworkModeSchema = z.enum(USER_TOOL_RUN_NETWORK_MODE_VALUES);

export const UserToolRunPolicySnapshotSchema = z.object({
    networkMode: UserToolRunNetworkModeSchema,
    timeoutSeconds: z.number().int().min(1).optional(),
    maxMemoryMb: z.number().int().min(1).optional(),
    secretAliases: z.array(z.string().trim().min(1)).optional(),
}).strict();

export type UserToolRunDomainStatus = z.infer<typeof UserToolRunStatusSchema>;
export type UserToolRunRuntime = z.infer<typeof UserToolRunRuntimeSchema>;
export type UserToolRunRunner = z.infer<typeof UserToolRunRunnerSchema>;
export type UserToolRunNetworkMode = z.infer<typeof UserToolRunNetworkModeSchema>;
export type UserToolRunPolicySnapshot = z.infer<typeof UserToolRunPolicySnapshotSchema>;

export const USER_TOOL_RUN_ALLOWED_TRANSITIONS: Readonly<Record<UserToolRunDomainStatus, readonly UserToolRunDomainStatus[]>> = {
    queued: ['running', 'failed', 'stopped', 'timed_out'],
    running: ['completed', 'failed', 'stopped', 'timed_out'],
    completed: [],
    failed: [],
    stopped: [],
    timed_out: [],
};

export function canTransitionUserToolRun(
    currentStatus: UserToolRunDomainStatus,
    nextStatus: UserToolRunDomainStatus,
): boolean {
    return USER_TOOL_RUN_ALLOWED_TRANSITIONS[currentStatus].includes(nextStatus);
}

export function assertUserToolRunTransition(
    currentStatus: UserToolRunDomainStatus,
    nextStatus: UserToolRunDomainStatus,
    executionId: string,
): void {
    if (!canTransitionUserToolRun(currentStatus, nextStatus)) {
        throw new Error(`Invalid UserToolRun transition for ${executionId}: ${currentStatus} -> ${nextStatus}`);
    }
}