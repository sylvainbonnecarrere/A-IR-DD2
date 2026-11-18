import { randomUUID } from 'crypto';

import { execFile } from 'child_process';

import { tmpdir } from 'os';

import path from 'path';

import { promisify } from 'util';

import mongoose from 'mongoose';

import { UserToolRun } from '../models/UserToolRun.model';

import { UserToolRunService } from '../services/userToolRun.service';

import type { DockerGatewayEpoch } from '../services/runtime/DockerGatewayAdmission';

import { DockerGatewayClient } from '../services/runtime/DockerGatewayClient';

import { DockerGatewayControlClient } from '../services/runtime/DockerGatewayControlClient';

import { DockerGatewayFencedAttemptProof } from '../services/runtime/DockerGatewayFencedAttemptProof';

import { DockerGatewayServer } from '../services/runtime/DockerGatewayServer';

import { MongoDockerGatewayAdmission } from '../services/runtime/MongoDockerGatewayAdmission';

import { MongoExpiredRunReconciler } from '../services/runtime/MongoExpiredRunReconciler';

import { MongoRunLeaseService } from '../services/runtime/MongoRunLeaseService';

import { MongoSupervisedAttemptService } from '../services/runtime/MongoSupervisedAttemptService';

import { MongoWorkspaceLockService } from '../services/runtime/MongoWorkspaceLockService';

import { SpawnDockerProcessRunner } from '../services/runtime/DockerSandboxRunner';

const describeDocker = process.env.AIRDD2_TEST_DOCKER_RESERVATION === '1' ? describe : describe.skip;

const execFileAsync = promisify(execFile);


