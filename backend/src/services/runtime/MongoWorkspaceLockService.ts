import { randomUUID } from 'crypto';
import mongoose from 'mongoose';

interface WorkspaceLockDocument {
    _id: string;
    owner: string;
    token: string;
    acquiredAt: Date;
}

export interface WorkspaceLock {
    key: string;
    owner: string;
    token: string;
}

export type RunWorkspaceLockRelease = 'released' | 'absent' | 'owned_by_another_run';

const DURABLE_WRITE = { w: 'majority' as const, wtimeoutMS: 10_000 };

// Locks are never stolen on timeout: a disconnected or paused process may still
// have a running container or resume later. Release requires separate proof
// that all protected work has stopped.
export class MongoWorkspaceLockService {
    constructor(private readonly connection: mongoose.Connection = mongoose.connection) {}

    async tryAcquire(ownerUserId: string, workflowId: string, owner: string): Promise<WorkspaceLock | null> {
        if (!owner.trim()) {
            throw new Error('Workspace lock owner is required');
        }
        const key = this.buildKey(ownerUserId, workflowId);
        const token = randomUUID();
        try {
            await this.collection().insertOne(
                { _id: key, owner, token, acquiredAt: new Date() },
                { writeConcern: DURABLE_WRITE },
            );
            return { key, owner, token };
        } catch (error) {
            if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11000) {
                return null;
            }
            throw error;
        }
    }

    async release(lock: WorkspaceLock): Promise<boolean> {
        const result = await this.collection().deleteOne(
            { _id: lock.key, owner: lock.owner, token: lock.token },
            { writeConcern: DURABLE_WRITE },
        );
        return result.deletedCount === 1;
    }

    async getOwner(ownerUserId: string, workflowId: string): Promise<string | null> {
        const key = this.buildKey(ownerUserId, workflowId);
        const lock = await this.collection().findOne({ _id: key }, { projection: { owner: 1 } });
        return lock?.owner ?? null;
    }

    async releaseForRun(
        ownerUserId: string,
        workflowId: string,
        executionId: string,
    ): Promise<RunWorkspaceLockRelease> {
        if (!executionId.trim()) throw new Error('Workspace lock run identity is required');
        const key = this.buildKey(ownerUserId, workflowId);
        const released = await this.collection().deleteOne(
            { _id: key, owner: executionId },
            { writeConcern: DURABLE_WRITE },
        );
        if (released.deletedCount === 1) return 'released';
        const current = await this.collection().findOne({ _id: key }, { projection: { owner: 1 } });
        return current ? 'owned_by_another_run' : 'absent';
    }

    private collection() {
        if (this.connection.readyState !== 1 || !this.connection.db) {
            throw new Error('MongoDB must be connected to coordinate workspace locks');
        }
        return this.connection.db.collection<WorkspaceLockDocument>('workspace_execution_locks');
    }

    private buildKey(ownerUserId: string, workflowId: string): string {
        if (!mongoose.isValidObjectId(ownerUserId) || !mongoose.isValidObjectId(workflowId)) {
            throw new Error('Workspace lock requires valid user and workflow ObjectIds');
        }
        return `${new mongoose.Types.ObjectId(ownerUserId).toHexString()}:${new mongoose.Types.ObjectId(workflowId).toHexString()}`;
    }
}
