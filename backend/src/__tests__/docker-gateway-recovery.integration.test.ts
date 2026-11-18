import { execFile } from 'child_process';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import path from 'path';
import { promisify } from 'util';
import mongoose from 'mongoose';
import { UserToolRun } from '../models/UserToolRun.model';
import { UserToolRunService } from '../services/userToolRun.service';
import { DockerGatewayAttemptRecovery } from '../services/runtime/DockerGatewayAttemptRecovery';
import { DockerGatewayClient } from '../services/runtime/DockerGatewayClient';
import { DockerGatewayControlClient } from '../services/runtime/DockerGatewayControlClient';
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
    let socketPath: string;

    async function docker(...args: string[]): Promise<string> {
        return (await execFileAsync('docker', args, { timeout: 15_000 })).stdout.trim();
    }

    beforeEach(async () => {
        userId = new mongoose.Types.ObjectId();
        workflowId = new mongoose.Types.ObjectId();
        const admission = new MongoDockerGatewayAdmission();
        await admission.recoverAfterRestart();
        const epoch = await admission.activateWorker('old-worker');
        socketPath = process.platform === 'win32'
            ? `\\\\.\\pipe\\airdd2-recovery-${randomUUID()}`
            : path.join(tmpdir(), `airdd2-recovery-${randomUUID()}.sock`);
        server = new DockerGatewayServer({
            socketPath,
            admission,
            commandRunner: { run: (args, options) => processRunner.run('docker', args, options) },
        });
        await server.listen();
        client = new DockerGatewayClient({ socketPath, epoch });
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

    it('fences the old worker, stops a real running attempt, and releases only its workspace', async () => {
        const attempt = await createExpiredRun();
        await createContainer(attempt.containerName, `airdd2.execution.attempt=${attempt.attemptId}`);
        const nextEpoch = await control.activateWorker('new-worker');
        const replacement = new DockerGatewayClient({ socketPath, epoch: nextEpoch });
        const oldResult = await client.run('docker', ['inspect', attempt.containerName]);
        expect(oldResult).toMatchObject({ exitCode: 1, errorMessage: expect.stringContaining('stale') });

        const summary = await new MongoExpiredRunReconciler(
            new DockerGatewayAttemptRecovery(replacement), runs, locks,
        ).reconcile();

        expect(summary).toEqual({ reconciled: 1, unresolved: 0, lockCleanupPending: 0 });
        expect(await docker('inspect', '--format', '{{.State.Status}}', attempt.containerName)).toBe('exited');
        const stored = await UserToolRun.findOne({ executionId: attempt.executionId })
            .select('+supervisedAttempt').lean();
        expect(stored?.status).toBe('failed');
        expect(stored?.error?.code).toBe('WORKER_LOST');
        expect(stored?.supervisedAttempt?.workerLossReconciliation).toMatchObject({
            containerState: 'exited',
            workspaceLockReleased: true,
        });
        expect(await locks.getOwner(userId.toHexString(), workflowId.toHexString())).toBeNull();
    }, 60_000);

    it('keeps the run and its workspace quarantined when the Docker identity does not match', async () => {
        const attempt = await createExpiredRun();
        await createContainer(attempt.containerName, `airdd2.execution.attempt=${randomUUID()}`);
        const nextEpoch = await control.activateWorker('new-worker');
        const replacement = new DockerGatewayClient({ socketPath, epoch: nextEpoch });

        const summary = await new MongoExpiredRunReconciler(
            new DockerGatewayAttemptRecovery(replacement), runs, locks,
        ).reconcile();

        expect(summary).toEqual({ reconciled: 0, unresolved: 1, lockCleanupPending: 0 });
        expect((await UserToolRun.findOne({ executionId: attempt.executionId }).lean())?.status).toBe('running');
        expect(await locks.getOwner(userId.toHexString(), workflowId.toHexString())).toBe(attempt.executionId);
        expect(await docker('inspect', '--format', '{{.State.Status}}', attempt.containerName)).toBe('running');
    }, 60_000);

    it('keeps a paused attempt and its workspace quarantined', async () => {
        const attempt = await createExpiredRun();
        await createContainer(attempt.containerName, `airdd2.execution.attempt=${attempt.attemptId}`);
        await docker('pause', attempt.containerName);
        try {
            const nextEpoch = await control.activateWorker('new-worker');
            const replacement = new DockerGatewayClient({ socketPath, epoch: nextEpoch });
            const summary = await new MongoExpiredRunReconciler(
                new DockerGatewayAttemptRecovery(replacement), runs, locks,
            ).reconcile();

            expect(summary).toEqual({ reconciled: 0, unresolved: 1, lockCleanupPending: 0 });
            expect((await UserToolRun.findOne({ executionId: attempt.executionId }).lean())?.status).toBe('running');
            expect(await locks.getOwner(userId.toHexString(), workflowId.toHexString())).toBe(attempt.executionId);
        } finally {
            await docker('unpause', attempt.containerName);
        }
    });
});
