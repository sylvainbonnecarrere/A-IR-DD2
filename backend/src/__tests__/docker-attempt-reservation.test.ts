import { randomUUID } from 'crypto';
import { DockerAttemptReservation, type DockerReservationCommand } from '../services/runtime/DockerAttemptReservation';

describe('DockerAttemptReservation', () => {
    const imageId = `sha256:${'a'.repeat(64)}`;
    const containerId = 'b'.repeat(64);
    let attemptId: string;
    let containerName: string;
    let container: Record<string, unknown>;
    let run: jest.Mock<Promise<string>, [string[]]>;
    let reservation: DockerAttemptReservation;

    beforeEach(() => {
        attemptId = randomUUID();
        containerName = DockerAttemptReservation.containerName(attemptId);
        container = {
            Id: containerId, Name: `/${containerName}`, Image: imageId, Mounts: [],
            Config: {
                Labels: { 'airdd2.reservation.attempt': attemptId },
                Entrypoint: ['/bin/true'], Cmd: ['/bin/true'],
                Healthcheck: { Test: ['NONE'] },
            },
            HostConfig: { NetworkMode: 'none', ReadonlyRootfs: true, Privileged: false, AutoRemove: false, CapDrop: ['ALL'], RestartPolicy: { Name: 'no' } },
            State: { Running: false, Paused: false, Restarting: false },
        };
        run = jest.fn<Promise<string>, [string[]]>()
            .mockImplementation(async (args) => args[0] === 'create' ? containerId : JSON.stringify([container]));
        const command: DockerReservationCommand = { run };
        reservation = new DockerAttemptReservation(imageId, command);
    });

    it('reserves and inspects a unique attempt by immutable ID', async () => {
        await expect(reservation.reserve(attemptId)).resolves.toEqual({ attemptId, containerId, containerName });
        expect(run).toHaveBeenNthCalledWith(1, expect.arrayContaining([
            'create', `--name=${containerName}`, '--pull=never', '--network=none', '--read-only',
            '--cap-drop=ALL', '--no-healthcheck', '--entrypoint=/bin/true', imageId,
        ]));
        expect(run).toHaveBeenNthCalledWith(2, ['inspect', containerId]);
    });

    it('rejects mutable image tags and malformed attempt identifiers before calling Docker', async () => {
        expect(() => new DockerAttemptReservation('ubuntu:latest', { run })).toThrow('immutable');
        await expect(reservation.reserve('invalid/attempt')).rejects.toThrow('UUID v4');
        expect(run).not.toHaveBeenCalled();
    });

    it('fails closed without cleanup when creation fails or its result is unknown', async () => {
        run.mockRejectedValueOnce(new Error('Docker unavailable or timed out'));
        await expect(reservation.reserve(attemptId)).rejects.toThrow('timed out');
        expect(run).toHaveBeenCalledTimes(1);
        run.mockReset().mockResolvedValueOnce('not-a-container-id');
        await expect(reservation.reserve(attemptId)).rejects.toThrow('outcome is unknown');
        expect(run).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['identity', { Id: 'c'.repeat(64) }],
        ['name', { Name: '/other' }],
        ['image', { Image: `sha256:${'c'.repeat(64)}` }],
        ['mount', { Mounts: [{ Source: '/workspace' }] }],
        ['label', { Config: { Labels: {}, Entrypoint: ['/bin/true'], Cmd: ['/bin/true'] } }],
        ['entrypoint', { Config: { Entrypoint: ['/bin/sh'] } }],
        ['healthcheck', { Config: { Healthcheck: { Test: ['CMD', '/bin/sh'] } } }],
        ['network', { HostConfig: { NetworkMode: 'bridge', ReadonlyRootfs: true, Privileged: false, AutoRemove: false, CapDrop: ['ALL'] } }],
        ['restart policy', { HostConfig: { RestartPolicy: { Name: 'always' } } }],
        ['running state', { State: { Running: true, Paused: false, Restarting: false } }],
    ])('refuses an unexpected %s without deleting anything', async (_label, change) => {
        for (const [key, value] of Object.entries(change)) {
            const previous = container[key];
            container[key] = typeof previous === 'object' && previous !== null && !Array.isArray(previous)
                && typeof value === 'object' && value !== null && !Array.isArray(value)
                ? { ...previous, ...value } : value;
        }
        await expect(reservation.reserve(attemptId)).rejects.toThrow('does not match');
        expect(run).toHaveBeenCalledTimes(2);
        expect(run.mock.calls.every(([args]) => !['rm', 'kill'].includes(args[0]))).toBe(true);
    });

    it('fails closed if inspection is malformed or unavailable', async () => {
        run.mockResolvedValueOnce(containerId).mockResolvedValueOnce('not json');
        await expect(reservation.reserve(attemptId)).rejects.toThrow('invalid JSON');
        run.mockReset().mockResolvedValueOnce(containerId).mockRejectedValueOnce(new Error('Docker unavailable'));
        await expect(reservation.reserve(attemptId)).rejects.toThrow('Docker unavailable');
        expect(run).toHaveBeenCalledTimes(2);
    });

    it('revalidates reservation identity before inspection', async () => {
        await expect(reservation.verify({ attemptId, containerId, containerName: 'other' })).rejects.toThrow('identity');
        expect(run).not.toHaveBeenCalled();
    });

    it('recovers a reservation by deterministic name after an interrupted caller', async () => {
        await expect(reservation.recover(attemptId)).resolves.toEqual({ attemptId, containerId, containerName });
        expect(run).toHaveBeenCalledWith(['inspect', containerName]);
    });

    it('rejects a conflicting container or unavailable Docker during recovery without modifying it', async () => {
        container.Name = '/other';
        await expect(reservation.recover(attemptId)).rejects.toThrow('does not match');
        run.mockRejectedValueOnce(new Error('Docker unavailable'));
        await expect(reservation.recover(attemptId)).rejects.toThrow('Docker unavailable');
        expect(run.mock.calls.every(([args]) => args[0] === 'inspect')).toBe(true);
    });

    it('rejects malformed or ambiguous recovery observations', async () => {
        container.Id = 'bad-id';
        await expect(reservation.recover(attemptId)).rejects.toThrow('invalid container identity');
        run.mockResolvedValueOnce('[]');
        await expect(reservation.recover(attemptId)).rejects.toThrow('exactly one');
        run.mockResolvedValueOnce('invalid');
        await expect(reservation.recover(attemptId)).rejects.toThrow('invalid JSON');
    });
});
