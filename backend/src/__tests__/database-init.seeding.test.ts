import { nativeFunctionsSeed } from '../seeds/nativeFunctions.seed';
import { seedNativeFunctions, seedSharedExampleFunctions } from '../services/databaseInit';

describe('databaseInit canonical tool seeding', () => {
    it('seeds native startup tools directly into user_tools without touching legacy persistence', async () => {
        const userToolsCol = {
            findOne: jest.fn().mockResolvedValue(null),
            updateOne: jest.fn().mockResolvedValue({ upsertedCount: 1, modifiedCount: 0 }),
        };
        const db = {
            collection: jest.fn((name: string) => {
                if (name === 'user_tools') {
                    return userToolsCol;
                }

                throw new Error(`Unexpected collection ${name}`);
            }),
        };

        await seedNativeFunctions(db as any);

        expect(userToolsCol.updateOne).toHaveBeenCalledTimes(nativeFunctionsSeed.length);
        expect(userToolsCol.updateOne).toHaveBeenCalledWith(
            expect.objectContaining({
                ownerUserId: null,
                scopeType: 'native',
                name: nativeFunctionsSeed[0].name,
            }),
            expect.objectContaining({
                $set: expect.objectContaining({
                    ownerUserId: null,
                    scopeType: 'native',
                    name: nativeFunctionsSeed[0].name,
                }),
            }),
            { upsert: true },
        );
        expect(db.collection).not.toHaveBeenCalledWith('user_functions');
    });

    it('seeds the shared hello_test example directly into user_tools without touching legacy persistence', async () => {
        const userToolsCol = {
            findOne: jest.fn().mockResolvedValue(null),
            updateOne: jest.fn().mockResolvedValue({ upsertedCount: 1, modifiedCount: 0 }),
            deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }),
        };
        const db = {
            collection: jest.fn((name: string) => {
                if (name === 'user_tools') {
                    return userToolsCol;
                }

                throw new Error(`Unexpected collection ${name}`);
            }),
        };

        await seedSharedExampleFunctions(db as any);

        expect(userToolsCol.deleteMany).toHaveBeenCalledWith({
            name: 'hello_test',
            $or: [
                { ownerUserId: { $ne: null } },
                { isReadonly: { $ne: true } },
            ],
        });
        expect(userToolsCol.updateOne).toHaveBeenCalledWith(
            expect.objectContaining({
                ownerUserId: null,
                scopeType: 'user',
                name: 'hello_test',
            }),
            expect.objectContaining({
                $set: expect.objectContaining({
                    ownerUserId: null,
                    scopeType: 'user',
                    name: 'hello_test',
                    trustLevel: 'internal',
                    isReadonly: true,
                }),
            }),
            { upsert: true },
        );
        expect(db.collection).not.toHaveBeenCalledWith('user_functions');
    });
});