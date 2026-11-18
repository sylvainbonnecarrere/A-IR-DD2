import mongoose from 'mongoose';

import {
    DEFAULT_RECOVERY_POLICY,
    buildAutoRecoveryIdempotencyKey,
    canAutoRecoverRun,
    isAgentAutoRecoveryEnvEnabled,
    normalizeRecoveryPolicy,
    type RecoveryPolicy,
} from '../../domain/execution/recoveryPolicy.contract';

import { AgentInstance } from '../../models/AgentInstance.model';
import { AgentPrototype } from '../../models/AgentPrototype.model';

import { FenceAndRetryService } from '../fenceAndRetry.service';

export interface QuarantinedRunEntry {
    executionId: string;
    ownerUserId: string;
    workflowId: string | null;
    attemptId: string;
    recoveryAttemptCount?: number | null;
    agentInstanceId?: string | null;
    agentPrototypeId?: string | null;
}

export type AutoRecoveryOutcome =
    | 'recovered'
    | 'disabled'
    | 'policy_off'
    | 'threshold_reached'
    | 'no_workspace'
    | 'failed';

/**
 * Port d'auto-recovery (US-J7-08, conception §4.6) : exécuté par le reconciler
 * pour un run `quarantined` dont l'agent a `recoveryPolicy.autoFenceAndRetry`
 * actif et `recoveryAttemptCount < maxAttempts`.
 */
export interface AutoRecoveryPort {
    tryRecoverQuarantinedRun(run: QuarantinedRunEntry): Promise<AutoRecoveryOutcome>;
}

/**
 * Auto-recovery fail-closed : la séquence est exactement celle de
 * `fence-and-retry` avec `reason: 'AGENT_AUTO_RECOVERY'` (audit signé
 * `agent_auto_recovery`, `actorUserId = ownerUserId`). Toute erreur laisse le
 * run `quarantined` (l'alerte 504 est persistée par le service fence-and-retry).
 * Double garde-fou : policy agent + env `AGENT_AUTO_RECOVERY=true`.
 */
export class AgentAutoRecoveryService implements AutoRecoveryPort {

    constructor(
        private readonly fenceAndRetry: FenceAndRetryService,
        private readonly env: NodeJS.ProcessEnv = process.env,
    ) {}

    async tryRecoverQuarantinedRun(run: QuarantinedRunEntry): Promise<AutoRecoveryOutcome> {
        if (!isAgentAutoRecoveryEnvEnabled(this.env)) {
            return 'disabled';
        }
        if (!run.workflowId) {
            return 'no_workspace';
        }
        const policy = await this.resolvePolicy(run);
        const recoveryAttemptCount = run.recoveryAttemptCount ?? 0;
        if (!canAutoRecoverRun(policy, recoveryAttemptCount)) {
            return policy.autoFenceAndRetry && policy.maxAttempts > 0
                ? 'threshold_reached'
                : 'policy_off';
        }

        try {
            await this.fenceAndRetry.fenceAndRetry({
                userId: run.ownerUserId,
                workspaceId: run.workflowId,
                runId: run.executionId,
                idempotencyKey: buildAutoRecoveryIdempotencyKey(run.executionId, recoveryAttemptCount),
                reason: 'AGENT_AUTO_RECOVERY',
            });
            return 'recovered';
        } catch (error) {
            console.error('[AgentAutoRecoveryService] Auto-recovery failed closed; run stays quarantined', {
                runId: run.executionId,
                attemptId: run.attemptId,
                error: error instanceof Error ? error.message : String(error),
            });
            return 'failed';
        }
    }

    /** Policy snapshotée sur l'instance, sinon sur le prototype, sinon défaut off. */
    private async resolvePolicy(run: QuarantinedRunEntry): Promise<RecoveryPolicy> {
        try {
            if (run.agentInstanceId && mongoose.isValidObjectId(run.agentInstanceId)) {
                const instance = await AgentInstance.findById(run.agentInstanceId).select('recoveryPolicy').lean();
                if (instance?.recoveryPolicy) {
                    return normalizeRecoveryPolicy(instance.recoveryPolicy);
                }
            }
            if (run.agentPrototypeId && mongoose.isValidObjectId(run.agentPrototypeId)) {
                const prototype = await AgentPrototype.findById(run.agentPrototypeId).select('recoveryPolicy').lean();
                if (prototype?.recoveryPolicy) {
                    return normalizeRecoveryPolicy(prototype.recoveryPolicy);
                }
            }
        } catch (error) {
            console.error('[AgentAutoRecoveryService] Policy resolution failed; defaulting to off', {
                runId: run.executionId,
                error: error instanceof Error ? error.message : String(error),
            });
        }
        return { ...DEFAULT_RECOVERY_POLICY };
    }
}
