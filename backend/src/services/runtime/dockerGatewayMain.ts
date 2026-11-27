import { logger } from '../logger';
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

  run(
    args: string[],
    options?: {
      stdin?: string;
      timeoutMs?: number;
      signal?: AbortSignal;
    },
  ) {
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

const IMAGE_ID_PATTERN = /^sha256:[0-9a-f]{64}$/;

/**
 * Résout l'ID immuable (sha256) d'une image locale disponible pour la réservation de
 * nom inerte du fencing. Sans image résolue, la réservation échoue fail-closed
 * (nameReserved=false, quiescence non prouvable).
 */
async function resolveInertImageId(commandRunner: DockerGatewayCommandRunner): Promise<string | undefined> {
  const candidates = [
    process.env.RUNTIME_NODE_IMAGE,
    'airdd2-runtime-node:24.19.0-ubuntu-noble',
    process.env.RUNTIME_PYTHON_IMAGE,
    'airdd2-runtime-python:3.12-ubuntu-noble',
    process.env.RUNTIME_PYTHON_PROVISIONING_IMAGE,
    'airdd2-python-provisioning:3.12-ubuntu-noble',
  ].filter((value, index, all): value is string => Boolean(value) && all.indexOf(value) === index);

  for (const image of candidates) {
    try {
      const result = await commandRunner.run(['image', 'inspect', image, '--format', '{{json .Id}}'], { timeoutMs: 5_000 });
      if (result.timedOut || result.errorMessage || result.exitCode !== 0) continue;
      const id = JSON.parse(result.stdout) as unknown;
      if (typeof id === 'string' && IMAGE_ID_PATTERN.test(id)) return id;
    } catch {
      // Image indisponible localement : on essaie la suivante.
    }
  }
  return undefined;
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

  const inertImage = await resolveInertImageId(commandRunner);
  if (!inertImage) {
    logger.warn('Docker gateway: no local runtime image resolved; name reservations will fail closed');
  }

  const reconciler = new DockerGatewayOperationReconciler(commandRunner, 'restart', { inertImage });

  const server = new DockerGatewayServer({ socketPath, admission, commandRunner, inertImage });
  const daemon = new DockerGatewayDaemon({
    admission,
    server,
    quiescenceVerifier: reconciler,
    fencer: reconciler,
  });

  let stopping = false;
  const stop = async (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;
    logger.info(`Docker gateway received ${signal}; closing admission`);

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
      logger.error('Docker gateway shutdown failed:', shutdownError instanceof Error ? shutdownError.message : shutdownError);
      process.exitCode = 1;
    }
  };
  process.once('SIGINT', () => {
    void stop('SIGINT');
  });
  process.once('SIGTERM', () => {
    void stop('SIGTERM');
  });

  await daemon.start();
  logger.info(`Docker gateway listening on ${socketPath}`);

  // Sweep des réservations de nom orphelines (état terminal, opération plus active) :
  // leftovers de crash/SIGKILL. Par ID immuable uniquement, fail-closed (tout doute -> conservé).
  try {
    const fenced = await admission.getFencedOperations();
    const activeOperationIds = new Set(fenced.map((entry) => entry.id));
    const swept = await reconciler.sweepOrphanReservations(activeOperationIds);
    if (swept.length > 0) {
      logger.info(`Docker gateway: ${swept.length} orphan reservation container(s) removed`, swept);
    }
  } catch (error) {
    logger.warn('Docker gateway: orphan reservation sweep skipped (fail-closed)', error instanceof Error ? error.message : error);
  }
}

if (require.main === module) {
  void runDockerGateway().catch(async (error: unknown) => {
    logger.error('Docker gateway startup failed:', error instanceof Error ? error.message : error);
    try {
      await mongoose.disconnect();
    } catch (disconnectError) {
      logger.error('Docker gateway MongoDB cleanup failed:', disconnectError instanceof Error ? disconnectError.message : disconnectError);
    }
    process.exitCode = 1;
  });
}
