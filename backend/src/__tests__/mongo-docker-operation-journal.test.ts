import { execFile, spawn } from 'child_process';
import { randomUUID } from 'crypto';
import path from 'path';
import { promisify } from 'util';
import mongoose from 'mongoose';
import { UserToolRun } from '../models/UserToolRun.model';
import { UserToolRunService } from '../services/userToolRun.service';
import { MongoRunLeaseService } from '../services/runtime/MongoRunLeaseService';
import { MongoSupervisedAttemptService, type SupervisedAttemptIdentity } from '../services/runtime/MongoSupervisedAttemptService';
import { MongoDockerOperationJournal } from '../services/runtime/MongoDockerOperationJournal';
import { DockerAttemptReservation } from '../services/runtime/DockerAttemptReservation';

describe('experimental persistent Docker operation journal', () => {
    const journal = new MongoDockerOperationJournal();
    let identity: SupervisedAttemptIdentity;

    async function createAttempt(): Promise<SupervisedAttemptIdentity> {
        const runs = new UserToolRunService();
        const executionId = randomUUID();
        await runs.createQueuedRun({
            executionId, ownerUserId: new mongoose.Types.ObjectId(), toolId: new mongoose.Types.ObjectId(),
            toolVersionTag: 'v1', toolContentHash: 'hash', launchContext: 'editor_test',
            runtime: 'typescript', policySnapshot: { networkMode: 'none' },
        });
        const lease = await new MongoRunLeaseService(30_000).claimQueued('worker');
        if (!lease || lease.executionId !== executionId) throw new Error('Expected claimed run');
        await runs.markRunning(executionId, new Date(), 'docker_sandbox', lease);
        return new MongoSupervisedAttemptService().create(lease);
    }

    beforeEach(async () => { identity = await createAttempt(); });

    it('creates the journal atomically with the attempt and keeps it private', async () => {
        expect(await journal.read(identity)).toEqual({
            admission: 'open', pending: null, lastOutcome: null, hasUnknownOutcome: false,
        });
        const run = await UserToolRun.findOne({ executionId: identity.executionId }).lean();
        expect(run?.supervisedAttempt).toBeUndefined();
    });

    it('serializes competing admissions and refuses a second operation while pending', async () => {
        const results = await Promise.allSettled(Array.from({ length: 20 }, () => journal.admit(identity, 'create')));
        const admitted = results.filter((result) => result.status === 'fulfilled');
        expect(admitted).toHaveLength(1);
        expect(results.filter((result) => result.status === 'rejected')).toHaveLength(19);
        expect((await journal.read(identity)).pending).toEqual(admitted[0].value);
    });

    it('closes atomically when admission and closure race', async () => {
        for (let i = 0; i < 10; i++) {
            const attempt = i === 0 ? identity : await createAttempt();
            const [admission, closure] = await Promise.allSettled([journal.admit(attempt, 'start'), journal.close(attempt)]);
            expect(closure.status).toBe('fulfilled');
            const state = await journal.read(attempt);
            expect(state.admission).toBe('closed');
            expect(state.pending).toEqual(admission.status === 'fulfilled' ? admission.value : null);
            await expect(journal.admit(attempt, 'remove')).rejects.toThrow('admission refused');
            await journal.close(attempt);
        }
    });

    it('keeps an admitted operation after its process is forcibly terminated', async () => {
        const fixture = path.join(__dirname, 'fixtures', 'docker-journal-worker.ts');
        const child = spawn(process.execPath, ['--import', 'tsx', fixture, identity.executionId, identity.attemptId, 'wait'], {
            env: process.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
        });
        const exited = new Promise<void>((resolve, reject) => {
            child.once('error', reject);
            child.once('exit', () => resolve());
        });
        try {
            const output = await new Promise<string>((resolve, reject) => {
                let stdout = '';
                let stderr = '';
                const timer = setTimeout(() => reject(new Error('Journal worker did not become ready')), 15_000);
                child.stdout.on('data', (chunk: Buffer) => {
                    stdout += chunk.toString('utf8');
                    if (stdout.includes('\n')) { clearTimeout(timer); resolve(stdout.trim()); }
                });
                child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
                child.once('error', (error) => { clearTimeout(timer); reject(error); });
                child.once('exit', () => { clearTimeout(timer); reject(new Error(`Journal worker exited: ${stderr}`)); });
            });
            const operation = JSON.parse(output) as { id: string; kind: string };
            if (!child.kill()) throw new Error('Unable to terminate the journal worker');
            await exited;
            const recovered = new MongoDockerOperationJournal();
            await recovered.close(identity);
            expect(await recovered.read(identity)).toMatchObject({ admission: 'closed', pending: operation });
            await expect(recovered.admit(identity, 'start')).rejects.toThrow('admission refused');
        } finally {
            if (child.exitCode === null && child.signalCode === null) child.kill();
            await exited;
        }
    }, 30_000);

    it('allows one admission across separate processes', async () => {
        const fixture = path.join(__dirname, 'fixtures', 'docker-journal-worker.ts');
        const run = promisify(execFile);
        const children = await Promise.allSettled([0, 1].map(() => run(
            process.execPath, ['--import', 'tsx', fixture, identity.executionId, identity.attemptId],
            { env: process.env, timeout: 20_000 },
        )));
        expect(children.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
        expect(children.filter((result) => result.status === 'rejected')).toHaveLength(1);
        expect((await journal.read(identity)).pending?.kind).toBe('create');
    });

    it('records an observed response without reopening a closed journal', async () => {
        const operation = await journal.admit(identity, 'create');
        await journal.close(identity);
        await journal.recordOutcome(identity, operation.id, 'response_observed');
        expect(await journal.read(identity)).toMatchObject({
            admission: 'closed', pending: null, lastOutcome: { operation, outcome: 'response_observed' },
        });
        await expect(journal.admit(identity, 'start')).rejects.toThrow('admission refused');
    });

    it('admits a subsequent operation only after recording the prior response', async () => {
        const first = await journal.admit(identity, 'create');
        await journal.recordOutcome(identity, first.id, 'response_observed');
        const second = await journal.admit(identity, 'start');
        expect(second.id).not.toBe(first.id);
        await expect(journal.recordOutcome(identity, first.id, 'unknown')).rejects.toThrow('not pending');
        expect((await journal.read(identity)).pending).toEqual(second);
    });

    it('permanently blocks admissions after an unknown outcome', async () => {
        const operation = await journal.admit(identity, 'create');
        await journal.recordOutcome(identity, operation.id, 'unknown');
        expect(await journal.read(identity)).toMatchObject({ pending: null, hasUnknownOutcome: true });
        await expect(journal.admit(identity, 'start')).rejects.toThrow('admission refused');
        await expect(journal.recordOutcome(identity, operation.id, 'response_observed')).rejects.toThrow('not pending');
    });

    it('refuses wrong attempt, execution or name and does not create missing journals', async () => {
        const attemptId = randomUUID();
        const wrong = { ...identity, attemptId, containerName: DockerAttemptReservation.containerName(attemptId) };
        await expect(journal.close(wrong)).rejects.toThrow('not found');
        await expect(journal.admit(wrong, 'create')).rejects.toThrow('admission refused');
        await expect(journal.read({ ...identity, executionId: 'other' })).rejects.toThrow('not found');
        await expect(journal.read({ ...identity, containerName: 'other' })).rejects.toThrow('matching attempt');
        expect((await journal.read(identity)).admission).toBe('open');
    });

    it('fails closed for attempts created before journals existed', async () => {
        await UserToolRun.updateOne({ executionId: identity.executionId }, { $unset: { 'supervisedAttempt.dockerJournal': 1 } });
        await expect(journal.close(identity)).rejects.toThrow('not found');
        await expect(journal.admit(identity, 'create')).rejects.toThrow('admission refused');
        await expect(journal.read(identity)).rejects.toThrow('not found');
    });

    it('does not turn MongoDB unavailability into an empty or closed journal', async () => {
        const unavailable = new MongoDockerOperationJournal(mongoose.createConnection());
        await expect(unavailable.admit(identity, 'create')).rejects.toThrow('MongoDB must be connected');
        await expect(unavailable.close(identity)).rejects.toThrow('MongoDB must be connected');
        await expect(unavailable.read(identity)).rejects.toThrow('MongoDB must be connected');
    });

    it('surfaces a database failure during admission', async () => {
        if (!mongoose.connection.db) throw new Error('Test database is unavailable');
        const db = mongoose.connection.db;
        const collection = db.collection('user_tool_runs');
        const failUpdate = jest.spyOn(collection, 'updateOne').mockRejectedValueOnce(new Error('write outcome unknown'));
        const getCollection = jest.spyOn(db, 'collection').mockReturnValueOnce(collection);
        try {
            await expect(journal.admit(identity, 'create')).rejects.toThrow('write outcome unknown');
        } finally {
            getCollection.mockRestore();
            failUpdate.mockRestore();
        }
        expect((await journal.read(identity)).pending).toBeNull();
    });
});
