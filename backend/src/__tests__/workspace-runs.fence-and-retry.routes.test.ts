import express from 'express';
import passport from 'passport';
import request from 'supertest';
import mongoose from 'mongoose';
import '../middleware/auth.middleware';

import { User } from '../models/User.model';
import { UserTool } from '../models/UserTool.model';
import { UserToolRun } from '../models/UserToolRun.model';
import { Workflow } from '../models/Workflow.model';

import { createWorkspaceRunsRouter } from '../routes/workspaceRuns.routes';

import { FenceAndRetryService } from '../services/fenceAndRetry.service';
import { SandboxService } from '../services/sandbox.service';
import { MongoWorkspaceLockService } from '../services/runtime/MongoWorkspaceLockService';
import { executionTargetFingerprint } from '../services/runtime/executionTargetFingerprint';
import {
    MongoGatewayFenceAuditStore,
    MongoQuarantinedRunStore,
    MongoRunCommandIdempotencyStore,
    MongoRuntimeAlertsStore,
    MongoWorkflowOwnershipStore,
} from '../services/runtime/fenceAndRetry.stores';
import type { FenceControlPort, FencedOperationLookupPort, QuarantinedRetryPort } from '../services/runtime/fenceAndRetry.ports';

import { generateAccessToken } from '../utils/jwt';
import { encrypt } from '../utils/encryption';

const OPERATION_ID = '123e4567-e89b-42d3-a456-426614174000';
const ATTEMPT_ID = '123e4567-e89b-42d3-a456-426614174001';
const CONTAINER_NAME = `airdd2-j7-attempt-${ATTEMPT_ID}`;

function fencedOperation() {
    return {
        id: OPERATION_ID,
        epoch: 3,
        effect: { command: 'run' as const, containerName: CONTAINER_NAME, attemptId: ATTEMPT_ID },
        fencedAt: new Date(),
        fenceKind: 'auto_epoch_rotation' as const,
        nameReservation: { containerName: CONTAINER_NAME, reserved: true },
        quiescenceProven: false,
    };
}

function createTestContext() {
    const control: jest.Mocked<FenceControlPort> = {
        fenceOperation: jest.fn().mockResolvedValue({ fenced: true, nameReserved: true, quiescent: true, observed: ['quiescence-proven'] }),
        verifyFenced: jest.fn().mockResolvedValue({ quiescent: true }),
    };
    const lookup: jest.Mocked<FencedOperationLookupPort> = {
        getFencedOperations: jest.fn().mockResolvedValue([fencedOperation()]),
    };
    const retry: jest.Mocked<QuarantinedRetryPort> = {
        retryQuarantinedRun: jest.fn(async (executionId: string, _userId: string, _idempotencyKey: string) => ({
            executionId: `child-of-${executionId}`,
            status: 'queued',
            replayed: false,
        })),
    };
    const service = new FenceAndRetryService(
        control,
        lookup,
        new MongoQuarantinedRunStore(),
        new MongoWorkflowOwnershipStore(),
        new MongoWorkspaceLockService(),
        new MongoGatewayFenceAuditStore(),
        new MongoRuntimeAlertsStore(),
        new MongoRunCommandIdempotencyStore(),
        retry,
    );
    const app = express();
    app.use(express.json());
    app.use(passport.initialize());
    app.use('/api/workspaces', createWorkspaceRunsRouter(service));
    return { app, control, lookup, retry };
}

async function createFixture() {
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const user = await User.create({
        email: `fence-retry-${suffix}@test.com`,
        password: 'Password123',
        username: `fencetry${suffix}`,
    });
    const accessToken = generateAccessToken({ sub: user.id, email: user.email, role: user.role });
    const workflow = await Workflow.create({
        userId: user._id,
        name: `wf-${suffix}`,
        isActive: true,
        isDefault: false,
        canvasState: { zoom: 1, panX: 0, panY: 0 },
    });
    return { user, accessToken, workflow };
}

async function createQuarantinedParentRun(userId: mongoose.Types.ObjectId, workflowId: mongoose.Types.ObjectId, executionId: string, status: 'worker_lost' | 'quarantined' | 'running' = 'worker_lost') {
    const toolId = new mongoose.Types.ObjectId();
    await UserToolRun.create({
        executionId,
        ownerUserId: userId,
        toolId,
        toolVersionTag: 'v1',
        toolContentHash: 'hash-v1',
        workflowId,
        launchContext: 'workflow_run',
        status,
        runtime: 'typescript',
        inputs: { value: 42 },
        policySnapshot: { networkMode: 'none' },
        timing: { queuedAt: new Date(), startedAt: new Date(), finishedAt: new Date(), durationMs: 5 },
        error: { code: status === 'running' ? undefined : (status === 'worker_lost' ? 'WORKER_LOST' : 'QUARANTINED'), message: 'perte worker', retryable: true },
        recoveryAttemptCount: 0,
        supervisedAttempt: {
            attemptId: ATTEMPT_ID,
            leaseOwner: 'old-worker',
            leaseTokenDigest: 'digest',
            createdAt: new Date(),
        },
    });
    return toolId;
}

