import { DockerAttemptReservation } from './DockerAttemptReservation';
import type { DockerAttemptRecoveryPort } from './DockerGatewayAttemptRecovery';
import { MongoWorkspaceLockService, type RunWorkspaceLockRelease } from './MongoWorkspaceLockService';
import { UserToolRunService } from '../userToolRun.service';

export interface ExpiredRunReconciliationSummary {
    reconciled: number;
    unresolved: number;
    lockCleanupPending: number;
}

export interface ExpiredRunReconciliationStore {
    listExpiredSupervisedRuns(): ReturnType<UserToolRunService['listExpiredSupervisedRuns']>;
    listWorkerLostLockCleanup(): ReturnType<UserToolRunService['listWorkerLostLockCleanup']>;
    markExpiredRunWorkerLost(
        executionId: string,
        attemptId: string,
        containerState: 'absent' | 'created' | 'exited' | 'dead',
    ): Promise<boolean>;
    markWorkerLostWorkspaceLockReleased(executionId: string, attemptId: string): Promise<boolean>;
}

export interface RunWorkspaceLockRecovery {
    releaseForRun(ownerUserId: string, workflowId: string, executionId: string): Promise<RunWorkspaceLockRelease>;
}

export class MongoExpiredRunReconciler {
    constructor(
        private readonly docker: DockerAttemptRecoveryPort,
        private readonly runs: ExpiredRunReconciliationStore = new UserToolRunService(),
        private readonly locks: RunWorkspaceLockRecovery = new MongoWorkspaceLockService(),
    ) {}

    async reconcile(): Promise<ExpiredRunReconciliationSummary> {
        const summary: ExpiredRunReconciliationSummary = {
            reconciled: 0,
            unresolved: 0,
            lockCleanupPending: 0,
        };
        await this.retryWorkerLostLockCleanup(summary);

        for (const run of await this.runs.listExpiredSupervisedRuns()) {
            const expectedContainerName = DockerAttemptReservation.containerName(run.attemptId);
            let containerState: 'absent' | 'created' | 'exited' | 'dead' | null;
            try {
                containerState = await this.docker.stopAndVerify(run.attemptId);
            } catch (error) {
                containerState = null;
                console.error('[MongoExpiredRunReconciler] Docker state inspection failed; run remains quarantined', {
                    executionId: run.executionId,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
            if (!containerState) {
                summary.unresolved += 1;
                console.warn('[MongoExpiredRunReconciler] Docker effects are not proven quiescent; retaining run and workspace lock', {
                    executionId: run.executionId,
                    attemptId: run.attemptId,
                    containerName: expectedContainerName,
                });
                continue;
            }

            if (!await this.runs.markExpiredRunWorkerLost(run.executionId, run.attemptId, containerState)) {
                continue;
            }
            summary.reconciled += 1;
            if (!run.workflowId) continue;

            const release = await this.locks.releaseForRun(run.ownerUserId, run.workflowId, run.executionId);
            await this.recordLockRelease(run.executionId, run.attemptId, release, summary);
        }
        return summary;
    }

    private async retryWorkerLostLockCleanup(summary: ExpiredRunReconciliationSummary): Promise<void> {
        for (const run of await this.runs.listWorkerLostLockCleanup()) {
            const release = await this.locks.releaseForRun(run.ownerUserId, run.workflowId, run.executionId);
            await this.recordLockRelease(run.executionId, run.attemptId, release, summary);
        }
    }

    private async recordLockRelease(
        executionId: string,
        attemptId: string,
        release: RunWorkspaceLockRelease,
        summary: ExpiredRunReconciliationSummary,
    ): Promise<void> {
        if (release === 'owned_by_another_run') {
            summary.lockCleanupPending += 1;
            console.error('[MongoExpiredRunReconciler] Workspace lock belongs to a different run; it was not released', {
                executionId,
            });
            return;
        }
        if (!await this.runs.markWorkerLostWorkspaceLockReleased(executionId, attemptId)) {
            summary.lockCleanupPending += 1;
            console.error('[MongoExpiredRunReconciler] Could not persist workspace lock release confirmation', {
                executionId,
            });
        }
    }
}
