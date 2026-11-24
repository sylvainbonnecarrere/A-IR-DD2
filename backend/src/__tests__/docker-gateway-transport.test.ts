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

const OPERATION_LABEL_PATTERN = /^--label=airdd2\.gateway\.op=([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;

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
    inertImage?: string,
  ): Promise<{
    client: DockerGatewayClient;
    createClient: (epoch: ReturnType<DockerGatewayAdmission['activateWorker']>) => DockerGatewayClient;
    control: DockerGatewayControlClient;
    admission: DockerGatewayAdmission;
    epoch: ReturnType<DockerGatewayAdmission['activateWorker']>;
  }> {
    const admission = new DockerGatewayAdmission();
    const epoch = admission.activateWorker('worker-1');
    socketPath =
      process.platform === 'win32'
        ? `\\\\.\\pipe\\airdd2-gateway-${randomUUID()}`
        : path.join(tmpdir(), `airdd2-gateway-${randomUUID()}.sock`);

    server = new DockerGatewayServer({ socketPath, admission, commandRunner: runner, inertImage });
    const address = process.platform === 'win32' ? socketPath : { host: '127.0.0.1', port: 0 };
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

  it('sends an allowed command through the gateway and injects the operation label on admitted runs', async () => {
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
      'run',
      '--rm',
      '--name=airdd2-test',
      '--network=none',
      'airdd2-runtime-python:3.12-ubuntu-noble',
      'python3',
      '-c',
      'print(1)',
    ];
    await expect(
      client.run('docker', args, {
        stdin: '{"args":{}}',
        timeoutMs: 2_000,
      }),
    ).resolves.toEqual({
      exitCode: 0,
      stdout: 'container-output',
      stderr: '',
      timedOut: false,
    });

    expect(runner.run).toHaveBeenCalledTimes(1);
    const [executedArgs, executedOptions] = jest.mocked(runner.run).mock.calls[0];
    expect(executedOptions).toEqual({
      stdin: '{"args":{}}',
      timeoutMs: 2_000,
      signal: expect.any(AbortSignal),
    });
    // Label d'opération injecté par le serveur en position 1, juste après 'run'.
    expect(executedArgs[0]).toBe('run');
    const labelMatch = OPERATION_LABEL_PATTERN.exec(executedArgs[1]);
    expect(labelMatch).not.toBeNull();
    expect(executedArgs.slice(2)).toEqual(args.slice(1));
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

    await expect(
      staleClient.run('docker', [
        'run',
        '--rm',
        '--name=airdd2-test',
        '--network=none',
        'airdd2-runtime-python:3.12-ubuntu-noble',
        'python3',
        '-c',
        'print(1)',
      ]),
    ).resolves.toMatchObject({ exitCode: 1, errorMessage: expect.stringContaining('stale or invalid') });
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('activates a replacement epoch, auto-fences the previous unknown operation, and rejects the previous worker', async () => {
    const runner: DockerGatewayCommandRunner = {
      run: jest.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '', timedOut: false }),
    };
    const { client, createClient, control, admission, epoch } = await startGateway(runner);

    const operation = admission.admit(epoch, { command: 'run', containerName: 'airdd2-fenced' });
    admission.settle(operation, 'unknown');
    admission.closeWorker(epoch);

    const nextEpoch = await control.activateWorker('worker-2');

    expect(nextEpoch.epoch).toBe(epoch.epoch + 1);

    // Fencing auto à la rotation d'epoch ; journal conservé, quiescence non prétendue.
    expect(admission.getPendingOperations()).toEqual([]);
    const fenced = admission.getFencedOperations();
    expect(fenced).toHaveLength(1);
    expect(fenced[0]).toMatchObject({
      id: operation.id,
      fenceKind: 'auto_epoch_rotation',
      quiescenceProven: false,
    });

    await expect(
      client.run('docker', ['image', 'inspect', 'airdd2-runtime-python:3.12-ubuntu-noble', '--format', '{{json .Id}}']),
    ).resolves.toMatchObject({ exitCode: 1, errorMessage: expect.stringContaining('stale') });
    await expect(
      createClient(nextEpoch).run('docker', ['image', 'inspect', 'airdd2-runtime-python:3.12-ubuntu-noble', '--format', '{{json .Id}}']),
    ).resolves.toMatchObject({ exitCode: 0 });
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
      'run',
      '--rm',
      '--network',
      'none',
      '--mount',
      'type=bind,src=/opt/airdd2/backend/python,dst=/opt/airdd2/backend-python,readonly',
      '--env',
      'AIRDD2_NATIVE_ROOT=/opt/airdd2/backend-python',
      '--entrypoint',
      'python3',
      'airdd2-runtime-python:3.12-ubuntu-noble',
      '-c',
      'print(1)',
    ],
    [
      'run',
      '--rm',
      '--mount',
      'type=bind,src=/opt/airdd2/backend/python,dst=/opt/airdd2/backend-python',
      '--workdir',
      '/opt/airdd2/backend-python',
      'airdd2-python-provisioning:3.12-ubuntu-noble',
      'python3',
      '-c',
      'print(1)',
      '{}',
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
    await expect(
      client.run('docker', [
        'run',
        '--rm',
        '--mount',
        'type=bind,src=/etc,dst=/persistent-workspace',
        'airdd2-runtime-python:3.12-ubuntu-noble',
        'python3',
        '-c',
        'print(1)',
      ]),
    ).resolves.toMatchObject({ exitCode: 1, errorMessage: 'Docker gateway command is not allowed' });
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('keeps Docker kill operations unresolved until an external quiescence proof', async () => {
    const runner: DockerGatewayCommandRunner = {
      run: jest
        .fn()
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false })
        .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'Docker unavailable', timedOut: false }),
    };
    const { client, admission, epoch } = await startGateway(runner);
    const result = await client.run('docker', ['kill', 'airdd2-attempt']);

    expect(result).toMatchObject({ exitCode: 1, errorMessage: expect.stringContaining('uncertain') });
    const pending = admission.getPendingOperations();
    expect(pending).toHaveLength(1);

    admission.closeWorker(epoch);

    await expect(admission.reconcileUnknown(pending[0].id, { verify: jest.fn().mockResolvedValue(false) })).resolves.toBe(false);

    expect(admission.getPendingOperations()).toEqual(pending);
  });

  it('quarantines an uncertain run instead of relying on a point-in-time container inspection', async () => {
    const runner: DockerGatewayCommandRunner = {
      run: jest.fn().mockResolvedValue({
        exitCode: 1,
        stdout: '',
        stderr: '',
        timedOut: true,
      }),
    };
    const { client, admission } = await startGateway(runner);

    const result = await client.run('docker', [
      'run',
      '--name=airdd2-attempt',
      '--network=none',
      'airdd2-runtime-python:3.12-ubuntu-noble',
      'python3',
      '-c',
      'print(1)',
    ]);

    expect(result).toMatchObject({ exitCode: 1, errorMessage: expect.stringContaining('uncertain') });
    expect(admission.getPendingOperations()).toHaveLength(1);

    expect(runner.run).toHaveBeenCalledTimes(1);
  });

  it('clears a kill operation only after inspecting a stopped matching container', async () => {
    const runner: DockerGatewayCommandRunner = {
      run: jest
        .fn()
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', timedOut: false })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: JSON.stringify([
            {
              Name: '/airdd2-attempt',
              Config: { Labels: {} },
              State: { Status: 'exited' },
            },
          ]),
          stderr: '',
          timedOut: false,
        }),
    };
    const { client, admission } = await startGateway(runner);

    await expect(client.run('docker', ['kill', 'airdd2-attempt'])).resolves.toMatchObject({ exitCode: 0 });
    expect(admission.getPendingOperations()).toEqual([]);

    expect(runner.run).toHaveBeenCalledTimes(2);
  });

  it('reports durable outcome recording failures without claiming command success', async () => {
    const runner: DockerGatewayCommandRunner = {
      run: jest.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '', timedOut: false }),
    };
    const { client, admission } = await startGateway(runner);

    jest.spyOn(admission, 'settle').mockImplementation(() => Promise.reject(new Error('MongoDB unavailable')));

    await expect(
      client.run('docker', [
        'run',
        '--rm',
        '--name=airdd2-attempt',
        '--network=none',
        'airdd2-runtime-python:3.12-ubuntu-noble',
        'python3',
        '-c',
        'print(1)',
      ]),
    ).resolves.toMatchObject({
      exitCode: 1,
      errorMessage: expect.stringContaining('could not be durably recorded'),
    });
    expect(runner.run).toHaveBeenCalledTimes(1);
  });

  describe('control plane fence/verify', () => {
    const INERT_IMAGE = `sha256:${'ab'.repeat(32)}`;

    // Mini-fake Docker stateful : la réservation n'existe qu'après un create réussi.
    function createFenceRunner(): DockerGatewayCommandRunner & { state: { reservedId: string | null; reservedName: string | null } } {
      const state: { reservedId: string | null; reservedName: string | null } = { reservedId: null, reservedName: null };
      const runner: DockerGatewayCommandRunner = {
        run: jest.fn().mockImplementation(async (args: string[]) => {
          const [command] = args;
          if (command === 'ps') {
            return { exitCode: 0, stdout: '', stderr: '', timedOut: false };
          }
          if (command === 'inspect') {
            const name = args[args.length - 1];
            if (!state.reservedId || state.reservedName !== name) {
              return { exitCode: 1, stdout: '', stderr: 'Error: No such container', timedOut: false };
            }
            return {
              exitCode: 0,
              stdout: JSON.stringify([
                {
                  Id: 'cd'.repeat(32),
                  Name: `/${name}`,
                  Config: { Labels: { 'airdd2.fence.op': state.reservedId } },
                  State: { Status: 'created' },
                },
              ]),
              stderr: '',
              timedOut: false,
            };
          }
          if (command === 'create') {
            const nameArg = args.find((arg) => arg.startsWith('--name='));
            const labelIndex = args.findIndex((arg) => arg === '--label');
            const label = labelIndex >= 0 ? args[labelIndex + 1] : '';
            const match = /^airdd2\.fence\.op=(.+)$/.exec(label);
            if (!match) {
              return { exitCode: 1, stdout: '', stderr: 'unexpected label', timedOut: false };
            }
            state.reservedId = match[1];
            state.reservedName = nameArg?.slice('--name='.length) ?? null;
            return { exitCode: 0, stdout: 'ef'.repeat(32), stderr: '', timedOut: false };
          }
          if (command === 'kill' || command === 'rm') {
            return { exitCode: 0, stdout: '', stderr: '', timedOut: false };
          }
          return { exitCode: 0, stdout: '', stderr: '', timedOut: false };
        }),
      };
      return Object.assign(runner, { state });
    }

    it('fences and verifies a quarantined operation through the control plane', async () => {
      const runner = createFenceRunner();
      const { control, admission, epoch } = await startGateway(runner, INERT_IMAGE);

      const operation = admission.admit(epoch, { command: 'run', containerName: 'airdd2-fence-me' });
      admission.settle(operation, 'unknown');
      admission.closeWorker(epoch);

      // Rotation d'epoch : fencing auto + réservation best-effort par le serveur.
      const nextEpoch = await control.activateWorker('worker-2');
      expect(nextEpoch.epoch).toBe(epoch.epoch + 1);

      const fencedAfterRotation = admission.getFencedOperation(operation.id);
      expect(fencedAfterRotation).toMatchObject({
        fenceKind: 'auto_epoch_rotation',
        nameReservation: { containerName: 'airdd2-fence-me', reserved: true },
        quiescenceProven: true,
      });

      const verify = await control.verifyFenced(operation.id);
      expect(verify).toEqual({ quiescent: true });

      const fence = await control.fenceOperation(operation.id, 'user_manual_reset');
      expect(fence).toMatchObject({ fenced: true, nameReserved: true, quiescent: true });
      expect(Array.isArray(fence.observed)).toBe(true);

      expect(admission.getFencedOperation(operation.id)?.quiescenceProven).toBe(true);
    }, 30_000);

    it('fences a still-pending unknown operation on demand and refuses verify before fencing', async () => {
      const runner = createFenceRunner();
      const { control, admission, epoch } = await startGateway(runner, INERT_IMAGE);

      const operation = admission.admit(epoch, { command: 'kill', containerName: 'airdd2-pending' });
      admission.settle(operation, 'unknown');

      await expect(control.verifyFenced(operation.id)).rejects.toMatchObject({
        name: 'DockerGatewayControlError',
        statusCode: 409,
      });

      const fence = await control.fenceOperation(operation.id, 'user_manual_reset');
      expect(fence.fenced).toBe(true);
      expect(admission.getPendingOperations()).toEqual([]);
      expect(admission.getFencedOperation(operation.id)).toMatchObject({
        fenceKind: 'user_manual_reset',
        nameReservation: { containerName: 'airdd2-pending', reserved: true },
      });
    }, 30_000);

    it('returns 404 for an unknown operation id and 400 for an invalid fence kind', async () => {
      const runner: DockerGatewayCommandRunner = { run: jest.fn() };
      const { control } = await startGateway(runner, INERT_IMAGE);

      await expect(control.fenceOperation(randomUUID())).rejects.toMatchObject({
        name: 'DockerGatewayControlError',
        statusCode: 404,
      });
      await expect(control.verifyFenced(randomUUID())).rejects.toMatchObject({
        name: 'DockerGatewayControlError',
        statusCode: 404,
      });
      await expect(control.fenceOperation(randomUUID(), 'bogus' as never)).rejects.toMatchObject({
        statusCode: 400,
      });
      await expect(control.fenceOperation('not-a-uuid')).rejects.toThrow('UUID v4');
      expect(runner.run).not.toHaveBeenCalled();
    });
  });
});
