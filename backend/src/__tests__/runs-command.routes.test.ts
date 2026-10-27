import express from 'express';
import passport from 'passport';
import request from 'supertest';
import '../middleware/auth.middleware';
import { User } from '../models/User.model';
import { UserToolRun } from '../models/UserToolRun.model';
import runsRoutes from '../routes/runs.routes';
import { SandboxService } from '../services/sandbox.service';
import { generateAccessToken } from '../utils/jwt';

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

    it('forwards the Idempotency-Key to the canonical run execution endpoint', async () => {
        const fixture = await createFixture();
        const runSpy = jest.spyOn(SandboxService.prototype, 'runFunction').mockResolvedValue({
            success: true,
            output: { ok: true },
            durationMs: 12,
            executionId: 'run-command-test-execute',
            runner: 'docker_sandbox',
            exitCode: 0,
            replayed: true,
        } as any);

        const response = await request(app)
            .post('/api/runs/execute')
            .set('Authorization', `Bearer ${fixture.accessToken}`)
            .set('Idempotency-Key', 'same-request')
            .send({ functionId: '66c111111111111111111111', testArgs: { value: 'ok' } })
            .expect(200);

        expect(runSpy).toHaveBeenCalledWith(
            '66c111111111111111111111',
            fixture.user.id,
            { value: 'ok' },
            undefined,
            undefined,
            undefined,
            expect.stringContaining('Bearer '),
            'same-request',
        );
        expect(response.body).toEqual(expect.objectContaining({
            executionId: 'run-command-test-execute',
            idempotency: {
                key: 'same-request',
                replayed: true,
            }
        }));
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
        });

        const persisted = await UserToolRun.findOne({ executionId: 'run-command-test-cancel' }).lean();
        expect(persisted?.status).toBe('stopped');
        expect(persisted?.error).toEqual(expect.objectContaining({ code: 'RUN_CANCELLED' }));
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
});