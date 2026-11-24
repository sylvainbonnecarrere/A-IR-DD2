import { logger } from '../services/logger';
import { MongoExpiredRunReconciler, type ExpiredRunReconciliationStore } from '../services/runtime/MongoExpiredRunReconciler';

import type { DockerAttemptFencingProofPort } from '../services/runtime/DockerGatewayFencedAttemptProof';

import type { ExpiredSupervisedRun, QuarantinedRecoveryRun, WorkerLostLockCleanup } from '../services/userToolRun.service';

import type { AutoRecoveryPort, QuarantinedRunEntry } from '../services/runtime/agentAutoRecovery.service';

import type { RunVisibilityPort } from '../services/runtime/runVisibility.service';

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
  quarantinedRuns: QuarantinedRecoveryRun[] = [],
) {
  const store: jest.Mocked<ExpiredRunReconciliationStore> = {
    listExpiredSupervisedRuns: jest.fn().mockResolvedValue(expiredRuns),
    listWorkerLostLockCleanup: jest.fn().mockResolvedValue(cleanupRuns),
    listQuarantinedRunsForRecovery: jest.fn().mockResolvedValue(quarantinedRuns),
    markExpiredRunWorkerLost: jest.fn().mockResolvedValue(true),
    markRunQuarantined: jest.fn().mockResolvedValue(true),
    markWorkerLostWorkspaceLockReleased: jest.fn().mockResolvedValue(true),
  };
  return store;
}

function createFencing(proof: Awaited<ReturnType<DockerAttemptFencingProofPort['proveFencedAttempt']>>) {
  return { proveFencedAttempt: jest.fn().mockResolvedValue(proof) };
}

function createLockRecovery(release: RunWorkspaceLockRelease = 'released') {
  return { releaseForRun: jest.fn().mockResolvedValue(release) };
}

