import mongoose from 'mongoose';
import { runDatabaseBootstrap } from '../services/databaseInit';

describe('run lease index bootstrap', () => {
    it('adds the lease expiry index to an existing database and is idempotent', async () => {
        const db = mongoose.connection.db;
        if (!db) {
            throw new Error('Test MongoDB connection is not ready');
        }
        await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
        await db.collection('user_tool_runs').dropIndex('idx_user_tool_runs_running_lease_expiry');
        await db.collection('user_tool_runs').insertOne({ executionId: 'legacy-run' });
        await runDatabaseBootstrap(db);
        await runDatabaseBootstrap(db);
        const indexes = await db.collection('user_tool_runs').listIndexes().toArray();
        const leaseIndexes = indexes.filter((index) => index.name === 'idx_user_tool_runs_running_lease_expiry');
        expect(leaseIndexes).toHaveLength(1);
        expect(leaseIndexes[0].key).toEqual({ status: 1, 'lease.expiresAt': 1 });
        expect(leaseIndexes[0].partialFilterExpression).toEqual({
            status: 'running', 'lease.expiresAt': { $type: 'date' },
        });
    });

    it('recreates the US-J7-06 partial indexes on an existing database and is idempotent', async () => {

        const db = mongoose.connection.db;
        if (!db) {
            throw new Error('Test MongoDB connection is not ready');
        }
        await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
        await db.collection('user_tool_runs').dropIndex('idx_user_tool_runs_recovery_attempts');
        await db.collection('user_tool_runs').dropIndex('idx_user_tool_runs_terminal_reconcilable');

        await runDatabaseBootstrap(db);
        await runDatabaseBootstrap(db);

        const indexes = await db.collection('user_tool_runs').listIndexes().toArray();

        const recoveryIndexes = indexes.filter((index) => index.name === 'idx_user_tool_runs_recovery_attempts');
        expect(recoveryIndexes).toHaveLength(1);
        expect(recoveryIndexes[0].key).toEqual({ ownerUserId: 1, retryOfExecutionId: 1, recoveryAttemptCount: -1 });
        expect(recoveryIndexes[0].partialFilterExpression).toEqual({ retryOfExecutionId: { $type: 'string' } });

        const reconcilableIndexes = indexes.filter((index) => index.name === 'idx_user_tool_runs_terminal_reconcilable');
        expect(reconcilableIndexes).toHaveLength(1);
        expect(reconcilableIndexes[0].key).toEqual({ status: 1, updatedAt: -1 });
        expect(reconcilableIndexes[0].partialFilterExpression).toEqual({ status: { $in: ['worker_lost', 'quarantined'] } });

        // Le watchdog actif reste limité aux seuls statuts non terminaux.
        const watchdog = indexes.filter((index) => index.name === 'idx_user_tool_runs_active_watchdog');
        expect(watchdog).toHaveLength(1);
        expect(watchdog[0].partialFilterExpression).toEqual({ status: { $in: ['queued', 'running'] } });
    });

    it('handles a collection created after the initial collection listing', async () => {
        const db = mongoose.connection.db;
        if (!db) throw new Error('Test MongoDB connection is not ready');
        await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
        const actual = await db.listCollections().toArray();
        if (!actual.some((collection) => collection.name === 'users')) {
            throw new Error('Expected the users collection for the bootstrap race test');
        }
        const originalList = db.listCollections.bind(db);
        const list = jest.spyOn(db, 'listCollections').mockImplementationOnce((...args) => {
            const cursor = originalList(...args);
            jest.spyOn(cursor, 'toArray').mockResolvedValueOnce(
                actual.filter((collection) => collection.name !== 'users'),
            );
            return cursor;
        });

        try {
            await expect(runDatabaseBootstrap(db)).resolves.toBeUndefined();
        } finally {
            list.mockRestore();
        }
        const users = await db.listCollections({ name: 'users' }).toArray();
        const info = users[0];
        if (!info || !('options' in info)) throw new Error('Expected users collection options');
        expect(info.options?.validator).toHaveProperty('$jsonSchema');
    });
});
