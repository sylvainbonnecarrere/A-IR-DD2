import { createHash, randomUUID } from 'crypto';
import { UserToolRun } from '../../models/UserToolRun.model';
import { DockerAttemptReservation } from './DockerAttemptReservation';
import type { RunLease } from './MongoRunLeaseService';

export interface SupervisedAttemptIdentity {
    executionId: string;
    attemptId: string;
    containerName: string;
}

export interface SupervisedAttemptStore {
    create(lease: RunLease): Promise<SupervisedAttemptIdentity>;
}

export class MongoSupervisedAttemptService implements SupervisedAttemptStore {
    async create(lease: RunLease): Promise<SupervisedAttemptIdentity> {
        if (!lease.executionId.trim() || !lease.owner.trim() || !lease.token.trim()) {
            throw new Error('A complete lease identity is required for a supervised attempt');
        }
        const attemptId = randomUUID();
        const containerName = DockerAttemptReservation.containerName(attemptId);
        const digest = createHash('sha256').update(lease.token, 'utf8').digest('hex');
        const run = await UserToolRun.findOneAndUpdate(
            {
                executionId: lease.executionId,
                status: 'running',
                supervisedAttempt: null,
                cancellationRequestedAt: null,
                'lease.owner': lease.owner,
                'lease.token': lease.token,
                $expr: { $gt: ['$lease.expiresAt', '$$NOW'] },
            },
            [{
                $set: {
                    supervisedAttempt: {
                        attemptId: { $literal: attemptId },
                        leaseOwner: { $literal: lease.owner },
                        leaseTokenDigest: { $literal: digest },
                        createdAt: '$$NOW',
                        dockerJournal: {
                            admission: 'open',
                            pending: null,
                            lastOutcome: null,
                            hasUnknownOutcome: false,
                        },
                    },
                },
            }],
            { new: true, writeConcern: { w: 'majority', wtimeoutMS: 10_000 } },
        ).select('+supervisedAttempt');
        if (!run?.supervisedAttempt || run.supervisedAttempt.attemptId !== attemptId) {
            throw new Error('Supervised attempt was not created: run, lease, cancellation, or attempt state changed');
        }
        return { executionId: lease.executionId, attemptId, containerName };
    }
}
