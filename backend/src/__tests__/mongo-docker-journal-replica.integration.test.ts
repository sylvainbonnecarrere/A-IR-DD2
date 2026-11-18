import { execFile } from 'child_process';
import { randomUUID } from 'crypto';
import path from 'path';
import { promisify } from 'util';
import mongoose from 'mongoose';
import { DockerAttemptReservation } from '../services/runtime/DockerAttemptReservation';
import { MongoDockerOperationJournal } from '../services/runtime/MongoDockerOperationJournal';
import { MongoWorkspaceLockService } from '../services/runtime/MongoWorkspaceLockService';
import type { RunLease } from '../services/runtime/MongoRunLeaseService';

const describeReplica = process.env.AIRDD2_TEST_MONGO_REPLICA === '1' ? describe : describe.skip;
const execFileAsync = promisify(execFile);

describeReplica('Docker operation journal with a disposable MongoDB replica set', () => {
    it('preserves a closed journal and pending operation across primary election', async () => {
        const testId = randomUUID();
        const network = `airdd2-j7-replica-${testId}`;
        const label = `airdd2.j7.replica=${testId}`;
        const aliases = ['mongo-a', 'mongo-b', 'mongo-c'];
        const containers: string[] = [];
        const connections: mongoose.Connection[] = [];
        const docker = async (...args: string[]) =>
            (await execFileAsync('docker', args, { timeout: 30_000, maxBuffer: 1024 * 1024 })).stdout.trim();

        try {
            await docker('image', 'inspect', 'mongo:6');
            await docker('network', 'create', '--label', label, network);
            for (const alias of aliases) {
                const id = await docker(
                    'run', '--detach', '--pull=never', '--label', label, '--network', network,
                    '--network-alias', alias, '--publish', '127.0.0.1::27017',
                    'mongo:6', '--replSet', 'j7test', '--bind_ip_all',
                );
                if (!/^[0-9a-f]{64}$/.test(id)) throw new Error('Invalid replica test container ID');
                containers.push(id);
            }
            const deadline = Date.now() + 60_000;
            const waitFor = async (predicate: () => Promise<boolean>, description: string) => {
                while (Date.now() < deadline) {
                    if (await predicate()) return;
                    await new Promise((resolve) => setTimeout(resolve, 500));
                }
                throw new Error(`Timed out waiting for ${description}`);
            };
            const ports = await Promise.all(containers.map(async (id) => {
                const mapping = await docker('port', id, '27017');
                const match = /^127\.0\.0\.1:(\d+)$/.exec(mapping);
                if (!match) throw new Error('Replica test port is not bound to loopback');
                return Number(match[1]);
            }));
            await waitFor(async () => {
                try {
                    await docker('exec', containers[0], 'mongosh', '--quiet', '--eval', 'db.adminCommand({ping:1}).ok');
                    return true;
                } catch (error) {
                    if (!(error instanceof Error)) throw error;
                    return false;
                }
            }, 'first replica member');
            await docker('exec', containers[0], 'mongosh', '--quiet', '--eval',
                'rs.initiate({_id:"j7test",members:[{_id:0,host:"mongo-a:27017"},{_id:1,host:"mongo-b:27017"},{_id:2,host:"mongo-c:27017"}]})');
            for (const port of ports) {
                connections.push(mongoose.createConnection(
                    `mongodb://127.0.0.1:${port}/journal_replica_test?directConnection=true&serverSelectionTimeoutMS=2000`,
                ));
            }
            await Promise.all(connections.map((connection) => connection.asPromise()));
            const findPrimary = async (excluded?: mongoose.Connection) => {
                for (const connection of connections) {
                    if (connection === excluded || !connection.db) continue;
                    try {
                        const hello = await connection.db.admin().command({ hello: 1 });
                        if (hello.isWritablePrimary === true) return connection;
                    } catch (error) {
                        if (!(error instanceof mongoose.mongo.MongoServerSelectionError)
                            && !(error instanceof mongoose.mongo.MongoNetworkError)) throw error;
                    }
                }
                return undefined;
            };
            const waitForPrimary = async (excluded?: mongoose.Connection): Promise<mongoose.Connection> => {
                const until = Date.now() + 60_000;
                while (Date.now() < until) {
                    const found = await findPrimary(excluded);
                    if (found) return found;
                    await new Promise((resolve) => setTimeout(resolve, 500));
                }
                throw new Error('Timed out waiting for a replica primary');
            };
            let elected = await waitForPrimary();
            if (!elected?.db) throw new Error('Replica test has no primary');
            const attemptId = randomUUID();
            const identity = {
                executionId: randomUUID(), attemptId,
                containerName: DockerAttemptReservation.containerName(attemptId),
            };
            await elected.db.collection('user_tool_runs').insertOne({
                executionId: identity.executionId,
                supervisedAttempt: {
                    attemptId, dockerJournal: {
                        admission: 'open', pending: null, lastOutcome: null, hasUnknownOutcome: false,
                    },
                },
            }, { writeConcern: { w: 'majority', wtimeoutMS: 10_000 } });
            const journal = new MongoDockerOperationJournal(elected);
            const operation = await journal.admit(identity, 'create');
            await journal.close(identity);
            const userId = new mongoose.Types.ObjectId().toHexString();
            const workflowId = new mongoose.Types.ObjectId().toHexString();
            const lock = await new MongoWorkspaceLockService(elected).tryAcquire(userId, workflowId, 'old-worker');
            if (!lock) throw new Error('Expected exclusive workspace lock');
            const leaseFixture = path.join(__dirname, 'fixtures', 'replica-run-lease-worker.ts');
            const runLeaseAction = async (connection: mongoose.Connection, action: string, lease?: RunLease) => {
                const index = connections.indexOf(connection);
                const mapping = await docker('port', containers[index], '27017');
                const match = /^127\.0\.0\.1:(\d+)$/.exec(mapping);
                if (!match) throw new Error('Replica test port is not bound to loopback');
                let stdout: string;
                try {
                    ({ stdout } = await execFileAsync(process.execPath, ['--import', 'tsx', leaseFixture, action], {
                        timeout: 60_000,
                        env: {
                            ...process.env,
                            AIRDD2_REPLICA_TEST_URI: `mongodb://127.0.0.1:${match[1]}/journal_replica_test?directConnection=true`,
                            AIRDD2_REPLICA_TEST_EXECUTION_ID: `replica-lease-${testId}`,
                            AIRDD2_REPLICA_TEST_LEASE: lease ? JSON.stringify(lease) : '',
                        },
                    }));
                } catch (error) {
                    if (typeof error === 'object' && error !== null && 'stderr' in error && typeof error.stderr === 'string') {
                        throw new Error(`Replica lease fixture ${action} failed: ${error.stderr.trim()}`);
                    }
                    throw error;
                }
                const result = /^AIRDD2_REPLICA_RESULT=(.+)$/m.exec(stdout);
                if (!result) throw new Error('Replica lease fixture did not return a result');
                return JSON.parse(result[1]);
            };
            const runLease: RunLease = await runLeaseAction(elected, 'create-and-claim');
            expect(runLease).toMatchObject({ owner: 'replica-worker', token: expect.any(String) });
            expect(await runLeaseAction(elected, 'cancel-queued')).toEqual({ kind: 'stopped' });
            const oldPrimary = elected;
            try {
                await oldPrimary.db!.admin().command({ replSetStepDown: 15, secondaryCatchUpPeriodSecs: 5 });
            } catch (error) {
                if (!(error instanceof Error) || !/connection|socket|network|not primary/i.test(error.message)) throw error;
            }
            elected = await waitForPrimary(oldPrimary);
            const recovered = new MongoDockerOperationJournal(elected);
            expect(await recovered.read(identity)).toMatchObject({
                admission: 'closed', pending: operation, hasUnknownOutcome: false,
            });
            await expect(recovered.admit(identity, 'start')).rejects.toThrow('admission refused');
            expect(await runLeaseAction(elected, 'claim')).toBeNull();
            expect(await runLeaseAction(elected, 'start', runLease)).toEqual({ status: 'running' });
            expect(await runLeaseAction(elected, 'cancel-running')).toEqual({ kind: 'requested' });
            const recoveredLocks = new MongoWorkspaceLockService(elected);
            expect(await recoveredLocks.tryAcquire(userId, workflowId, 'new-worker')).toBeNull();
            expect(await recoveredLocks.release({ ...lock, token: randomUUID() })).toBe(false);
            expect(await recoveredLocks.release(lock)).toBe(true);
            const replacementLock = await recoveredLocks.tryAcquire(userId, workflowId, 'new-worker');
            if (!replacementLock) throw new Error('Expected replacement workspace lock');

            const uncertainAttemptId = randomUUID();
            const uncertainIdentity = {
                executionId: randomUUID(), attemptId: uncertainAttemptId,
                containerName: DockerAttemptReservation.containerName(uncertainAttemptId),
            };
            if (!elected.db) throw new Error('Replacement primary connection unavailable');
            await elected.db.collection('user_tool_runs').insertOne({
                executionId: uncertainIdentity.executionId,
                supervisedAttempt: {
                    attemptId: uncertainAttemptId,
                    dockerJournal: { admission: 'open', pending: null, lastOutcome: null, hasUnknownOutcome: false },
                },
            }, { writeConcern: { w: 'majority', wtimeoutMS: 10_000 } });
            const remainingIndex = connections.indexOf(elected);
            const stopped = containers.filter((_id, index) => index !== remainingIndex);
            for (const id of stopped) await docker('stop', '--time', '2', id);
            await expect(recovered.admit(uncertainIdentity, 'create')).rejects.toThrow();
            await expect(recoveredLocks.tryAcquire(userId, new mongoose.Types.ObjectId().toHexString(), 'no-quorum'))
                .rejects.toThrow();
            await expect(runLeaseAction(elected, 'create-unconfirmed')).rejects.toThrow('Replica lease fixture create-unconfirmed failed');
            for (const id of stopped) {
                await docker('start', id);
                const index = containers.indexOf(id);
                await connections[index].close();
                const mapping = await docker('port', id, '27017');
                const match = /^127\.0\.0\.1:(\d+)$/.exec(mapping);
                if (!match) throw new Error('Restarted replica port is not bound to loopback');
                connections[index] = mongoose.createConnection(
                    `mongodb://127.0.0.1:${Number(match[1])}/journal_replica_test?directConnection=true&serverSelectionTimeoutMS=10000`,
                );
                await connections[index].asPromise();
            }
            elected = await waitForPrimary();
            const afterQuorum = new MongoDockerOperationJournal(elected);
            expect(await afterQuorum.read(identity)).toMatchObject({
                admission: 'closed', pending: operation, hasUnknownOutcome: false,
            });
            await afterQuorum.close(uncertainIdentity);
            const uncertainState = await afterQuorum.read(uncertainIdentity);
            expect(uncertainState.admission).toBe('closed');
            if (uncertainState.pending) {
                expect(uncertainState.pending).toEqual({ id: expect.any(String), kind: 'create' });
            }
            await expect(afterQuorum.admit(uncertainIdentity, 'start')).rejects.toThrow('admission refused');

            const untilHealthy = Date.now() + 60_000;
            let healthy = false;
            while (Date.now() < untilHealthy) {
                if (!elected.db) throw new Error('Replica primary connection unavailable');
                const status = await elected.db.admin().command({ replSetGetStatus: 1 });
                if (Array.isArray(status.members)
                    && status.members.filter((member: { health?: number; stateStr?: string }) =>
                        member.health === 1 && member.stateStr === 'SECONDARY').length === 2) {
                    healthy = true;
                    break;
                }
                await new Promise((resolve) => setTimeout(resolve, 500));
            }
            if (!healthy) throw new Error('Replica secondaries did not recover before the primary crash test');
            const failedPrimary = elected;
            const failedId = containers[connections.indexOf(failedPrimary)];
            if (!failedId) throw new Error('Cannot identify the disposable Mongo primary container');
            await docker('kill', failedId);
            const crashPrimary = await waitForPrimary(failedPrimary);
            const afterCrash = new MongoDockerOperationJournal(crashPrimary);
            expect(await afterCrash.read(identity)).toMatchObject({
                admission: 'closed', pending: operation, hasUnknownOutcome: false,
            });
            expect(await afterCrash.read(uncertainIdentity)).toEqual(uncertainState);
            await expect(afterCrash.admit(uncertainIdentity, 'start')).rejects.toThrow('admission refused');
            const crashLocks = new MongoWorkspaceLockService(crashPrimary);
            expect(await crashLocks.tryAcquire(userId, workflowId, 'after-crash')).toBeNull();
            expect(await crashLocks.release(replacementLock)).toBe(true);
            expect(await runLeaseAction(crashPrimary, 'claim')).toBeNull();
            if (!crashPrimary.db) throw new Error('Replica primary connection unavailable');
            const runsAfterCrash = crashPrimary.db.collection('user_tool_runs');
            expect(await runsAfterCrash.findOne(
                { executionId: `${runLease.executionId}-cancelled` },
                { readConcern: { level: 'majority' } },
            )).toMatchObject({ status: 'stopped', cancellationRequestedAt: expect.any(Date) });
            expect(await runsAfterCrash.findOne(
                { executionId: runLease.executionId },
                { readConcern: { level: 'majority' } },
            )).toMatchObject({ status: 'running', cancellationRequestedAt: expect.any(Date) });
            expect(await runLeaseAction(crashPrimary, 'complete', runLease)).toEqual({ status: 'completed' });
        } finally {
            try {
                await Promise.all(connections.map((connection) => connection.close()));
            } finally {
                const discovered = await docker('container', 'ls', '--all', '--no-trunc', '--filter', `label=${label}`, '--format', '{{.ID}}');
                for (const id of discovered.split(/\s+/).filter(Boolean)) {
                    if (!/^[0-9a-f]{64}$/.test(id)) throw new Error('Invalid replica test container ID');
                    if (!containers.includes(id)) containers.push(id);
                }
                for (const id of containers) await docker('rm', '--force', id);
                const networks = await docker('network', 'ls', '--no-trunc', '--filter', `label=${label}`, '--format', '{{.ID}}');
                for (const id of networks.split(/\s+/).filter(Boolean)) {
                    if (!/^[0-9a-f]{64}$/.test(id)) throw new Error('Invalid replica test network ID');
                    await docker('network', 'rm', id);
                }
            }
        }
    }, 240_000);
});
