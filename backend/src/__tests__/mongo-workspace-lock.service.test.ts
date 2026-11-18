import { execFile } from 'child_process';
import path from 'path';
import { promisify } from 'util';
import mongoose from 'mongoose';
import { MongoWorkspaceLockService } from '../services/runtime/MongoWorkspaceLockService';

describe('MongoWorkspaceLockService', () => {
    const service = new MongoWorkspaceLockService();
    const userId = new mongoose.Types.ObjectId().toHexString();
    const workflowId = new mongoose.Types.ObjectId().toHexString();

    afterEach(async () => {
        if (!mongoose.connection.db) {
            throw new Error('Test database is unavailable');
        }
        await mongoose.connection.db.collection('workspace_execution_locks').deleteMany({});
    });

    it('allows one acquisition for the same workspace across two independent processes', async () => {
        const fixture = path.join(__dirname, 'fixtures', 'workspace-lock-worker.ts');
        const run = promisify(execFile);
        const results = await Promise.all(['first', 'second'].map((owner) =>
            run(process.execPath, ['--import', 'tsx', fixture, userId, workflowId, owner], {
                env: process.env, timeout: 20_000,
            }),
        ));
        expect(results.map(({ stdout }) => JSON.parse(stdout).acquired).sort()).toEqual([false, true]);
        expect(await service.tryAcquire(userId, workflowId, 'third')).toBeNull();
    });

    it('does not expire or steal a workspace lock after a process has exited', async () => {
        const fixture = path.join(__dirname, 'fixtures', 'workspace-lock-worker.ts');
        const run = promisify(execFile);
        const result = await run(process.execPath, ['--import', 'tsx', fixture, userId, workflowId, 'exited'], {
            env: process.env, timeout: 20_000,
        });
        expect(JSON.parse(result.stdout).acquired).toBe(true);
        expect(await service.tryAcquire(userId, workflowId, 'new-process')).toBeNull();
    });

    it('releases only the exact holder and isolates different workspaces', async () => {
        const lock = await service.tryAcquire(userId, workflowId, 'first');
        if (!lock) {
            throw new Error('Expected lock acquisition');
        }
        expect(await service.tryAcquire(userId, new mongoose.Types.ObjectId().toHexString(), 'second')).not.toBeNull();
        expect(await service.release({ ...lock, token: 'incorrect' })).toBe(false);
        expect(await service.release({ ...lock, owner: 'incorrect' })).toBe(false);
        expect(await service.tryAcquire(userId, workflowId, 'second')).toBeNull();
        expect(await service.release(lock)).toBe(true);
        expect(await service.release(lock)).toBe(false);
        expect(await service.tryAcquire(userId, workflowId, 'second')).not.toBeNull();
    });

    it('releases a run-owned lock conditionally and reports locks owned by another run', async () => {
        await service.tryAcquire(userId, workflowId, 'run-1');

        expect(await service.releaseForRun(userId, workflowId, 'run-2')).toBe('owned_by_another_run');
        expect(await service.getOwner(userId, workflowId)).toBe('run-1');
        expect(await service.releaseForRun(userId, workflowId, 'run-1')).toBe('released');
        expect(await service.releaseForRun(userId, workflowId, 'run-1')).toBe('absent');
    });

    it('normalizes ObjectIds and rejects invalid identities', async () => {
        const lock = await service.tryAcquire(userId.toUpperCase(), workflowId.toUpperCase(), 'first');
        expect(lock).not.toBeNull();
        expect(await service.tryAcquire(userId, workflowId, 'second')).toBeNull();
        await expect(service.tryAcquire('invalid', workflowId, 'first')).rejects.toThrow('valid user and workflow');
        await expect(service.tryAcquire(userId, workflowId, ' ')).rejects.toThrow('owner is required');
    });

    it('fails explicitly when MongoDB is unavailable', async () => {
        const disconnected = mongoose.createConnection();
        const unavailable = new MongoWorkspaceLockService(disconnected);
        await expect(unavailable.tryAcquire(userId, workflowId, 'worker'))
            .rejects.toThrow('MongoDB must be connected');
        await expect(unavailable.release({ key: 'key', owner: 'worker', token: 'token' }))
            .rejects.toThrow('MongoDB must be connected');
    });
});
