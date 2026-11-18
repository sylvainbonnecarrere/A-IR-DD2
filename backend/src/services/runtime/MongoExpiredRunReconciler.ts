import { DockerAttemptReservation } from './DockerAttemptReservation';

import type { DockerAttemptFencingProof, DockerAttemptFencingProofPort } from './DockerGatewayFencedAttemptProof';

import { MongoWorkspaceLockService, type RunWorkspaceLockRelease } from './MongoWorkspaceLockService';

import { UserToolRunService } from '../userToolRun.service';

import type { AutoRecoveryPort, QuarantinedRunEntry } from './agentAutoRecovery.service';

export interface ExpiredRunReconciliationSummary {
    reconciled: number;
    unresolved: number;
    lockCleanupPending: number;
    autoRecovered: number;
}

export interface ExpiredRunReconciliationStore {
    listExpiredSupervisedRuns(): ReturnType<UserToolRunService['listExpiredSupervisedRuns']>;
    listWorkerLostLockCleanup(): ReturnType<UserToolRunService['listWorkerLostLockCleanup']>;
    listQuarantinedRunsForRecovery(): ReturnType<UserToolRunService['listQuarantinedRunsForRecovery']>;
    markExpiredRunWorkerLost(
        executionId: string,
        attemptId: string,
        containerState: 'absent' | 'created' | 'exited' | 'dead',
    ): Promise<boolean>;
    markRunQuarantined(executionId: string, attemptId: string, message?: string): Promise<boolean>;
    markWorkerLostWorkspaceLockReleased(executionId: string, attemptId: string): Promise<boolean>;
}

export interface RunWorkspaceLockRecovery {
    releaseForRun(ownerUserId: string, workflowId: string, executionId: string): Promise<RunWorkspaceLockRelease>;
}

export class MongoExpiredRunReconciler {

    constructor(
        private readonly fencing: DockerAttemptFencingProofPort,
        private readonly runs: ExpiredRunReconciliationStore = new UserToolRunService(),
        private readonly locks: RunWorkspaceLockRecovery = new MongoWorkspaceLockService(),
        private readonly autoRecovery?: AutoRecoveryPort,
    ) {}

    async reconcile(): Promise<ExpiredRunReconciliationSummary> {
        const summary: ExpiredRunReconciliationSummary = {
            reconciled: 0,
            unresolved: 0,
            lockCleanupPending: 0,
            autoRecovered: 0,
        };
        await this.retryWorkerLostLockCleanup(summary);

        const quarantinedThisPass = new Set<string>();

        for (const run of await this.runs.listExpiredSupervisedRuns()) {
            const expectedContainerName = DockerAttemptReservation.containerName(run.attemptId);
            let proof: DockerAttemptFencingProof | null;
            try {
                proof = await this.fencing.proveFencedAttempt(run.attemptId);
            } catch (error) {
                proof = null;
                console.error('[MongoExpiredRunReconciler] Gateway quiescence proof failed closed; run will be quarantined', {
                    executionId: run.executionId,
                    attemptId: run.attemptId,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
            if (!proof || !proof.quiescent || !proof.containerState) {
                // Fail-closed : preuve de quiescence absente -> `quarantined`, verrou workspace tenu.
                if (!await this.runs.markRunQuarantined(run.executionId, run.attemptId)) {
                    continue;
                }
                summary.unresolved += 1;
                quarantinedThisPass.add(run.executionId);
                console.warn('[MongoExpiredRunReconciler] Docker quiescence is not proven; run quarantined and workspace lock retained', {
                    executionId: run.executionId,
                    attemptId: run.attemptId,
                    containerName: expectedContainerName,
                    operationId: proof?.operationId ?? null,
                });
                await this.tryAutoRecover(run, summary);
                continue;
            }

            if (!await this.runs.markExpiredRunWorkerLost(run.executionId, run.attemptId, proof.containerState)) {
                continue;
            }
            summary.reconciled += 1;
            if (!run.workflowId) continue;

            const release = await this.locks.releaseForRun(run.ownerUserId, run.workflowId, run.executionId);
            await this.recordLockRelease(run.executionId, run.attemptId, release, summary);
        }

        // Runs déjà quarantinés avant ce pass (ex. redémarrage du worker) :
        // l'auto-recovery s'évalue aussi pour eux, une seule fois par run.
        for (const run of await this.runs.listQuarantinedRunsForRecovery()) {
            if (quarantinedThisPass.has(run.executionId)) continue;
            await this.tryAutoRecover(run, summary);
        }
        return summary;
    }

    private async tryAutoRecover(
        run: QuarantinedRunEntry,
        summary: ExpiredRunReconciliationSummary,
    ): Promise<void> {
        if (!this.autoRecovery || !run.workflowId) return;
        const outcome = await this.autoRecovery.tryRecoverQuarantinedRun(run);
        if (outcome === 'recovered') {
            summary.autoRecovered += 1;
            console.info('[MongoExpiredRunReconciler] Auto-recovery relaunched quarantined run', {
                executionId: run.executionId,
                attemptId: run.attemptId,
                recoveryAttemptCount: run.recoveryAttemptCount ?? 0,
            });
            return;
        }
        console.info('[MongoExpiredRunReconciler] Auto-recovery skipped quarantined run', {
            executionId: run.executionId,
            outcome,
        });
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
