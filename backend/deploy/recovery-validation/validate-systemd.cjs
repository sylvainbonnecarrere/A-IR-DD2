'use strict';

const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { existsSync } = require('node:fs');
const { promisify } = require('node:util');
const mongoose = require('mongoose');
const { UserToolRun } = require('../../dist/src/models/UserToolRun.model');
const { MongoWorkspaceLockService } = require('../../dist/src/services/runtime/MongoWorkspaceLockService');

const exec = promisify(execFile);
const mongoUri = 'mongodb://127.0.0.1:27017/airdd2_recovery_validation';
const service = 'airdd2-backend.service';
const gateway = 'airdd2-docker-gateway.service';
const locks = new MongoWorkspaceLockService();
const fixtures = [];

async function command(program, args, timeout = 20_000) {
    return (await exec(program, args, { timeout })).stdout.trim();
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
    }, 'Backend did not restart and become ready after SIGKILL');
}

async function createRun(mode) {
    const attemptId = randomUUID();
    const executionId = `systemd-test-${randomUUID()}`;
    const name = `airdd2-j7-attempt-${attemptId}`;
    const owner = new mongoose.Types.ObjectId();
    const workflow = new mongoose.Types.ObjectId();
    const fixture = { executionId, attemptId, name, owner, workflow, lock: null, paused: false };
    fixtures.push(fixture);

    await UserToolRun.create({
        executionId, ownerUserId: owner, workflowId: workflow, toolId: new mongoose.Types.ObjectId(),
        toolVersionTag: 'test', toolContentHash: 'isolated-test', launchContext: 'editor_test',
        status: 'running', runtime: 'typescript', runner: 'docker_sandbox', inputs: {},
        policySnapshot: { networkMode: 'none' },
        timing: { queuedAt: new Date(), startedAt: new Date(), finishedAt: null, durationMs: null },
        lease: { owner: 'lost-worker', token: randomUUID(), acquiredAt: new Date(0), expiresAt: new Date(0) },
        supervisedAttempt: {
            attemptId, leaseOwner: 'lost-worker', leaseTokenDigest: 'test', createdAt: new Date(),
            dockerJournal: { admission: 'open', pending: null, lastOutcome: null, hasUnknownOutcome: false },
        },
    });
    fixture.lock = await locks.tryAcquire(owner.toHexString(), workflow.toHexString(), executionId);
    if (!fixture.lock) throw new Error('Failed to acquire isolated test workspace lock');
    await command('docker', [
        'run', '-d', `--name=${name}`, '--pull=never', '--network=none',
        '--label', `airdd2.execution.attempt=${attemptId}`,
        '--label', `airdd2.systemd-recovery.test=${attemptId}`,
        'ubuntu:noble', 'sleep', '120',
    ]);
    if (mode === 'paused') {
        await command('docker', ['pause', name]);
        fixture.paused = true;
    }
    return fixture;
}

async function validateUncertainGatewayRestart() {
    const operationId = randomUUID();
    const state = mongoose.connection.db.collection('docker_gateway_state');
    let injected = false;
    await command('systemctl', ['stop', service]);
    try {
        await command('systemctl', ['reset-failed', service, gateway]);
        const current = await state.findOne({ _id: 'docker-gateway' });
        if (!current || current.pendingOperation) throw new Error('Gateway is not idle for the isolated fault test');
        const inserted = await state.updateOne(
            { _id: 'docker-gateway', pendingOperation: null },
            { $set: { pendingOperation: {
                id: operationId, epoch: current.epoch, state: 'in_flight',
                effect: { command: 'run', containerName: `airdd2-systemd-${randomUUID()}` },
            } } },
        );
        if (inserted.modifiedCount !== 1) throw new Error('Could not insert isolated pending operation');
        injected = true;
        await command('systemctl', ['start', gateway]);
        await waitFor(async () => {
            const currentState = await state.findOne({ _id: 'docker-gateway' });
            return currentState?.pendingOperation?.id === operationId
                && currentState.pendingOperation.state === 'unknown';
        }, 'Gateway did not preserve the pending run as uncertain');
        assert.equal(existsSync('/run/airdd2-docker-gateway/docker.sock'), false);
        console.log('PASS gateway restart: injected uncertain run remains blocked and socket stays closed');
    } finally {
        await command('systemctl', ['stop', gateway]);
        if (injected) {
            const removed = await state.updateOne(
                { _id: 'docker-gateway', 'pendingOperation.id': operationId },
                { $set: { pendingOperation: null } },
            );
            if (removed.modifiedCount !== 1) throw new Error('Could not remove the synthetic test operation');
        }
        await command('systemctl', ['reset-failed', service, gateway]);
        await command('systemctl', ['start', service]);
        await waitFor(ready, 'Backend did not recover after the synthetic gateway test');
    }
}

async function run() {
    if (process.env.AIRDD2_RECOVERY_VALIDATION !== '1' || !existsSync('/etc/airdd2-recovery-validation')) {
        throw new Error('Refusing to run outside the isolated recovery validation container');
    }
    await waitFor(ready, 'Backend was not initially ready');
    await command('systemctl', ['reset-failed', service, gateway]);
    await mongoose.connect(mongoUri);
    try {
        const live = await createRun('running');
        await restartBackendByCrash();
        const recovered = await UserToolRun.findOne({ executionId: live.executionId }).select('+supervisedAttempt').lean();
        assert.equal(recovered?.status, 'failed');
        assert.equal(recovered?.error?.code, 'WORKER_LOST');
        assert.equal(recovered?.supervisedAttempt?.workerLossReconciliation?.workspaceLockReleased, true);
        assert.equal(await command('docker', ['inspect', '--format', '{{.State.Status}}', live.name]), 'exited');
        assert.equal(await locks.getOwner(live.owner.toHexString(), live.workflow.toHexString()), null);
        console.log('PASS SIGKILL backend: real container stopped, WORKER_LOST persisted, owned lock released');

        const paused = await createRun('paused');
        await restartBackendByCrash();
        const unresolved = await UserToolRun.findOne({ executionId: paused.executionId }).lean();
        assert.equal(unresolved?.status, 'running');
        assert.equal(await locks.getOwner(paused.owner.toHexString(), paused.workflow.toHexString()), paused.executionId);
        assert.equal(await command('docker', ['inspect', '--format', '{{.State.Status}}', paused.name]), 'paused');
        console.log('PASS SIGKILL backend: paused attempt and workspace remain quarantined');
        await command('docker', ['unpause', paused.name]);
        paused.paused = false;
        await command('docker', ['rm', '-f', paused.name]);
        await locks.release(paused.lock);
        await UserToolRun.deleteOne({ executionId: paused.executionId });
        await validateUncertainGatewayRestart();
    } finally {
        for (const fixture of fixtures) {
            if (fixture.paused) await command('docker', ['unpause', fixture.name]);
            const ids = await command('docker', ['container', 'ls', '-aq', '--no-trunc',
                '--filter', `label=airdd2.systemd-recovery.test=${fixture.attemptId}`]);
            for (const id of ids.split(/\s+/).filter(Boolean)) {
                if (!/^[0-9a-f]{64}$/.test(id)) throw new Error('Invalid isolated test container ID');
                await command('docker', ['rm', '-f', id]);
            }
            if (fixture.lock) await locks.release(fixture.lock);
            await UserToolRun.deleteOne({ executionId: fixture.executionId });
        }
        await mongoose.disconnect();
    }
}

run().catch((error) => {
    console.error('Systemd recovery validation failed:', error);
    process.exitCode = 1;
});
