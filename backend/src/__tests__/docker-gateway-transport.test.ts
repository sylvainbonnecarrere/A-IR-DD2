import { randomUUID } from 'crypto';
import { stat } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { DockerGatewayAdmission } from '../services/runtime/DockerGatewayAdmission';
import { DockerGatewayClient } from '../services/runtime/DockerGatewayClient';
import { DockerGatewayControlClient } from '../services/runtime/DockerGatewayControlClient';
import { DockerGatewayServer } from '../services/runtime/DockerGatewayServer';
import type { DockerGatewayCommandRunner } from '../services/runtime/DockerGatewayProtocol';

const itUnix = process.platform === 'win32' ? it.skip : it;

describe('Docker gateway transport', () => {
    let server: DockerGatewayServer | undefined;
    let socketPath = '';

    afterEach(async () => {
        await server?.close();
        server = undefined;
    });

    itUnix('creates the Unix socket with group-only access', async () => {
        const admission = new DockerGatewayAdmission();
        const epoch = admission.activateWorker('worker-1');
        socketPath = path.join(tmpdir(), `airdd2-gateway-${randomUUID()}.sock`);
        server = new DockerGatewayServer({
            socketPath,
            admission,
            commandRunner: { run: jest.fn() },
        });

        await server.listen();

        const socket = await stat(socketPath);
        expect(socket.isSocket()).toBe(true);
        expect(socket.mode & 0o777).toBe(0o660);
        expect(epoch.epoch).toBe(1);
    });

    async function startGateway(
        runner: DockerGatewayCommandRunner,
    ): Promise<{
        client: DockerGatewayClient;
        createClient: (epoch: ReturnType<DockerGatewayAdmission['activateWorker']>) => DockerGatewayClient;
        control: DockerGatewayControlClient;
        admission: DockerGatewayAdmission;
        epoch: ReturnType<DockerGatewayAdmission['activateWorker']>;
    }> {
        const admission = new DockerGatewayAdmission();
        const epoch = admission.activateWorker('worker-1');
        socketPath = process.platform === 'win32'
            ? `\\\\.\\pipe\\airdd2-gateway-${randomUUID()}`
            : path.join(tmpdir(), `airdd2-gateway-${randomUUID()}.sock`);
        server = new DockerGatewayServer({ socketPath, admission, commandRunner: runner });
        const address = process.platform === 'win32'
            ? socketPath
            : { host: '127.0.0.1', port: 0 };
        await server.listen(address);

        if (typeof address !== 'string') {
            const bound = server.getAddress();
            if (!bound) throw new Error('Gateway did not bind a TCP test address');
            if (typeof bound === 'string') throw new Error('Gateway unexpectedly bound a pipe address');
            const clientOptions = { host: address.host, port: bound.port };
            return {
                client: new DockerGatewayClient({ ...clientOptions, epoch }),
                createClient: (nextEpoch) => new DockerGatewayClient({ ...clientOptions, epoch: nextEpoch }),
                control: new DockerGatewayControlClient(clientOptions),
                admission,
                epoch,
            };
        }

        return {
            client: new DockerGatewayClient({ socketPath, epoch }),
            createClient: (nextEpoch) => new DockerGatewayClient({ socketPath, epoch: nextEpoch }),
            control: new DockerGatewayControlClient({ socketPath }),
            admission,
            epoch,
        };
    }

    it('sends an allowed command through the gateway and returns the observed outcome', async () => {
        const runner: DockerGatewayCommandRunner = {
            run: jest.fn().mockResolvedValue({
                exitCode: 0,
                stdout: 'container-output',
                stderr: '',
                timedOut: false,
            }),
        };
        const { client } = await startGateway(runner);

        const args = [
            'run', '--rm', '--name=airdd2-test', '--network=none',
            'airdd2-runtime-python:3.12-ubuntu-noble', 'python3', '-c', 'print(1)',
        ];
        await expect(client.run('docker', args, {
            stdin: '{"args":{}}',
            timeoutMs: 2_000,
        })).resolves.toEqual({
            exitCode: 0,
            stdout: 'container-output',
            stderr: '',
            timedOut: false,
        });
        expect(runner.run).toHaveBeenCalledWith(args, {
            stdin: '{"args":{}}',
            timeoutMs: 2_000,
            signal: expect.any(AbortSignal),
        });
    });

    it('fails closed for disallowed Docker commands without invoking the daemon adapter', async () => {
        const runner: DockerGatewayCommandRunner = {
            run: jest.fn(),
        };
        const { client } = await startGateway(runner);

        await expect(client.run('docker', ['rm', '--force', 'container-id'])).resolves.toMatchObject({
            exitCode: 1,
            errorMessage: 'Docker gateway command is not allowed',
        });
        expect(runner.run).not.toHaveBeenCalled();
    });

    it.each([
        ['run', '-d', '--name=airdd2-background', 'image'],
        ['run', '--detach=true', 'image'],
        ['run', '--restart=always', 'image'],
        ['kill', 'unrelated-container'],
        ['inspect', 'unrelated-container'],
        ['rm', '--force', 'airdd2-container'],
    ])('refuses Docker commands that could bypass supervised execution: %s %s', async (...args) => {
        const runner: DockerGatewayCommandRunner = {
            run: jest.fn(),
        };
        const { client } = await startGateway(runner);

        await expect(client.run('docker', args)).resolves.toMatchObject({ exitCode: 1 });
        expect(runner.run).not.toHaveBeenCalled();
    });

    it('rejects stale worker epochs before forwarding commands', async () => {
        const runner: DockerGatewayCommandRunner = {
            run: jest.fn(),
        };
        const { createClient, epoch } = await startGateway(runner);
        const staleClient = createClient({ ...epoch, token: 'stale-token' });

        await expect(staleClient.run('docker', [
            'run', '--rm', '--name=airdd2-test', '--network=none',
            'airdd2-runtime-python:3.12-ubuntu-noble', 'python3', '-c', 'print(1)',
        ]))
            .resolves.toMatchObject({ exitCode: 1, errorMessage: expect.stringContaining('stale or invalid') });
        expect(runner.run).not.toHaveBeenCalled();
    });

    it('activates a replacement epoch and rejects commands from the previous worker', async () => {
        const runner: DockerGatewayCommandRunner = {
            run: jest.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '', timedOut: false }),
        };
        const { client, createClient, control, epoch } = await startGateway(runner);
        const nextEpoch = await control.activateWorker('worker-2');

        expect(nextEpoch.epoch).toBe(epoch.epoch + 1);
        await expect(client.run('docker', ['image', 'inspect', 'airdd2-runtime-python:3.12-ubuntu-noble', '--format', '{{json .Id}}']))
            .resolves.toMatchObject({ exitCode: 1, errorMessage: expect.stringContaining('stale') });
        await expect(createClient(nextEpoch).run('docker', [
            'image', 'inspect', 'airdd2-runtime-python:3.12-ubuntu-noble', '--format', '{{json .Id}}',
        ])).resolves.toMatchObject({ exitCode: 0 });
        expect(runner.run).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['version', '--format', '{{json .Server.Version}}'],
        ['context', 'show'],
        ['info', '--format', '{{json .Rootless}}'],
        ['image', 'inspect', 'airdd2-runtime-python:3.12-ubuntu-noble', '--format', '{{json .Id}}'],
    ])('allows the runtime health read-only command: %s', async (...args) => {
        const runner: DockerGatewayCommandRunner = {
            run: jest.fn().mockResolvedValue({ exitCode: 0, stdout: 'ok', stderr: '', timedOut: false }),
        };
        const { client } = await startGateway(runner);
        await expect(client.run('docker', args)).resolves.toMatchObject({ exitCode: 0, stdout: 'ok' });
        expect(runner.run).toHaveBeenCalledTimes(1);
    });

    it.each([
        [
            'run', '--rm', '--network', 'none',
            '--mount', 'type=bind,src=/opt/airdd2/backend/python,dst=/opt/airdd2/backend-python,readonly',
            '--env', 'AIRDD2_NATIVE_ROOT=/opt/airdd2/backend-python',
            '--entrypoint', 'python3', 'airdd2-runtime-python:3.12-ubuntu-noble', '-c', 'print(1)',
        ],
        [
            'run', '--rm',
            '--mount', 'type=bind,src=/opt/airdd2/backend/python,dst=/opt/airdd2/backend-python',
            '--workdir', '/opt/airdd2/backend-python',
            'airdd2-python-provisioning:3.12-ubuntu-noble', 'python3', '-c', 'print(1)', '{}',
        ],
    ])('allows the exact native runtime/provisioning Docker command', async (...args) => {
        const runner: DockerGatewayCommandRunner = {
            run: jest.fn().mockResolvedValue({ exitCode: 0, stdout: 'ok', stderr: '', timedOut: false }),
        };
        const { client } = await startGateway(runner);
        await expect(client.run('docker', args)).resolves.toMatchObject({ exitCode: 0, stdout: 'ok' });
        expect(runner.run).toHaveBeenCalledTimes(1);
    });

    it('rejects workspace bind mounts outside the configured host root', async () => {
        const runner: DockerGatewayCommandRunner = { run: jest.fn() };
        const { client } = await startGateway(runner);
        await expect(client.run('docker', [
            'run', '--rm',
            '--mount', 'type=bind,src=/etc,dst=/persistent-workspace',
            'airdd2-runtime-python:3.12-ubuntu-noble', 'python3', '-c', 'print(1)',
        ])).resolves.toMatchObject({ exitCode: 1, errorMessage: 'Docker gateway command is not allowed' });
        expect(runner.run).not.toHaveBeenCalled();
    });

    it('keeps Docker kill operations unresolved until an external quiescence proof', async () => {
        const runner: DockerGatewayCommandRunner = {
            run: jest.fn()
                .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false })
                .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'Docker unavailable', timedOut: false }),
        };
        const { client, admission, epoch } = await startGateway(runner);
        const result = await client.run('docker', ['kill', 'airdd2-attempt']);

        expect(result).toMatchObject({ exitCode: 1, errorMessage: expect.stringContaining('uncertain') });
        const pending = admission.getPendingOperations();
        expect(pending).toHaveLength(1);
        admission.closeWorker(epoch);
        await expect(admission.reconcileUnknown(pending[0].id, { verify: jest.fn().mockResolvedValue(false) }))
            .resolves.toBe(false);
        expect(admission.getPendingOperations()).toEqual(pending);
    });

    it('quarantines an uncertain run instead of relying on a point-in-time container inspection', async () => {
        const runner: DockerGatewayCommandRunner = {
            run: jest.fn().mockResolvedValue({
                exitCode: 1, stdout: '', stderr: '', timedOut: true,
            }),
        };
        const { client, admission } = await startGateway(runner);
        const result = await client.run('docker', [
            'run', '--name=airdd2-attempt', '--network=none',
            'airdd2-runtime-python:3.12-ubuntu-noble', 'python3', '-c', 'print(1)',
        ]);

        expect(result).toMatchObject({ exitCode: 1, errorMessage: expect.stringContaining('uncertain') });
        expect(admission.getPendingOperations()).toHaveLength(1);
        expect(runner.run).toHaveBeenCalledTimes(1);
    });

    it('clears a kill operation only after inspecting a stopped matching container', async () => {
        const runner: DockerGatewayCommandRunner = {
            run: jest.fn()
                .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false })
                .mockResolvedValueOnce({
                    exitCode: 0,
                    stdout: JSON.stringify([{
                        Name: '/airdd2-attempt',
                        Config: { Labels: {} },
                        State: { Status: 'exited' },
                    }]),
                    stderr: '',
                    timedOut: false,
                }),
        };
        const { client, admission } = await startGateway(runner);

        await expect(client.run('docker', ['kill', 'airdd2-attempt']))
            .resolves.toMatchObject({ exitCode: 0 });
        expect(admission.getPendingOperations()).toEqual([]);
        expect(runner.run).toHaveBeenCalledTimes(2);
    });

    it('reports durable outcome recording failures without claiming command success', async () => {
        const runner: DockerGatewayCommandRunner = {
            run: jest.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '', timedOut: false }),
        };
        const { client, admission } = await startGateway(runner);
        jest.spyOn(admission, 'settle').mockImplementation(() => Promise.reject(new Error('MongoDB unavailable')));

        await expect(client.run('docker', [
            'run', '--rm', '--name=airdd2-attempt', '--network=none',
            'airdd2-runtime-python:3.12-ubuntu-noble', 'python3', '-c', 'print(1)',
        ]))
            .resolves.toMatchObject({
                exitCode: 1,
                errorMessage: expect.stringContaining('could not be durably recorded'),
            });
        expect(runner.run).toHaveBeenCalledTimes(1);
    });
});
