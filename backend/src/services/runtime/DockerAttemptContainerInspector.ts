import { DockerAttemptReservation, DockerCliReservationCommand } from './DockerAttemptReservation';
import type { DockerReservationCommand } from './DockerAttemptReservation';

const CONTAINER_ID_PATTERN = /^[0-9a-f]{64}$/;
const STATES = ['created', 'running', 'paused', 'restarting', 'removing', 'exited', 'dead'] as const;
type ContainerState = typeof STATES[number];

export interface ObservedAttemptContainer {
    containerId: string;
    attemptId: string;
    state: ContainerState;
}

/**
 * An observation is not proof that the container or pending Docker operations
 * are neutralized. This inspector does not authorize removal or workspace reuse.
 */
export class DockerAttemptContainerInspector {
    constructor(private readonly command: DockerReservationCommand = new DockerCliReservationCommand()) {}

    async inspect(attemptId: string, containerId: string): Promise<ObservedAttemptContainer> {
        const name = DockerAttemptReservation.containerName(attemptId);
        if (!CONTAINER_ID_PATTERN.test(containerId)) {
            throw new Error('Attempt container inspection requires a full immutable Docker ID');
        }
        const raw = await this.command.run(['inspect', containerId]);
        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch {
            throw new Error('Attempt container inspection returned invalid JSON');
        }
        if (!Array.isArray(parsed) || parsed.length !== 1 || typeof parsed[0] !== 'object' || parsed[0] === null) {
            throw new Error('Attempt container inspection did not return exactly one container');
        }
        const item = parsed[0] as Record<string, unknown>;
        const config = item.Config;
        const state = item.State;
        if (typeof config !== 'object' || config === null || typeof state !== 'object' || state === null) {
            throw new Error('Attempt container inspection returned incomplete identity or state');
        }
        const labels = (config as Record<string, unknown>).Labels;
        const status = (state as Record<string, unknown>).Status;
        if (item.Id !== containerId || item.Name !== `/${name}` || typeof labels !== 'object' || labels === null
            || (labels as Record<string, unknown>)['airdd2.execution.attempt'] !== attemptId) {
            throw new Error('Attempt container inspection does not match the expected identity');
        }
        const observedState = STATES.find((value) => value === status);
        if (!observedState) {
            throw new Error('Attempt container inspection returned an unknown state');
        }
        return { containerId, attemptId, state: observedState };
    }
}
