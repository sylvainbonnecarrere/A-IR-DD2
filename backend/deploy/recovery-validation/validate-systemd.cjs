'use strict';

/**
 * Validation operationnelle US-J7-10 (labo isole uniquement).
 *
 * Scenarios reels sous systemd + Docker-in-Docker :
 *  1. SIGKILL reel du backend -> run sans preuve gateway => `quarantined`,
 *     verrou tenu, conteneur non touche (fail-closed) ;
 *  2. restart du gateway avec une operation `run` reelle incertaine (pending
 *     injecte + conteneur reel labelise) => fencing auto `auto_epoch_rotation`,
 *     rotation d'epoch, admission rouverte (socket present), reservation de nom,
 *     quiescence prouvee ; apres restart du backend le run passe `worker_lost`
 *     et le verrou est libere (owner === runId) ;
 *  3. `POST /api/workspaces/:workspaceId/runs/:runId/fence-and-retry` reel
 *     (JWT + Idempotency-Key) => 202 + run fils `queued` + audit immuable +
 *     verrou libere ; rejeu meme cle => 200 replayed ;
 *  4. cas negatif : run `quarantined` sans operation fencee => 504 +
 *     alerte critique persistee + verrou tenu + aucun audit.
 *
 * Regles : ne jamais effacer les journaux (`docker_gateway_state`,
 * `gateway_fence_audit`, `runtime_alerts`) ; nettoyage limite aux fixtures
 * du script dans la base jetable du labo.
 */

const assert = require('node:assert/strict');

const { execFile } = require('node:child_process');

const { randomUUID } = require('node:crypto');

const { existsSync, readFileSync } = require('node:fs');

const { promisify } = require('node:util');

const exec = promisify(execFile);

// Les secrets du labo sont lus depuis l'env file genere par setup.sh AVANT de
// charger les utils dist (elles lisent process.env au chargement).
function loadLabEnv() {
    const raw = readFileSync('/etc/airdd2/backend.env', 'utf8');
    for (const line of raw.split('\n')) {
        const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
        if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
    }
}

loadLabEnv();

const mongoose = require('mongoose');

const { User } = require('../../dist/src/models/User.model');

const { UserTool } = require('../../dist/src/models/UserTool.model');

const { UserToolRun } = require('../../dist/src/models/UserToolRun.model');

const { Workflow } = require('../../dist/src/models/Workflow.model');

const { MongoWorkspaceLockService } = require('../../dist/src/services/runtime/MongoWorkspaceLockService');

const { generateAccessToken } = require('../../dist/src/utils/jwt');

const mongoUri = 'mongodb://127.0.0.1:27017/airdd2_recovery_validation';

const service = 'airdd2-backend.service';

const gateway = 'airdd2-docker-gateway.service';

const gatewaySocket = '/run/airdd2-docker-gateway/docker.sock';

const locks = new MongoWorkspaceLockService();

const fixtures = [];

async function command(program, args, timeout = 20_000) {
    return (await exec(program, args, { timeout })).stdout.trim();
}

async function commandAllowFailure(program, args, timeout = 20_000) {
    try {
        const result = await exec(program, args, { timeout });
        return { ok: true, stdout: result.stdout.trim() };
    } catch (error) {
        return { ok: false, stdout: String(error.stdout || ''), stderr: String(error.stderr || error.message) };
    }
}

async function waitFor(predicate, message, timeout = 60_000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        if (await predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 300));
    }
    throw new Error(message);
}

async function ready() {
    try {
        const response = await fetch('http://127.0.0.1:3001/api/health/ready', {
            signal: AbortSignal.timeout(1_000),
        });
        return response.ok;
    } catch {
        return false;
    }
}

async function restartBackendByCrash() {
    const oldPid = await command('systemctl', ['show', service, '--property=MainPID', '--value']);
    assert.notEqual(oldPid, '0');
    await command('systemctl', ['kill', '--kill-whom=main', '--signal=SIGKILL', service]);
    await waitFor(async () => {
        const pid = await command('systemctl', ['show', service, '--property=MainPID', '--value']);
        return pid !== '0' && pid !== oldPid && await ready();
    }, 'Backend did not restart and become ready after SIGKILL', 120_000);
}

function attemptContainerName(attemptId) {
    return `airdd2-j7-attempt-${attemptId}`;
}

