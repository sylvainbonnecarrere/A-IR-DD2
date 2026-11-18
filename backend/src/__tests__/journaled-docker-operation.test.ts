import { randomUUID } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import mongoose from 'mongoose';
import { DockerAttemptReservation } from '../services/runtime/DockerAttemptReservation';
import { DockerOperationJournalFailure, JournaledDockerOperation } from '../services/runtime/JournaledDockerOperation';
import { MongoDockerOperationJournal } from '../services/runtime/MongoDockerOperationJournal';
import { MongoRunLeaseService } from '../services/runtime/MongoRunLeaseService';
import { MongoSupervisedAttemptService, type SupervisedAttemptIdentity } from '../services/runtime/MongoSupervisedAttemptService';
import { UserToolRunService } from '../services/userToolRun.service';

describe('experimental journaled Docker operation', () => {
    const journal = new MongoDockerOperationJournal();
    let identity: SupervisedAttemptIdentity;

    beforeEach(async () => {
        const executionId = randomUUID();
        const runs = new UserToolRunService();
        await runs.createQueuedRun({
            executionId, ownerUserId: new mongoose.Types.ObjectId(), toolId: new mongoose.Types.ObjectId(),
            toolVersionTag: 'v1', toolContentHash: 'hash', launchContext: 'editor_test',
            runtime: 'typescript', policySnapshot: { networkMode: 'none' },
        });
        const lease = await new MongoRunLeaseService(30_000).claimQueued('worker');
        if (!lease || lease.executionId !== executionId) throw new Error('Expected claimed run');
        await runs.markRunning(executionId, new Date(), 'docker_sandbox', lease);
        identity = await new MongoSupervisedAttemptService().create(lease);
    });

    it('sends only after admission is persisted and keeps the response pending', async () => {
        const transport = { send: jest.fn().mockImplementation(async () => {
            expect((await journal.read(identity)).pending).toMatchObject({ kind: 'create', id: expect.any(String) });
            return 'complete response';
        }) };
        const sender = new JournaledDockerOperation(journal, transport);
        await expect(sender.send(identity, 'create', 'payload')).resolves.toEqual({
            response: 'complete response', operationId: expect.any(String), state: 'unreconciled',
        });
        expect(transport.send).toHaveBeenCalledWith(identity, 'create', 'payload');
        expect((await journal.read(identity)).pending).toMatchObject({ kind: 'create' });
        await expect(sender.send(identity, 'start', 'payload')).rejects.toThrow('admission refused');
        expect(transport.send).toHaveBeenCalledTimes(1);
    });

    it('does not send if the admission was closed or the journal fails', async () => {
        const transport = { send: jest.fn() };
        const sender = new JournaledDockerOperation(journal, transport);
        await journal.close(identity);
        await expect(sender.send(identity, 'create', 'payload')).rejects.toThrow('admission refused');
        const unavailable = new JournaledDockerOperation(
            new MongoDockerOperationJournal(mongoose.createConnection()), transport,
        );
        await expect(unavailable.send(identity, 'create', 'payload')).rejects.toThrow('MongoDB must be connected');
        expect(transport.send).not.toHaveBeenCalled();
    });

    it('does not send when the admission response is lost after the majority write', async () => {
        const transport = { send: jest.fn() };
        const lostResponseJournal = {
            admit: async (current: SupervisedAttemptIdentity) => {
                await journal.admit(current, 'create');
                throw new Error('admission response lost after acknowledged write');
            },
            recordOutcome: journal.recordOutcome.bind(journal),
        };
        const sender = new JournaledDockerOperation(lostResponseJournal, transport);
        await expect(sender.send(identity, 'create', 'payload'))
            .rejects.toThrow('admission response lost after acknowledged write');
        expect(transport.send).not.toHaveBeenCalled();

        const recovered = new MongoDockerOperationJournal();
        await recovered.close(identity);
        expect(await recovered.read(identity)).toMatchObject({
            admission: 'closed', pending: { id: expect.any(String), kind: 'create' }, hasUnknownOutcome: false,
        });
        await expect(recovered.admit(identity, 'start')).rejects.toThrow('admission refused');
    });

    it('marks a rejected transport uncertain and refuses further sends', async () => {
        const transport = { send: jest.fn().mockRejectedValue(new Error('response lost')) };
        const sender = new JournaledDockerOperation(journal, transport);
        await expect(sender.send(identity, 'create', 'payload')).rejects.toThrow('response lost');
        expect(await journal.read(identity)).toMatchObject({
            pending: null, hasUnknownOutcome: true,
            lastOutcome: { operation: { kind: 'create' }, outcome: 'unknown' },
        });
        await expect(sender.send(identity, 'create', 'payload')).rejects.toThrow('admission refused');
        expect(transport.send).toHaveBeenCalledTimes(1);
    });

    it('exposes both errors if recording the uncertain outcome fails', async () => {
        const transportError = new Error('transport failed');
        const journalError = new Error('database unavailable');
        const failingJournal = {
            admit: journal.admit.bind(journal),
            recordOutcome: jest.fn().mockRejectedValue(journalError),
        };
        const sender = new JournaledDockerOperation(failingJournal, { send: jest.fn().mockRejectedValue(transportError) });
        await expect(sender.send(identity, 'create', 'payload')).rejects.toMatchObject({
            name: 'DockerOperationJournalFailure', transportError, journalError,
        } satisfies Partial<DockerOperationJournalFailure>);
        expect((await journal.read(identity)).pending).toMatchObject({ kind: 'create' });
        await expect(journal.admit(identity, 'start')).rejects.toThrow('admission refused');
    });

    it('sends at most one concurrent operation per attempt', async () => {
        let release!: () => void;
        const blocked = new Promise<void>((resolve) => { release = resolve; });
        const transport = { send: jest.fn().mockReturnValue(blocked) };
        const sender = new JournaledDockerOperation(journal, transport);
        const results = Array.from({ length: 10 }, () => sender.send(identity, 'create', 'payload'));
        const settled = Promise.allSettled(results);
        const deadline = Date.now() + 5000;
        while (transport.send.mock.calls.length === 0 && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 5));
        }
        release();
        const outcomes = await settled;
        expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
        expect(transport.send).toHaveBeenCalledTimes(1);
    });

    it('keeps an already admitted send pending if admission closes before transport starts', async () => {
        const pause: { release: () => void } = { release: () => undefined };
        const gate = new Promise<void>((resolve) => { pause.release = resolve; });
        let admitted!: () => void;
        const reached = new Promise<void>((resolve) => { admitted = resolve; });
        const delayedJournal = {
            admit: async (current: SupervisedAttemptIdentity) => {
                const operation = await journal.admit(current, 'create');
                admitted();
                await gate;
                return operation;
            },
            recordOutcome: journal.recordOutcome.bind(journal),
        };
        const transport = { send: jest.fn().mockResolvedValue('response') };
        const work = new JournaledDockerOperation(delayedJournal, transport).send(identity, 'create', 'payload');
        await reached;
        await journal.close(identity);
        pause.release();
        await expect(work).resolves.toMatchObject({ response: 'response', state: 'unreconciled' });
        expect(transport.send).toHaveBeenCalledTimes(1);
        expect(await journal.read(identity)).toMatchObject({ admission: 'closed', pending: { kind: 'create' } });
        await expect(journal.admit(identity, 'start')).rejects.toThrow('admission refused');
    });

    it('refuses a mismatched identity before transport', async () => {
        const attemptId = randomUUID();
        const other = { ...identity, attemptId, containerName: DockerAttemptReservation.containerName(attemptId) };
        const transport = { send: jest.fn() };
        await expect(new JournaledDockerOperation(journal, transport).send(other, 'remove', 'payload'))
            .rejects.toThrow('admission refused');
        expect(transport.send).not.toHaveBeenCalled();
    });

    const dockerIt = process.env.AIRDD2_TEST_DOCKER_RESERVATION === '1' ? it : it.skip;
    dockerIt('records the real late create when closure happens after admission', async () => {
        const docker = promisify(execFile);
        const runDocker = async (...args: string[]) =>
            (await docker('docker', args, { timeout: 15_000 })).stdout.trim();
        let resume!: () => void;
        const gate = new Promise<void>((resolve) => { resume = resolve; });
        let admitted!: () => void;
        const ready = new Promise<void>((resolve) => { admitted = resolve; });
        const delayedJournal = {
            admit: async (current: SupervisedAttemptIdentity) => {
                const operation = await journal.admit(current, 'create');
                admitted();
                await gate;
                return operation;
            },
            recordOutcome: journal.recordOutcome.bind(journal),
        };
        const label = `airdd2.j7.journal-test=${identity.attemptId}`;
        const transport = {
            send: async () => runDocker('create', `--name=${identity.containerName}`, '--pull=never',
                '--label', label, '--network=none', '--read-only', '--cap-drop=ALL', 'ubuntu:noble', '/bin/true'),
        };
        const work = new JournaledDockerOperation(delayedJournal, transport).send(identity, 'create', undefined);
        try {
            await Promise.race([
                ready,
                work.then(() => { throw new Error('Docker operation completed before admission was observed'); }),
            ]);
            await journal.close(identity);
            resume();
            const { response: id, operationId, state } = await work;
            expect(state).toBe('unreconciled');
            expect(id).toMatch(/^[0-9a-f]{64}$/);
            expect(await runDocker('inspect', '--format', '{{.Id}} {{.State.Running}}', id)).toBe(`${id} false`);
            expect(await journal.read(identity)).toMatchObject({ admission: 'closed', pending: { id: operationId, kind: 'create' } });
        } finally {
            resume();
            try {
                await work;
            } finally {
                const ids = await runDocker('container', 'ls', '--all', '--no-trunc', '--filter', `label=${label}`, '--format', '{{.ID}}');
                for (const id of ids.split(/\s+/).filter(Boolean)) {
                    if (!/^[0-9a-f]{64}$/.test(id)) throw new Error('Invalid test container ID');
                    await runDocker('rm', '--force', id);
                }
            }
        }
    }, 30_000);
});
