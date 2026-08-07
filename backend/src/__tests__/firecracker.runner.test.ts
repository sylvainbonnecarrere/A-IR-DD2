import { FirecrackerRunner } from '../services/runtime/FirecrackerRunner';
import type { RuntimeHealthReport } from '../types/runtimeHealth.types';

function createReport(firecrackerAvailable: boolean): RuntimeHealthReport {
    return {
        status: firecrackerAvailable ? 'healthy' : 'degraded',
        checkedAt: '2026-03-23T12:00:00.000Z',
        summary: 'Runtime summary',
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
                executionReady: true,
            },
            images: {
                node: { available: true, status: 'healthy', image: 'airdd2-runtime-node:24.19.0-ubuntu-noble' },
                python: { available: true, status: 'healthy', image: 'airdd2-runtime-python:3.12-ubuntu-noble' },
            },
            runners: {
                preferred: firecrackerAvailable ? 'firecracker' : 'docker_sandbox',
                dockerSandbox: { runner: 'docker_sandbox', available: true, status: 'healthy' },
                firecracker: {
                    runner: 'firecracker',
                    available: firecrackerAvailable,
                    status: firecrackerAvailable ? 'healthy' : 'degraded',
                    detail: firecrackerAvailable
                        ? 'KVM disponible: le branchement Firecracker peut être préparé sur cet hôte Linux.'
                        : 'Firecracker indisponible sur cet hôte (Linux/KVM requis). Le runtime reste en trajectoire Docker durci pour dev/test.'
                }
            },
            typescript: { available: true, status: 'healthy', engine: 'node-subprocess' }
        },
        capabilities: {
            build: { typescript: true, python: true },
            run: { typescript: true, python: true, dockerRootless: true }
        },
        python: { available: true, version: 'Python 3.12.6', executable: 'python3' },
        typescript: { available: true, engine: 'node-subprocess' }
    };
}

describe('FirecrackerRunner', () => {
    const previous = process.env.SANDBOX_FIRECRACKER_ENABLED;

    afterEach(() => {
        if (previous === undefined) {
            delete process.env.SANDBOX_FIRECRACKER_ENABLED;
        } else {
            process.env.SANDBOX_FIRECRACKER_ENABLED = previous;
        }
    });

    it('stays not ready when KVM is detected but the Firecracker prototype is not enabled', () => {
        delete process.env.SANDBOX_FIRECRACKER_ENABLED;
        const runner = new FirecrackerRunner();

        expect(runner.getReadiness(createReport(true), 'python')).toEqual({
            ready: false,
            reason: 'Firecracker détecté mais non activé. Utiliser SANDBOX_FIRECRACKER_ENABLED=true pour le prototype J7.'
        });
    });

    it('becomes ready only when KVM is available and the prototype flag is enabled', () => {
        process.env.SANDBOX_FIRECRACKER_ENABLED = 'true';
        const runner = new FirecrackerRunner();

        expect(runner.getReadiness(createReport(true), 'typescript')).toEqual({
            ready: true,
            reason: undefined
        });
    });

    it('keeps execute blocked while the Firecracker prototype is not wired in this environment', async () => {
        process.env.SANDBOX_FIRECRACKER_ENABLED = 'true';
        const runner = new FirecrackerRunner();

        await expect(runner.execute({} as any)).rejects.toThrow(
            'FirecrackerRunner prototype: branchement KVM détecté mais exécution non activée dans cet environnement.'
        );
    });
});