async function createRun({ executionId, attemptId, ownerUserId, workflowId, toolId, toolVersionTag = 'test', toolContentHash = 'isolated-test', policySnapshot = { networkMode: 'none' }, status = 'running', pendingOperationId = null }) {
    const name = attemptContainerName(attemptId);
    const fixture = { executionId, attemptId, name, ownerUserId, workflowId, lock: null, childExecutionId: null };
    fixtures.push(fixture);

    await UserToolRun.create({
        executionId,
        ownerUserId,
        toolId: toolId ?? new mongoose.Types.ObjectId(),
        toolVersionTag,
        toolContentHash,
        workflowId,
        launchContext: 'editor_test',
        status,
        runtime: 'typescript',
        runner: 'docker_sandbox',
        inputs: {},
        policySnapshot,
        timing: { queuedAt: new Date(), startedAt: new Date(), finishedAt: null, durationMs: null },
        lease: { owner: 'lost-worker', token: randomUUID(), acquiredAt: new Date(0), expiresAt: new Date(0) },
        supervisedAttempt: {
            attemptId,
            leaseOwner: 'lost-worker',
            leaseTokenDigest: 'test',
            createdAt: new Date(),
            dockerJournal: {
                admission: 'open',
                pending: pendingOperationId ? { id: pendingOperationId, kind: 'create' } : null,
                lastOutcome: null,
                hasUnknownOutcome: Boolean(pendingOperationId),
            },
        },
    });
    fixture.lock = await locks.tryAcquire(ownerUserId.toString(), workflowId.toString(), executionId);
    if (!fixture.lock) throw new Error(`Failed to acquire isolated test workspace lock for ${executionId}`);
    return fixture;
}

async function createLabeledContainer(fixture, operationId) {
    const args = [
        'run', '-d', `--name=${fixture.name}`, '--pull=never', '--network=none',
        '--label', `airdd2.execution.attempt=${fixture.attemptId}`,
        '--label', `airdd2.systemd-recovery.test=${fixture.attemptId}`,
    ];
    if (operationId) args.push('--label', `airdd2.gateway.op=${operationId}`);
    args.push('ubuntu:noble', 'sleep', '300');
    await command('docker', args);
}

async function containerState(name) {
    return command('docker', ['inspect', '--format', '{{.State.Status}}', name]);
}

async function fenceAndRetryApi(token, workspaceId, runId, idempotencyKey) {
    return fetch(`http://127.0.0.1:3001/api/workspaces/${workspaceId}/runs/${runId}/fence-and-retry`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Idempotency-Key': idempotencyKey,
            'Content-Type': 'application/json',
        },
        body: '{}',
        signal: AbortSignal.timeout(45_000),
    });
}

async function scenarioSigkillQuarantine() {
    const owner = new mongoose.Types.ObjectId();
    const workflow = new mongoose.Types.ObjectId();
    const attemptId = randomUUID();
    const fixture = await createRun({
        executionId: `systemd-test-sigkill-${randomUUID()}`,
        attemptId,
        ownerUserId: owner,
        workflowId: workflow,
    });
    await createLabeledContainer(fixture, null);

    await restartBackendByCrash();

    await waitFor(async () => {
        const run = await UserToolRun.findOne({ executionId: fixture.executionId }).lean();
        return run?.status === 'quarantined';
    }, 'Run without gateway fencing proof was not quarantined after SIGKILL', 90_000);

    assert.equal(await locks.getOwner(owner.toHexString(), workflow.toHexString()), fixture.executionId);
    assert.equal(await containerState(fixture.name), 'running');

    console.log('PASS SIGKILL backend: no gateway proof -> run quarantined, workspace lock retained, container untouched');
    return fixture;
}

