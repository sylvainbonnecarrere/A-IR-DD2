import { createDefaultSandboxRunnerPort, createSandboxRunnerFactory } from '../services/runtime/SandboxRunner';
import type { RuntimeHealthReport } from '../types/runtimeHealth.types';

function createReport(overrides: Partial<RuntimeHealthReport> = {}): RuntimeHealthReport {
    return {
        status: 'healthy',
        checkedAt: '2026-03-17T16:00:00.000Z',
        summary: 'Runtime MVP prêt',
        components: [],
        runtime: {
            node: { available: true, status: 'healthy', executable: 'node', version: 'v22.14.0' },
            python: { available: true, status: 'healthy', executable: 'python3', version: 'Python 3.12.6' },
            docker: {
                available: true,
                status: 'healthy',
                executable: 'docker',
                version: '29.1.3',
                rootless: true,
                mode: 'rootless',
                securityLevel: 'production-ready',
                executionReady: true
            },
            images: {
                node: { available: true, status: 'healthy', image: 'airdd2-runtime-node:24.19.0-ubuntu-noble' },
                python: { available: true, status: 'healthy', image: 'airdd2-runtime-python:3.12-ubuntu-noble' }
            },
            runners: {
                preferred: 'docker_sandbox',
                dockerSandbox: { runner: 'docker_sandbox', available: true, status: 'healthy' },
                firecracker: { runner: 'firecracker', available: false, status: 'degraded', detail: 'Linux/KVM requis' }
            },
            typescript: { available: true, status: 'healthy', engine: 'node-subprocess' }
        },
        capabilities: {
            build: { typescript: true, python: true },
            run: { typescript: true, python: true, dockerRootless: true }
        },
        python: { available: true, version: 'Python 3.12.6', executable: 'python3' },
        typescript: { available: true, engine: 'node-subprocess' },
        ...overrides
    };
}

describe('SandboxRunner port', () => {
    it('returns docker_sandbox as the default runner id', () => {
        const runner = createDefaultSandboxRunnerPort();

        expect(runner.getRunnerId()).toBe('docker_sandbox');
        expect(runner.supportsRuntime('python')).toBe(true);
        expect(runner.supportsRuntime('typescript')).toBe(true);
    });

    it('reports not ready when docker rootless capability is missing', () => {
        const runner = createDefaultSandboxRunnerPort();
        const report = createReport({
            summary: 'Docker rootless non confirmé',
            runtime: {
                node: { available: true, status: 'healthy', executable: 'node', version: 'v22.14.0' },
                python: { available: true, status: 'healthy', executable: 'python3', version: 'Python 3.12.6' },
                docker: {
                    available: true,
                    status: 'unhealthy',
                    executable: 'docker',
                    version: '29.1.3',
                    rootless: false,
                    mode: 'unknown',
                    securityLevel: 'unavailable',
                    executionReady: false
                },
                images: {
                    node: { available: true, status: 'healthy', image: 'airdd2-runtime-node:24.19.0-ubuntu-noble' },
                    python: { available: true, status: 'healthy', image: 'airdd2-runtime-python:3.12-ubuntu-noble' }
                },
                runners: {
                    preferred: 'docker_sandbox',
                    dockerSandbox: { runner: 'docker_sandbox', available: false, status: 'unhealthy' },
                    firecracker: { runner: 'firecracker', available: false, status: 'degraded', detail: 'Linux/KVM requis' }
                },
                typescript: { available: true, status: 'healthy', engine: 'node-subprocess' }
            },
            capabilities: {
                build: { typescript: true, python: true },
                run: { typescript: false, python: false, dockerRootless: false }
            }
        });

        expect(runner.getReadiness(report, 'python')).toEqual({
            ready: false,
            reason: 'Docker rootless non confirmé'
        });
    });

    it('accepts Docker Desktop when execution readiness is available', () => {
        const runner = createDefaultSandboxRunnerPort();
        const report = createReport({
            status: 'degraded',
            summary: 'Runtime MVP disponible en mode dev-only: exécution possible via Docker durci, sans sécurité de production.',
            runtime: {
                node: { available: true, status: 'healthy', executable: 'node', version: 'v22.14.0' },
                python: { available: true, status: 'healthy', executable: 'python3', version: 'Python 3.12.6' },
                docker: {
                    available: true,
                    status: 'degraded',
                    executable: 'docker',
                    version: '29.1.3',
                    rootless: false,
                    mode: 'docker-desktop',
                    securityLevel: 'dev-only',
                    executionReady: true,
                    warning: 'Docker Desktop détecté : mode dev-only explicite. Acceptable en développement/test, sans sécurité de production.'
                },
                images: {
                    node: { available: true, status: 'healthy', image: 'airdd2-runtime-node:24.19.0-ubuntu-noble' },
                    python: { available: true, status: 'healthy', image: 'airdd2-runtime-python:3.12-ubuntu-noble' }
                },
                runners: {
                    preferred: 'docker_sandbox',
                    dockerSandbox: { runner: 'docker_sandbox', available: true, status: 'degraded' },
                    firecracker: { runner: 'firecracker', available: false, status: 'degraded', detail: 'Linux/KVM requis' }
                },
                typescript: { available: true, status: 'healthy', engine: 'node-subprocess' }
            },
            capabilities: {
                build: { typescript: true, python: true },
                run: { typescript: true, python: true, dockerRootless: false }
            }
        });

        expect(runner.getReadiness(report, 'python')).toEqual({
            ready: true,
            warning: 'Docker Desktop détecté : mode dev-only explicite. Acceptable en développement/test, sans sécurité de production.'
        });
    });

    it('keeps Docker as the preferred runner until the Firecracker prototype is explicitly enabled', () => {
        const factory = createSandboxRunnerFactory();
        const report = createReport({
            runtime: {
                node: { available: true, status: 'healthy', executable: 'node', version: 'v22.14.0' },
                python: { available: true, status: 'healthy', executable: 'python3', version: 'Python 3.12.6' },
                docker: {
                    available: true,
                    status: 'healthy',
                    executable: 'docker',
                    version: '29.1.3',
                    rootless: true,
                    mode: 'rootless',
                    securityLevel: 'production-ready',
                    executionReady: true
                },
                images: {
                    node: { available: true, status: 'healthy', image: 'airdd2-runtime-node:24.19.0-ubuntu-noble' },
                    python: { available: true, status: 'healthy', image: 'airdd2-runtime-python:3.12-ubuntu-noble' }
                },
                runners: {
                    preferred: 'firecracker',
                    dockerSandbox: { runner: 'docker_sandbox', available: true, status: 'healthy' },
                    firecracker: { runner: 'firecracker', available: true, status: 'healthy', detail: 'KVM disponible' }
                },
                typescript: { available: true, status: 'healthy', engine: 'node-subprocess' }
            }
        });

        const previous = process.env.SANDBOX_FIRECRACKER_ENABLED;
        delete process.env.SANDBOX_FIRECRACKER_ENABLED;

        expect(factory.getPreferredRunner(report).getRunnerId()).toBe('docker_sandbox');

        process.env.SANDBOX_FIRECRACKER_ENABLED = 'true';
        expect(factory.getPreferredRunner(report).getRunnerId()).toBe('firecracker');

        if (previous === undefined) {
            delete process.env.SANDBOX_FIRECRACKER_ENABLED;
        } else {
            process.env.SANDBOX_FIRECRACKER_ENABLED = previous;
        }
    });
});