function fenceAndRetryRequest(app: express.Express, workspaceId: string, runId: string, token: string, key?: string) {
    const req = request(app).post(`/api/workspaces/${workspaceId}/runs/${runId}/fence-and-retry`).set('Authorization', `Bearer ${token}`);
    if (key) req.set('Idempotency-Key', key);
    return req;
}

describe('POST /api/workspaces/:workspaceId/runs/:runId/fence-and-retry', () => {
    const locks = new MongoWorkspaceLockService();
    let db: NonNullable<mongoose.Connection['db']>;

    beforeAll(() => {
        db = mongoose.connection.db!;
    });

    afterEach(async () => {
        jest.restoreAllMocks();
        await UserToolRun.deleteMany({ executionId: /^fr-test-/i });
        await Workflow.deleteMany({ name: /^wf-fr-test-/i });
        await User.deleteMany({ email: /^fence-retry-/i });
        await db.collection('gateway_fence_audit').deleteMany({ runId: /^fr-test-/i });
        await db.collection('runtime_alerts').deleteMany({ runId: /^fr-test-/i });
        await db.collection('run_command_idempotency').deleteMany({ runId: /^fr-test-/i });
        await db.collection<{ _id: string }>('workspace_execution_locks').deleteMany({ _id: { $regex: /^[a-f\d]{24}:[a-f\d]{24}$/ } });
    });

    it('rejects without authentication and without Idempotency-Key', async () => {
        const { app } = createTestContext();
        const fixture = await createFixture();
        const runId = 'fr-test-noauth';
        await createQuarantinedParentRun(fixture.user._id, fixture.workflow._id, runId);

        await request(app)
            .post(`/api/workspaces/${fixture.workflow.id}/runs/${runId}/fence-and-retry`)
            .set('Idempotency-Key', 'k1')
            .expect(401);

        const response = await fenceAndRetryRequest(app, fixture.workflow.id, runId, fixture.accessToken).expect(400);
        expect(response.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    });

    it('rejects invalid params with 400', async () => {
        const { app } = createTestContext();
        const fixture = await createFixture();
        const response = await fenceAndRetryRequest(app, 'not-an-object-id', 'fr-test-x', fixture.accessToken, 'k').expect(400);
        expect(response.body.code).toBe('INVALID_PARAMS');
    });

    it('returns 404 for an unknown run or a workspace owned by another user', async () => {
        const { app } = createTestContext();
        const fixture = await createFixture();
        const other = await createFixture();
        const runId = 'fr-test-404';
        await createQuarantinedParentRun(fixture.user._id, fixture.workflow._id, runId);

        // Run inconnu
        const notFound = await fenceAndRetryRequest(app, fixture.workflow.id, 'fr-test-missing', fixture.accessToken, 'k404a').expect(404);
        expect(notFound.body.code).toBe('RUN_NOT_FOUND');

        // Workspace d'un autre utilisateur
        const notOwned = await fenceAndRetryRequest(app, other.workflow.id, runId, fixture.accessToken, 'k404b').expect(404);
        expect(notOwned.body.code).toBe('RUN_NOT_FOUND');
    });

    it('returns 409 RUN_NOT_QUARANTINED for a non-reconcilable run', async () => {
        const { app, control } = createTestContext();
        const fixture = await createFixture();
        const runId = 'fr-test-running';
        await createQuarantinedParentRun(fixture.user._id, fixture.workflow._id, runId, 'running');

        const response = await fenceAndRetryRequest(app, fixture.workflow.id, runId, fixture.accessToken, 'k409').expect(409);
        expect(response.body.code).toBe('RUN_NOT_QUARANTINED');
        expect(response.body.details.status).toBe('running');
        expect(control.fenceOperation).not.toHaveBeenCalled();
    });

    it('fences, proves quiescence, audits, releases the owned lock and answers 202', async () => {
        const { app, control, lookup, retry } = createTestContext();
        const fixture = await createFixture();
        const runId = 'fr-test-202';
        await createQuarantinedParentRun(fixture.user._id, fixture.workflow._id, runId, 'quarantined');
        const acquired = await locks.tryAcquire(fixture.user.id, fixture.workflow.id, runId);
        if (!acquired) throw new Error('Expected workspace lock acquisition');
        const parentBefore = await UserToolRun.findOne({ executionId: runId }).select('+supervisedAttempt').lean();

        const response = await fenceAndRetryRequest(app, fixture.workflow.id, runId, fixture.accessToken, 'key-202').expect(202);

        expect(response.body).toEqual({
            fencedRunId: runId,
            newExecutionId: `child-of-${runId}`,
            status: 'queued',
            recoveryAttemptCount: 1,
            idempotency: { key: 'key-202', replayed: false },
        });
        expect(control.fenceOperation).toHaveBeenCalledWith(OPERATION_ID, 'user_manual_reset');
        expect(control.verifyFenced).toHaveBeenCalledWith(OPERATION_ID);
        expect(lookup.getFencedOperations).toHaveBeenCalledTimes(1);
        expect(retry.retryQuarantinedRun).toHaveBeenCalledWith(runId, fixture.user.id, 'key-202');

        // Audit immuable persisté
        const auditEntries = await db.collection('gateway_fence_audit').find({ runId }).toArray();
        expect(auditEntries).toHaveLength(1);
        expect(auditEntries[0]).toMatchObject({
            actorUserId: fixture.user.id,
            fencedOpUuid: OPERATION_ID,
            operationId: OPERATION_ID,
            workspaceId: fixture.workflow.id,
            runId,
            reason: 'USER_MANUAL_RESET',
            fenceKind: 'user_manual_reset',
            quiescenceProven: true,
        });

        // Verrou libéré (owner === runId)
        expect(await locks.getOwner(fixture.user.id, fixture.workflow.id)).toBeNull();

        // Parent strictement immutable
        const parentAfter = await UserToolRun.findOne({ executionId: runId }).select('+supervisedAttempt').lean();
        expect(parentAfter?.status).toBe('quarantined');
        expect(parentAfter?.error?.code).toBe('QUARANTINED');
        expect(parentAfter?.updatedAt?.getTime()).toBe(parentBefore?.updatedAt?.getTime());

        // Réponse idempotente persistée
        const stored = await db.collection<{ _id: string }>('run_command_idempotency').findOne({ _id: `${fixture.user.id}:fence-and-retry:key-202` });
        expect(stored).toMatchObject({ runId, workspaceId: fixture.workflow.id, command: 'fence-and-retry' });
    });

    it('replays the same Idempotency-Key with 200 and no side effects', async () => {
        const { app, control, retry } = createTestContext();
        const fixture = await createFixture();
        const runId = 'fr-test-replay';
        await createQuarantinedParentRun(fixture.user._id, fixture.workflow._id, runId);
        await locks.tryAcquire(fixture.user.id, fixture.workflow.id, runId);

        await fenceAndRetryRequest(app, fixture.workflow.id, runId, fixture.accessToken, 'replay-key').expect(202);
        const replay = await fenceAndRetryRequest(app, fixture.workflow.id, runId, fixture.accessToken, 'replay-key').expect(200);

        expect(replay.body).toEqual(expect.objectContaining({
            fencedRunId: runId,
            newExecutionId: `child-of-${runId}`,
            idempotency: { key: 'replay-key', replayed: true },
        }));
        expect(control.fenceOperation).toHaveBeenCalledTimes(1);
        expect(control.verifyFenced).toHaveBeenCalledTimes(1);
        expect(retry.retryQuarantinedRun).toHaveBeenCalledTimes(1);
        expect(await db.collection('gateway_fence_audit').countDocuments({ runId })).toBe(1);
    });

    it('returns 409 IDEMPOTENCY_KEY_REUSED when the key targets another run', async () => {
        const { app } = createTestContext();
        const fixture = await createFixture();
        const runId = 'fr-test-key-a';
        const otherRunId = 'fr-test-key-b';
        await createQuarantinedParentRun(fixture.user._id, fixture.workflow._id, runId);
        await createQuarantinedParentRun(fixture.user._id, fixture.workflow._id, otherRunId);
        await locks.tryAcquire(fixture.user.id, fixture.workflow.id, runId);

        await fenceAndRetryRequest(app, fixture.workflow.id, runId, fixture.accessToken, 'shared-key').expect(202);
        const conflict = await fenceAndRetryRequest(app, fixture.workflow.id, otherRunId, fixture.accessToken, 'shared-key').expect(409);
        expect(conflict.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    });

    it('returns 409 WORKSPACE_LOCKED_BY_OTHER_RUN and keeps the audit trail when the lock is owned by another run', async () => {
        const { app, retry } = createTestContext();
        const fixture = await createFixture();
        const runId = 'fr-test-lock-other';
        await createQuarantinedParentRun(fixture.user._id, fixture.workflow._id, runId, 'worker_lost');
        await locks.tryAcquire(fixture.user.id, fixture.workflow.id, 'another-run');

        const response = await fenceAndRetryRequest(app, fixture.workflow.id, runId, fixture.accessToken, 'lock-key').expect(409);
        expect(response.body.code).toBe('WORKSPACE_LOCKED_BY_OTHER_RUN');

        // Étapes 1-2 persistées, aucun run fils, verrou intact
        expect(await db.collection('gateway_fence_audit').countDocuments({ runId })).toBe(1);
        expect(retry.retryQuarantinedRun).not.toHaveBeenCalled();
        expect(await locks.getOwner(fixture.user.id, fixture.workflow.id)).toBe('another-run');
        expect((await UserToolRun.findOne({ executionId: runId }).lean())?.status).toBe('worker_lost');
    });

    it('returns 504, persists a critical alert and retains the lock when quiescence is not proven', async () => {
        const ctx = createTestContext();
        ctx.control.verifyFenced.mockResolvedValue({ quiescent: false });
        const { app, retry } = ctx;
        const fixture = await createFixture();
        const runId = 'fr-test-504';
        await createQuarantinedParentRun(fixture.user._id, fixture.workflow._id, runId, 'quarantined');
        await locks.tryAcquire(fixture.user.id, fixture.workflow.id, runId);

        const response = await fenceAndRetryRequest(app, fixture.workflow.id, runId, fixture.accessToken, '504-key').expect(504);
        expect(response.body.code).toBe('FENCING_TIMEOUT_ESCALATED');

        // Alerte critique persistée, pas d'audit, verrou tenu, pas de run fils
        const alerts = await db.collection('runtime_alerts').find({ runId }).toArray();
        expect(alerts).toHaveLength(1);
        expect(alerts[0]).toMatchObject({
            severity: 'critical',
            code: 'FENCING_TIMEOUT_ESCALATED',
            operationId: OPERATION_ID,
            acknowledgedAt: null,
        });
        expect(await db.collection('gateway_fence_audit').countDocuments({ runId })).toBe(0);
        expect(retry.retryQuarantinedRun).not.toHaveBeenCalled();
        expect(await locks.getOwner(fixture.user.id, fixture.workflow.id)).toBe(runId);
        expect((await UserToolRun.findOne({ executionId: runId }).lean())?.status).toBe('quarantined');
    });

    it('fails closed with 504 + alert when the gateway control plane errors or no fenced operation matches', async () => {
        const ctx = createTestContext();
        ctx.control.fenceOperation.mockRejectedValue(new Error('gateway unreachable'));
        const { app } = ctx;
        const fixture = await createFixture();
        const runId = 'fr-test-504-err';
        await createQuarantinedParentRun(fixture.user._id, fixture.workflow._id, runId);
        await locks.tryAcquire(fixture.user.id, fixture.workflow.id, runId);

        const response = await fenceAndRetryRequest(app, fixture.workflow.id, runId, fixture.accessToken, 'err-key').expect(504);
        expect(response.body.code).toBe('FENCING_TIMEOUT_ESCALATED');
        expect(await db.collection('runtime_alerts').countDocuments({ runId, code: 'FENCING_TIMEOUT_ESCALATED' })).toBe(1);
        expect(await locks.getOwner(fixture.user.id, fixture.workflow.id)).toBe(runId);

        // Aucune opération fencée correspondante -> preuve absente -> 504
        const ctx2 = createTestContext();
        ctx2.lookup.getFencedOperations.mockResolvedValue([]);
        const app2 = ctx2.app;
        const runId2 = 'fr-test-504-noop';
        await createQuarantinedParentRun(fixture.user._id, fixture.workflow._id, runId2);
        const response2 = await fenceAndRetryRequest(app2, fixture.workflow.id, runId2, fixture.accessToken, 'noop-key').expect(504);
        expect(response2.body.code).toBe('FENCING_TIMEOUT_ESCALATED');
        expect(await db.collection('runtime_alerts').countDocuments({ runId: runId2, code: 'FENCING_TIMEOUT_ESCALATED' })).toBe(1);
        expect(await db.collection('gateway_fence_audit').countDocuments({ runId: runId2 })).toBe(0);
    });

    it('creates a real queued child run with lineage and incremented recoveryAttemptCount, parent immutable', async () => {
        const control: jest.Mocked<FenceControlPort> = {
            fenceOperation: jest.fn().mockResolvedValue({ fenced: true, nameReserved: true, quiescent: true, observed: [] }),
            verifyFenced: jest.fn().mockResolvedValue({ quiescent: true }),
        };
        const lookup: jest.Mocked<FencedOperationLookupPort> = {
            getFencedOperations: jest.fn().mockResolvedValue([fencedOperation()]),
        };
        const service = new FenceAndRetryService(
            control,
            lookup,
            new MongoQuarantinedRunStore(),
            new MongoWorkflowOwnershipStore(),
            new MongoWorkspaceLockService(),
            new MongoGatewayFenceAuditStore(),
            new MongoRuntimeAlertsStore(),
            new MongoRunCommandIdempotencyStore(),
            new SandboxService(),
        );
        const app = express();
        app.use(express.json());
        app.use(passport.initialize());
        app.use('/api/workspaces', createWorkspaceRunsRouter(service));

        const fixture = await createFixture();
        const version = {
            versionTag: 'v1', contentHash: 'hash-v1', sourceMode: 'inline' as const,
            sourceInline: 'export default () => 1', createdAt: new Date(),
            buildStatus: 'built' as const, validationStatus: 'valid' as const,
        };
        const policy = { networkMode: 'none' as const, timeoutSeconds: 30, maxMemoryMb: 256, secretAliases: [] };
        const tool = await UserTool.create({
            ownerUserId: fixture.user._id, scopeType: 'user', name: `fr-tool-${Date.now()}`,
            description: 'fence-and-retry fixture', runtime: 'typescript',
            currentVersion: version, versions: [version], policy, workflowId: fixture.workflow._id,
        });
        const runId = 'fr-test-real-child';
        await UserToolRun.create({
            executionId: runId,
            ownerUserId: fixture.user._id,
            toolId: tool._id,
            toolVersionTag: version.versionTag,
            toolContentHash: version.contentHash,
            workflowId: fixture.workflow._id,
            launchContext: 'workflow_run',
            status: 'worker_lost',
            runtime: 'typescript',
            inputs: { value: 42 },
            privateContextCiphertext: encrypt(JSON.stringify({ token: 'fr-private' }), fixture.user.id),
            policySnapshot: policy,
            targetFingerprint: executionTargetFingerprint({
                _id: tool._id,
                name: tool.name,
                language: tool.runtime,
                origin: 'custom',
                workflowId: fixture.workflow._id,
                codeInline: version.sourceInline,
                dependencies: tool.dependencies,
                toolVersionTag: version.versionTag,
                toolContentHash: version.contentHash,
                policySnapshot: tool.policy,
            }),
            timing: { queuedAt: new Date(), startedAt: new Date(), finishedAt: new Date(), durationMs: 3 },
            error: { code: 'WORKER_LOST', message: 'worker lost', retryable: true },
            recoveryAttemptCount: 2,
            supervisedAttempt: { attemptId: ATTEMPT_ID, leaseOwner: 'w', leaseTokenDigest: 'd', createdAt: new Date() },
        });
        const parentBefore = await UserToolRun.findOne({ executionId: runId }).lean();
        await locks.tryAcquire(fixture.user.id, fixture.workflow.id, runId);

        const response = await fenceAndRetryRequest(app, fixture.workflow.id, runId, fixture.accessToken, 'real-key').expect(202);

        expect(response.body).toMatchObject({
            fencedRunId: runId,
            status: 'queued',
            recoveryAttemptCount: 3,
        });
        const child = await UserToolRun.findOne({ executionId: response.body.newExecutionId }).select('+privateContextCiphertext').lean();
        expect(child).toMatchObject({
            status: 'queued',
            retryOfExecutionId: runId,
            recoveryAttemptCount: 3,
            workflowId: fixture.workflow._id,
        });
        expect(child?.privateContextCiphertext).toBeTruthy();
        expect(child?.privateContextCiphertext).not.toContain('fr-private');

        // Parent strictement immutable
        const parentAfter = await UserToolRun.findOne({ executionId: runId }).lean();
        expect(parentAfter?.status).toBe('worker_lost');
        expect(parentAfter?.recoveryAttemptCount).toBe(2);
        expect(parentAfter?.updatedAt?.getTime()).toBe(parentBefore?.updatedAt?.getTime());

        // Verrou libéré puis nouveau run fils (le worker réclamera le verrou à l'exécution)
        expect(await locks.getOwner(fixture.user.id, fixture.workflow.id)).toBeNull();

        await UserTool.deleteOne({ _id: tool._id });
    });
});