async function scenarioGatewayRestartFencing() {
    // Utilisateur/workflow/tool reels pour le futur appel API fence-and-retry.
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const user = await User.create({
        email: `systemd-validation-${suffix}@test.com`,
        password: 'Password123',
        username: `sysdval${suffix}`,
    });
    const workflow = await Workflow.create({
        userId: user._id,
        name: `wf-systemd-validation-${suffix}`,
        isActive: true,
        isDefault: false,
        canvasState: { zoom: 1, panX: 0, panY: 0 },
    });
    const version = {
        versionTag: 'v1', contentHash: 'hash-v1', sourceMode: 'inline',
        sourceInline: 'export default () => 1', createdAt: new Date(),
        buildStatus: 'built', validationStatus: 'valid',
    };
    const policy = { networkMode: 'none', timeoutSeconds: 30, maxMemoryMb: 256, secretAliases: [] };
    const tool = await UserTool.create({
        ownerUserId: user._id, scopeType: 'user', name: `systemd-validation-tool-${suffix}`,
        description: 'recovery validation fixture', runtime: 'typescript',
        currentVersion: version, versions: [version], policy, workflowId: workflow._id,
    });
    const ownerFixture = { userId: user._id, workflowId: workflow._id, toolId: tool._id, runIds: [] };
    fixtures.push(ownerFixture);

    const operationId = randomUUID();
    const attemptId = randomUUID();
    const fixture = await createRun({
        executionId: `systemd-test-uncertain-${randomUUID()}`,
        attemptId,
        ownerUserId: user._id,
        workflowId: workflow._id,
        toolId: tool._id,
        toolVersionTag: version.versionTag,
        toolContentHash: version.contentHash,
        policySnapshot: policy,
        pendingOperationId: operationId,
    });
    ownerFixture.runIds.push(fixture.executionId);
    await createLabeledContainer(fixture, operationId);

    const state = mongoose.connection.db.collection('docker_gateway_state');

    await command('systemctl', ['stop', service]);
    await command('systemctl', ['reset-failed', service, gateway]);

    const current = await state.findOne({ _id: 'docker-gateway' });
    if (!current || current.pendingOperation) throw new Error('Gateway is not idle for the isolated fault test');
    const epochBefore = current.epoch;

    const inserted = await state.updateOne(
        { _id: 'docker-gateway', pendingOperation: null },
        { $set: { pendingOperation: {
            id: operationId, epoch: current.epoch, state: 'in_flight',
            effect: { command: 'run', containerName: fixture.name, attemptId },
        } } },
    );
    if (inserted.modifiedCount !== 1) throw new Error('Could not insert isolated pending operation');

    try {
        await command('systemctl', ['start', gateway]);

        // L'admission rouvre immediatement : le socket existe des le demarrage
        // du gateway, l'operation incertaine est fencee, pas bloquee.
        await waitFor(() => Promise.resolve(existsSync(gatewaySocket)), 'Gateway socket did not reopen after restart with an uncertain operation', 60_000);
        await waitFor(async () => {
            const s = await state.findOne({ _id: 'docker-gateway' });
            return !s?.pendingOperation
                && Array.isArray(s?.fencedOperations)
                && s.fencedOperations.some((entry) => entry.id === operationId);
        }, 'Injected uncertain run was not fenced into fencedOperations', 60_000);

        const fenced = await state.findOne({ _id: 'docker-gateway' });
        const entry = fenced.fencedOperations.find((item) => item.id === operationId);
        assert.equal(entry.fenceKind, 'auto_epoch_rotation');

        await waitFor(async () => {
            const s = await state.findOne({ _id: 'docker-gateway' });
            const e = s?.fencedOperations?.find((item) => item.id === operationId);
            return e?.quiescenceProven === true && e?.nameReservation?.reserved === true;
        }, 'Quiescence of the fenced operation was not proven (name reservation missing or container not terminal)', 90_000);

        // Le conteneur reel labelise a ete tue par ID immuable ; le nom est tenu
        // par la reservation inerte (label airdd2.fence.op), donc toute creation
        // differee sur ce nom echoue.
        await waitFor(async () => {
            try {
                return (await containerState(fixture.name)) !== 'running';
            } catch {
                return true; // conteneur retire par la reservation de nom
            }
        }, 'Labeled attempt container was not killed during fencing', 30_000);
        const labels = JSON.parse(await command('docker', ['inspect', '--format', '{{json .Config.Labels}}', fixture.name]));
        assert.equal(labels['airdd2.fence.op'], operationId);
        const delayed = await commandAllowFailure('docker', [
            'run', '-d', `--name=${fixture.name}`, '--pull=never', '--network=none', 'ubuntu:noble', 'true',
        ]);
        assert.equal(delayed.ok, false, 'Delayed creation on the reserved name must fail');

        console.log('PASS gateway restart: uncertain run auto-fenced (auto_epoch_rotation), admission reopened, name reserved, quiescence proven');

        await command('systemctl', ['start', service]);
        await waitFor(ready, 'Backend did not recover after the gateway fencing test', 120_000);

        const stateAfter = await state.findOne({ _id: 'docker-gateway' });
        assert.ok(stateAfter.epoch > epochBefore, 'Epoch did not rotate when the backend re-activated the worker');
        assert.equal(stateAfter.admissionClosed, false);

        await waitFor(async () => {
            const run = await UserToolRun.findOne({ executionId: fixture.executionId }).lean();
            return run?.status === 'worker_lost';
        }, 'Run with proven fenced attempt was not marked worker_lost after backend restart', 90_000);

        assert.equal(await locks.getOwner(user.id, workflow.id), null);

        console.log('PASS backend restart after fencing: run worker_lost with quiescence proof, owned workspace lock released');
        return { user, workflow, tool, fixture, operationId, ownerFixture };
    } finally {
        await command('systemctl', ['reset-failed', service, gateway]);
        await command('systemctl', ['start', service]);
        await waitFor(ready, 'Backend did not recover after the synthetic gateway test', 120_000);
    }
}

