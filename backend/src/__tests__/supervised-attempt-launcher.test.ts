import mongoose from 'mongoose';
import { createHash } from 'crypto';
import { execFile } from 'child_process';
import path from 'path';
import { promisify } from 'util';
import { UserToolRun } from '../models/UserToolRun.model';
import { MongoRunLeaseService, type RunLease } from '../services/runtime/MongoRunLeaseService';
import { MongoSupervisedAttemptService } from '../services/runtime/MongoSupervisedAttemptService';
import { SupervisedAttemptLauncher } from '../services/runtime/SupervisedAttemptLauncher';
import { UserToolRunService } from '../services/userToolRun.service';
import { DockerSandboxRunner, type DockerProcessRunner } from '../services/runtime/DockerSandboxRunner';
import { DockerSupervisedAttemptLauncher } from '../services/runtime/DockerSupervisedAttemptLauncher';
import type { SandboxExecutionRequest } from '../services/runtime/execution.types';
import { MongoExpiredRunReconciler } from '../services/runtime/MongoExpiredRunReconciler';
import { MongoWorkspaceLockService } from '../services/runtime/MongoWorkspaceLockService';

describe('persisted supervised attempt launch', () => {
    const runs = new UserToolRunService();
    const leases = new MongoRunLeaseService(30_000);
    const attempts = new MongoSupervisedAttemptService();
    const workspaceLocks = new MongoWorkspaceLockService();
    const ownerUserId = new mongoose.Types.ObjectId();
    const workflowId = new mongoose.Types.ObjectId();
    let lease: RunLease;

    beforeEach(async () => {
        await runs.createQueuedRun({
            executionId: 'supervised-run',
            ownerUserId,
            toolId: new mongoose.Types.ObjectId(),
            toolVersionTag: 'v1',
            toolContentHash: 'hash',
            launchContext: 'editor_test',
            runtime: 'typescript',
            policySnapshot: { networkMode: 'none' },
            workflowId,
        });
        const claimed = await leases.claimQueued('worker');
        if (!claimed) throw new Error('Expected claimed run');
        lease = claimed;
        await runs.markRunning(lease.executionId, new Date(), 'docker_sandbox', lease);
    });

    it('persists identity and lease binding before handing the attempt to the launcher', async () => {
        const signal = new AbortController().signal;
        const launch = jest.fn().mockImplementation(async (identity) => {
            const stored = await UserToolRun.findOne({ executionId: lease.executionId }).select('+supervisedAttempt').lean();
            expect(stored?.supervisedAttempt).toMatchObject({
                attemptId: identity.attemptId,
                leaseOwner: lease.owner,
                leaseTokenDigest: createHash('sha256').update(lease.token).digest('hex'),
                createdAt: expect.any(Date),
            });
            expect(identity.containerName).toBe(`airdd2-j7-attempt-${identity.attemptId}`);
            return 'launched';
        });
        await expect(new SupervisedAttemptLauncher(attempts, { launch }).launch(lease, signal)).resolves.toBe('launched');
        expect(launch).toHaveBeenCalledTimes(1);
        expect(launch).toHaveBeenCalledWith(expect.objectContaining({ executionId: lease.executionId }), signal);
        const publicRun = await UserToolRun.findOne({ executionId: lease.executionId }).lean();
        expect(publicRun?.supervisedAttempt).toBeUndefined();
    });

    it('allows only one concurrent launcher for the same running lease', async () => {
        const launch = jest.fn().mockResolvedValue('launched');
        const launcher = new SupervisedAttemptLauncher(attempts, { launch });
        const signal = new AbortController().signal;
        const results = await Promise.allSettled(Array.from({ length: 10 }, () => launcher.launch(lease, signal)));
        expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
        expect(results.filter((result) => result.status === 'rejected')).toHaveLength(9);
        expect(launch).toHaveBeenCalledTimes(1);
    });

    it('allows one attempt across two independent processes', async () => {
        const execFileAsync = promisify(execFile);
        const fixture = path.join(__dirname, 'fixtures', 'supervised-attempt-worker.ts');
        const env = {
            ...process.env,
            TEST_ATTEMPT_EXECUTION: lease.executionId,
            TEST_ATTEMPT_OWNER: lease.owner,
            TEST_ATTEMPT_TOKEN: lease.token,
        };
        const results = await Promise.all([0, 1].map(() =>
            execFileAsync(process.execPath, ['--import', 'tsx', fixture], { env, timeout: 20_000 })));
        const parsed = results.map(({ stdout }) => JSON.parse(stdout) as { created: boolean; attemptId?: string });
        expect(parsed.map((value) => value.created).sort()).toEqual([false, true]);
        const stored = await UserToolRun.findOne({ executionId: lease.executionId }).select('+supervisedAttempt').lean();
        expect(stored?.supervisedAttempt?.attemptId).toBe(parsed.find((value) => value.created)?.attemptId);
    });

    it('sends the persisted attempt identity to the Docker launch command', async () => {
        const request: SandboxExecutionRequest = {
            executionId: lease.executionId, userId: 'user',
            function: { _id: 'tool', name: 'tool', language: 'typescript', origin: 'custom' },
            runtime: 'typescript', launchContext: 'editor_test', args: {},
            policySnapshot: { networkMode: 'none' }, workspace: null,
            sourceCode: 'function run() { return 1; }', mode: 'typescript-custom',
        };
        const run = jest.fn().mockImplementation(async (_command: string, args: string[]) => {
            const stored = await UserToolRun.findOne({ executionId: lease.executionId }).select('+supervisedAttempt').lean();
            const attemptId = stored?.supervisedAttempt?.attemptId;
            expect(attemptId).toBeDefined();
            expect(args).toEqual(expect.arrayContaining([
                `--name=airdd2-j7-attempt-${attemptId}`, '--label', `airdd2.execution.attempt=${attemptId}`,
            ]));
            expect(args).not.toContain('--rm');
            return { exitCode: 0, stdout: JSON.stringify({ success: true, output: 1 }), stderr: '', timedOut: false };
        });
        const processRunner: DockerProcessRunner = { run };
        const dockerLauncher = new DockerSupervisedAttemptLauncher(request, new DockerSandboxRunner(processRunner));
        const result = await new SupervisedAttemptLauncher(attempts, dockerLauncher)
            .launch(lease, new AbortController().signal);
        expect(result.success).toBe(true);
        expect(run).toHaveBeenCalledTimes(1);
        expect((await UserToolRun.findOne({ executionId: lease.executionId }).lean())?.status).toBe('running');
    });

    const dockerIt = process.env.AIRDD2_TEST_DOCKER_RESERVATION === '1' ? it : it.skip;
    dockerIt('launches an actual sandbox with the persisted identity and leaves it inspectable', async () => {
        const docker = promisify(execFile);
        const request: SandboxExecutionRequest = {
            executionId: lease.executionId, userId: 'user',
            function: { _id: 'tool', name: 'tool', language: 'typescript', origin: 'custom' },
            runtime: 'typescript', launchContext: 'editor_test', args: {},
            policySnapshot: { networkMode: 'none', timeoutSeconds: 10 }, workspace: null,
            sourceCode: 'function run() { return 1; }', mode: 'typescript-custom',
        };
        try {
            const result = await new SupervisedAttemptLauncher(attempts, new DockerSupervisedAttemptLauncher(request))
                .launch(lease, new AbortController().signal);
            expect(result.success).toBe(true);
            const stored = await UserToolRun.findOne({ executionId: lease.executionId }).select('+supervisedAttempt').lean();
            const attemptId = stored?.supervisedAttempt?.attemptId;
            expect(attemptId).toBeDefined();
            const { stdout } = await docker('docker', [
                'inspect', '--format', '{{.Name}} {{index .Config.Labels "airdd2.execution.attempt"}} {{.HostConfig.AutoRemove}}',
                `airdd2-j7-attempt-${attemptId}`,
            ], { timeout: 15_000 });
            expect(stdout.trim()).toBe(`/airdd2-j7-attempt-${attemptId} ${attemptId} false`);
        } finally {
            const stored = await UserToolRun.findOne({ executionId: lease.executionId }).select('+supervisedAttempt').lean();
            const attemptId = stored?.supervisedAttempt?.attemptId;
            if (attemptId) {
                const { stdout } = await docker('docker', [
                    'container', 'ls', '--all', '--no-trunc', '--filter', `label=airdd2.execution.attempt=${attemptId}`, '--format', '{{.ID}}',
                ], { timeout: 15_000 });
                for (const id of stdout.trim().split(/\s+/).filter(Boolean)) {
                    if (!/^[0-9a-f]{64}$/.test(id)) throw new Error('Invalid test container ID');
                    await docker('docker', ['rm', '--force', id], { timeout: 15_000 });
                }
            }
        }
    });

    it('does not replace a persisted attempt after a failed launcher or expired lease', async () => {
        const launch = jest.fn().mockRejectedValue(new Error('launcher result unknown'));
        const launcher = new SupervisedAttemptLauncher(attempts, { launch });
        const signal = new AbortController().signal;
        await expect(launcher.launch(lease, signal)).rejects.toThrow('launcher result unknown');
        const first = await UserToolRun.findOne({ executionId: lease.executionId }).select('+supervisedAttempt').lean();
        await UserToolRun.updateOne({ executionId: lease.executionId }, { $set: { 'lease.expiresAt': new Date(0) } });
        expect(await leases.claimQueued('other')).toBeNull();
        await expect(launcher.launch(lease, signal)).rejects.toThrow('was not created');
        const after = await UserToolRun.findOne({ executionId: lease.executionId }).select('+supervisedAttempt').lean();
        expect(after?.supervisedAttempt?.attemptId).toBe(first?.supervisedAttempt?.attemptId);
        expect(after?.status).toBe('running');
        expect(launch).toHaveBeenCalledTimes(1);
    });

    it.each(['owner', 'token', 'executionId'] as const)('rejects a mismatched %s without launching', async (field) => {
        const launch = jest.fn();
        await expect(new SupervisedAttemptLauncher(attempts, { launch })
            .launch({ ...lease, [field]: 'wrong' }, new AbortController().signal)).rejects.toThrow('was not created');
        expect(launch).not.toHaveBeenCalled();
    });

    it('rejects an expired lease or a persisted cancellation without launching', async () => {
        const launch = jest.fn();
        const launcher = new SupervisedAttemptLauncher(attempts, { launch });
        const signal = new AbortController().signal;
        await UserToolRun.updateOne({ executionId: lease.executionId }, { $set: { 'lease.expiresAt': new Date(0) } });
        await expect(launcher.launch(lease, signal)).rejects.toThrow('was not created');
        await UserToolRun.updateOne({ executionId: lease.executionId }, {
            $set: { 'lease.expiresAt': new Date(Date.now() + 30_000), cancellationRequestedAt: new Date() },
        });
        await expect(launcher.launch(lease, signal)).rejects.toThrow('was not created');
        expect(launch).not.toHaveBeenCalled();
    });

    it('never invokes the launcher on Mongo failure or abort', async () => {
        const launch = jest.fn();
        const controller = new AbortController();
        const failure = new SupervisedAttemptLauncher({ create: jest.fn().mockRejectedValue(new Error('database unavailable')) }, { launch });
        await expect(failure.launch(lease, controller.signal)).rejects.toThrow('database unavailable');
        const abortingStore = {
            create: async (current: RunLease) => {
                const attempt = await attempts.create(current);
                controller.abort();
                return attempt;
            },
        };
        await expect(new SupervisedAttemptLauncher(abortingStore, { launch }).launch(lease, controller.signal))
            .rejects.toThrow('outcome requires reconciliation');
        expect(launch).not.toHaveBeenCalled();
        const stored = await UserToolRun.findOne({ executionId: lease.executionId }).select('+supervisedAttempt').lean();
        expect(stored?.supervisedAttempt?.attemptId).toBeDefined();
        expect(stored?.status).toBe('running');
    });

    it('does not allocate for a queued run', async () => {
        await UserToolRun.updateOne({ executionId: lease.executionId }, { $set: { status: 'queued' } });
        await expect(attempts.create(lease)).rejects.toThrow('was not created');
    });

    it('marks an expired run worker_lost only after gateway-proven quiescence and releases its owned workspace lock', async () => {
        await attempts.create(lease);
        const acquired = await workspaceLocks.tryAcquire(
            ownerUserId.toHexString(),
            workflowId.toHexString(),
            lease.executionId,
        );
        if (!acquired) throw new Error('Expected workspace lock acquisition');
        await UserToolRun.updateOne(
            { executionId: lease.executionId },
            { $set: { 'lease.expiresAt': new Date(0) } },
        );
        expect(await runs.listExpiredSupervisedRuns()).toHaveLength(1);
        const fencing = {
            proveFencedAttempt: jest.fn().mockResolvedValue({
                operationId: '123e4567-e89b-42d3-a456-426614174000',
                quiescent: true,
                containerState: 'exited' as const,
            }),
        };

        const summary = await new MongoExpiredRunReconciler(fencing, runs, workspaceLocks).reconcile();

        expect(summary).toEqual({ reconciled: 1, unresolved: 0, lockCleanupPending: 0, autoRecovered: 0 });
        const stored = await UserToolRun.findOne({ executionId: lease.executionId })
            .select('+supervisedAttempt')
            .lean();
        expect(stored?.status).toBe('worker_lost');
        expect(stored?.error?.code).toBe('WORKER_LOST');
        expect(stored?.supervisedAttempt?.workerLossReconciliation).toMatchObject({
            containerState: 'exited',
            workspaceLockReleased: true,
        });
        expect(await workspaceLocks.getOwner(ownerUserId.toHexString(), workflowId.toHexString())).toBeNull();
    });

    it('quarantines an expired run and retains its workspace lock when quiescence is not proven', async () => {
        await attempts.create(lease);

        const acquired = await workspaceLocks.tryAcquire(
            ownerUserId.toHexString(),
            workflowId.toHexString(),
            lease.executionId,
        );
        if (!acquired) throw new Error('Expected workspace lock acquisition');

        await UserToolRun.updateOne(
            { executionId: lease.executionId },
            { $set: { 'lease.expiresAt': new Date(0) } },
        );
        expect(await runs.listExpiredSupervisedRuns()).toHaveLength(1);

        const fencing = { proveFencedAttempt: jest.fn().mockResolvedValue(null) };

        const summary = await new MongoExpiredRunReconciler(fencing, runs, workspaceLocks).reconcile();

        expect(summary).toEqual({ reconciled: 0, unresolved: 1, lockCleanupPending: 0, autoRecovered: 0 });

        const stored = await UserToolRun.findOne({ executionId: lease.executionId })
            .select('+supervisedAttempt')
            .lean();

        expect(stored?.status).toBe('quarantined');
        expect(stored?.error?.code).toBe('QUARANTINED');
        expect(stored?.supervisedAttempt?.workerLossReconciliation).toBeUndefined();
        expect(await workspaceLocks.getOwner(ownerUserId.toHexString(), workflowId.toHexString())).toBe(lease.executionId);
    });
});
