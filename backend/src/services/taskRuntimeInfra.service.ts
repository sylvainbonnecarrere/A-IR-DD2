export type TaskLeaseReason = 'lease_active' | 'lease_expired' | 'missing_task';
export type TaskRuntimeStatus = 'scheduled' | 'running' | 'completed' | 'failed' | 'cancelled' | 'stale';

export interface TaskLease {
    taskId: string;
    workerId: string;
    acquiredAt: Date;
    expiresAt: Date;
    leaseId: string;
}

export interface TaskLeaseResult {
    ok: boolean;
    reason?: TaskLeaseReason;
    lease?: TaskLease;
}

interface TaskRuntimeEntry {
    taskId: string;
    runAt: Date;
    nextRunAt: Date;
    status: TaskRuntimeStatus;
    metadata?: Record<string, unknown>;
    lease?: TaskLease;
    retryAfterMs?: number;
    startedAt?: Date;
    completedAt?: Date;
}

export class TaskLeaseService {
    private readonly leases = new Map<string, TaskLease>();

    acquireLease(taskId: string, workerId: string, leaseDurationMs: number, now: Date = new Date()): TaskLeaseResult {
        const current = this.leases.get(taskId);
        if (current && current.expiresAt.getTime() > now.getTime()) {
            return { ok: false, reason: 'lease_active', lease: current };
        }

        const leaseId = `lease-${taskId}-${workerId}-${now.getTime()}`;
        const lease: TaskLease = {
            taskId,
            workerId,
            acquiredAt: now,
            expiresAt: new Date(now.getTime() + leaseDurationMs),
            leaseId,
        };

        this.leases.set(taskId, lease);
        return {
            ok: true,
            reason: current ? 'lease_expired' : undefined,
            lease,
        };
    }

    releaseLease(taskId: string): boolean {
        return this.leases.delete(taskId);
    }

    renewLease(taskId: string, workerId: string, leaseDurationMs: number, now: Date = new Date()): TaskLeaseResult {
        const current = this.leases.get(taskId);
        if (!current) {
            return { ok: false, reason: 'missing_task' };
        }

        if (current.workerId !== workerId) {
            return { ok: false, reason: 'lease_active', lease: current };
        }

        const renewed: TaskLease = {
            ...current,
            acquiredAt: now,
            expiresAt: new Date(now.getTime() + leaseDurationMs),
        };

        this.leases.set(taskId, renewed);
        return { ok: true, lease: renewed };
    }

    hasActiveLease(taskId: string, now: Date = new Date()): boolean {
        const current = this.leases.get(taskId);
        return !!current && current.expiresAt.getTime() > now.getTime();
    }
}

export class TaskSchedulerService {
    private readonly tasks = new Map<string, TaskRuntimeEntry>();

    enqueueTask(taskId: string, runAt: Date, metadata?: Record<string, unknown>): TaskRuntimeEntry {
        const entry: TaskRuntimeEntry = {
            taskId,
            runAt,
            nextRunAt: runAt,
            status: 'scheduled',
            metadata,
        };
        this.tasks.set(taskId, entry);
        return entry;
    }

    getAllTasks(): TaskRuntimeEntry[] {
        return Array.from(this.tasks.values());
    }

    markRunning(taskId: string, lease: TaskLease, now: Date = new Date()): TaskRuntimeEntry | undefined {
        const existing = this.tasks.get(taskId);
        if (!existing) {
            return undefined;
        }

        existing.status = 'running';
        existing.startedAt = now;
        existing.lease = lease;
        existing.nextRunAt = now;
        return existing;
    }

    markCompleted(taskId: string, now: Date = new Date()): TaskRuntimeEntry | undefined {
        const existing = this.tasks.get(taskId);
        if (!existing) {
            return undefined;
        }

        existing.status = 'completed';
        existing.completedAt = now;
        existing.lease = undefined;
        existing.retryAfterMs = undefined;
        existing.nextRunAt = now;
        return existing;
    }

    markFailed(taskId: string, now: Date = new Date()): TaskRuntimeEntry | undefined {
        const existing = this.tasks.get(taskId);
        if (!existing) {
            return undefined;
        }

        existing.status = 'failed';
        existing.completedAt = now;
        existing.lease = undefined;
        existing.retryAfterMs = undefined;
        existing.nextRunAt = now;
        return existing;
    }

    scheduleRetry(taskId: string, delayMs: number, now: Date = new Date()): TaskRuntimeEntry | undefined {
        const existing = this.tasks.get(taskId);
        if (!existing || existing.status === 'completed' || existing.status === 'failed' || existing.status === 'cancelled') {
            return existing;
        }

        const nextRunAt = new Date(now.getTime() + delayMs);
        existing.status = 'scheduled';
        existing.nextRunAt = nextRunAt;
        existing.retryAfterMs = delayMs;
        return existing;
    }

    getDueTasks(now: Date = new Date()): TaskRuntimeEntry[] {
        return Array.from(this.tasks.values())
            .filter((entry) => entry.status !== 'completed' && entry.status !== 'failed' && entry.status !== 'cancelled')
            .filter((entry) => entry.nextRunAt.getTime() <= now.getTime())
            .sort((a, b) => a.nextRunAt.getTime() - b.nextRunAt.getTime());
    }

