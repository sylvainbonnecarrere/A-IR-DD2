import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const ATTEMPT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const IMAGE_ID_PATTERN = /^sha256:[0-9a-f]{64}$/;
const CONTAINER_ID_PATTERN = /^[0-9a-f]{64}$/;

export interface DockerReservationCommand {
    run(args: string[]): Promise<string>;
}

export class DockerCliReservationCommand implements DockerReservationCommand {
    async run(args: string[]): Promise<string> {
        try {
            const result = await execFileAsync('docker', args, { timeout: 15_000, maxBuffer: 1024 * 1024, windowsHide: true });
            return result.stdout.trim();
        } catch (error) {
            const kind = error instanceof Error ? error.name : 'UnknownError';
            throw new Error(`Docker reservation command failed or timed out (${kind}); its outcome may be unknown`);
        }
    }
}

export interface AttemptReservation {
    attemptId: string;
    containerId: string;
    containerName: string;
}

/**
 * Reserves a fresh attempt name only; it does not stop a launcher or certify
 * that a workspace can be released. The caller must persist the attempt ID
 * before any launcher can use its name and restrict Docker access accordingly.
 */
export class DockerAttemptReservation {
    constructor(
        private readonly imageId: string,
        private readonly command: DockerReservationCommand = new DockerCliReservationCommand(),
    ) {
        if (!IMAGE_ID_PATTERN.test(imageId)) {
            throw new Error('Reservation requires a trusted immutable Docker image ID');
        }
    }

    static containerName(attemptId: string): string {
        if (!ATTEMPT_ID_PATTERN.test(attemptId)) {
            throw new Error('Attempt ID must be a lowercase UUID v4');
        }
        return `airdd2-j7-attempt-${attemptId}`;
    }

    async reserve(attemptId: string): Promise<AttemptReservation> {
        const containerName = DockerAttemptReservation.containerName(attemptId);
        const containerId = await this.command.run([
            'create', `--name=${containerName}`, '--pull=never',
            '--label', `airdd2.reservation.attempt=${attemptId}`,
            '--network=none', '--read-only', '--cap-drop=ALL', '--no-healthcheck',
            '--entrypoint=/bin/true', this.imageId, '/bin/true',
        ]);
        if (!CONTAINER_ID_PATTERN.test(containerId)) {
            throw new Error('Docker reservation returned an invalid container ID; outcome is unknown');
        }
        const reservation = { attemptId, containerId, containerName };
        await this.verify(reservation);
        return reservation;
    }

    async verify(reservation: AttemptReservation): Promise<void> {
        const expectedName = DockerAttemptReservation.containerName(reservation.attemptId);
        if (reservation.containerName !== expectedName || !CONTAINER_ID_PATTERN.test(reservation.containerId)) {
            throw new Error('Invalid Docker reservation identity');
        }
        const container = await this.inspect(reservation.containerId);
        if (!this.matches(container, reservation)) {
            throw new Error('Docker reservation inspection does not match the expected inert container');
        }
    }

    async recover(attemptId: string): Promise<AttemptReservation> {
        const containerName = DockerAttemptReservation.containerName(attemptId);
        const container = await this.inspect(containerName);
        if (typeof container !== 'object' || container === null || !('Id' in container)
            || typeof container.Id !== 'string' || !CONTAINER_ID_PATTERN.test(container.Id)) {
            throw new Error('Docker reservation inspection returned an invalid container identity');
        }
        const reservation = { attemptId, containerId: container.Id, containerName };
        if (!this.matches(container, reservation)) {
            throw new Error('Docker reservation inspection does not match the expected inert container');
        }
        return reservation;
    }

    private async inspect(identity: string): Promise<unknown> {
        const raw = await this.command.run(['inspect', identity]);
        let containers: unknown;
        try {
            containers = JSON.parse(raw);
        } catch {
            throw new Error('Docker reservation inspection returned invalid JSON');
        }
        if (!Array.isArray(containers) || containers.length !== 1) {
            throw new Error('Docker reservation inspection did not return exactly one container');
        }
        return containers[0];
    }

    private matches(value: unknown, reservation: AttemptReservation): boolean {
        if (typeof value !== 'object' || value === null) return false;
        const item = value as Record<string, unknown>;
        const config = item.Config;
        const host = item.HostConfig;
        const state = item.State;
        if (typeof config !== 'object' || config === null || typeof host !== 'object' || host === null
            || typeof state !== 'object' || state === null) return false;
        const c = config as Record<string, unknown>;
        const h = host as Record<string, unknown>;
        const s = state as Record<string, unknown>;
        const labels = c.Labels;
        const healthcheck = c.Healthcheck;
        const restartPolicy = h.RestartPolicy;
        return item.Id === reservation.containerId
            && item.Name === `/${reservation.containerName}`
            && item.Image === this.imageId
            && Array.isArray(item.Mounts) && item.Mounts.length === 0
            && typeof labels === 'object' && labels !== null
            && (labels as Record<string, unknown>)['airdd2.reservation.attempt'] === reservation.attemptId
            && Array.isArray(c.Entrypoint) && c.Entrypoint.length === 1 && c.Entrypoint[0] === '/bin/true'
            && Array.isArray(c.Cmd) && c.Cmd.length === 1 && c.Cmd[0] === '/bin/true'
            && typeof healthcheck === 'object' && healthcheck !== null
            && Array.isArray((healthcheck as Record<string, unknown>).Test)
            && ((healthcheck as Record<string, unknown>).Test as unknown[]).length === 1
            && ((healthcheck as Record<string, unknown>).Test as unknown[])[0] === 'NONE'
            && h.NetworkMode === 'none' && h.ReadonlyRootfs === true && h.Privileged === false
            && h.AutoRemove === false && Array.isArray(h.CapDrop) && h.CapDrop.includes('ALL')
            && typeof restartPolicy === 'object' && restartPolicy !== null
            && (restartPolicy as Record<string, unknown>).Name === 'no'
            && s.Running === false && s.Paused === false && s.Restarting === false;
    }
}
