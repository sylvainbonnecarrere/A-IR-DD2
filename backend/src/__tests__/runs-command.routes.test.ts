import express from 'express';
import passport from 'passport';
import request from 'supertest';
import '../middleware/auth.middleware';
import { User } from '../models/User.model';
import { UserToolRun } from '../models/UserToolRun.model';
import runsRoutes from '../routes/runs.routes';
import { SandboxService } from '../services/sandbox.service';
import { IdempotencyKeyReuseError } from '../services/runtime/ExecutionOrchestrator';
import { RuntimeNotReadyError } from '../services/runtime/errors';
import { generateAccessToken } from '../utils/jwt';
import { encrypt } from '../utils/encryption';

const app = express();
app.use(express.json());
app.use(passport.initialize());
app.use('/api/runs', runsRoutes);

describe('Run command routes', () => {
    afterEach(async () => {
        jest.restoreAllMocks();
        await UserToolRun.deleteMany({ executionId: /run-command-test-/i });
        await User.deleteMany({ email: /run-command-route-/i });
    });

    async function createFixture() {
        const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const user = await User.create({
            email: `run-command-route-${suffix}@test.com`,
            password: 'Password123',
            username: `runcommand${suffix}`,
        });

        const accessToken = generateAccessToken({
            sub: user.id,
            email: user.email,
            role: user.role,
        });

        return { user, accessToken };
    }

    it('forwards the Idempotency-Key and acknowledges a persisted queued run', async () => {
        const fixture = await createFixture();
        const syncRunSpy = jest.spyOn(SandboxService.prototype, 'runFunction');
        const queueSpy = jest.spyOn(SandboxService.prototype, 'queueFunctionRun').mockResolvedValue({
            executionId: 'run-command-test-execute',
            status: 'queued',
            replayed: true,
        });

        const response = await request(app)
            .post('/api/runs/execute')
            .set('Authorization', `Bearer ${fixture.accessToken}`)
            .set('Idempotency-Key', 'same-request')
            .send({ functionId: '66c111111111111111111111', testArgs: { value: 'ok' } })
            .expect(200);

        expect(queueSpy).toHaveBeenCalledWith(expect.objectContaining({
            functionId: '66c111111111111111111111',
            userId: fixture.user.id,
            testArgs: { value: 'ok' },
            idempotencyKey: 'same-request',
        }));
        expect(syncRunSpy).not.toHaveBeenCalled();
        expect(response.body).toEqual(expect.objectContaining({
            executionId: 'run-command-test-execute',
            status: 'queued',
            idempotency: {
                key: 'same-request',
                replayed: true,
            }
        }));
    });

    it('acknowledges a persisted queued run before waiting for sandbox completion', async () => {
        const fixture = await createFixture();
        jest.spyOn(SandboxService.prototype, 'queueFunctionRun').mockResolvedValue({
            executionId: 'run-command-test-queued',
            status: 'queued',
            replayed: false,
        });

        const response = await request(app)
            .post('/api/runs/execute')
            .set('Authorization', `Bearer ${fixture.accessToken}`)
            .set('Idempotency-Key', 'queued-request')
            .send({ functionId: '66c111111111111111111111', testArgs: { value: 'queued' } })
            .expect(202);

        expect(response.body).toEqual(expect.objectContaining({
            executionId: expect.any(String),
            status: 'queued',
            idempotency: { key: 'queued-request', replayed: false },
        }));
    });

    it('returns a stable conflict when an idempotency key is reused for different inputs', async () => {
        const fixture = await createFixture();
        jest.spyOn(SandboxService.prototype, 'queueFunctionRun').mockRejectedValue(new IdempotencyKeyReuseError());

        const response = await request(app)
            .post('/api/runs/execute')
            .set('Authorization', `Bearer ${fixture.accessToken}`)
            .set('Idempotency-Key', 'reused-key')
            .send({ functionId: '66c111111111111111111111', testArgs: { value: 'different' } })
            .expect(409);

        expect(response.body).toEqual(expect.objectContaining({ code: 'IDEMPOTENCY_KEY_REUSED' }));
    });

    it('returns a stable unavailable response when the runtime cannot accept a run', async () => {
        const fixture = await createFixture();
        jest.spyOn(SandboxService.prototype, 'queueFunctionRun').mockRejectedValue(new RuntimeNotReadyError('runner unavailable'));

        const response = await request(app)
            .post('/api/runs/execute')
            .set('Authorization', `Bearer ${fixture.accessToken}`)
            .send({ functionId: '66c111111111111111111111', testArgs: { value: 'ok' } })
            .expect(503);

        expect(response.body).toEqual(expect.objectContaining({ code: 'RUNTIME_NOT_READY' }));
    });

    it('cancels a queued run owned by the authenticated user', async () => {
        const fixture = await createFixture();
        await UserToolRun.create({
            executionId: 'run-command-test-cancel',
            ownerUserId: fixture.user._id,
            toolId: '66c111111111111111111111',
            toolVersionTag: 'v1',
            toolContentHash: 'hash',
            workflowId: null,
            launchContext: 'editor_test',
            status: 'queued',
            runtime: 'typescript',
            runner: 'docker_sandbox',
            inputs: {},
            outputs: null,
            policySnapshot: { networkMode: 'restricted', timeoutSeconds: 30, maxMemoryMb: 256, secretAliases: [] },
            timing: { queuedAt: new Date(), startedAt: null, finishedAt: null, durationMs: null },
            error: null,
        });

        const response = await request(app)
            .post('/api/runs/executions/run-command-test-cancel/cancel')
            .set('Authorization', `Bearer ${fixture.accessToken}`)
            .expect(200);

        expect(response.body).toEqual({
            success: true,
            executionId: 'run-command-test-cancel',
            status: 'stopped',
            cancellationRequested: false,
        });

        const persisted = await UserToolRun.findOne({ executionId: 'run-command-test-cancel' }).lean();
        expect(persisted?.status).toBe('stopped');
        expect(persisted?.error).toEqual(expect.objectContaining({ code: 'RUN_CANCELLED' }));
    });

    it('does not report a running run stopped before the runner confirms cancellation', async () => {
        const fixture = await createFixture();
        await UserToolRun.create({
            executionId: 'run-command-test-running-cancel',
            ownerUserId: fixture.user._id,
            toolId: '66c111111111111111111111',
            toolVersionTag: 'v1',
            toolContentHash: 'hash',
            workflowId: null,
            launchContext: 'editor_test',
            status: 'running',
            runtime: 'typescript',
            runner: 'docker_sandbox',
            inputs: {},
            outputs: null,
            policySnapshot: { networkMode: 'restricted', timeoutSeconds: 30, maxMemoryMb: 256, secretAliases: [] },
            timing: { queuedAt: new Date(), startedAt: new Date(), finishedAt: null, durationMs: null },
            error: null,
        });

        const response = await request(app)
            .post('/api/runs/executions/run-command-test-running-cancel/cancel')
            .set('Authorization', `Bearer ${fixture.accessToken}`)
            .expect(202);

        expect(response.body).toEqual(expect.objectContaining({
            executionId: 'run-command-test-running-cancel',
            status: 'running',
            cancellationRequested: true,
        }));

        const persisted = await UserToolRun.findOne({ executionId: 'run-command-test-running-cancel' }).lean();
        expect(persisted?.status).toBe('running');
        expect(persisted?.cancellationRequestedAt).toBeInstanceOf(Date);
    });

    it('rejects cancellation of terminal runs with a stable error code', async () => {
        const fixture = await createFixture();
        await UserToolRun.create({
            executionId: 'run-command-test-finished',
            ownerUserId: fixture.user._id,
            toolId: '66c111111111111111111111',
            toolVersionTag: 'v1',
            toolContentHash: 'hash',
            workflowId: null,
            launchContext: 'editor_test',
            status: 'completed',
            runtime: 'typescript',
            runner: 'docker_sandbox',
            inputs: {},
            outputs: { result: { ok: true } },
            policySnapshot: { networkMode: 'restricted', timeoutSeconds: 30, maxMemoryMb: 256, secretAliases: [] },
            timing: { queuedAt: new Date(), startedAt: new Date(), finishedAt: new Date(), durationMs: 10 },
            error: null,
        });

        const response = await request(app)
            .post('/api/runs/executions/run-command-test-finished/cancel')
            .set('Authorization', `Bearer ${fixture.accessToken}`)
            .expect(409);

        expect(response.body).toEqual(expect.objectContaining({
            code: 'RUN_NOT_CANCELLABLE',
            status: 'completed',
        }));
    });

    it('requires a fresh idempotency key for an explicit retry command', async () => {
        const fixture = await createFixture();
        const response = await request(app)
            .post('/api/runs/executions/parent-run/retry')
            .set('Authorization', `Bearer ${fixture.accessToken}`)
            .expect(400);

        expect(response.body).toEqual(expect.objectContaining({
            code: 'IDEMPOTENCY_KEY_REQUIRED',
        }));
    });

    it('creates a new retry child run without mutating its terminal parent', async () => {
        const fixture = await createFixture();
        await UserToolRun.create({
            executionId: 'run-command-test-retry-parent',
            ownerUserId: fixture.user._id,
            toolId: '66c111111111111111111111',
            toolVersionTag: 'v1',
            toolContentHash: 'hash',
            workflowId: null,
            launchContext: 'editor_test',
            status: 'failed',
            runtime: 'typescript',
            runner: 'docker_sandbox',
            inputs: { value: 'retry-me' },
            privateContextCiphertext: encrypt(JSON.stringify({ accessToken: 'retry-context-secret' }), fixture.user.id),
            outputs: null,
            policySnapshot: { networkMode: 'restricted', timeoutSeconds: 30, maxMemoryMb: 256, secretAliases: [] },
            timing: { queuedAt: new Date(), startedAt: new Date(), finishedAt: new Date(), durationMs: 20 },
            error: { code: 'RUNNER_UNAVAILABLE', message: 'runner unavailable', retryable: true },
        });
        const queueSpy = jest.spyOn(SandboxService.prototype, 'queueFunctionRun').mockResolvedValue({
            executionId: 'run-command-test-retry-child',
            status: 'queued',
            replayed: false,
        });

        const response = await request(app)
            .post('/api/runs/executions/run-command-test-retry-parent/retry')
            .set('Authorization', `Bearer ${fixture.accessToken}`)
            .set('Idempotency-Key', 'new-retry-intent')
            .expect(202);

        expect(response.body).toEqual(expect.objectContaining({
            executionId: 'run-command-test-retry-child',
            retryOfExecutionId: 'run-command-test-retry-parent',
            status: 'queued',
        }));
        expect(queueSpy).toHaveBeenCalledWith(expect.objectContaining({
            userId: fixture.user.id,
            testArgs: { value: 'retry-me' },
            privateContext: { accessToken: 'retry-context-secret' },
            retryOfExecutionId: 'run-command-test-retry-parent',
            idempotencyKey: 'new-retry-intent',
        }));
        expect((await UserToolRun.findOne({ executionId: 'run-command-test-retry-parent' }).lean())?.status).toBe('failed');
    });

    it('rejects retry of a completed run and never enqueues a child', async () => {
        const fixture = await createFixture();
        await UserToolRun.create({
            executionId: 'run-command-test-completed-parent',
            ownerUserId: fixture.user._id,
            toolId: '66c111111111111111111111',
            toolVersionTag: 'v1',
            toolContentHash: 'hash',
            workflowId: null,
            launchContext: 'editor_test',
            status: 'completed',
            runtime: 'typescript',
            runner: 'docker_sandbox',
            inputs: { value: 'do-not-rerun' },
            outputs: { result: { ok: true } },
            policySnapshot: { networkMode: 'restricted', timeoutSeconds: 30, maxMemoryMb: 256, secretAliases: [] },
            timing: { queuedAt: new Date(), startedAt: new Date(), finishedAt: new Date(), durationMs: 20 },
            error: null,
        });
        const queueSpy = jest.spyOn(SandboxService.prototype, 'queueFunctionRun');

        const response = await request(app)
            .post('/api/runs/executions/run-command-test-completed-parent/retry')
            .set('Authorization', `Bearer ${fixture.accessToken}`)
            .set('Idempotency-Key', 'completed-run-retry')
            .expect(409);

        expect(response.body).toEqual(expect.objectContaining({ code: 'RUN_NOT_RETRYABLE' }));
        expect(queueSpy).not.toHaveBeenCalled();
        expect((await UserToolRun.findOne({ executionId: 'run-command-test-completed-parent' }).lean())?.status).toBe('completed');
    });

    it('does not reveal or retry a run owned by another user', async () => {
        const owner = await createFixture();
        const attacker = await createFixture();
        await UserToolRun.create({
            executionId: 'run-command-test-foreign-retry',
            ownerUserId: owner.user._id,
            toolId: '66c111111111111111111111',
            toolVersionTag: 'v1',
            toolContentHash: 'hash',
            workflowId: null,
            launchContext: 'editor_test',
            status: 'failed',
            runtime: 'typescript',
            runner: 'docker_sandbox',
            inputs: {},
            outputs: null,
            policySnapshot: { networkMode: 'restricted', timeoutSeconds: 30, maxMemoryMb: 256, secretAliases: [] },
            timing: { queuedAt: new Date(), startedAt: new Date(), finishedAt: new Date(), durationMs: 20 },
            error: { code: 'RUNNER_UNAVAILABLE', message: 'runner unavailable', retryable: true },
        });
        const queueSpy = jest.spyOn(SandboxService.prototype, 'queueFunctionRun');

        await request(app)
            .post('/api/runs/executions/run-command-test-foreign-retry/retry')
            .set('Authorization', `Bearer ${attacker.accessToken}`)
            .set('Idempotency-Key', 'foreign-retry-intent')
            .expect(404);

        expect(queueSpy).not.toHaveBeenCalled();
        expect((await UserToolRun.findOne({ executionId: 'run-command-test-foreign-retry' }).lean())?.status).toBe('failed');
    });
});