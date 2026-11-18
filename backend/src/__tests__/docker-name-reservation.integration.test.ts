import { execFile, spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { promisify } from 'util';
import path from 'path';
import { DockerAttemptReservation } from '../services/runtime/DockerAttemptReservation';
import { DockerAttemptContainerInspector } from '../services/runtime/DockerAttemptContainerInspector';

const execFileAsync = promisify(execFile);
const describeDocker = process.env.AIRDD2_TEST_DOCKER_RESERVATION === '1' ? describe : describe.skip;

describeDocker('Docker name reservation assumptions', () => {
    const containers = new Set<string>();

    async function docker(...args: string[]): Promise<string> {
        const { stdout } = await execFileAsync('docker', args, { timeout: 15_000 });
        return stdout.trim();
    }

    async function create(name: string): Promise<string> {
        const id = await docker(
            'create', `--name=${name}`, '--pull=never', '--network=none', '--read-only', '--cap-drop=ALL',
            'ubuntu:noble', '/bin/true',
        );
        if (!/^[0-9a-f]{64}$/.test(id)) {
            throw new Error('Docker did not return a valid container ID');
        }
        containers.add(id);
        return id;
    }

    afterEach(async () => {
        for (const id of containers) {
            await docker('rm', '--force', id);
            containers.delete(id);
        }
    });

    it('allows only one concurrent creation for a container name', async () => {
        const name = `airdd2-j7-reservation-test-${randomUUID()}`;
        const attempts = await Promise.allSettled([create(name), create(name)]);
        expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
        const failures = attempts.filter((attempt): attempt is PromiseRejectedResult => attempt.status === 'rejected');
        expect(failures).toHaveLength(1);
        expect(failures[0].reason).toEqual(expect.objectContaining({ stderr: expect.stringMatching(/already in use/i) }));
    });

    it('rejects a stale container ID and a late creation while an inert replacement holds the name', async () => {
        const name = `airdd2-j7-reservation-test-${randomUUID()}`;
        const previousId = await create(name);
        await docker('rm', previousId);
        containers.delete(previousId);

        const reservationId = await create(name);
        await expect(docker('start', previousId)).rejects.toMatchObject({ stderr: expect.stringMatching(/no such container/i) });
        await expect(create(name)).rejects.toMatchObject({ stderr: expect.stringMatching(/already in use/i) });
        await docker('start', '--attach', name);
        await expect(create(name)).rejects.toMatchObject({ stderr: expect.stringMatching(/already in use/i) });
        const details = JSON.parse(await docker('inspect', reservationId)) as Array<{
            State: { Running: boolean };
            Mounts: unknown[];
            HostConfig: { NetworkMode: string; ReadonlyRootfs: boolean };
            Config: { Cmd: string[] };
        }>;
        expect(details[0]).toMatchObject({
            State: { Running: false },
            Mounts: [],
            HostConfig: { NetworkMode: 'none', ReadonlyRootfs: true },
            Config: { Cmd: ['/bin/true'] },
        });
    });

    it('creates and verifies the reservation adapter against Docker, including a late name-based start', async () => {
        const attemptId = randomUUID();
        const name = DockerAttemptReservation.containerName(attemptId);
        const imageId = await docker('image', 'inspect', 'ubuntu:noble', '--format', '{{.Id}}');
        const service = new DockerAttemptReservation(imageId);
        try {
            const result = await service.reserve(attemptId);
            containers.add(result.containerId);
            await expect(service.reserve(attemptId)).rejects.toThrow('outcome may be unknown');
            await docker('start', '--attach', name);
            await expect(service.verify(result)).resolves.toBeUndefined();
        } finally {
            const ids = await docker('container', 'ls', '--all', '--no-trunc', '--filter',
                `label=airdd2.reservation.attempt=${attemptId}`, '--format', '{{.ID}}');
            for (const id of ids.split(/\s+/).filter(Boolean)) {
                if (!/^[0-9a-f]{64}$/.test(id)) throw new Error('Invalid test container ID');
                containers.add(id);
            }
        }
    });

    it('does not let concurrent reservation attempts both succeed', async () => {
        const attemptId = randomUUID();
        const imageId = await docker('image', 'inspect', 'ubuntu:noble', '--format', '{{.Id}}');
        const service = new DockerAttemptReservation(imageId);
        try {
            const results = await Promise.allSettled([service.reserve(attemptId), service.reserve(attemptId)]);
            const successes = results.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof service.reserve>>> =>
                result.status === 'fulfilled');
            const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
            expect(successes).toHaveLength(1);
            expect(failures).toHaveLength(1);
            expect(failures[0].reason.message).toMatch(/outcome may be unknown/);
            await service.verify(successes[0].value);
        } finally {
            const ids = await docker('container', 'ls', '--all', '--no-trunc', '--filter',
                `label=airdd2.reservation.attempt=${attemptId}`, '--format', '{{.ID}}');
            for (const id of ids.split(/\s+/).filter(Boolean)) {
                if (!/^[0-9a-f]{64}$/.test(id)) throw new Error('Invalid test container ID');
                containers.add(id);
            }
        }
    });

    it('does not protect a reservation from a late removal addressed by name', async () => {
        const attemptId = randomUUID();
        const name = DockerAttemptReservation.containerName(attemptId);
        const imageId = await docker('image', 'inspect', 'ubuntu:noble', '--format', '{{.Id}}');
        const service = new DockerAttemptReservation(imageId);
        try {
            const reservation = await service.reserve(attemptId);
            containers.add(reservation.containerId);
            await docker('rm', '--force', name);
            containers.delete(reservation.containerId);
            await expect(service.verify(reservation)).rejects.toThrow('outcome may be unknown');
            await expect(service.recover(attemptId)).rejects.toThrow('outcome may be unknown');

            const replacementId = await create(name);
            expect(replacementId).not.toBe(reservation.containerId);
            await expect(service.recover(attemptId)).rejects.toThrow('does not match');
        } finally {
            const ids = await docker('container', 'ls', '--all', '--no-trunc', '--filter',
                `label=airdd2.reservation.attempt=${attemptId}`, '--format', '{{.ID}}');
            for (const id of ids.split(/\s+/).filter(Boolean)) {
                if (!/^[0-9a-f]{64}$/.test(id)) throw new Error('Invalid test container ID');
                containers.add(id);
            }
        }
    });

    it('does not let a stale immutable ID remove a replacement reservation', async () => {
        const attemptId = randomUUID();
        const name = DockerAttemptReservation.containerName(attemptId);
        const imageId = await docker('image', 'inspect', 'ubuntu:noble', '--format', '{{.Id}}');
        const service = new DockerAttemptReservation(imageId);
        try {
            const oldId = await create(name);
            await docker('rm', '--force', oldId);
            containers.delete(oldId);
            const reservation = await service.reserve(attemptId);
            containers.add(reservation.containerId);

            await expect(docker('rm', '--force', oldId)).resolves.toBe('');
            await expect(docker('inspect', oldId)).rejects.toMatchObject({
                stderr: expect.stringMatching(/no such object|no such container/i),
            });
            await expect(service.verify(reservation)).resolves.toBeUndefined();
        } finally {
            const ids = await docker('container', 'ls', '--all', '--no-trunc', '--filter',
                `label=airdd2.reservation.attempt=${attemptId}`, '--format', '{{.ID}}');
            for (const id of ids.split(/\s+/).filter(Boolean)) {
                if (!/^[0-9a-f]{64}$/.test(id)) throw new Error('Invalid test container ID');
                containers.add(id);
            }
        }
    });

    it('observes an execution container by full ID before and after it exits', async () => {
        const attemptId = randomUUID();
        const name = DockerAttemptReservation.containerName(attemptId);
        const inspector = new DockerAttemptContainerInspector();
        try {
            const id = await docker('create', `--name=${name}`, '--pull=never', '--network=none',
                '--label', `airdd2.execution.attempt=${attemptId}`, 'ubuntu:noble', '/bin/true');
            if (!/^[0-9a-f]{64}$/.test(id)) throw new Error('Invalid test container ID');
            containers.add(id);
            await expect(inspector.inspect(attemptId, id)).resolves.toEqual({ containerId: id, attemptId, state: 'created' });
            await docker('start', '--attach', id);
            await expect(inspector.inspect(attemptId, id)).resolves.toEqual({ containerId: id, attemptId, state: 'exited' });
            await expect(inspector.inspect(randomUUID(), id)).rejects.toThrow('expected identity');
        } finally {
            const ids = await docker('container', 'ls', '--all', '--no-trunc', '--filter',
                `label=airdd2.execution.attempt=${attemptId}`, '--format', '{{.ID}}');
            for (const id of ids.split(/\s+/).filter(Boolean)) {
                if (!/^[0-9a-f]{64}$/.test(id)) throw new Error('Invalid test container ID');
                containers.add(id);
            }
        }
    });

    it('recovers the exact reservation from a new process after the creating process is gone', async () => {
        const attemptId = randomUUID();
        const imageId = await docker('image', 'inspect', 'ubuntu:noble', '--format', '{{.Id}}');
        try {
            const fixture = path.join(__dirname, 'fixtures', 'docker-reservation-recover-worker.ts');
            const creation = await execFileAsync(process.execPath, ['--import', 'tsx', fixture, 'create', imageId, attemptId], {
                timeout: 20_000,
            });
            const created = JSON.parse(creation.stdout) as { containerId: string };
            if (!/^[0-9a-f]{64}$/.test(created.containerId)) throw new Error('Invalid test container ID');
            containers.add(created.containerId);
            const recovered = await execFileAsync(process.execPath, ['--import', 'tsx', fixture, 'recover', imageId, attemptId], {
                timeout: 20_000,
            });
            expect(JSON.parse(recovered.stdout)).toEqual(created);
        } finally {
            const ids = await docker('container', 'ls', '--all', '--no-trunc', '--filter',
                `label=airdd2.reservation.attempt=${attemptId}`, '--format', '{{.ID}}');
            for (const id of ids.split(/\s+/).filter(Boolean)) {
                if (!/^[0-9a-f]{64}$/.test(id)) throw new Error('Invalid test container ID');
                containers.add(id);
            }
        }
    });

    it('recovers a reservation after the creating process is forcibly terminated', async () => {
        const attemptId = randomUUID();
        const imageId = await docker('image', 'inspect', 'ubuntu:noble', '--format', '{{.Id}}');
        const fixture = path.join(__dirname, 'fixtures', 'docker-reservation-recover-worker.ts');
        const child = spawn(process.execPath, ['--import', 'tsx', fixture, 'create-and-wait', imageId, attemptId], {
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
        });
        const exited = new Promise<void>((resolve, reject) => {
            child.once('error', reject);
            child.once('exit', () => resolve());
        });
        try {
            const output = await new Promise<string>((resolve, reject) => {
                let stdout = '';
                let stderr = '';
                const timer = setTimeout(() => reject(new Error('Reservation process did not become ready')), 15_000);
                child.stdout.on('data', (chunk: Buffer) => {
                    stdout += chunk.toString('utf8');
                    if (stdout.includes('\n')) {
                        clearTimeout(timer);
                        resolve(stdout.trim());
                    }
                });
                child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
                child.once('error', (error) => { clearTimeout(timer); reject(error); });
                child.once('exit', () => {
                    clearTimeout(timer);
                    reject(new Error(`Reservation process exited before readiness: ${stderr}`));
                });
            });
            const created = JSON.parse(output) as { containerId: string };
            if (!/^[0-9a-f]{64}$/.test(created.containerId)) throw new Error('Invalid test container ID');
            containers.add(created.containerId);
            if (!child.kill()) throw new Error('Unable to terminate the reservation process');
            await exited;
            const recovered = await execFileAsync(process.execPath, ['--import', 'tsx', fixture, 'recover', imageId, attemptId], {
                timeout: 20_000,
            });
            expect(JSON.parse(recovered.stdout)).toEqual(created);
        } finally {
            if (child.exitCode === null && child.signalCode === null) child.kill();
            await exited;
            const ids = await docker('container', 'ls', '--all', '--no-trunc', '--filter',
                `label=airdd2.reservation.attempt=${attemptId}`, '--format', '{{.ID}}');
            for (const id of ids.split(/\s+/).filter(Boolean)) {
                if (!/^[0-9a-f]{64}$/.test(id)) throw new Error('Invalid test container ID');
                containers.add(id);
            }
        }
    }, 40_000);

    it('fails closed if a late launcher occupies the name before a reservation is created', async () => {
        const attemptId = randomUUID();
        const name = DockerAttemptReservation.containerName(attemptId);
        const imageId = await docker('image', 'inspect', 'ubuntu:noble', '--format', '{{.Id}}');
        const service = new DockerAttemptReservation(imageId);
        const oldId = await create(name);
        await docker('rm', oldId);
        containers.delete(oldId);

        const lateId = await create(name);
        await expect(service.reserve(attemptId)).rejects.toThrow('outcome may be unknown');
        const state = await docker('inspect', '--format', '{{.Id}} {{.State.Running}}', lateId);
        expect(state).toBe(`${lateId} false`);
        await expect(docker('start', oldId)).rejects.toMatchObject({ stderr: expect.stringMatching(/no such container/i) });
    });

    it('demonstrates that killing a retained container alone does not prevent a late restart', async () => {
        const name = `airdd2-j7-reservation-test-${randomUUID()}`;
        const id = await docker('create', `--name=${name}`, '--pull=never', '--network=none',
            '--read-only', '--cap-drop=ALL', 'ubuntu:noble', '/bin/sleep', '30');
        if (!/^[0-9a-f]{64}$/.test(id)) throw new Error('Invalid test container ID');
        containers.add(id);
        await docker('start', id);
        await docker('kill', id);
        expect(await docker('inspect', '--format', '{{.State.Running}}', id)).toBe('false');
        await docker('start', id);
        expect(await docker('inspect', '--format', '{{.State.Running}}', id)).toBe('true');
        await docker('kill', id);
    });
});
