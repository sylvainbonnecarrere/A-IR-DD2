import type { UserToolRunRunner, UserToolRunRuntime } from '../../models/UserToolRun.model';
import type { RuntimeHealthReport } from '../../types/runtimeHealth.types';
import { DockerSandboxRunner } from './DockerSandboxRunner';
import { FirecrackerRunner } from './FirecrackerRunner';

export interface SandboxRunnerReadiness {
    ready: boolean;
    reason?: string;
    warning?: string;
}

export interface SandboxRunnerPort {
    getRunnerId(): UserToolRunRunner;
    getLabel(): string;
    supportsRuntime(runtime: UserToolRunRuntime): boolean;
    getReadiness(report: RuntimeHealthReport, runtime: UserToolRunRuntime): SandboxRunnerReadiness;
}

export interface SandboxRunnerFactory {
    createDockerRunner(): SandboxRunnerPort;
    createFirecrackerRunner(): SandboxRunnerPort;
    getPreferredRunner(report: RuntimeHealthReport): SandboxRunnerPort;
}

class DefaultSandboxRunnerFactory implements SandboxRunnerFactory {
    private readonly dockerRunner = new DockerSandboxRunner();
    private readonly firecrackerRunner = new FirecrackerRunner();

    createDockerRunner(): SandboxRunnerPort {
        return this.dockerRunner;
    }

    createFirecrackerRunner(): SandboxRunnerPort {
        return this.firecrackerRunner;
    }

    getPreferredRunner(report: RuntimeHealthReport): SandboxRunnerPort {
        const firecrackerEnabled = process.env.SANDBOX_FIRECRACKER_ENABLED === 'true';

        return firecrackerEnabled && report.runtime.runners.preferred === 'firecracker'
            ? this.firecrackerRunner
            : this.dockerRunner;
    }
}

export function createSandboxRunnerFactory(): SandboxRunnerFactory {
    return new DefaultSandboxRunnerFactory();
}

export function createDefaultSandboxRunnerPort(): SandboxRunnerPort {
    return createSandboxRunnerFactory().createDockerRunner();
}