import { randomUUID } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import mongoose from 'mongoose';
import { LocalDockerAdmissionGate } from '../services/runtime/LocalDockerAdmissionGate';
import { MongoDockerOperationJournal } from '../services/runtime/MongoDockerOperationJournal';
import { MongoRunLeaseService } from '../services/runtime/MongoRunLeaseService';
import { MongoSupervisedAttemptService, type SupervisedAttemptIdentity } from '../services/runtime/MongoSupervisedAttemptService';
import { UserToolRunService } from '../services/userToolRun.service';

describe('local experimental Docker admission gate', () => {
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

    it('prevents a locally suspended admitted operation from being sent after close', async () => {
        let resume!: () => void;
        const wait = new Promise<void>((resolve) => { resume = resolve; });
        let admitted!: () => void;
        const ready = new Promise<void>((resolve) => { admitted = resolve; });
        const delayed = {
            admit: async (current: SupervisedAttemptIdentity) => {
                const operation = await journal.admit(current, 'create');
                admitted();
                await wait;
                return operation;
            },
            close: journal.close.bind(journal),
            recordOutcome: journal.recordOutcome.bind(journal),
        };
        const transport = { send: jest.fn().mockResolvedValue('response') };
        const gate = new LocalDockerAdmissionGate(identity, delayed, transport);
        const work = gate.send('create', 'payload');
        const rejected = expect(work).rejects.toThrow('admitted operation was not sent');
        try {
            await Promise.race([ready, work.then(() => { throw new Error('Unexpected completed operation'); })]);
            await gate.close();
        } finally {
            resume();
        }
        await rejected;
        expect(transport.send).not.toHaveBeenCalled();
        expect(await journal.read(identity)).toMatchObject({
            admission: 'closed', hasUnknownOutcome: true,
            lastOutcome: { outcome: 'unknown', operation: { kind: 'create' } },
        });
    });

    it('closes locally even if persisting closure fails, and permits an explicit retry', async () => {
        const close = jest.fn().mockRejectedValueOnce(new Error('database unavailable')).mockImplementation(() => journal.close(identity));
        const transport = { send: jest.fn() };
        const gate = new LocalDockerAdmissionGate(identity, {
            admit: journal.admit.bind(journal), recordOutcome: journal.recordOutcome.bind(journal), close,
        }, transport);
        await expect(gate.close()).rejects.toThrow('database unavailable');
        await expect(gate.send('create', 'payload')).rejects.toThrow('gate is closed');
        expect(transport.send).not.toHaveBeenCalled();
        await gate.close();
        expect((await journal.read(identity)).admission).toBe('closed');
    });

    it('does not claim to stop an operation already sent when closed', async () => {
        let resume!: (value: string) => void;
        const pending = new Promise<string>((resolve) => { resume = resolve; });
        let sent!: () => void;
        const started = new Promise<void>((resolve) => { sent = resolve; });
        const transport = { send: jest.fn().mockImplementation(() => { sent(); return pending; }) };
        const gate = new LocalDockerAdmissionGate(identity, journal, transport);
        const work = gate.send('create', 'payload');
        try {
            await Promise.race([started, work.then(() => { throw new Error('Unexpected completed operation'); })]);
            await gate.close();
            expect(await journal.read(identity)).toMatchObject({ admission: 'closed', pending: { kind: 'create' } });
        } finally {
            resume('response');
        }
        await expect(work).resolves.toMatchObject({ state: 'unreconciled', response: 'response' });
        expect((await journal.read(identity)).pending).toMatchObject({ kind: 'create' });
        await expect(gate.send('start', 'payload')).rejects.toThrow('gate is closed');
    });

    it('does not let caller mutation redirect the attempt identity', async () => {
        const original = { ...identity };
        const transport = { send: jest.fn().mockResolvedValue('response') };
        const gate = new LocalDockerAdmissionGate(identity, journal, transport);
        identity.executionId = 'different';
        await gate.send('inspect', 'payload');
        expect(transport.send).toHaveBeenCalledWith(original, 'inspect', 'payload');
        expect((await journal.read(original)).pending).toMatchObject({ kind: 'inspect' });
    });

    const dockerIt = process.env.AIRDD2_TEST_DOCKER_RESERVATION === '1' ? it : it.skip;
    dockerIt('blocks a suspended create before it reaches the real Docker daemon', async () => {
        const run = promisify(execFile);
        const docker = async (...args: string[]) => (await run('docker', args, { timeout: 15_000 })).stdout.trim();
        let resume!: () => void;
        const paused = new Promise<void>((resolve) => { resume = resolve; });
        let admitted!: () => void;
        const ready = new Promise<void>((resolve) => { admitted = resolve; });
        const delayed = {
            admit: async (current: SupervisedAttemptIdentity) => {
                const operation = await journal.admit(current, 'create');
                admitted();
                await paused;
                return operation;
            },
            close: journal.close.bind(journal),
            recordOutcome: journal.recordOutcome.bind(journal),
        };
        const label = `airdd2.j7.local-gate-test=${identity.attemptId}`;
        const transport = {
            send: jest.fn().mockImplementation(() => docker('create', `--name=${identity.containerName}`,
                '--pull=never', '--network=none', '--label', label, 'ubuntu:noble', '/bin/true')),
        };
        const gate = new LocalDockerAdmissionGate(identity, delayed, transport);
        const work = gate.send('create', undefined);
        const rejection = expect(work).rejects.toThrow('admitted operation was not sent');
        try {
            await Promise.race([ready, work.then(() => { throw new Error('Unexpected completed operation'); })]);
            await gate.close();
            resume();
            await rejection;
            expect(transport.send).not.toHaveBeenCalled();
            const ids = await docker('container', 'ls', '--all', '--no-trunc', '--filter', `label=${label}`, '--format', '{{.ID}}');
            expect(ids).toBe('');
            expect(await journal.read(identity)).toMatchObject({ admission: 'closed', hasUnknownOutcome: true });
        } finally {
            resume();
            try {
                await rejection;
            } finally {
                const ids = await docker('container', 'ls', '--all', '--no-trunc', '--filter', `label=${label}`, '--format', '{{.ID}}');
                for (const id of ids.split(/\s+/).filter(Boolean)) {
                    if (!/^[0-9a-f]{64}$/.test(id)) throw new Error('Invalid test container ID');
                    await docker('rm', '--force', id);
                }
            }
        }
    }, 30_000);

    const windowsDockerIt = process.platform === 'win32' && process.env.AIRDD2_TEST_DOCKER_RESERVATION === '1' ? it : it.skip;
    windowsDockerIt('does not prevent another Windows process from accessing the Docker pipe', async () => {
        if (process.env.DOCKER_HOST || process.env.DOCKER_CONTEXT) {
            throw new Error('This test requires the local Docker CLI context without overrides');
        }
        const run = promisify(execFile);
        const context = (await run('docker', ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'], {
            timeout: 15_000, windowsHide: true,
        })).stdout.trim();
        const match = /^npipe:\/\/\/\/\.\/pipe\/([a-zA-Z0-9_.-]+)$/.exec(context);
        if (!match) throw new Error('This test requires a local Windows named pipe Docker context');
        const socketPath = `\\\\.\\pipe\\${match[1]}`;
        const gate = new LocalDockerAdmissionGate(identity, journal, { send: jest.fn() });
        await gate.close();
        await expect(gate.send('inspect', undefined)).rejects.toThrow('gate is closed');

        const script = [
            "const http = require('http');",
            "const req = http.request({ socketPath: process.argv[1], method: 'GET', path: '/_ping', timeout: 5000 }, res => {",
            "  let body = ''; res.setEncoding('utf8'); res.on('data', chunk => body += chunk);",
            "  res.on('end', () => { if (res.statusCode !== 200 || body.trim() !== 'OK') {",
            "    process.stderr.write('Unexpected Docker ping response'); process.exitCode = 1;",
            "  } else process.stdout.write('OK'); });",
            "  res.on('error', error => { process.stderr.write(error.message); process.exitCode = 1; });",
            '});',
            "req.on('timeout', () => req.destroy(new Error('Docker ping timed out')));",
            "req.on('error', error => { process.stderr.write(error.message); process.exitCode = 1; });",
            'req.end();',
        ].join('\n');
        const child = await run(process.execPath, ['-e', script, socketPath], { timeout: 10_000, windowsHide: true });
        expect(child.stdout).toBe('OK');
        expect((await journal.read(identity)).admission).toBe('closed');
    }, 30_000);
});
