import { randomUUID } from 'crypto';
import mongoose from 'mongoose';
import { DockerAttemptReservation } from './DockerAttemptReservation';
import type { SupervisedAttemptIdentity } from './MongoSupervisedAttemptService';

const OPERATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const OPERATIONS = ['create', 'start', 'stop', 'kill', 'remove', 'inspect'] as const;
export type DockerOperationKind = typeof OPERATIONS[number];
export type DockerOperationOutcome = 'response_observed' | 'unknown';

export interface DockerOperation {
    id: string;
    kind: DockerOperationKind;
}

export interface DockerOperationJournal {
    admission: 'open' | 'closed';
    pending: DockerOperation | null;
    lastOutcome: { operation: DockerOperation; outcome: DockerOperationOutcome } | null;
    hasUnknownOutcome: boolean;
}

interface JournalRun {
    executionId: string;
    supervisedAttempt: { attemptId: string; dockerJournal?: DockerOperationJournal } | null;
}

const DURABLE_WRITE = { w: 'majority' as const, wtimeoutMS: 10_000 };

// Neither admission closure nor a response proves Docker quiescence.
export class MongoDockerOperationJournal {
    constructor(private readonly connection: mongoose.Connection = mongoose.connection) {}

    async admit(identity: SupervisedAttemptIdentity, kind: DockerOperationKind): Promise<DockerOperation> {
        this.validateIdentity(identity);
        if (!OPERATIONS.some((value) => value === kind)) throw new Error('Unknown Docker operation kind');
        const operation = { id: randomUUID(), kind };
        const result = await this.collection().updateOne(
            {
                executionId: identity.executionId, 'supervisedAttempt.attemptId': identity.attemptId,
                'supervisedAttempt.dockerJournal.admission': 'open',
                'supervisedAttempt.dockerJournal.pending': null,
                'supervisedAttempt.dockerJournal.hasUnknownOutcome': false,
            },
            { $set: { 'supervisedAttempt.dockerJournal.pending': operation } },
            { writeConcern: DURABLE_WRITE },
        );
        if (result.matchedCount !== 1) {
            throw new Error('Docker operation admission refused: journal missing, closed, busy or uncertain');
        }
        return operation;
    }

    async close(identity: SupervisedAttemptIdentity): Promise<void> {
        this.validateIdentity(identity);
        const result = await this.collection().updateOne(
            {
                executionId: identity.executionId, 'supervisedAttempt.attemptId': identity.attemptId,
                'supervisedAttempt.dockerJournal.admission': { $in: ['open', 'closed'] },
            },
            { $set: { 'supervisedAttempt.dockerJournal.admission': 'closed' } },
            { writeConcern: DURABLE_WRITE },
        );
        if (result.matchedCount !== 1) throw new Error('Docker operation journal not found');
    }

    async recordOutcome(identity: SupervisedAttemptIdentity, operationId: string, outcome: DockerOperationOutcome): Promise<void> {
        this.validateIdentity(identity);
        if (!OPERATION_ID.test(operationId)) throw new Error('Docker operation requires a UUID v4 identity');
        if (outcome !== 'response_observed' && outcome !== 'unknown') throw new Error('Unknown Docker operation outcome');
        const update = outcome === 'unknown'
            ? { 'supervisedAttempt.dockerJournal.pending': null, 'supervisedAttempt.dockerJournal.hasUnknownOutcome': true }
            : { 'supervisedAttempt.dockerJournal.pending': null };
        const result = await this.collection().updateOne(
            {
                executionId: identity.executionId, 'supervisedAttempt.attemptId': identity.attemptId,
                'supervisedAttempt.dockerJournal.pending.id': operationId,
            },
            [{ $set: {
                ...update,
                'supervisedAttempt.dockerJournal.lastOutcome': {
                    operation: '$supervisedAttempt.dockerJournal.pending', outcome: { $literal: outcome },
                },
            } }],
            { writeConcern: DURABLE_WRITE },
        );
        if (result.matchedCount !== 1) throw new Error('Docker operation outcome refused: operation is not pending');
    }

    async read(identity: SupervisedAttemptIdentity): Promise<DockerOperationJournal> {
        this.validateIdentity(identity);
        const run = await this.collection().findOne(
            { executionId: identity.executionId, 'supervisedAttempt.attemptId': identity.attemptId },
            { projection: { supervisedAttempt: 1 }, readConcern: { level: 'majority' } },
        );
        const journal = run?.supervisedAttempt?.dockerJournal;
        if (!journal) throw new Error('Docker operation journal not found');
        return journal;
    }

    private validateIdentity(identity: SupervisedAttemptIdentity): void {
        if (!identity.executionId.trim()
            || DockerAttemptReservation.containerName(identity.attemptId) !== identity.containerName) {
            throw new Error('Docker operation journal requires a complete matching attempt identity');
        }
    }

    private collection() {
        if (this.connection.readyState !== 1 || !this.connection.db) {
            throw new Error('MongoDB must be connected to journal Docker operations');
        }
        return this.connection.db.collection<JournalRun>('user_tool_runs');
    }
}
