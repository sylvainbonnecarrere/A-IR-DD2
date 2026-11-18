import type { DockerProcessRunner } from './DockerSandboxRunner';
import type { DockerGatewayEpoch } from './DockerGatewayAdmission';
import { DockerGatewayClient } from './DockerGatewayClient';
import { DockerGatewayControlClient, DockerGatewayControlError } from './DockerGatewayControlClient';

interface DockerCommandResult {
    exitCode: number;
    stdout: string;
    stderr: string;
    timedOut: boolean;
    aborted?: boolean;
    errorMessage?: string;
}

interface CommandRunner {
    run(command: string, args: string[], timeoutMs?: number): Promise<DockerCommandResult>;
}

let activeEpoch: DockerGatewayEpoch | undefined;
let activeClient: DockerGatewayClient | undefined;
let activeControlClient: DockerGatewayControlClient | undefined;

export function isDockerGatewayRequired(): boolean {
    return process.env.NODE_ENV === 'production' || process.env.DOCKER_GATEWAY_REQUIRED === 'true';
}

export function isDockerGatewayWorkerActive(): boolean {
    return activeEpoch !== undefined && activeClient !== undefined && activeControlClient !== undefined;
}

export async function activateDockerGatewayWorker(
    socketPath: string,
    workerId: string,
    retryTimeoutMs = 120_000,
): Promise<DockerGatewayEpoch> {
    if (!Number.isSafeInteger(retryTimeoutMs) || retryTimeoutMs < 0 || retryTimeoutMs > 300_000) {
        throw new RangeError('Docker gateway activation timeout is invalid');
    }
    if (activeEpoch) throw new Error('Docker gateway worker is already active in this process');

    const control = new DockerGatewayControlClient({ socketPath });
    activeControlClient = control;
    const deadline = Date.now() + retryTimeoutMs;
    let lastError: unknown;
    while (true) {
        try {
            const epoch = await control.activateWorker(workerId);
            activeEpoch = epoch;
            activeClient = new DockerGatewayClient({ socketPath, epoch });
            return epoch;
        } catch (error) {
            lastError = error;
            if (error instanceof DockerGatewayControlError
                && error.statusCode === 409
                && !error.message.includes('still in flight')) {
                activeControlClient = undefined;
                throw new Error(
                    `Docker gateway worker activation refused: ${error.message}`,
                );
            }
            if (Date.now() >= deadline) {
                activeControlClient = undefined;
                throw new Error(
                    `Docker gateway worker activation failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
                );
            }
            await new Promise((resolve) => setTimeout(resolve, 250));
        }
    }
}

export async function closeDockerGatewayWorker(): Promise<void> {
    const epoch = activeEpoch;
    const control = activeControlClient;
    if (!epoch || !control) {
        activeEpoch = undefined;
        activeClient = undefined;
        activeControlClient = undefined;
        return;
    }

    await control.closeWorker(epoch);
    activeEpoch = undefined;
    activeClient = undefined;
    activeControlClient = undefined;
}

export function createDockerProcessRunner(fallback: DockerProcessRunner): DockerProcessRunner {
    return {
        run(command, args, options) {
            const client = activeClient;
            if (client) return client.run(command, args, options);
            if (isDockerGatewayRequired()) {
                return Promise.resolve({
                    exitCode: 1,
                    stdout: '',
                    stderr: 'Docker gateway is not active in this backend process',
                    timedOut: false,
                    errorMessage: 'Docker gateway is not active in this backend process',
                });
            }
            return fallback.run(command, args, options);
        },
    };
}

export function createDockerCommandRunner(fallback: CommandRunner, dockerExecutable: string): CommandRunner {
    const processRunner = createDockerProcessRunner({
        run: (command, args, options) => fallback.run(command, args, options?.timeoutMs),
    });
    return {
        run(command, args, timeoutMs) {
            if (command !== dockerExecutable) return fallback.run(command, args, timeoutMs);
            return processRunner.run(command, args, { timeoutMs });
        },
    };
}
