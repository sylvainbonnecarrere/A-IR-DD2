import type {
    DockerGatewayOperation,
    DockerGatewayQuiescenceVerifier,
} from './DockerGatewayAdmission';
import type { DockerGatewayCommandRunner } from './DockerGatewayProtocol';

const CONTAINER_NAME_PATTERN = /^airdd2-[A-Za-z0-9_.-]{1,63}$/;
const ATTEMPT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const INSPECT_TIMEOUT_MS = 5_000;
const KILL_TIMEOUT_MS = 5_000;
const RECONCILE_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 250;

interface ContainerObservation {
    state: 'created' | 'running' | 'paused' | 'restarting' | 'removing' | 'exited' | 'dead';
}

export class DockerGatewayOperationReconciler implements DockerGatewayQuiescenceVerifier {
    constructor(
        private readonly runner: DockerGatewayCommandRunner,
        private readonly context: 'in-flight' | 'restart' = 'in-flight',
    ) {}

    async verify(operation: DockerGatewayOperation): Promise<boolean> {
        const effect = operation.effect;
        if (!effect
            || !CONTAINER_NAME_PATTERN.test(effect.containerName)
            || (effect.attemptId !== undefined && !ATTEMPT_ID_PATTERN.test(effect.attemptId))) {
            return false;
        }
        if (effect.attemptId
            && effect.containerName !== `airdd2-j7-attempt-${effect.attemptId}`) {
            return false;
        }

        // A disconnected run request may still create or start the container after inspection.
        if (effect.command === 'run') return false;
        // After a restart a delayed kill can still target a later container with the same name.
        if (this.context === 'restart') return false;

        const deadline = Date.now() + RECONCILE_TIMEOUT_MS;
        while (Date.now() <= deadline) {
            const observation = await this.inspect(effect.containerName, effect.attemptId);
            if (observation === 'absent') return true;
            if (!observation) return false;
            if (observation.state === 'created' || observation.state === 'exited' || observation.state === 'dead') {
                return true;
            }
            if (observation.state === 'removing') {
                await delay(POLL_INTERVAL_MS);
                continue;
            }
            if (observation.state === 'paused') return false;

            await this.runner.run(['kill', effect.containerName], { timeoutMs: KILL_TIMEOUT_MS });
            await delay(POLL_INTERVAL_MS);
        }
        return false;
    }

    private async inspect(name: string, attemptId?: string): Promise<ContainerObservation | 'absent' | null> {
        let result;
        try {
            result = await this.runner.run(['inspect', name], { timeoutMs: INSPECT_TIMEOUT_MS });
        } catch {
            return null;
        }
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
        if (container.Name !== `/${name}` || typeof config !== 'object' || config === null
            || typeof state !== 'object' || state === null) {
            return null;
        }
        if (attemptId) {
            const labels = (config as Record<string, unknown>).Labels;
            if (typeof labels !== 'object' || labels === null
                || (labels as Record<string, unknown>)['airdd2.execution.attempt'] !== attemptId) {
                return null;
            }
        }
        const status = (state as Record<string, unknown>).Status;
        if (!['created', 'running', 'paused', 'restarting', 'removing', 'exited', 'dead'].includes(String(status))) {
            return null;
        }
        return { state: status as ContainerObservation['state'] };
    }
}

function delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
