import mongoose from 'mongoose';
import { DockerGatewayDaemon } from './DockerGatewayDaemon';
import { DockerGatewayServer } from './DockerGatewayServer';
import type { DockerGatewayCommandRunner } from './DockerGatewayProtocol';
import { MongoDockerGatewayAdmission } from './MongoDockerGatewayAdmission';
import { DockerGatewayOperationReconciler } from './DockerGatewayOperationReconciler';
import { SpawnDockerProcessRunner, type DockerProcessRunner } from './DockerSandboxRunner';

class DockerCliGatewayRunner implements DockerGatewayCommandRunner {
    constructor(
        private readonly processRunner: DockerProcessRunner,
        private readonly dockerBinary: string,
    ) {}

    run(args: string[], options?: {
        stdin?: string;
        timeoutMs?: number;
        signal?: AbortSignal;
    }) {
        return this.processRunner.run(this.dockerBinary, args, options);
    }
}

function requiredEnvironment(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`Required Docker gateway setting ${name} is missing`);
    return value;
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function assertSupportedNodeRuntime(): void {
    const [major, minor, patch] = process.versions.node.split('.').map(Number);
    if (major !== 24 || minor < 22 || (minor === 22 && patch < 1)) {
        throw new Error(`Docker gateway requires Node.js >=24.22.1 <25; found ${process.versions.node}`);
    }
}

async function runDockerGateway(): Promise<void> {
    assertSupportedNodeRuntime();
    const mongoUri = requiredEnvironment('MONGODB_URI');
    const socketPath = requiredEnvironment('DOCKER_GATEWAY_SOCKET');
    const dockerBinary = process.env.DOCKER_BIN?.trim() || 'docker';

    await mongoose.connect(mongoUri, {
        maxPoolSize: 5,
        minPoolSize: 1,
        serverSelectionTimeoutMS: 5_000,
        socketTimeoutMS: 45_000,
        family: 4,
    });

    const admission = new MongoDockerGatewayAdmission();
    const processRunner: DockerProcessRunner = new SpawnDockerProcessRunner();

    const commandRunner = new DockerCliGatewayRunner(processRunner, dockerBinary);
    const server = new DockerGatewayServer({ socketPath, admission, commandRunner });
    const daemon = new DockerGatewayDaemon({
        admission,
        server,
        quiescenceVerifier: new DockerGatewayOperationReconciler(commandRunner, 'restart'),
    });

    let stopping = false;
    const stop = async (signal: NodeJS.Signals) => {
        if (stopping) return;
        stopping = true;
        console.info(`Docker gateway received ${signal}; closing admission`);
        let shutdownError: unknown;
        try {
            await daemon.stop();
        } catch (error) {
            shutdownError = error;
        }
        try {
            await mongoose.disconnect();
        } catch (error) {
            shutdownError = shutdownError
                ? new Error(`Docker gateway shutdown failed: ${describeError(shutdownError)}; ${describeError(error)}`)
                : error;
        }
        if (shutdownError) {
            console.error('Docker gateway shutdown failed:', shutdownError instanceof Error ? shutdownError.message : shutdownError);
            process.exitCode = 1;
        }
    };
    process.once('SIGINT', () => { void stop('SIGINT'); });
    process.once('SIGTERM', () => { void stop('SIGTERM'); });

    await daemon.start();
    console.info(`Docker gateway listening on ${socketPath}`);
}

if (require.main === module) {
    void runDockerGateway().catch(async (error: unknown) => {
        console.error('Docker gateway startup failed:', error instanceof Error ? error.message : error);
        try {
            await mongoose.disconnect();
        } catch (disconnectError) {
            console.error(
                'Docker gateway MongoDB cleanup failed:',
                disconnectError instanceof Error ? disconnectError.message : disconnectError,
            );
        }
        process.exitCode = 1;
    });
}
