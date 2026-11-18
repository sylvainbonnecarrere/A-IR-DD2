import { execFile, spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { createServer, request, type Server } from 'http';
import { promisify } from 'util';
import { DockerAttemptReservation } from '../services/runtime/DockerAttemptReservation';
import { DockerGatewayOperationReconciler } from '../services/runtime/DockerGatewayOperationReconciler';
import { SpawnDockerProcessRunner } from '../services/runtime/DockerSandboxRunner';

const execFileAsync = promisify(execFile);
const describeDocker = process.env.AIRDD2_TEST_DOCKER_RESERVATION === '1' ? describe : describe.skip;

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

describeDocker('delayed Docker API requests against a name reservation', () => {
    async function docker(...args: string[]): Promise<string> {
        return (await execFileAsync('docker', args, { timeout: 15_000 })).stdout.trim();
    }

    async function localDockerSocket(): Promise<string> {
        if (process.env.DOCKER_HOST || process.env.DOCKER_CONTEXT) {
            throw new Error('This test requires the local Docker CLI context without DOCKER_HOST or DOCKER_CONTEXT overrides');
        }
        const endpoint = await docker('context', 'inspect', '--format', '{{.Endpoints.docker.Host}}');
        if (endpoint.startsWith('unix:///')) return endpoint.slice('unix://'.length);
        const pipe = /^npipe:\/\/\/\/\.\/pipe\/([a-zA-Z0-9_.-]+)$/.exec(endpoint);
        if (pipe && process.platform === 'win32') return `\\\\.\\pipe\\${pipe[1]}`;
        throw new Error('This test only supports a local Unix socket or Windows named pipe Docker context');
    }

    it.each([false, true])('handles a client-disconnected create request, reservation=%s', async (withReservation) => {
        const socketPath = await localDockerSocket();
        const imageId = await docker('image', 'inspect', 'ubuntu:noble', '--format', '{{.Id}}');
        const attemptId = randomUUID();
        const name = DockerAttemptReservation.containerName(attemptId);
        const label = `airdd2.inflight.test=${attemptId}`;
        const accepted = deferred<void>();
        const disconnected = deferred<void>();
        const release = deferred<void>();
        const forwarded = deferred<{ status: number; body: string }>();
        void forwarded.promise.catch(() => undefined);
        let requestAccepted = false;
        let server: Server | undefined;
        const reservationService = new DockerAttemptReservation(imageId);
        const createBody = JSON.stringify({
            Image: imageId,
            Cmd: ['/bin/true'],
            Labels: { 'airdd2.inflight.test': attemptId },
            HostConfig: { NetworkMode: 'none', ReadonlyRootfs: true, CapDrop: ['ALL'] },
        });

        try {
            server = createServer((incoming, response) => {
                const chunks: Buffer[] = [];
                incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
                incoming.on('error', (error) => accepted.reject(error));
                incoming.on('end', () => {
                    if (incoming.method !== 'POST' || incoming.url !== '/test'
                        || Buffer.concat(chunks).toString('utf8') !== createBody) {
                        response.writeHead(400).end();
                        accepted.reject(new Error('Unexpected request to the Docker test proxy'));
                        return;
                    }
                    requestAccepted = true;
                    response.on('close', () => disconnected.resolve());
                    accepted.resolve();
                    void release.promise.then(() => {
                        const body = Buffer.from(createBody);
                        const upstream = request({
                            socketPath,
                            method: 'POST',
                            path: `/v1.41/containers/create?name=${encodeURIComponent(name)}`,
                            headers: { 'content-type': 'application/json', 'content-length': body.length },
                            timeout: 10_000,
                        }, (result) => {
                            const output: Buffer[] = [];
                            result.on('data', (chunk: Buffer) => output.push(chunk));
                            result.on('end', () => forwarded.resolve({
                                status: result.statusCode ?? 0,
                                body: Buffer.concat(output).toString('utf8'),
                            }));
                            result.on('error', (error) => forwarded.reject(error));
                        });
                        upstream.on('timeout', () => upstream.destroy(new Error('Docker request timed out')));
                        upstream.on('error', (error) => forwarded.reject(error));
                        upstream.end(body);
                    });
                    response.on('error', () => undefined);
                });
            });
            await new Promise<void>((resolve, reject) => {
                server!.once('error', reject);
                server!.listen(0, '127.0.0.1', resolve);
            });
            const address = server.address();
            if (!address || typeof address === 'string') throw new Error('Missing local test server address');
            const client = request({ host: '127.0.0.1', port: address.port, method: 'POST', path: '/test' });
            client.on('error', () => undefined);
            client.end(createBody);
            await accepted.promise;
            client.destroy();
            await disconnected.promise;
            const reservation = withReservation ? await reservationService.reserve(attemptId) : undefined;
            if (!withReservation) {
                const runner = new SpawnDockerProcessRunner();
                const verifier = new DockerGatewayOperationReconciler({
                    run: (args, options) => runner.run('docker', args, options),
                });
                await expect(verifier.verify({
                    id: randomUUID(),
                    epoch: 1,
                    effect: { command: 'run', containerName: name, attemptId },
                })).resolves.toBe(false);
            }
            release.resolve();
            const result = await forwarded.promise;
            expect(result.status).toBe(withReservation ? 409 : 201);
            if (reservation) {
                await expect(reservationService.verify(reservation)).resolves.toBeUndefined();
            } else {
                expect(JSON.parse(result.body)).toEqual(expect.objectContaining({ Id: expect.stringMatching(/^[0-9a-f]{64}$/) }));
            }
        } finally {
            release.resolve();
            try {
                if (requestAccepted) await forwarded.promise;
            } finally {
                if (server?.listening) {
                    server.closeAllConnections();
                    await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
                }
                for (const filter of [label, `airdd2.reservation.attempt=${attemptId}`]) {
                    const ids = await docker('container', 'ls', '--all', '--no-trunc', '--filter', `label=${filter}`, '--format', '{{.ID}}');
                    for (const id of ids.split(/\s+/).filter(Boolean)) {
                        if (!/^[0-9a-f]{64}$/.test(id)) throw new Error('Invalid test container ID');
                        await docker('rm', '--force', id);
                    }
                }
            }
        }
    }, 30_000);

    it.each([false, true])('handles a delayed start after client disconnect, replacement reservation=%s', async (withReservation) => {
        const socketPath = await localDockerSocket();
        const imageId = await docker('image', 'inspect', 'ubuntu:noble', '--format', '{{.Id}}');
        const attemptId = randomUUID();
        const name = DockerAttemptReservation.containerName(attemptId);
        const label = `airdd2.inflight.test=${attemptId}`;
        const accepted = deferred<void>();
        const disconnected = deferred<void>();
        const release = deferred<void>();
        const forwarded = deferred<number>();
        void forwarded.promise.catch(() => undefined);
        let server: Server | undefined;
        let requestAccepted = false;

        try {
            const containerId = await docker(
                'create', `--name=${name}`, '--pull=never', '--network=none',
                '--label', label, '--label', `airdd2.execution.attempt=${attemptId}`, imageId, 'sleep', '30',
            );
            expect(containerId).toMatch(/^[0-9a-f]{64}$/);

            server = createServer((incoming, response) => {
                if (incoming.method !== 'POST' || incoming.url !== '/test') {
                    response.writeHead(400).end();
                    accepted.reject(new Error('Unexpected request to the Docker test proxy'));
                    return;
                }
                incoming.resume();
                incoming.on('end', () => {
                    requestAccepted = true;
                    response.on('close', () => disconnected.resolve());
                    accepted.resolve();
                    void release.promise.then(() => {
                        const upstream = request({
                            socketPath,
                            method: 'POST',
                            path: `/v1.41/containers/${containerId}/start`,
                            timeout: 10_000,
                        }, (result) => {
                            result.resume();
                            result.on('end', () => forwarded.resolve(result.statusCode ?? 0));
                            result.on('error', (error) => forwarded.reject(error));
                        });
                        upstream.on('timeout', () => upstream.destroy(new Error('Docker request timed out')));
                        upstream.on('error', (error) => forwarded.reject(error));
                        upstream.end();
                    });
                    response.on('error', () => undefined);
                });
            });
            await new Promise<void>((resolve, reject) => {
                server!.once('error', reject);
                server!.listen(0, '127.0.0.1', resolve);
            });
            const address = server.address();
            if (!address || typeof address === 'string') throw new Error('Missing local test server address');
            const client = request({ host: '127.0.0.1', port: address.port, method: 'POST', path: '/test' });
            client.on('error', () => undefined);
            client.end();
            await accepted.promise;
            client.destroy();
            await disconnected.promise;

            expect(await docker('inspect', '--format', '{{.State.Status}}', containerId)).toBe('created');
            const runner = new SpawnDockerProcessRunner();
            const verifier = new DockerGatewayOperationReconciler({
                run: (args, options) => runner.run('docker', args, options),
            });
            await expect(verifier.verify({
                id: randomUUID(),
                epoch: 1,
                effect: { command: 'run', containerName: name, attemptId },
            })).resolves.toBe(false);

            const reservationService = new DockerAttemptReservation(imageId);
            let reservation;
            if (withReservation) {
                await docker('rm', '--force', containerId);
                reservation = await reservationService.reserve(attemptId);
            }
            release.resolve();
            expect(await forwarded.promise).toBe(withReservation ? 404 : 204);
            if (reservation) {
                await expect(reservationService.verify(reservation)).resolves.toBeUndefined();
            } else {
                expect(await docker('inspect', '--format', '{{.State.Status}}', containerId)).toBe('running');
            }
        } finally {
            release.resolve();
            try {
                if (requestAccepted) await forwarded.promise;
            } finally {
                if (server?.listening) {
                    server.closeAllConnections();
                    await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
                }
                for (const filter of [label, `airdd2.reservation.attempt=${attemptId}`]) {
                    const ids = await docker('container', 'ls', '--all', '--no-trunc', '--filter',
                        `label=${filter}`, '--format', '{{.ID}}');
                    for (const id of ids.split(/\s+/).filter(Boolean)) {
                        if (!/^[0-9a-f]{64}$/.test(id)) throw new Error('Invalid test container ID');
                        await docker('rm', '--force', id);
                    }
                }
            }
        }
    }, 30_000);

    it('shows that a delayed name-based removal can destroy an inert reservation', async () => {
        const socketPath = await localDockerSocket();
        const imageId = await docker('image', 'inspect', 'ubuntu:noble', '--format', '{{.Id}}');
        const attemptId = randomUUID();
        const name = DockerAttemptReservation.containerName(attemptId);
        const label = `airdd2.inflight.test=${attemptId}`;
        const accepted = deferred<void>();
        const disconnected = deferred<void>();
        const release = deferred<void>();
        const forwarded = deferred<number>();
        void forwarded.promise.catch(() => undefined);
        let server: Server | undefined;
        let requestAccepted = false;

        try {
            await docker('create', `--name=${name}`, '--pull=never', '--network=none',
                '--label', label, imageId, '/bin/true');
            server = createServer((incoming, response) => {
                if (incoming.method !== 'POST' || incoming.url !== '/test') {
                    response.writeHead(400).end();
                    accepted.reject(new Error('Unexpected request to the Docker test proxy'));
                    return;
                }
                incoming.resume();
                incoming.on('end', () => {
                    requestAccepted = true;
                    response.on('close', () => disconnected.resolve());
                    accepted.resolve();
                    void release.promise.then(() => {
                        const upstream = request({
                            socketPath,
                            method: 'DELETE',
                            path: `/v1.41/containers/${encodeURIComponent(name)}?force=1`,
                            timeout: 10_000,
                        }, (result) => {
                            result.resume();
                            result.on('end', () => forwarded.resolve(result.statusCode ?? 0));
                            result.on('error', (error) => forwarded.reject(error));
                        });
                        upstream.on('timeout', () => upstream.destroy(new Error('Docker request timed out')));
                        upstream.on('error', (error) => forwarded.reject(error));
                        upstream.end();
                    });
                    response.on('error', () => undefined);
                });
            });
            await new Promise<void>((resolve, reject) => {
                server!.once('error', reject);
                server!.listen(0, '127.0.0.1', resolve);
            });
            const address = server.address();
            if (!address || typeof address === 'string') throw new Error('Missing local test server address');
            const client = request({ host: '127.0.0.1', port: address.port, method: 'POST', path: '/test' });
            client.on('error', () => undefined);
            client.end();
            await accepted.promise;
            client.destroy();
            await disconnected.promise;

            await docker('rm', '--force', name);
            const reservationService = new DockerAttemptReservation(imageId);
            const reservation = await reservationService.reserve(attemptId);
            release.resolve();
            expect(await forwarded.promise).toBe(204);
            await expect(reservationService.verify(reservation)).rejects.toThrow('outcome may be unknown');
        } finally {
            release.resolve();
            try {
                if (requestAccepted) await forwarded.promise;
            } finally {
                if (server?.listening) {
                    server.closeAllConnections();
                    await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
                }
                for (const filter of [label, `airdd2.reservation.attempt=${attemptId}`]) {
                    const ids = await docker('container', 'ls', '--all', '--no-trunc', '--filter',
                        `label=${filter}`, '--format', '{{.ID}}');
                    for (const id of ids.split(/\s+/).filter(Boolean)) {
                        if (!/^[0-9a-f]{64}$/.test(id)) throw new Error('Invalid test container ID');
                        await docker('rm', '--force', id);
                    }
                }
            }
        }
    }, 30_000);

    it('shows that a delayed name-based kill can affect a replacement container', async () => {
        const socketPath = await localDockerSocket();
        const attemptId = randomUUID();
        const name = DockerAttemptReservation.containerName(attemptId);
        const label = `airdd2.inflight.test=${attemptId}`;
        const accepted = deferred<void>();
        const disconnected = deferred<void>();
        const release = deferred<void>();
        const forwarded = deferred<number>();
        void forwarded.promise.catch(() => undefined);
        let server: Server | undefined;
        let requestAccepted = false;

        try {
            await docker('run', '-d', `--name=${name}`, '--pull=never', '--network=none',
                '--label', label, 'ubuntu:noble', 'sleep', '30');
            server = createServer((incoming, response) => {
                if (incoming.method !== 'POST' || incoming.url !== '/test') {
                    response.writeHead(400).end();
                    accepted.reject(new Error('Unexpected request to the Docker test proxy'));
                    return;
                }
                incoming.resume();
                incoming.on('end', () => {
                    requestAccepted = true;
                    response.on('close', () => disconnected.resolve());
                    accepted.resolve();
                    void release.promise.then(() => {
                        const upstream = request({
                            socketPath,
                            method: 'POST',
                            path: `/v1.41/containers/${encodeURIComponent(name)}/kill`,
                            timeout: 10_000,
                        }, (result) => {
                            result.resume();
                            result.on('end', () => forwarded.resolve(result.statusCode ?? 0));
                            result.on('error', (error) => forwarded.reject(error));
                        });
                        upstream.on('timeout', () => upstream.destroy(new Error('Docker request timed out')));
                        upstream.on('error', (error) => forwarded.reject(error));
                        upstream.end();
                    });
                    response.on('error', () => undefined);
                });
            });
            await new Promise<void>((resolve, reject) => {
                server!.once('error', reject);
                server!.listen(0, '127.0.0.1', resolve);
            });
            const address = server.address();
            if (!address || typeof address === 'string') throw new Error('Missing local test server address');
            const client = request({ host: '127.0.0.1', port: address.port, method: 'POST', path: '/test' });
            client.on('error', () => undefined);
            client.end();
            await accepted.promise;
            client.destroy();
            await disconnected.promise;

            await docker('rm', '--force', name);
            const replacement = await docker('run', '-d', `--name=${name}`, '--pull=never', '--network=none',
                '--label', label, 'ubuntu:noble', 'sleep', '30');
            expect(replacement).toMatch(/^[0-9a-f]{64}$/);
            release.resolve();
            expect(await forwarded.promise).toBe(204);
            expect(await docker('inspect', '--format', '{{.State.Status}}', replacement)).toBe('exited');
        } finally {
            release.resolve();
            try {
                if (requestAccepted) await forwarded.promise;
            } finally {
                if (server?.listening) {
                    server.closeAllConnections();
                    await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
                }
                const ids = await docker('container', 'ls', '--all', '--no-trunc', '--filter', `label=${label}`, '--format', '{{.ID}}');
                for (const id of ids.split(/\s+/).filter(Boolean)) {
                    if (!/^[0-9a-f]{64}$/.test(id)) throw new Error('Invalid test container ID');
                    await docker('rm', '--force', id);
                }
            }
        }
    }, 30_000);

    it('preserves the unknown outcome after the daemon creates a container but the client dies before the reply', async () => {
        const socketPath = await localDockerSocket();
        const imageId = await docker('image', 'inspect', 'ubuntu:noble', '--format', '{{.Id}}');
        const attemptId = randomUUID();
        const name = DockerAttemptReservation.containerName(attemptId);
        const body = JSON.stringify({
            Image: imageId,
            Cmd: ['/bin/true'],
            Labels: { 'airdd2.inflight.test': attemptId },
            HostConfig: { NetworkMode: 'none', ReadonlyRootfs: true, CapDrop: ['ALL'] },
        });
        const forwarded = deferred<{ status: number; body: string }>();
        void forwarded.promise.catch(() => undefined);
        let forwarding = false;
        let server: Server | undefined;
        let child: ReturnType<typeof spawn> | undefined;
        let childExited: Promise<void> | undefined;
        let readinessTimeout: ReturnType<typeof setTimeout> | undefined;
        try {
            server = createServer((incoming, response) => {
                const chunks: Buffer[] = [];
                incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
                incoming.on('error', (error) => forwarded.reject(error));
                incoming.on('end', () => {
                    if (incoming.method !== 'POST' || incoming.url !== '/test'
                        || Buffer.concat(chunks).toString('utf8') !== body) {
                        response.writeHead(400).end();
                        forwarded.reject(new Error('Unexpected request to the Docker test proxy'));
                        return;
                    }
                    forwarding = true;
                    const upstream = request({
                        socketPath,
                        method: 'POST',
                        path: `/v1.41/containers/create?name=${encodeURIComponent(name)}`,
                        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
                        timeout: 10_000,
                    }, (result) => {
                        const output: Buffer[] = [];
                        result.on('data', (chunk: Buffer) => output.push(chunk));
                        result.on('end', () => forwarded.resolve({
                            status: result.statusCode ?? 0,
                            body: Buffer.concat(output).toString('utf8'),
                        }));
                        result.on('error', (error) => forwarded.reject(error));
                    });
                    upstream.on('timeout', () => upstream.destroy(new Error('Docker request timed out')));
                    upstream.on('error', (error) => forwarded.reject(error));
                    upstream.end(body);
                    response.on('error', () => undefined);
                });
            });
            await new Promise<void>((resolve, reject) => {
                server!.once('error', reject);
                server!.listen(0, '127.0.0.1', resolve);
            });
            const address = server.address();
            if (!address || typeof address === 'string') throw new Error('Missing local test server address');
            const script = [
                "const http = require('http');",
                "const req = http.request({host:'127.0.0.1',port:Number(process.argv[1]),method:'POST',path:'/test'}, () => {",
                "  process.stderr.write('Unexpected response'); process.exitCode = 1;",
                '});',
                "req.on('error', error => { process.stderr.write(error.message); process.exitCode = 1; });",
                'req.end(process.argv[2]);',
            ].join('\n');
            child = spawn(process.execPath, ['-e', script, String(address.port), body], {
                stdio: ['ignore', 'pipe', 'pipe'],
                windowsHide: true,
            });
            let childError = '';
            child.stderr!.on('data', (chunk: Buffer) => { childError += chunk.toString('utf8'); });
            childExited = new Promise<void>((resolve, reject) => {
                child!.once('error', reject);
                child!.once('exit', () => resolve());
            });
            const result = await Promise.race([
                forwarded.promise,
                childExited.then(() => { throw new Error(`Client exited before Docker replied: ${childError}`); }),
                new Promise<never>((_, reject) => {
                    readinessTimeout = setTimeout(() => reject(new Error('Docker test request did not complete')), 15_000);
                }),
            ]);
            clearTimeout(readinessTimeout);
            expect(result.status).toBe(201);
            const created = JSON.parse(result.body) as { Id?: unknown };
            if (typeof created.Id !== 'string' || !/^[0-9a-f]{64}$/.test(created.Id)) {
                throw new Error('Docker returned an invalid container ID');
            }
            if (child.exitCode !== null || child.signalCode !== null || !child.kill()) {
                throw new Error('Client exited before the lost-reply scenario was established');
            }
            await childExited;
            expect(childError).toBe('');
            const observed = await docker('inspect', '--format', '{{.Id}} {{.Name}} {{.State.Running}}', created.Id);
            expect(observed).toBe(`${created.Id} /${name} false`);
            await expect(new DockerAttemptReservation(imageId).reserve(attemptId))
                .rejects.toThrow('outcome may be unknown');
        } finally {
            clearTimeout(readinessTimeout);
            try {
                if (child && child.exitCode === null && child.signalCode === null) child.kill();
                if (childExited) await childExited;
                if (forwarding) await forwarded.promise;
            } finally {
                if (server?.listening) {
                    server.closeAllConnections();
                    await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
                }
                const ids = await docker('container', 'ls', '--all', '--no-trunc', '--filter',
                    `label=airdd2.inflight.test=${attemptId}`, '--format', '{{.ID}}');
                for (const id of ids.split(/\s+/).filter(Boolean)) {
                    if (!/^[0-9a-f]{64}$/.test(id)) throw new Error('Invalid test container ID');
                    await docker('rm', '--force', id);
                }
            }
        }
    }, 30_000);
});
