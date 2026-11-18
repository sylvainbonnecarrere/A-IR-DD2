import { MongoExpiredRunReconciler, type ExpiredRunReconciliationStore } from '../services/runtime/MongoExpiredRunReconciler';
import type { DockerAttemptRecoveryPort } from '../services/runtime/DockerGatewayAttemptRecovery';
import type { ExpiredSupervisedRun, WorkerLostLockCleanup } from '../services/userToolRun.service';
import type { RunWorkspaceLockRelease } from '../services/runtime/MongoWorkspaceLockService';

const expiredRun: ExpiredSupervisedRun = {
    executionId: 'run-1',
    ownerUserId: 'user-1',
    workflowId: 'workflow-1',
    attemptId: '123e4567-e89b-42d3-a456-426614174000',
};
const attemptId = expiredRun.attemptId;

const cleanupRun: WorkerLostLockCleanup = {
    ...expiredRun,
    workflowId: 'workflow-1',
};

function createStore(
    expiredRuns: ExpiredSupervisedRun[] = [expiredRun],
    cleanupRuns: WorkerLostLockCleanup[] = [],
) {
    const store: jest.Mocked<ExpiredRunReconciliationStore> = {
        listExpiredSupervisedRuns: jest.fn().mockResolvedValue(expiredRuns),
        listWorkerLostLockCleanup: jest.fn().mockResolvedValue(cleanupRuns),
        markExpiredRunWorkerLost: jest.fn().mockResolvedValue(true),
        markWorkerLostWorkspaceLockReleased: jest.fn().mockResolvedValue(true),
    };
    return store;
}

function createLockRecovery(release: RunWorkspaceLockRelease = 'released') {
    return { releaseForRun: jest.fn().mockResolvedValue(release) };
}

describe('MongoExpiredRunReconciler', () => {
    it('keeps the run and workspace lock when Docker quiescence cannot be proven', async () => {
        const store = createStore();
        const docker: DockerAttemptRecoveryPort = { stopAndVerify: jest.fn().mockResolvedValue(null) };
        const locks = createLockRecovery();

        const summary = await new MongoExpiredRunReconciler(docker, store, locks).reconcile();

        expect(summary).toEqual({ reconciled: 0, unresolved: 1, lockCleanupPending: 0 });
        expect(store.markExpiredRunWorkerLost).not.toHaveBeenCalled();
        expect(locks.releaseForRun).not.toHaveBeenCalled();
    });

    it('marks a quiescent expired run WORKER_LOST before releasing its workspace lock', async () => {
        const store = createStore();
        const docker: DockerAttemptRecoveryPort = { stopAndVerify: jest.fn().mockResolvedValue('exited') };
        const locks = createLockRecovery();

        const summary = await new MongoExpiredRunReconciler(docker, store, locks).reconcile();

        expect(summary).toEqual({ reconciled: 1, unresolved: 0, lockCleanupPending: 0 });
        expect(store.markExpiredRunWorkerLost).toHaveBeenCalledWith('run-1', attemptId, 'exited');
        expect(locks.releaseForRun).toHaveBeenCalledWith('user-1', 'workflow-1', 'run-1');
        expect(store.markWorkerLostWorkspaceLockReleased).toHaveBeenCalledWith('run-1', attemptId);
    });

    it('never releases a workspace lock now owned by another run', async () => {
        const store = createStore();
        const docker: DockerAttemptRecoveryPort = { stopAndVerify: jest.fn().mockResolvedValue('absent') };
        const locks = createLockRecovery('owned_by_another_run');
        const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);

        try {
            const summary = await new MongoExpiredRunReconciler(docker, store, locks).reconcile();

            expect(summary).toEqual({ reconciled: 1, unresolved: 0, lockCleanupPending: 1 });
            expect(store.markWorkerLostWorkspaceLockReleased).not.toHaveBeenCalled();
            expect(log).toHaveBeenCalled();
        } finally {
            log.mockRestore();
        }
    });

    it('retries persisting a confirmed lock release after restart', async () => {
        const store = createStore([], [cleanupRun]);
        const docker: DockerAttemptRecoveryPort = { stopAndVerify: jest.fn() };
        const locks = createLockRecovery('absent');

        const summary = await new MongoExpiredRunReconciler(docker, store, locks).reconcile();

        expect(summary).toEqual({ reconciled: 0, unresolved: 0, lockCleanupPending: 0 });
        expect(locks.releaseForRun).toHaveBeenCalledWith('user-1', 'workflow-1', 'run-1');
        expect(store.markWorkerLostWorkspaceLockReleased).toHaveBeenCalledWith('run-1', attemptId);
        expect(docker.stopAndVerify).not.toHaveBeenCalled();
    });

    it('keeps the lock cleanup pending when the run changes before terminalization', async () => {
        const store = createStore();
        store.markExpiredRunWorkerLost.mockResolvedValue(false);
        const docker: DockerAttemptRecoveryPort = { stopAndVerify: jest.fn().mockResolvedValue('dead') };
        const locks = createLockRecovery();

        const summary = await new MongoExpiredRunReconciler(docker, store, locks).reconcile();

        expect(summary).toEqual({ reconciled: 0, unresolved: 0, lockCleanupPending: 0 });
        expect(locks.releaseForRun).not.toHaveBeenCalled();
    });
});