async function scenarioFenceAndRetryApi(ctx) {
    const { user, workflow, fixture } = ctx;
    const token = generateAccessToken({ sub: user.id, email: user.email, role: user.role });
    const key = `systemd-validation-${randomUUID()}`;

    const response = await fenceAndRetryApi(token, workflow.id, fixture.executionId, key);
    const raw = await response.text();
    assert.equal(response.status, 202, `Expected 202, got ${response.status}: ${raw}`);
    const body = JSON.parse(raw);
    assert.equal(body.fencedRunId, fixture.executionId);
    assert.equal(body.status, 'queued');
    assert.equal(body.recoveryAttemptCount, 1);
    assert.equal(body.idempotency.replayed, false);
    assert.ok(body.newExecutionId && body.newExecutionId !== fixture.executionId);
    fixture.childExecutionId = body.newExecutionId;
    ctx.ownerFixture.runIds.push(body.newExecutionId);

    const child = await UserToolRun.findOne({ executionId: body.newExecutionId }).lean();
    assert.ok(child, 'Child run not persisted');
    assert.equal(child.retryOfExecutionId, fixture.executionId);
    assert.equal(child.recoveryAttemptCount, 1);
    assert.equal(child.status, 'queued');

    const audit = await mongoose.connection.db.collection('gateway_fence_audit').findOne({ runId: fixture.executionId });
    assert.ok(audit, 'Fence audit entry missing');
    assert.equal(audit.quiescenceProven, true);
    assert.equal(audit.reason, 'USER_MANUAL_RESET');
    assert.equal(audit.fencedOpUuid, ctx.operationId);

    assert.equal(await locks.getOwner(user.id, workflow.id), null);

    const replay = await fenceAndRetryApi(token, workflow.id, fixture.executionId, key);
    const replayRaw = await replay.text();
    assert.equal(replay.status, 200, `Expected 200 replay, got ${replay.status}: ${replayRaw}`);
    const replayBody = JSON.parse(replayRaw);
    assert.equal(replayBody.idempotency.replayed, true);
    assert.equal(replayBody.newExecutionId, body.newExecutionId);

    console.log('PASS fence-and-retry API: 202 + queued child run + immutable audit + lock released, replay 200 without side effects');
}

async function scenarioFenceAndRetryFailClosed(ctx) {
    const { user, workflow } = ctx;
    const token = generateAccessToken({ sub: user.id, email: user.email, role: user.role });
    const attemptId = randomUUID();
    const orphan = await createRun({
        executionId: `systemd-test-orphan-${randomUUID()}`,
        attemptId,
        ownerUserId: user._id,
        workflowId: workflow._id,
        status: 'quarantined',
    });
    ctx.ownerFixture.runIds.push(orphan.executionId);

    const response = await fenceAndRetryApi(token, workflow.id, orphan.executionId, `orphan-${randomUUID()}`);
    const raw = await response.text();
    assert.equal(response.status, 504, `Expected 504, got ${response.status}: ${raw}`);
    const body = JSON.parse(raw);
    assert.equal(body.code, 'FENCING_TIMEOUT_ESCALATED');

    const alerts = await mongoose.connection.db.collection('runtime_alerts')
        .countDocuments({ runId: orphan.executionId, code: 'FENCING_TIMEOUT_ESCALATED', severity: 'critical' });
    assert.equal(alerts, 1);
    const audits = await mongoose.connection.db.collection('gateway_fence_audit')
        .countDocuments({ runId: orphan.executionId });
    assert.equal(audits, 0);
    assert.equal(await locks.getOwner(user.id, workflow.id), orphan.executionId);

    console.log('PASS fence-and-retry fail-closed: 504 + critical alert persisted + lock retained + no audit when no fenced operation matches');
    return orphan;
}