    markStale(taskId: string, now: Date = new Date()): TaskRuntimeEntry | undefined {
        const existing = this.tasks.get(taskId);
        if (!existing) {
            return undefined;
        }

        existing.status = 'stale';
        existing.nextRunAt = new Date(now.getTime() + (existing.retryAfterMs ?? 0));
        return existing;
    }

    getTask(taskId: string): TaskRuntimeEntry | undefined {
        return this.tasks.get(taskId);
    }
}

export class TaskQueueService {
    public readonly scheduler: TaskSchedulerService;
    public readonly leaseService: TaskLeaseService;

    constructor(scheduler: TaskSchedulerService = new TaskSchedulerService(), leaseService: TaskLeaseService = new TaskLeaseService()) {
        this.scheduler = scheduler;
        this.leaseService = leaseService;
    }

    enqueueTask(taskId: string, runAt: Date, metadata?: Record<string, unknown>): TaskRuntimeEntry {
        const existing = this.scheduler.getTask(taskId);
        if (existing && existing.status !== 'completed' && existing.status !== 'failed' && existing.status !== 'cancelled') {
            return existing;
        }

        return this.scheduler.enqueueTask(taskId, runAt, metadata);
    }

    claimNextTask(workerId: string, leaseDurationMs: number, now: Date = new Date()): { task?: TaskRuntimeEntry; lease?: TaskLease; reason?: string } {
        const dueTasks = this.scheduler.getDueTasks(now)
            .filter((entry) => entry.status !== 'running')
            .filter((entry) => !this.leaseService.hasActiveLease(entry.taskId, now))
            .sort((a, b) => a.nextRunAt.getTime() - b.nextRunAt.getTime());

        if (dueTasks.length === 0) {
            return { reason: 'no_due_tasks' };
        }

        const candidate = dueTasks[0];
        const leaseResult = this.leaseService.acquireLease(candidate.taskId, workerId, leaseDurationMs, now);

        if (!leaseResult.ok) {
            return {
                reason: leaseResult.reason ?? 'lease_unavailable',
                lease: leaseResult.lease,
            };
        }

        const task = this.scheduler.markRunning(candidate.taskId, leaseResult.lease!, now);
        return {
            task,
            lease: leaseResult.lease,
        };
    }

    getTask(taskId: string): TaskRuntimeEntry | undefined {
        return this.scheduler.getTask(taskId);
    }
}

export interface TaskWorkerOptions {
    leaseDurationMs: number;
    retryDelayMs: number;
}

export class TaskWorkerService {
    private readonly queue: TaskQueueService;
    private readonly executor: (task: TaskRuntimeEntry) => Promise<unknown> | unknown;
    private readonly leaseDurationMs: number;
    private readonly retryDelayMs: number;

    constructor(
        queue: TaskQueueService = new TaskQueueService(),
        executor: (task: TaskRuntimeEntry) => Promise<unknown> | unknown = async () => undefined,
        options: Partial<TaskWorkerOptions> = {}
    ) {
        this.queue = queue;
        this.executor = executor;
        this.leaseDurationMs = options.leaseDurationMs ?? 60_000;
        this.retryDelayMs = options.retryDelayMs ?? 30_000;
    }

    async runNextTask(workerId: string, now: Date = new Date()): Promise<{ accepted: boolean; taskId?: string; reason?: string }> {
        this.reapAbandonedTasks(now);

        const claimed = this.queue.claimNextTask(workerId, this.leaseDurationMs, now);
        if (!claimed.task) {
            return { accepted: false, reason: claimed.reason ?? 'no_due_tasks' };
        }

        try {
            await this.executor(claimed.task);
            this.queue.scheduler.scheduleRetry(claimed.task.taskId, this.retryDelayMs, now);
            return { accepted: true, taskId: claimed.task.taskId };
        } catch {
            this.queue.scheduler.scheduleRetry(claimed.task.taskId, this.retryDelayMs, now);
            return { accepted: true, taskId: claimed.task.taskId, reason: 'execution_error' };
        }
    }

    reapAbandonedTasks(now: Date = new Date()): string[] {
        const staleTaskIds: string[] = [];

        for (const entry of this.queue.scheduler.getAllTasks()) {
            const lease = entry.lease;
            if (!lease) {
                continue;
            }

            if (lease.expiresAt.getTime() > now.getTime()) {
                continue;
            }

            this.queue.leaseService.releaseLease(entry.taskId);
            entry.status = 'stale';
            entry.nextRunAt = new Date(now.getTime() + (entry.retryAfterMs ?? this.retryDelayMs));
            entry.retryAfterMs = entry.retryAfterMs ?? this.retryDelayMs;
            entry.lease = undefined;
            staleTaskIds.push(entry.taskId);
        }

        return staleTaskIds;
    }

    getHealthSnapshot(now: Date = new Date()): { totalTasks: number; runningTasks: number; staleLeases: number } {
        const tasks = this.queue.scheduler.getAllTasks();

        return {
            totalTasks: tasks.length,
            runningTasks: tasks.filter((entry) => entry.status === 'running').length,
            staleLeases: tasks.filter((entry) =>
                entry.status === 'stale' || (entry.status === 'running' && entry.lease && entry.lease.expiresAt.getTime() <= now.getTime())
            ).length,
        };
    }
}