describeDocker('Docker gateway recovery against the Linux daemon', () => {

    const runs = new UserToolRunService();
    const locks = new MongoWorkspaceLockService();
    const processRunner = new SpawnDockerProcessRunner();
    const testId = randomUUID();
    let userId: mongoose.Types.ObjectId;
    let workflowId: mongoose.Types.ObjectId;
    let server: DockerGatewayServer | undefined;
    let client: DockerGatewayClient;
    let control: DockerGatewayControlClient;
    let admission: MongoDockerGatewayAdmission;
    let oldEpoch: DockerGatewayEpoch;
    let socketPath: string;

    async function docker(...args: string[]): Promise<string> {
        return (await execFileAsync('docker', args, { timeout: 15_000 })).stdout.trim();
    }

    beforeEach(async () => {
        userId = new mongoose.Types.ObjectId();
        workflowId = new mongoose.Types.ObjectId();
        admission = new MongoDockerGatewayAdmission();
        await admission.recoverAfterRestart();
        oldEpoch = await admission.activateWorker('old-worker');
        socketPath = process.platform === 'win32'
            ? `\\\\.\\pipe\\airdd2-recovery-${randomUUID()}`
            : path.join(tmpdir(), `airdd2-recovery-${randomUUID()}.sock`);
        server = new DockerGatewayServer({
            socketPath,
            admission,
            commandRunner: { run: (args, options) => processRunner.run('docker', args, options) },
            inertImage: 'ubuntu:noble',
        });
        await server.listen();
        client = new DockerGatewayClient({ socketPath, epoch: oldEpoch });
        control = new DockerGatewayControlClient({ socketPath });
    });

    afterEach(async () => {
        await server?.close();
        server = undefined;
        const ids = await docker('container', 'ls', '--all', '--no-trunc', '--filter',
            `label=airdd2.gateway-recovery.test=${testId}`, '--format', '{{.ID}}');
        for (const id of ids.split(/\s+/).filter(Boolean)) {
            if (!/^[0-9a-f]{64}$/.test(id)) throw new Error('Invalid test container ID');
            await docker('rm', '--force', id);
        }
    });

    async function createExpiredRun() {
        const executionId = `recovery-${randomUUID()}`;
        await runs.createQueuedRun({
            executionId,
            ownerUserId: userId,
            toolId: new mongoose.Types.ObjectId(),
            workflowId,
            toolVersionTag: 'v1',
            toolContentHash: 'hash',
            launchContext: 'editor_test',
            runtime: 'typescript',
            policySnapshot: { networkMode: 'none' },
        });
        const lease = await new MongoRunLeaseService(30_000).claimQueued('old-worker');
        if (!lease) throw new Error('Expected claimed run');
        await runs.markRunning(executionId, new Date(), 'docker_sandbox', lease);

        const attempt = await new MongoSupervisedAttemptService().create(lease);

        if (!await locks.tryAcquire(userId.toHexString(), workflowId.toHexString(), executionId)) {
            throw new Error('Expected workspace lock');
        }
        await UserToolRun.updateOne({ executionId }, { $set: { 'lease.expiresAt': new Date(0) } });
        return attempt;
    }

    async function createContainer(name: string, label: string): Promise<void> {
        const id = await docker('run', '-d', `--name=${name}`, '--pull=never',
            '--label', `airdd2.gateway-recovery.test=${testId}`, '--label', label,
            '--network=none', 'ubuntu:noble', 'sleep', '120');
        if (!/^[0-9a-f]{64}$/.test(id)) throw new Error('Invalid created test container ID');
    }

    async function reconcileWithNewWorker() {
        const nextEpoch = await control.activateWorker('new-worker');
        const replacement = new DockerGatewayClient({ socketPath, epoch: nextEpoch });
        const summary = await new MongoExpiredRunReconciler(
            new DockerGatewayFencedAttemptProof(admission, control, replacement), runs, locks,
        ).reconcile();
        return { summary, nextEpoch };
    }

    it('fences the old worker, proves quiescence on a real running attempt, and releases only its workspace', async () => {
        const attempt = await createExpiredRun();
        await createContainer(attempt.containerName, `airdd2.execution.attempt=${attempt.attemptId}`);
        const operation = await admission.admit(oldEpoch, {
            command: 'run',
            containerName: attempt.containerName,
            attemptId: attempt.attemptId,
        });
        const { summary } = await reconcileWithNewWorker();
        const oldResult = await client.run('docker', ['inspect', attempt.containerName]);
        expect(oldResult).toMatchObject({ exitCode: 1, errorMessage: expect.stringContaining('stale') });

        expect(summary).toEqual({ reconciled: 1, unresolved: 0, lockCleanupPending: 0 });
        // La réservation inerte occupe le nom sous le label de fencing (jamais le nom nu).
        expect(await docker('inspect', '--format', '{{.State.Status}}', attempt.containerName)).toBe('created');
        expect(await docker('inspect', '--format', '{{ index .Config.Labels "airdd2.fence.op" }}', attempt.containerName))
            .toBe(operation.id);
        const stored = await UserToolRun.findOne({ executionId: attempt.executionId })
            .select('+supervisedAttempt')
            .lean();
        expect(stored?.status).toBe('worker_lost');
        expect(stored?.error?.code).toBe('WORKER_LOST');
        expect(stored?.supervisedAttempt?.workerLossReconciliation).toMatchObject({
            containerState: 'absent',
            workspaceLockReleased: true,
        });
        expect(await locks.getOwner(userId.toHexString(), workflowId.toHexString())).toBeNull();
    }, 90_000);

    it('keeps the run quarantined and its workspace locked when the Docker identity does not match', async () => {
        const attempt = await createExpiredRun();
        await createContainer(attempt.containerName, `airdd2.execution.attempt=${randomUUID()}`);
        await admission.admit(oldEpoch, {
            command: 'run',
            containerName: attempt.containerName,
            attemptId: attempt.attemptId,
        });

        const { summary } = await reconcileWithNewWorker();

        expect(summary).toEqual({ reconciled: 0, unresolved: 1, lockCleanupPending: 0 });
        expect((await UserToolRun.findOne({ executionId: attempt.executionId }).lean())?.status).toBe('quarantined');
        expect(await locks.getOwner(userId.toHexString(), workflowId.toHexString())).toBe(attempt.executionId);
        expect(await docker('inspect', '--format', '{{.State.Status}}', attempt.containerName)).toBe('running');
    }, 90_000);

    it('keeps a paused attempt quarantined and its workspace locked', async () => {
        const attempt = await createExpiredRun();
        await createContainer(attempt.containerName, `airdd2.execution.attempt=${attempt.attemptId}`);
        await docker('pause', attempt.containerName);
        await admission.admit(oldEpoch, {
            command: 'run',
            containerName: attempt.containerName,
            attemptId: attempt.attemptId,
        });
        try {
            const { summary } = await reconcileWithNewWorker();

            expect(summary).toEqual({ reconciled: 0, unresolved: 1, lockCleanupPending: 0 });
            expect((await UserToolRun.findOne({ executionId: attempt.executionId }).lean())?.status).toBe('quarantined');
            expect(await locks.getOwner(userId.toHexString(), workflowId.toHexString())).toBe(attempt.executionId);
        } finally {
            await docker('unpause', attempt.containerName);
        }
    }, 90_000);
});
