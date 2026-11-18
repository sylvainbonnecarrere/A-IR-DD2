import { randomUUID } from 'crypto';
import { UserToolRun } from '../../models/UserToolRun.model';
import { DURABLE_RUN_WRITE_CONCERN } from './durableRunWriteConcern';
import { isReconstructionRejectionCode, type RunReconstructionRejectionCode } from '../../domain/execution/runReconstructionQuarantine';

export interface RunLease {
    executionId: string;
    owner: string;
    token: string;
    expiresAt: Date;
}

export type RunLeaseObservation =
    | { kind: 'active'; lease: RunLease }
    | { kind: 'cancellation_requested'; lease: RunLease }
    | { kind: 'lost' };

export class MongoRunLeaseService {
    constructor(private readonly leaseDurationMs: number) {
        if (!Number.isSafeInteger(leaseDurationMs) || leaseDurationMs < 1000 || leaseDurationMs > 86_400_000) {
            throw new RangeError('Lease duration must be an integer between 1000 and 86400000 milliseconds');
        }
    }

    // Queued leases may be reclaimed only while all consumers fence the transition
    // to running before starting a runner or performing irreversible work.
    async claimQueued(owner: string): Promise<RunLease | null> {
        if (!owner.trim()) {
            throw new Error('Lease owner is required');
        }
        const token = randomUUID();
        const run = await UserToolRun.findOneAndUpdate(
            {
                status: 'queued',
                reconstructionQuarantine: null,
                $expr: { $lte: [{ $ifNull: ['$lease.expiresAt', new Date(0)] }, '$$NOW'] },
            },
            [{
                $set: {
                    lease: {
                        owner: { $literal: owner },
                        token: { $literal: token },
                        acquiredAt: '$$NOW',
                        expiresAt: { $add: ['$$NOW', this.leaseDurationMs] },
                    },
                    // Set with the claim, before reconstruction can acquire a workspace lock.
                    workspaceRetentionProtected: true,
                },
            }],
            { new: true, sort: { 'timing.queuedAt': 1, _id: 1 }, writeConcern: DURABLE_RUN_WRITE_CONCERN },
        ).select('+lease.token');

        if (!run?.lease) {
            return null;
        }
        return { executionId: run.executionId, owner, token, expiresAt: run.lease.expiresAt };
    }

    async renew(lease: RunLease): Promise<RunLease | null> {
        const observation = await this.renewAndObserve(lease);
        return observation.kind === 'lost' ? null : observation.lease;
    }

    async renewAndObserve(lease: RunLease): Promise<RunLeaseObservation> {
        const run = await UserToolRun.findOneAndUpdate(
            {
                executionId: lease.executionId,
                status: { $in: ['queued', 'running'] },
                'lease.owner': lease.owner,
                'lease.token': lease.token,
                $expr: { $gt: ['$lease.expiresAt', '$$NOW'] },
            },
            [{ $set: { 'lease.expiresAt': { $add: ['$$NOW', this.leaseDurationMs] } } }],
            { new: true, writeConcern: DURABLE_RUN_WRITE_CONCERN },
        ).select('+lease.token');
        if (!run?.lease) {
            return { kind: 'lost' };
        }
        return {
            kind: run.cancellationRequestedAt ? 'cancellation_requested' : 'active',
            lease: { ...lease, expiresAt: run.lease.expiresAt },
        };
    }

    async releaseQueued(lease: RunLease): Promise<boolean> {
        const result = await UserToolRun.updateOne(
            {
                executionId: lease.executionId,
                status: 'queued',
                'lease.owner': lease.owner,
                'lease.token': lease.token,
                $expr: { $gt: ['$lease.expiresAt', '$$NOW'] },
            },
            { $set: { lease: null, workspaceRetentionProtected: false } },
            { writeConcern: DURABLE_RUN_WRITE_CONCERN },
        );
        return result.modifiedCount === 1;
    }

    async deferQueued(lease: RunLease): Promise<boolean> {
        const result = await UserToolRun.updateOne(
            {
                executionId: lease.executionId,
                status: 'queued',
                'lease.owner': lease.owner,
                'lease.token': lease.token,
                $expr: { $gt: ['$lease.expiresAt', '$$NOW'] },
            },
            [{
                $set: {
                    lease: null,
                    workspaceRetentionProtected: false,
                    'timing.queuedAt': '$$NOW',
                },
            }],
            { writeConcern: DURABLE_RUN_WRITE_CONCERN },
        );
        return result.modifiedCount === 1;
    }

    async quarantineQueued(lease: RunLease, code: RunReconstructionRejectionCode): Promise<boolean> {
        if (!isReconstructionRejectionCode(code)) {
            throw new Error('Invalid reconstruction quarantine code');
        }
        const result = await UserToolRun.updateOne(
            {
                executionId: lease.executionId,
                status: 'queued',
                reconstructionQuarantine: null,
                cancellationRequestedAt: null,
                'lease.owner': lease.owner,
                'lease.token': lease.token,
                $expr: { $gt: ['$lease.expiresAt', '$$NOW'] },
            },
            [{ $set: { reconstructionQuarantine: { code: { $literal: code }, quarantinedAt: '$$NOW' }, lease: null } }],
            { writeConcern: DURABLE_RUN_WRITE_CONCERN },
        );
        return result.modifiedCount === 1;
    }
}
