import { z } from 'zod';

export const TASK_INSTANCE_STATUS_VALUES = [
    'pending',
    'ready',
    'running',
    'blocked',
    'completed',
    'failed',
    'cancelled',
    'timed_out'
] as const;

export const TaskInstanceStatusSchema = z.enum(TASK_INSTANCE_STATUS_VALUES);

export type TaskInstanceStatus = z.infer<typeof TaskInstanceStatusSchema>;

export const TASK_INSTANCE_ALLOWED_TRANSITIONS: Readonly<Record<TaskInstanceStatus, readonly TaskInstanceStatus[]>> = {
    pending: ['ready', 'blocked', 'cancelled', 'timed_out'],
    ready: ['running', 'cancelled', 'timed_out'],
    running: ['completed', 'failed', 'blocked', 'cancelled', 'timed_out'],
    blocked: ['ready', 'cancelled', 'timed_out'],
    completed: [],
    failed: [],
    cancelled: [],
    timed_out: [],
};

export function canTransitionTaskInstance(
    currentStatus: TaskInstanceStatus,
    nextStatus: TaskInstanceStatus,
): boolean {
    return TASK_INSTANCE_ALLOWED_TRANSITIONS[currentStatus].includes(nextStatus);
}

export function assertTaskInstanceTransition(
    currentStatus: TaskInstanceStatus,
    nextStatus: TaskInstanceStatus,
    taskId: string,
): void {
    if (!canTransitionTaskInstance(currentStatus, nextStatus)) {
        throw new Error(`Invalid TaskInstance transition for ${taskId}: ${currentStatus} -> ${nextStatus}`);
    }
}