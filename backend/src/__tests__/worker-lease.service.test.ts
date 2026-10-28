import {
    TaskLeaseService,
    TaskQueueService,
    TaskSchedulerService,
    TaskWorkerService,
} from '../services/taskRuntimeInfra.service';

describe('TaskRuntimeInfra service', () => {
    it('acquires a lease once per task while active', () => {
        const service = new TaskLeaseService();
        const now = new Date('2026-10-27T10:00:00.000Z');

        const first = service.acquireLease('task-1', 'worker-a', 60_000, now);
        const second = service.acquireLease('task-1', 'worker-b', 60_000, now);

        expect(first.ok).toBe(true);
        expect(second.ok).toBe(false);
        expect(second.reason).toBe('lease_active');
    });

    it('releases and re-acquires a task after the lease expires', () => {
        const service = new TaskLeaseService();
        const now = new Date('2026-10-27T10:00:00.000Z');

        const first = service.acquireLease('task-2', 'worker-a', 30_000, now);
        expect(first.ok).toBe(true);

        const expiredNow = new Date('2026-10-27T10:00:31.000Z');
        const second = service.acquireLease('task-2', 'worker-b', 30_000, expiredNow);

        expect(second.ok).toBe(true);
        if (!second.lease) {
            throw new Error('Expected renewal lease to be present after expiry');
        }
        expect(second.lease.workerId).toBe('worker-b');
    });

    it('tracks expired leases explicitly when a worker regains the task', () => {
        const service = new TaskLeaseService();
        const now = new Date('2026-10-27T10:00:00.000Z');

        service.acquireLease('task-3', 'worker-a', 30_000, now);

        const expiredNow = new Date('2026-10-27T10:00:31.000Z');
        const result = service.acquireLease('task-3', 'worker-b', 30_000, expiredNow);

        expect(result.ok).toBe(true);
        expect(result.reason).toBe('lease_expired');
        expect(result.lease?.workerId).toBe('worker-b');
    });

    it('keeps the scheduler due-task semantics explicit and retry-safe', () => {
        const scheduler = new TaskSchedulerService();

        scheduler.enqueueTask('task-4', new Date('2026-10-27T11:59:00.000Z'), { attempt: 1 });
        scheduler.enqueueTask('task-5', new Date('2026-10-27T12:05:00.000Z'), { attempt: 1 });
        scheduler.scheduleRetry('task-4', 30_000, new Date('2026-10-27T12:00:00.000Z'));

        const due = scheduler.getDueTasks(new Date('2026-10-27T12:00:30.000Z'));

        expect(due.map((item) => item.taskId)).toEqual(['task-4']);
        expect(scheduler.getTask('task-4')?.nextRunAt.toISOString()).toBe('2026-10-27T12:00:30.000Z');
    });

    it('tracks a task lifecycle from scheduled to running to completed without re-enabling stale retries', () => {
        const scheduler = new TaskSchedulerService();
        const leaseService = new TaskLeaseService();
        const scheduledAt = new Date('2026-10-27T12:00:00.000Z');

        scheduler.enqueueTask('task-6', scheduledAt, { attempt: 0 });

        const leased = leaseService.acquireLease('task-6', 'worker-a', 60_000, scheduledAt);
        expect(leased.ok).toBe(true);

        scheduler.markRunning('task-6', leased.lease!, scheduledAt);
        scheduler.scheduleRetry('task-6', 30_000, new Date('2026-10-27T12:00:15.000Z'));

        scheduler.markCompleted('task-6', new Date('2026-10-27T12:00:20.000Z'));

        expect(scheduler.getTask('task-6')?.status).toBe('completed');
        expect(scheduler.getDueTasks(new Date('2026-10-27T12:00:45.000Z')).map((item) => item.taskId)).not.toContain('task-6');
    });

    it('claims only due tasks with a valid lease and rejects already-running work', () => {
        const scheduler = new TaskSchedulerService();
        const leaseService = new TaskLeaseService();
        const queue = new TaskQueueService(scheduler, leaseService);

        const task7At = new Date('2026-10-27T13:00:00.000Z');
        const task8At = new Date('2026-10-27T13:05:00.000Z');
        queue.enqueueTask('task-7', task7At, { attempt: 0 });
        queue.enqueueTask('task-8', task8At, { attempt: 0 });

        const dueAt = new Date('2026-10-27T13:00:30.000Z');
        const activeLease = leaseService.acquireLease('task-7', 'worker-a', 60_000, dueAt);
        scheduler.markRunning('task-7', activeLease.lease!, dueAt);

        const firstClaim = queue.claimNextTask('worker-b', 60_000, new Date('2026-10-27T13:05:30.000Z'));
        expect(firstClaim.task?.taskId).toBe('task-8');
        expect(firstClaim.lease?.workerId).toBe('worker-b');

        const secondClaim = queue.claimNextTask('worker-c', 60_000, new Date('2026-10-27T13:05:45.000Z'));
        expect(secondClaim.task).toBeUndefined();
    });

    it('runs a task exactly once and schedules a retry when a worker misses its lease window', async () => {
        const scheduler = new TaskSchedulerService();
        const leaseService = new TaskLeaseService();
        const queue = new TaskQueueService(scheduler, leaseService);
        const executed: string[] = [];

        queue.enqueueTask('task-9', new Date('2026-10-27T14:00:00.000Z'), { attempt: 0 });

        const worker = new TaskWorkerService(queue, async (task) => {
            executed.push(task.taskId);
        }, { leaseDurationMs: 30_000, retryDelayMs: 15_000 });

        const firstRun = await worker.runNextTask('worker-a', new Date('2026-10-27T14:00:10.000Z'));
        expect(firstRun.accepted).toBe(true);
        expect(firstRun.taskId).toBe('task-9');
        expect(executed).toEqual(['task-9']);

        const expiredRun = await worker.runNextTask('worker-b', new Date('2026-10-27T14:00:45.000Z'));
        expect(expiredRun.accepted).toBe(false);
        expect(expiredRun.reason).toBe('no_due_tasks');

        const retryAt = new Date('2026-10-27T14:01:00.000Z');
        const afterRetry = await worker.runNextTask('worker-c', retryAt);
        expect(afterRetry.accepted).toBe(true);
        expect(afterRetry.taskId).toBe('task-9');
        expect(executed).toEqual(['task-9', 'task-9']);
    });

    it('marks abandoned tasks as stale and exposes a worker health snapshot', () => {
        const scheduler = new TaskSchedulerService();
        const leaseService = new TaskLeaseService();
        const queue = new TaskQueueService(scheduler, leaseService);

        queue.enqueueTask('task-10', new Date('2026-10-27T15:00:00.000Z'), { attempt: 0 });
        const lease = leaseService.acquireLease('task-10', 'worker-a', 10_000, new Date('2026-10-27T15:00:00.000Z'));
        scheduler.markRunning('task-10', lease.lease!, new Date('2026-10-27T15:00:00.000Z'));

        const worker = new TaskWorkerService(queue, async () => undefined, { leaseDurationMs: 10_000, retryDelayMs: 5_000 });
        const stale = worker.reapAbandonedTasks(new Date('2026-10-27T15:00:25.000Z'));

        expect(stale).toEqual(['task-10']);
        expect(worker.getHealthSnapshot(new Date('2026-10-27T15:00:25.000Z')).staleLeases).toBe(1);
    });
});
