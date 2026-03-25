import type { RuntimeHealthReport } from '../../types/runtimeHealth.types';
import type { SandboxRunnerPort, SandboxRunnerReadiness } from './SandboxRunner';
import type { SandboxExecutionRequest, SandboxExecutionResult } from './execution.types';

export class FirecrackerRunner implements SandboxRunnerPort {
    getRunnerId() {
        return 'firecracker' as const;
    }

    getLabel(): string {
        return 'Firecracker';
    }

    supportsRuntime(runtime: SandboxExecutionRequest['runtime']): boolean {
        return runtime === 'python' || runtime === 'typescript';
    }

    getReadiness(report: RuntimeHealthReport, runtime: SandboxExecutionRequest['runtime']): SandboxRunnerReadiness {
        if (!this.supportsRuntime(runtime)) {
            return {
                ready: false,
                reason: `Runner ${this.getRunnerId()} ne supporte pas le runtime ${runtime}.`
            };
        }

        if (!report.runtime.runners.firecracker.available) {
            return {
                ready: false,
                reason: report.runtime.runners.firecracker.detail
            };
        }

        return {
            ready: process.env.SANDBOX_FIRECRACKER_ENABLED === 'true',
            reason: process.env.SANDBOX_FIRECRACKER_ENABLED === 'true'
                ? undefined
                : 'Firecracker détecté mais non activé. Utiliser SANDBOX_FIRECRACKER_ENABLED=true pour le prototype J7.'
        };
    }

    async execute(_request: SandboxExecutionRequest): Promise<SandboxExecutionResult> {
        throw new Error('FirecrackerRunner prototype: branchement KVM détecté mais exécution non activée dans cet environnement.');
    }
}
