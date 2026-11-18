import mongoose from 'mongoose';

type Db = NonNullable<mongoose.Connection['db']>;

import { UserToolRun } from '../../models/UserToolRun.model';
import { Workflow } from '../../models/Workflow.model';

import type {
    FenceAuditEntry,
    FenceAuditPort,
    FenceAndRetryIdempotencyRecord,
    FenceAndRetryRunView,
    QuarantinedRunStorePort,
    RunCommandIdempotencyPort,
    RuntimeAlertEntry,
    RuntimeAlertPort,
    WorkflowOwnershipPort,
} from './fenceAndRetry.ports';

const DURABLE_WRITE = { w: 'majority' as const, wtimeoutMS: 10_000 };

function requireDb(connection: mongoose.Connection): Db {
    if (connection.readyState !== 1 || !connection.db) {
        throw new Error('MongoDB must be connected for fence-and-retry persistence');
    }
    return connection.db;
}

/**
 * Journal d'audit du fencing gateway — collection immuable (append-only) :
 * seules des insertions sont exposées ; aucune mise à jour ni suppression.
 */
export class MongoGatewayFenceAuditStore implements FenceAuditPort {

    constructor(private readonly connection: mongoose.Connection = mongoose.connection) {}

    async record(entry: FenceAuditEntry): Promise<void> {
        await requireDb(this.connection)
            .collection('gateway_fence_audit')
            .insertOne({ ...entry }, { writeConcern: DURABLE_WRITE });
    }
}

export class MongoRuntimeAlertsStore implements RuntimeAlertPort {

    constructor(private readonly connection: mongoose.Connection = mongoose.connection) {}

    async raise(entry: RuntimeAlertEntry): Promise<void> {
        await requireDb(this.connection)
            .collection('runtime_alerts')
            .insertOne(
                { ...entry, createdAt: new Date(), acknowledgedAt: null },
                { writeConcern: DURABLE_WRITE },
            );
    }
}

export class MongoRunCommandIdempotencyStore implements RunCommandIdempotencyPort {

    constructor(private readonly connection: mongoose.Connection = mongoose.connection) {}

    private collection() {
        return requireDb(this.connection).collection<FenceAndRetryIdempotencyRecord & { _id: string }>('run_command_idempotency');
    }

    async find(storageId: string): Promise<FenceAndRetryIdempotencyRecord | null> {
        const record = await this.collection()
            .findOne({ _id: storageId }, { readConcern: { level: 'majority' } });
        return record ?? null;
    }

    async store(record: FenceAndRetryIdempotencyRecord): Promise<void> {
        await this.collection()
            .insertOne({ _id: record.storageId, ...record }, { writeConcern: DURABLE_WRITE });
    }
}

export function buildFenceAndRetryStorageId(userId: string, idempotencyKey: string): string {
    return `${userId}:fence-and-retry:${idempotencyKey}`;
}

export class MongoQuarantinedRunStore implements QuarantinedRunStorePort {

    async findOwnedRunInWorkspace(executionId: string, ownerUserId: string, workflowId: string): Promise<FenceAndRetryRunView | null> {
        if (!mongoose.isValidObjectId(ownerUserId) || !mongoose.isValidObjectId(workflowId)) {
            return null;
        }
        const run = await UserToolRun.findOne({
            executionId,
            ownerUserId: new mongoose.Types.ObjectId(ownerUserId),
            workflowId: new mongoose.Types.ObjectId(workflowId),
        })
            .select('+supervisedAttempt')
            .read('primary')
            .readConcern('majority')
            .maxTimeMS(10_000)
            .lean();
        if (!run) return null;
        return {
            executionId: run.executionId,
            ownerUserId: run.ownerUserId.toString(),
            workflowId: run.workflowId?.toString() ?? null,
            status: run.status,
            error: run.error ?? null,
            recoveryAttemptCount: run.recoveryAttemptCount ?? null,
            supervisedAttempt: run.supervisedAttempt ? { attemptId: run.supervisedAttempt.attemptId } : null,
            agentInstanceId: run.agentInstanceId?.toString() ?? null, // ⭐ J7-09
        };
    }
}

export class MongoWorkflowOwnershipStore implements WorkflowOwnershipPort {

    async existsOwnedWorkflow(workspaceId: string, userId: string): Promise<boolean> {
        if (!mongoose.isValidObjectId(workspaceId) || !mongoose.isValidObjectId(userId)) {
            return false;
        }
        const ownerUserId = new mongoose.Types.ObjectId(userId);
        const workflowId = new mongoose.Types.ObjectId(workspaceId);
        const ownedWorkflow = await Workflow.exists({
            _id: workflowId,
            userId: ownerUserId,
        });
        return ownedWorkflow !== null;
    }
}
