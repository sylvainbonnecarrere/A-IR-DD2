import { DockerAttemptReservation } from './DockerAttemptReservation';
import { SpawnDockerProcessRunner } from './DockerSandboxRunner';
import { createDockerProcessRunner } from './DockerGatewayRuntime';
import type { DockerProcessRunner } from './DockerSandboxRunner';

const CONTAINER_ID_PATTERN = /^[0-9a-f]{64}$/;
const TERMINAL_STATES = ['created', 'exited', 'dead'] as const;
const INSPECT_TIMEOUT_MS = 5_000;
const KILL_TIMEOUT_MS = 5_000;
const RECONCILE_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 250;

export type DockerAttemptQuiescentState = 'absent' | typeof TERMINAL_STATES[number];

export interface DockerAttemptRecoveryPort {
    stopAndVerify(attemptId: string): Promise<DockerAttemptQuiescentState | null>;
}

interface ContainerInspection {
    id: string;
    state: 'created' | 'running' | 'paused' | 'restarting' | 'removing' | 'exited' | 'dead';
}

export class DockerGatewayAttemptRecovery implements DockerAttemptRecoveryPort {
    private readonly runner: DockerProcessRunner;

    constructor(runner?: DockerProcessRunner) {
        this.runner = runner ?? createDockerProcessRunner(new SpawnDockerProcessRunner());
    }

    async stopAndVerify(attemptId: string): Promise<DockerAttemptQuiescentState | null> {
        const containerName = DockerAttemptReservation.containerName(attemptId);
        const deadline = Date.now() + RECONCILE_TIMEOUT_MS;
        while (Date.now() <= deadline) {
            const inspection = await this.inspect(containerName, attemptId);
            if (inspection === 'absent') return 'absent';
            if (!inspection) return null;
            if (TERMINAL_STATES.includes(inspection.state as typeof TERMINAL_STATES[number])) {
                return inspection.state as DockerAttemptQuiescentState;
            }
            if (inspection.state === 'paused') return null;
            if (inspection.state === 'removing') {
                await delay(POLL_INTERVAL_MS);
                continue;
            }

            await this.runner.run('docker', ['kill', containerName], { timeoutMs: KILL_TIMEOUT_MS });
            await delay(POLL_INTERVAL_MS);
        }
        return null;
    }

    private async inspect(name: string, attemptId: string): Promise<ContainerInspection | 'absent' | null> {
        const result = await this.runner.run('docker', ['inspect', name], { timeoutMs: INSPECT_TIMEOUT_MS });
        if (result.timedOut || result.errorMessage) return null;
        if (result.exitCode !== 0) {
            return /no such (?:object|container)/i.test(result.stderr) ? 'absent' : null;
        }

        let parsed: unknown;
        try {
            parsed = JSON.parse(result.stdout);
        } catch {
            return null;
        }
        if (!Array.isArray(parsed) || parsed.length !== 1 || typeof parsed[0] !== 'object' || parsed[0] === null) {
            return null;
        }
        const container = parsed[0] as Record<string, unknown>;
        const config = container.Config;
        const state = container.State;
        if (container.Id !== undefined && (typeof container.Id !== 'string' || !CONTAINER_ID_PATTERN.test(container.Id))) {
            return null;
        }
        if (container.Name !== `/${name}` || typeof container.Id !== 'string'
            || typeof config !== 'object' || config === null || typeof state !== 'object' || state === null) {
            return null;
        }
        const labels = (config as Record<string, unknown>).Labels;
        if (typeof labels !== 'object' || labels === null
            || (labels as Record<string, unknown>)['airdd2.execution.attempt'] !== attemptId) {
            return null;
        }
        const status = (state as Record<string, unknown>).Status;
        if (!['created', 'running', 'paused', 'restarting', 'removing', 'exited', 'dead'].includes(String(status))) {
            return null;
        }
        return { id: container.Id, state: status as ContainerInspection['state'] };
    }
}

function delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