describe('MongoExpiredRunReconciler', () => {
  it('quarantines the run and retains the workspace lock when no fenced operation proves quiescence', async () => {
    const store = createStore();
    const fencing = createFencing(null);
    const locks = createLockRecovery();

    const summary = await new MongoExpiredRunReconciler(fencing, store, locks).reconcile();

    expect(summary).toEqual({ reconciled: 0, unresolved: 1, lockCleanupPending: 0, autoRecovered: 0 });
    expect(store.markRunQuarantined).toHaveBeenCalledWith('run-1', attemptId);
    expect(store.markExpiredRunWorkerLost).not.toHaveBeenCalled();
    expect(locks.releaseForRun).not.toHaveBeenCalled();
  });

  it('quarantines the run when the gateway reports quiescence as not proven', async () => {
    const store = createStore();
    const fencing = createFencing({ operationId: '123e4567-e89b-42d3-a456-426614174001', quiescent: false, containerState: null });
    const locks = createLockRecovery();

    const summary = await new MongoExpiredRunReconciler(fencing, store, locks).reconcile();

    expect(summary).toEqual({ reconciled: 0, unresolved: 1, lockCleanupPending: 0, autoRecovered: 0 });
    expect(store.markRunQuarantined).toHaveBeenCalledWith('run-1', attemptId);
    expect(store.markExpiredRunWorkerLost).not.toHaveBeenCalled();
    expect(locks.releaseForRun).not.toHaveBeenCalled();
  });

  it('fails closed and quarantines when the gateway proof errors out', async () => {
    const store = createStore();
    const fencing: DockerAttemptFencingProofPort = {
      proveFencedAttempt: jest.fn().mockRejectedValue(new Error('gateway unreachable')),
    };
    const locks = createLockRecovery();
    const log = jest.spyOn(logger, 'error').mockImplementation(() => undefined);

    try {
      const summary = await new MongoExpiredRunReconciler(fencing, store, locks).reconcile();

      expect(summary).toEqual({ reconciled: 0, unresolved: 1, lockCleanupPending: 0, autoRecovered: 0 });
      expect(store.markRunQuarantined).toHaveBeenCalledWith('run-1', attemptId);
      expect(store.markExpiredRunWorkerLost).not.toHaveBeenCalled();
      expect(locks.releaseForRun).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it('marks a quiescent expired run worker_lost before releasing its workspace lock', async () => {
    const store = createStore();
    const fencing = createFencing({ operationId: '123e4567-e89b-42d3-a456-426614174001', quiescent: true, containerState: 'exited' });
    const locks = createLockRecovery();

    const summary = await new MongoExpiredRunReconciler(fencing, store, locks).reconcile();

    expect(summary).toEqual({ reconciled: 1, unresolved: 0, lockCleanupPending: 0, autoRecovered: 0 });
    expect(store.markRunQuarantined).not.toHaveBeenCalled();
    expect(store.markExpiredRunWorkerLost).toHaveBeenCalledWith('run-1', attemptId, 'exited');
    expect(locks.releaseForRun).toHaveBeenCalledWith('user-1', 'workflow-1', 'run-1');
    expect(store.markWorkerLostWorkspaceLockReleased).toHaveBeenCalledWith('run-1', attemptId);
  });

  it('never releases a workspace lock now owned by another run', async () => {
    const store = createStore();
    const fencing = createFencing({ operationId: '123e4567-e89b-42d3-a456-426614174001', quiescent: true, containerState: 'absent' });
    const locks = createLockRecovery('owned_by_another_run');
    const log = jest.spyOn(logger, 'error').mockImplementation(() => undefined);

    try {
      const summary = await new MongoExpiredRunReconciler(fencing, store, locks).reconcile();

      expect(summary).toEqual({ reconciled: 1, unresolved: 0, lockCleanupPending: 1, autoRecovered: 0 });
      expect(store.markWorkerLostWorkspaceLockReleased).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it('retries persisting a confirmed lock release after restart', async () => {
    const store = createStore([], [cleanupRun]);
    const fencing = createFencing(null);
    const locks = createLockRecovery('absent');

    const summary = await new MongoExpiredRunReconciler(fencing, store, locks).reconcile();

    expect(summary).toEqual({ reconciled: 0, unresolved: 0, lockCleanupPending: 0, autoRecovered: 0 });
    expect(locks.releaseForRun).toHaveBeenCalledWith('user-1', 'workflow-1', 'run-1');
    expect(store.markWorkerLostWorkspaceLockReleased).toHaveBeenCalledWith('run-1', attemptId);
    expect(fencing.proveFencedAttempt).not.toHaveBeenCalled();
  });

  it('keeps the lock cleanup pending when the run changes before terminalization', async () => {
    const store = createStore();
    store.markExpiredRunWorkerLost.mockResolvedValue(false);
    const fencing = createFencing({ operationId: '123e4567-e89b-42d3-a456-426614174001', quiescent: true, containerState: 'dead' });
    const locks = createLockRecovery();

    const summary = await new MongoExpiredRunReconciler(fencing, store, locks).reconcile();

    expect(summary).toEqual({ reconciled: 0, unresolved: 0, lockCleanupPending: 0, autoRecovered: 0 });
    expect(locks.releaseForRun).not.toHaveBeenCalled();
  });

  it('does not count an unresolved run when the quarantine marking loses the race', async () => {
    const store = createStore();
    store.markRunQuarantined.mockResolvedValue(false);
    const fencing = createFencing(null);
    const locks = createLockRecovery();

    const summary = await new MongoExpiredRunReconciler(fencing, store, locks).reconcile();

    expect(summary).toEqual({ reconciled: 0, unresolved: 0, lockCleanupPending: 0, autoRecovered: 0 });
    expect(locks.releaseForRun).not.toHaveBeenCalled();
  });

  it('invokes auto-recovery exactly once for a run quarantined during this pass', async () => {
    const store = createStore();
    const fencing = createFencing(null);
    const locks = createLockRecovery();
    const autoRecovery: jest.Mocked<AutoRecoveryPort> = {
      tryRecoverQuarantinedRun: jest.fn().mockResolvedValue('recovered'),
    };
    store.listQuarantinedRunsForRecovery.mockResolvedValue([
      {
        executionId: 'run-1',
        ownerUserId: 'user-1',
        workflowId: 'workflow-1',
        attemptId,
        recoveryAttemptCount: 0,
      },
    ]);

    const summary = await new MongoExpiredRunReconciler(fencing, store, locks, autoRecovery).reconcile();

    expect(summary).toEqual({ reconciled: 0, unresolved: 1, lockCleanupPending: 0, autoRecovered: 1 });
    expect(autoRecovery.tryRecoverQuarantinedRun).toHaveBeenCalledTimes(1);
    expect(autoRecovery.tryRecoverQuarantinedRun).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: 'run-1',
        workflowId: 'workflow-1',
        attemptId,
      } satisfies Partial<QuarantinedRunEntry>),
    );
  });

  it('evaluates auto-recovery for runs already quarantined before this pass', async () => {
    const store = createStore(
      [],
      [],
      [
        {
          executionId: 'run-old',
          ownerUserId: 'user-1',
          workflowId: 'workflow-1',
          attemptId: '123e4567-e89b-42d3-a456-426614174099',
          recoveryAttemptCount: 2,
        },
      ],
    );
    const fencing = createFencing({ operationId: '123e4567-e89b-42d3-a456-426614174001', quiescent: true, containerState: 'exited' });
    const locks = createLockRecovery();
    const autoRecovery: jest.Mocked<AutoRecoveryPort> = {
      tryRecoverQuarantinedRun: jest.fn().mockResolvedValue('threshold_reached'),
    };

    const summary = await new MongoExpiredRunReconciler(fencing, store, locks, autoRecovery).reconcile();

    expect(summary).toEqual({ reconciled: 0, unresolved: 0, lockCleanupPending: 0, autoRecovered: 0 });
    expect(autoRecovery.tryRecoverQuarantinedRun).toHaveBeenCalledTimes(1);
    expect(autoRecovery.tryRecoverQuarantinedRun).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: 'run-old',
        recoveryAttemptCount: 2,
      }),
    );
  });

  it('never invokes auto-recovery for a worker_lost run', async () => {
    const store = createStore();
    const fencing = createFencing({ operationId: '123e4567-e89b-42d3-a456-426614174001', quiescent: true, containerState: 'exited' });
    const locks = createLockRecovery();
    const autoRecovery: jest.Mocked<AutoRecoveryPort> = {
      tryRecoverQuarantinedRun: jest.fn().mockResolvedValue('recovered'),
    };

    const summary = await new MongoExpiredRunReconciler(fencing, store, locks, autoRecovery).reconcile();

    expect(summary).toEqual({ reconciled: 1, unresolved: 0, lockCleanupPending: 0, autoRecovered: 0 });
    expect(autoRecovery.tryRecoverQuarantinedRun).not.toHaveBeenCalled();
  });

  // ⭐ J7-09: visibilité
  it('records a run_quarantined visibility entry (lock held) when the run is quarantined', async () => {
    const store = createStore([{ ...expiredRun, agentInstanceId: '507f1f77bcf86cd799439012' }]);
    const fencing = createFencing(null);
    const locks = createLockRecovery();
    const visibility: jest.Mocked<RunVisibilityPort> = { record: jest.fn().mockResolvedValue(undefined) };

    const summary = await new MongoExpiredRunReconciler(fencing, store, locks, undefined, visibility).reconcile();

    expect(summary).toEqual({ reconciled: 0, unresolved: 1, lockCleanupPending: 0, autoRecovered: 0 });
    expect(visibility.record).toHaveBeenCalledTimes(1);
    expect(visibility.record).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workflow-1',
        runId: 'run-1',
        agentInstanceId: '507f1f77bcf86cd799439012',
        event: 'run_quarantined',
        cause: 'QUARANTINED',
        lockHeld: true,
      }),
    );
  });

  it('never records visibility for a worker_lost run', async () => {
    const store = createStore();
    const fencing = createFencing({ operationId: '123e4567-e89b-42d3-a456-426614174001', quiescent: true, containerState: 'exited' });
    const locks = createLockRecovery();
    const visibility: jest.Mocked<RunVisibilityPort> = { record: jest.fn().mockResolvedValue(undefined) };

    const summary = await new MongoExpiredRunReconciler(fencing, store, locks, undefined, visibility).reconcile();

    expect(summary).toEqual({ reconciled: 1, unresolved: 0, lockCleanupPending: 0, autoRecovered: 0 });
    expect(visibility.record).not.toHaveBeenCalled();
  });
});
