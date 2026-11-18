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
