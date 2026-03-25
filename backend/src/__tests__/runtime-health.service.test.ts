import { RuntimeHealthService, type CommandRunner } from '../services/runtimeHealth.service';

type CommandResponse = {
    exitCode: number;
    stdout?: string;
    stderr?: string;
    timedOut?: boolean;
    errorMessage?: string;
};

class FakeCommandRunner implements CommandRunner {
    constructor(private readonly responses: Record<string, CommandResponse>) {}

    async run(command: string, args: string[]): Promise<{
        exitCode: number;
        stdout: string;
        stderr: string;
        timedOut: boolean;
        errorMessage?: string;
    }> {
        const key = [command, ...args].join(' ');
        const response = this.responses[key];
        if (!response) {
            return {
                exitCode: 1,
                stdout: '',
                stderr: `Missing fake response for ${key}`,
                timedOut: false
            };
        }

        return {
            exitCode: response.exitCode,
            stdout: response.stdout ?? '',
            stderr: response.stderr ?? '',
            timedOut: response.timedOut ?? false,
            errorMessage: response.errorMessage
        };
    }
}

describe('RuntimeHealthService', () => {
    it('reports a healthy runtime when Node, Python, Docker rootless, and both images are available', async () => {
        const runner = new FakeCommandRunner({
            'node --version': { exitCode: 0, stdout: 'v22.14.0\n' },
            'python3 --version': { exitCode: 0, stderr: 'Python 3.12.6\n' },
            'docker version --format {{json .Server.Version}}': { exitCode: 0, stdout: '"27.5.1"\n' },
            'docker info --format {{json .Rootless}}': { exitCode: 0, stdout: 'true\n' },
            'docker image inspect airdd2-runtime-node:bookworm-slim --format {{json .Id}}': { exitCode: 0, stdout: '"sha256:node"\n' },
            'docker image inspect airdd2-runtime-python:3.12-slim --format {{json .Id}}': { exitCode: 0, stdout: '"sha256:python"\n' }
        });

        const service = new RuntimeHealthService({
            runner,
            now: () => new Date('2026-03-17T14:00:00.000Z'),
            runtimeConfig: {
                nodeExecutable: 'node',
                pythonExecutables: ['python3', 'python'],
                dockerExecutable: 'docker'
            },
            kvmAvailable: async () => false
        });

        const report = await service.getHealthReport();

        expect(report.status).toBe('healthy');
        expect(report.python).toEqual({
            available: true,
            version: 'Python 3.12.6',
            executable: 'python3'
        });
        expect(report.runtime.docker.rootless).toBe(true);
        expect(report.runtime.docker.mode).toBe('rootless');
        expect(report.runtime.docker.executionReady).toBe(true);
        expect(report.runtime.images.node.available).toBe(true);
        expect(report.runtime.images.python.available).toBe(true);
        expect(report.capabilities.run.python).toBe(true);
        expect(report.capabilities.run.typescript).toBe(true);
        expect(report.runtime.runners.preferred).toBe('docker_sandbox');
    });

    it('falls back to python on Windows-style environments and reports missing runtime images', async () => {
        const runner = new FakeCommandRunner({
            'node --version': { exitCode: 0, stdout: 'v22.14.0\n' },
            'python3 --version': { exitCode: 1, stderr: 'not found' },
            'python --version': { exitCode: 0, stdout: 'Python 3.11.9\n' },
            'docker version --format {{json .Server.Version}}': { exitCode: 0, stdout: '"27.5.1"\n' },
            'docker info --format {{json .Rootless}}': { exitCode: 0, stdout: 'false\n' },
            'docker image inspect airdd2-runtime-node:bookworm-slim --format {{json .Id}}': { exitCode: 1, stderr: 'No such image' },
            'docker image inspect airdd2-runtime-python:3.12-slim --format {{json .Id}}': { exitCode: 1, stderr: 'No such image' }
        });

        const service = new RuntimeHealthService({
            runner,
            runtimeConfig: {
                nodeExecutable: 'node',
                pythonExecutables: ['python3', 'python'],
                dockerExecutable: 'docker'
            },
            kvmAvailable: async () => false
        });

        const report = await service.getHealthReport();

        expect(report.python.executable).toBe('python');
        expect(report.runtime.docker.rootless).toBe(false);
        expect(report.runtime.images.node.available).toBe(false);
        expect(report.runtime.images.python.available).toBe(false);
        expect(report.status).toBe('unhealthy');
        expect(report.capabilities.run.dockerRootless).toBe(false);
        expect(report.capabilities.run.python).toBe(false);
    });

    it('uses SecurityOptions and context fallback when docker info does not expose Rootless directly', async () => {
        const runner = new FakeCommandRunner({
            'node --version': { exitCode: 0, stdout: 'v22.14.0\n' },
            'python3 --version': { exitCode: 0, stdout: 'Python 3.12.6\n' },
            'docker version --format {{json .Server.Version}}': { exitCode: 0, stdout: '"29.1.3"\n' },
            'docker info --format {{json .Rootless}}': { exitCode: 1, stderr: 'template failure' },
            'docker info --format {{json .SecurityOptions}}': { exitCode: 0, stdout: '["name=seccomp","name=rootless"]\n' },
            'docker image inspect airdd2-runtime-node:bookworm-slim --format {{json .Id}}': { exitCode: 0, stdout: '"sha256:node"\n' },
            'docker image inspect airdd2-runtime-python:3.12-slim --format {{json .Id}}': { exitCode: 0, stdout: '"sha256:python"\n' }
        });

        const service = new RuntimeHealthService({
            runner,
            runtimeConfig: {
                nodeExecutable: 'node',
                pythonExecutables: ['python3', 'python'],
                dockerExecutable: 'docker'
            },
            kvmAvailable: async () => false
        });

        const report = await service.getHealthReport();

        expect(report.runtime.docker.rootless).toBe(true);
        expect(report.status).toBe('healthy');
    });

    it('uses the rootless user socket fallback when security options do not expose rootless', async () => {
        const runner = new FakeCommandRunner({
            'node --version': { exitCode: 0, stdout: 'v22.14.0\n' },
            'python3 --version': { exitCode: 0, stdout: 'Python 3.12.6\n' },
            'docker version --format {{json .Server.Version}}': { exitCode: 0, stdout: '"29.1.3"\n' },
            'docker info --format {{json .SecurityOptions}}': { exitCode: 0, stdout: '["name=seccomp","name=cgroupns"]\n' },
            'docker info --format {{json .Rootless}}': { exitCode: 1, stderr: 'template failure' },
            'docker image inspect airdd2-runtime-node:bookworm-slim --format {{json .Id}}': { exitCode: 0, stdout: '"sha256:node"\n' },
            'docker image inspect airdd2-runtime-python:3.12-slim --format {{json .Id}}': { exitCode: 0, stdout: '"sha256:python"\n' }
        });

        const service = new RuntimeHealthService({
            runner,
            socketExists: async (socketPath) => socketPath === '/run/user/1000/docker.sock',
            runtimeConfig: {
                nodeExecutable: 'node',
                pythonExecutables: ['python3', 'python'],
                dockerExecutable: 'docker'
            },
            kvmAvailable: async () => false
        });

        const report = await service.getHealthReport();

        expect(report.runtime.docker.rootless).toBe(true);
        expect(report.status).toBe('healthy');
    });

    it('treats Docker Desktop as execution-ready with degraded security instead of unhealthy', async () => {
        const runner = new FakeCommandRunner({
            'node --version': { exitCode: 0, stdout: 'v22.14.0\n' },
            'python3 --version': { exitCode: 0, stdout: 'Python 3.12.6\n' },
            'docker version --format {{json .Server.Version}}': { exitCode: 0, stdout: '"29.1.3"\n' },
            'docker context show': { exitCode: 0, stdout: 'desktop-linux\n' },
            'docker context inspect desktop-linux --format {{.Endpoints.docker.Host}}': { exitCode: 0, stdout: 'npipe:////./pipe/dockerDesktopLinuxEngine\n' },
            'docker image inspect airdd2-runtime-node:bookworm-slim --format {{json .Id}}': { exitCode: 0, stdout: '"sha256:node"\n' },
            'docker image inspect airdd2-runtime-python:3.12-slim --format {{json .Id}}': { exitCode: 0, stdout: '"sha256:python"\n' }
        });

        const service = new RuntimeHealthService({
            runner,
            runtimeConfig: {
                nodeExecutable: 'node',
                pythonExecutables: ['python3', 'python'],
                dockerExecutable: 'docker'
            },
            kvmAvailable: async () => false
        });

        const report = await service.getHealthReport();

        expect(report.status).toBe('degraded');
        expect(report.runtime.docker.rootless).toBe(false);
        expect(report.runtime.docker.mode).toBe('docker-desktop');
        expect(report.runtime.docker.securityLevel).toBe('dev-only');
        expect(report.runtime.docker.executionReady).toBe(true);
        expect(report.capabilities.run.python).toBe(true);
        expect(report.capabilities.run.typescript).toBe(true);
        expect(report.capabilities.run.dockerRootless).toBe(false);
        expect(report.runtime.runners.preferred).toBe('docker_sandbox');
        expect(report.runtime.runners.firecracker.available).toBe(false);
    });

    it('marks Firecracker as the preferred runtime trajectory when KVM is available', async () => {
        const runner = new FakeCommandRunner({
            'node --version': { exitCode: 0, stdout: 'v22.14.0\n' },
            'python3 --version': { exitCode: 0, stdout: 'Python 3.12.6\n' },
            'docker version --format {{json .Server.Version}}': { exitCode: 0, stdout: '"29.1.3"\n' },
            'docker info --format {{json .Rootless}}': { exitCode: 0, stdout: 'true\n' },
            'docker image inspect airdd2-runtime-node:bookworm-slim --format {{json .Id}}': { exitCode: 0, stdout: '"sha256:node"\n' },
            'docker image inspect airdd2-runtime-python:3.12-slim --format {{json .Id}}': { exitCode: 0, stdout: '"sha256:python"\n' }
        });

        const service = new RuntimeHealthService({
            runner,
            runtimeConfig: {
                nodeExecutable: 'node',
                pythonExecutables: ['python3', 'python'],
                dockerExecutable: 'docker'
            },
            kvmAvailable: async () => true
        });

        const report = await service.getHealthReport();

        expect(report.status).toBe('healthy');
        expect(report.runtime.runners.preferred).toBe('firecracker');
        expect(report.runtime.runners.firecracker).toEqual(expect.objectContaining({
            available: true,
            status: 'healthy',
            detail: 'KVM disponible: le branchement Firecracker peut être préparé sur cet hôte Linux.'
        }));
        expect(report.summary).toContain('Firecracker préparable');
    });
});