async function cleanup() {
    for (const fixture of fixtures) {
        if (fixture.attemptId) {
            // Conteneurs du script : tentative + reservation de nom (par label/ID).
            const ids = await commandAllowFailure('docker', ['container', 'ls', '-aq', '--no-trunc',
                '--filter', `label=airdd2.systemd-recovery.test=${fixture.attemptId}`]);
            if (ids.ok) {
                for (const id of ids.stdout.split(/\s+/).filter(Boolean)) {
                    if (!/^[0-9a-f]{64}$/.test(id)) throw new Error('Invalid isolated test container ID');
                    await commandAllowFailure('docker', ['rm', '-f', id]);
                }
            }
            const fenceIds = await commandAllowFailure('docker', ['container', 'ls', '-aq', '--no-trunc',
                '--filter', `label=airdd2.execution.attempt=${fixture.attemptId}`]);
            if (fenceIds.ok) {
                for (const id of fenceIds.stdout.split(/\s+/).filter(Boolean)) {
                    if (!/^[0-9a-f]{64}$/.test(id)) throw new Error('Invalid isolated test container ID');
                    await commandAllowFailure('docker', ['rm', '-f', id]);
                }
            }
            if (fixture.childExecutionId) {
                const child = await UserToolRun.findOne({ executionId: fixture.childExecutionId }).lean();
                const childAttempt = child?.supervisedAttempt?.attemptId;
                if (childAttempt) {
                    const childIds = await commandAllowFailure('docker', ['container', 'ls', '-aq', '--no-trunc',
                        '--filter', `label=airdd2.execution.attempt=${childAttempt}`]);
                    if (childIds.ok) {
                        for (const id of childIds.stdout.split(/\s+/).filter(Boolean)) {
                            if (/^[0-9a-f]{64}$/.test(id)) await commandAllowFailure('docker', ['rm', '-f', id]);
                        }
                    }
                }
            }
            if (fixture.lock) await locks.release(fixture.lock).catch(() => undefined);
            await UserToolRun.deleteOne({ executionId: fixture.executionId }).catch(() => undefined);
        }
    }
    for (const fixture of fixtures) {
        if (fixture.runIds) {
            for (const runId of fixture.runIds) await UserToolRun.deleteOne({ executionId: runId }).catch(() => undefined);
        }
        if (fixture.userId) {
            await UserTool.deleteOne({ _id: fixture.toolId }).catch(() => undefined);
            await Workflow.deleteOne({ _id: fixture.workflowId }).catch(() => undefined);
            await User.deleteOne({ _id: fixture.userId }).catch(() => undefined);
        }
    }
    // Journaux jamais touches : docker_gateway_state, gateway_fence_audit, runtime_alerts.
}

async function run() {
    if (process.env.AIRDD2_RECOVERY_VALIDATION !== '1' || !existsSync('/etc/airdd2-recovery-validation')) {
        throw new Error('Refusing to run outside the isolated recovery validation container');
    }
    await waitFor(ready, 'Backend was not initially ready', 120_000);
    await command('systemctl', ['reset-failed', service, gateway]);
    await mongoose.connect(mongoUri);

    try {
        await scenarioSigkillQuarantine();
        const ctx = await scenarioGatewayRestartFencing();
        await scenarioFenceAndRetryApi(ctx);
        await scenarioFenceAndRetryFailClosed(ctx);
    } finally {
        await cleanup();
        await mongoose.disconnect();
    }
}

run().catch((error) => {
    console.error('Systemd recovery validation failed:', error);
    process.exitCode = 1;
});
