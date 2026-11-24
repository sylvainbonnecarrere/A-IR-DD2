import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import { createConnection, type AddressInfo } from 'net';
import { chmod, lstat, unlink } from 'fs/promises';
import { randomUUID } from 'crypto';
import path from 'path';
import type {
  DockerGatewayAdmissionPort,
  DockerGatewayEpoch,
  DockerGatewayFenceKind,
  DockerGatewayFencedOperation,
  DockerGatewayOperation,
  DockerGatewayOperationEffect,
} from './DockerGatewayAdmission';
import type { DockerGatewayServerPort } from './DockerGatewayDaemon';
import { DOCKER_GATEWAY_OP_LABEL, type DockerGatewayCommandRequest, type DockerGatewayCommandRunner } from './DockerGatewayProtocol';
import { DockerGatewayOperationReconciler } from './DockerGatewayOperationReconciler';

const MAX_BODY_BYTES = 16 * 1024 * 1024;
const MAX_TIMEOUT_MS = 120_000;
const MIN_TIMEOUT_MS = 100;
const CONTAINER_NAME_PATTERN = /^airdd2-[A-Za-z0-9_.-]{1,63}$/;
const OPERATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const OPERATION_CONTROL_PATTERN = /^\/v1\/operations\/([0-9a-f-]{36})\/(fence|verify)$/;

const RUNTIME_IMAGE_PATTERN = /^airdd2-(?:runtime-node|runtime-python|python-provisioning):[A-Za-z0-9._-]+$/;

const FENCE_KINDS: readonly DockerGatewayFenceKind[] = [
  'auto_epoch_rotation',
  'user_manual_reset',
  'agent_auto_recovery',
  'admin_maintenance',
];

export interface DockerGatewayServerOptions {
  socketPath: string;
  admission: DockerGatewayAdmissionPort;
  commandRunner: DockerGatewayCommandRunner;
  inertImage?: string;
}

export class DockerGatewayServer implements DockerGatewayServerPort {
  private server: Server | undefined;
  private boundSocket: { path: string; device: number; inode: number } | undefined;
  private readonly operationReconciler: DockerGatewayOperationReconciler;

  constructor(private readonly options: DockerGatewayServerOptions) {
    this.operationReconciler = new DockerGatewayOperationReconciler(options.commandRunner, 'in-flight', {
      inertImage: options.inertImage,
    });
  }

  async listen(address: string | { port: number; host: string } = this.options.socketPath): Promise<void> {
    if (this.server) {
      throw new Error('Docker gateway is already listening');
    }
    if (typeof address === 'string' && process.platform !== 'win32') {
      await this.removeStaleSocket(address);
    }

    const server = createServer((request, response) => {
      void this.handle(request, response);
    });
    this.server = server;

    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(address, () => {
          server.off('error', reject);
          resolve();
        });
      });
      if (typeof address === 'string' && process.platform !== 'win32') {
        const socket = await lstat(address);
        if (!socket.isSocket()) {
          throw new Error('Docker gateway path is not a Unix socket');
        }
        this.boundSocket = { path: address, device: socket.dev, inode: socket.ino };
        await chmod(address, 0o660);
      }
    } catch (error) {
      this.server = undefined;
      if (server.listening) {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
      await this.removeBoundSocket();
      throw error;
    }
  }

  async close(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (!server?.listening) {
      await this.removeBoundSocket();
      return;
    }
    try {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    } finally {
      await this.removeBoundSocket();
    }
  }

  getAddress(): AddressInfo | string | null {
    return this.server?.address() ?? null;
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method === 'POST' && request.url === '/v1/worker/activate') {
      await this.handleWorkerActivation(request, response);
      return;
    }
    if (request.method === 'POST' && request.url === '/v1/worker/close') {
      await this.handleWorkerClosure(request, response);
      return;
    }
    const operationControl = request.method === 'POST' ? OPERATION_CONTROL_PATTERN.exec(request.url ?? '') : null;
    if (operationControl) {
      await this.handleOperationControl(request, response, operationControl[1], operationControl[2] as 'fence' | 'verify');
      return;
    }
    if (request.method !== 'POST' || request.url !== '/v1/docker/command') {
      this.send(response, 404, { error: 'Docker gateway route not found' });
      return;
    }

    let body: unknown;
    try {
      body = await this.readBody(request);
    } catch (error) {
      this.send(response, 400, { error: error instanceof Error ? error.message : 'Invalid request body' });
      return;
    }

    const parsed = this.parseRequest(body);
    if (!parsed) {
      this.send(response, 400, { error: 'Invalid Docker gateway command request' });
      return;
    }

    parsed.args = this.ensureRunContainerName(parsed.args);
    const effect = this.getOperationEffect(parsed.args);
    let command = '';
    let operation: DockerGatewayOperation;
    try {
      command = parsed.args[0];
      if (!this.isAllowedCommand(parsed.args)) {
        this.send(response, 403, { error: 'Docker gateway command is not allowed' });
        return;
      }
      operation = await this.options.admission.admit(parsed.epoch, effect);
    } catch (error) {
      this.send(response, 409, { error: error instanceof Error ? error.message : 'Docker command admission refused' });
      return;
    }

    if (command === 'run') {
      // Label d'opération injecté par le serveur après admission : tout conteneur
      // créé porte le label, même si la réponse HTTP est perdue en transit.
      parsed.args = ['run', `--label=${DOCKER_GATEWAY_OP_LABEL}=${operation.id}`, ...parsed.args.slice(1)];
      if (!this.isAllowedCommand(parsed.args)) {
        // Fail-closed : aucune exécution si les arguments injectés sont invalides.
        try {
          await this.options.admission.reconcileInFlight(operation, this.operationReconciler);
        } catch {
          // L'opération reste en état unknown, journalisée.
        }
        this.send(response, 403, { error: 'Docker gateway command is not allowed' });
        return;
      }
    }

    const controller = new AbortController();
    let responseClosed = false;

    response.once('close', () => {
      if (!response.writableEnded) {
        responseClosed = true;
        controller.abort();
      }
    });

    let result: Awaited<ReturnType<DockerGatewayCommandRunner['run']>>;
    try {
      result = await this.options.commandRunner.run(parsed.args, {
        stdin: parsed.stdin,
        timeoutMs: parsed.timeoutMs,
        signal: controller.signal,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Docker command failed with an unknown outcome';
      try {
        const quiescent = await this.options.admission.reconcileInFlight(operation, this.operationReconciler);
        if (quiescent) {
          if (!responseClosed) {
            this.send(response, 502, {
              error: message,
              operationId: operation.id,
              outcome: 'effects_quiescent',
            });
          }
          return;
        }
        if (!responseClosed) {
          this.send(response, 503, {
            error: `Docker command outcome is unknown and requires quiescence reconciliation: ${message}`,
            operationId: operation.id,
            outcome: 'unknown',
          });
        }
      } catch (journalError) {
        const journalMessage = journalError instanceof Error ? journalError.message : 'unknown reconciliation error';
        if (!responseClosed) {
          this.send(response, 503, {
            error: `Docker command outcome is unknown and could not be reconciled: ${message}; ${journalMessage}`,
            operationId: operation.id,
            outcome: 'unknown',
          });
        }
      }
      return;
    }

    const outcome = this.getOutcome(command, result);
    if (outcome === 'unknown') {
      try {
        const quiescent = await this.options.admission.reconcileInFlight(operation, this.operationReconciler);
        if (!quiescent) {
          if (!responseClosed) {
            this.send(response, 503, {
              ...result,
              error: 'Docker command outcome remains uncertain after reconciliation',
              operationId: operation.id,
              outcome: 'unknown',
            });
          }
          return;
        }
      } catch (error) {
        if (!responseClosed) {
          this.send(response, 503, {
            ...result,
            error: `Docker command outcome could not be reconciled: ${error instanceof Error ? error.message : 'unknown reconciliation error'}`,
            operationId: operation.id,
            outcome: 'unknown',
          });
        }
        return;
      }
    }
    try {
      if (outcome === 'effects_quiescent') {
        await this.options.admission.settle(operation, outcome);
      }
    } catch (error) {
      if (!responseClosed) {
        this.send(response, 503, {
          error: `Docker command finished but its outcome could not be durably recorded: ${error instanceof Error ? error.message : 'unknown journal error'}`,
          operationId: operation.id,
          outcome: 'unknown',
        });
      }
      return;
    }
    if (!responseClosed) {
      this.send(response, 200, { ...result, operationId: operation.id, outcome });
    }
  }

  private async handleWorkerActivation(request: IncomingMessage, response: ServerResponse): Promise<void> {
    let body: unknown;
    try {
      body = await this.readBody(request);
    } catch (error) {
      this.send(response, 400, { error: error instanceof Error ? error.message : 'Invalid activation request' });
      return;
    }
    if (
      typeof body !== 'object' ||
      body === null ||
      !('workerId' in body) ||
      typeof body.workerId !== 'string' ||
      !body.workerId.trim() ||
      body.workerId.length > 200
    ) {
      this.send(response, 400, { error: 'Docker gateway worker identity is invalid' });
      return;
    }
    try {
      const epoch = await this.options.admission.fenceAndActivateWorker(body.workerId);
      // Fencing best-effort (journalisé) des opérations fencées sans réservation :
      // l'admission est déjà rouverte, aucune erreur ici ne doit la refermer.
      await this.fenceUnreservedOperations();
      this.send(response, 200, epoch);
    } catch (error) {
      this.send(response, 409, {
        error: error instanceof Error ? error.message : 'Docker gateway worker activation refused',
      });
    }
  }

  private async handleWorkerClosure(request: IncomingMessage, response: ServerResponse): Promise<void> {
    let body: unknown;
    try {
      body = await this.readBody(request);
    } catch (error) {
      this.send(response, 400, { error: error instanceof Error ? error.message : 'Invalid closure request' });
      return;
    }
    const epoch = this.parseEpoch(body);
    if (!epoch) {
      this.send(response, 400, { error: 'Docker gateway worker epoch is invalid' });
      return;
    }
    try {
      await this.options.admission.closeWorker(epoch);
      this.send(response, 200, { closed: true });
    } catch (error) {
      this.send(response, 409, {
        error: error instanceof Error ? error.message : 'Docker gateway worker closure refused',
      });
    }
  }

  private async handleOperationControl(
    request: IncomingMessage,
    response: ServerResponse,
    operationId: string,
    action: 'fence' | 'verify',
  ): Promise<void> {
    if (!OPERATION_ID_PATTERN.test(operationId)) {
      this.send(response, 400, { error: 'Docker gateway operation id is invalid' });
      return;
    }
    let body: unknown;
    try {
      body = await this.readBody(request);
    } catch (error) {
      this.send(response, 400, { error: error instanceof Error ? error.message : 'Invalid control request body' });
      return;
    }
    if (typeof body !== 'object' || body === null) {
      this.send(response, 400, { error: 'Docker gateway control request body must be a JSON object' });
      return;
    }
    let fenceKind: DockerGatewayFenceKind | undefined;
    if (action === 'fence' && (body as Record<string, unknown>).fenceKind !== undefined) {
      const requested = (body as Record<string, unknown>).fenceKind;
      if (typeof requested !== 'string' || !FENCE_KINDS.includes(requested as DockerGatewayFenceKind)) {
        this.send(response, 400, { error: 'Docker gateway fence kind is invalid' });
        return;
      }
      fenceKind = requested as DockerGatewayFenceKind;
    }

    let fenced = await this.options.admission.getFencedOperation(operationId);
    let operation: DockerGatewayOperation | undefined;
    if (fenced) {
      operation = { id: fenced.id, epoch: fenced.epoch, ...(fenced.effect ? { effect: fenced.effect } : {}) };
    } else {
      const pending = (await this.options.admission.getPendingOperations()).find((candidate) => candidate.id === operationId);
      if (!pending) {
        this.send(response, 404, { error: 'Docker gateway operation is unknown' });
        return;
      }
      if (action === 'verify') {
        // Fail-closed : la vérification de quiescence exige un fencing préalable.
        this.send(response, 409, { error: 'Docker gateway operation is not fenced; fence it first' });
        return;
      }
      try {
        fenced = await this.options.admission.fencePendingOperation(operationId, fenceKind ?? 'user_manual_reset');
      } catch (error) {
        this.send(response, 409, {
          error: error instanceof Error ? error.message : 'Docker gateway operation could not be fenced',
        });
        return;
      }
      operation = pending;
    }

    try {
      if (action === 'fence') {
        const result = await this.operationReconciler.fence(operation, fenced);
        await this.options.admission.markNameReservation(operationId, result.nameReserved);
        if (result.quiescent) {
          await this.options.admission.markQuiescenceProven(operationId);
        }
        this.send(response, 200, result);
        return;
      }
      const quiescent = await this.operationReconciler.verifyFenced(operation, fenced);
      if (quiescent) {
        await this.options.admission.markQuiescenceProven(operationId);
      }
      this.send(response, 200, { quiescent });
    } catch (error) {
      this.send(response, 503, {
        error: `Docker gateway operation control failed closed: ${error instanceof Error ? error.message : 'unknown error'}`,
        operationId,
        outcome: 'unknown',
      });
    }
  }

  private async fenceUnreservedOperations(): Promise<void> {
    let fencedOperations: DockerGatewayFencedOperation[];
    try {
      fencedOperations = await this.options.admission.getFencedOperations();
    } catch {
      return;
    }
    for (const fenced of fencedOperations) {
      if (fenced.quiescenceProven || fenced.nameReservation?.reserved) continue;
      try {
        const operation: DockerGatewayOperation = {
          id: fenced.id,
          epoch: fenced.epoch,
          ...(fenced.effect ? { effect: fenced.effect } : {}),
        };
        const result = await this.operationReconciler.fence(operation, fenced);
        await this.options.admission.markNameReservation(fenced.id, result.nameReserved);
        if (result.quiescent) {
          await this.options.admission.markQuiescenceProven(fenced.id);
        }
      } catch {
        // Best-effort : l'opération reste fencée, journalisée, sans réservation prouvée.
      }
    }
  }

  private async readBody(request: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > MAX_BODY_BYTES) {
        throw new Error('Docker gateway request body exceeds the allowed size');
      }
      chunks.push(buffer);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } catch {
      throw new Error('Docker gateway request body must be valid JSON');
    }
  }

  private parseRequest(value: unknown): DockerGatewayCommandRequest | null {
    if (typeof value !== 'object' || value === null) {
      return null;
    }
    const request = value as Record<string, unknown>;
    const epoch = this.parseEpoch(request.epoch);
    if (
      !epoch ||
      !Array.isArray(request.args) ||
      request.args.length === 0 ||
      request.args.some((arg) => typeof arg !== 'string' || arg.includes('\0')) ||
      (request.stdin !== undefined && typeof request.stdin !== 'string') ||
      (request.timeoutMs !== undefined &&
        (!Number.isSafeInteger(request.timeoutMs) ||
          (request.timeoutMs as number) < MIN_TIMEOUT_MS ||
          (request.timeoutMs as number) > MAX_TIMEOUT_MS))
    ) {
      return null;
    }
    return {
      epoch,
      args: request.args as string[],
      ...(typeof request.stdin === 'string' ? { stdin: request.stdin } : {}),
      ...(typeof request.timeoutMs === 'number' ? { timeoutMs: request.timeoutMs } : {}),
    };
  }

  private parseEpoch(value: unknown): DockerGatewayEpoch | null {
    if (typeof value !== 'object' || value === null) return null;
    const epoch = value as Record<string, unknown>;
    if (
      typeof epoch.workerId !== 'string' ||
      !epoch.workerId.trim() ||
      !Number.isSafeInteger(epoch.epoch) ||
      (epoch.epoch as number) < 1 ||
      typeof epoch.token !== 'string' ||
      !epoch.token.trim()
    ) {
      return null;
    }
    return {
      workerId: epoch.workerId,
      epoch: epoch.epoch as number,
      token: epoch.token,
    };
  }

  private getOutcome(
    command: string,
    result: { exitCode: number; timedOut: boolean; aborted?: boolean; errorMessage?: string },
  ): 'effects_quiescent' | 'unknown' {
    if (this.isReadOnlyCommand(command)) {
      return result.timedOut || result.aborted || result.errorMessage ? 'unknown' : 'effects_quiescent';
    }
    if (command === 'run') {
      return !result.timedOut && !result.aborted && !result.errorMessage ? 'effects_quiescent' : 'unknown';
    }
    return 'unknown';
  }

  private ensureRunContainerName(args: string[]): string[] {
    if (args[0] !== 'run' || args.some((argument) => argument === '--name' || argument.startsWith('--name='))) {
      return args;
    }
    return ['run', `--name=airdd2-gateway-${randomUUID()}`, ...args.slice(1)];
  }

  private getOperationEffect(args: string[]): DockerGatewayOperationEffect | undefined {
    if (args[0] === 'kill' && args.length === 2 && CONTAINER_NAME_PATTERN.test(args[1])) {
      return { command: 'kill', containerName: args[1] };
    }
    if (args[0] !== 'run') return undefined;

    const name = args.find((argument) => argument.startsWith('--name='))?.slice('--name='.length);
    if (!name || !CONTAINER_NAME_PATTERN.test(name)) return undefined;

    const labels: string[] = [];
    for (let index = 0; index < args.length; index += 1) {
      const argument = args[index];
      if (argument === '--label' && index + 1 < args.length) {
        labels.push(args[index + 1]);
      } else if (argument.startsWith('--label=')) {
        labels.push(argument.slice('--label='.length));
      }
    }
    const attemptId = labels
      .map((label) => /^airdd2\.execution\.attempt=([0-9a-f-]{36})$/.exec(label)?.[1])
      .find((candidate): candidate is string => Boolean(candidate));

    if (attemptId && name !== `airdd2-j7-attempt-${attemptId}`) return undefined;

    return { command: 'run', containerName: name, ...(attemptId ? { attemptId } : {}) };
  }

  private isAllowedCommand(args: string[]): boolean {
    const [command, ...parameters] = args;
    if (command === 'run') {
      return (
        this.isAllowedRuntime(args) &&
        !parameters.some(
          (arg) =>
            arg === '-d' ||
            arg.startsWith('-d=') ||
            arg === '--detach' ||
            arg.startsWith('--detach=') ||
            arg === '--restart' ||
            arg.startsWith('--restart='),
        )
      );
    }
    if (command === 'kill') {
      return parameters.length === 1 && CONTAINER_NAME_PATTERN.test(parameters[0]);
    }
    if (command === 'inspect') {
      const target = parameters[parameters.length - 1];
      return Boolean(target && CONTAINER_NAME_PATTERN.test(target));
    }
    if (command === 'image') {
      return (
        parameters.length === 4 &&
        parameters[0] === 'inspect' &&
        RUNTIME_IMAGE_PATTERN.test(parameters[1]) &&
        parameters[2] === '--format' &&
        parameters[3] === '{{json .Id}}'
      );
    }
    if (command === 'version') {
      return parameters.length === 2 && parameters[0] === '--format' && parameters[1] === '{{json .Server.Version}}';
    }
    if (command === 'context') {
      return (
        (parameters.length === 1 && parameters[0] === 'show') ||
        (parameters.length === 4 &&
          parameters[0] === 'inspect' &&
          /^[A-Za-z0-9_.-]{1,128}$/.test(parameters[1]) &&
          parameters[2] === '--format' &&
          parameters[3] === '{{.Endpoints.docker.Host}}')
      );
    }
    if (command === 'info') {
      return (
        parameters.length === 2 &&
        parameters[0] === '--format' &&
        ['{{json .SecurityOptions}}', '{{json .Rootless}}'].includes(parameters[1])
      );
    }
    return false;
  }

  private isReadOnlyCommand(command: string): boolean {
    return command === 'inspect' || command === 'image' || command === 'version' || command === 'context' || command === 'info';
  }

  private isAllowedRuntime(args: string[]): boolean {
    const [command, ...parameters] = args;
    if (command !== 'run') return false;
    const values = new Map<string, string>();
    const flags = new Set<string>();
    const valueOptions = new Set([
      '--name',
      '--network',
      '--cpus',
      '--pids-limit',
      '--memory',
      '--tmpfs',
      '--security-opt',
      '--cap-drop',
      '--workdir',
      '--env',
      '-e',
      '--mount',
      '--label',
      '--entrypoint',
    ]);
    for (let index = 0; index < parameters.length; index += 1) {
      const argument = parameters[index];
      if (argument === '--') return false;
      if (argument === '--rm' || argument === '--interactive' || argument === '-i' || argument === '--read-only') {
        flags.add(argument);
        continue;
      }
      if (argument.startsWith('--')) {
        const equalsIndex = argument.indexOf('=');
        const option = equalsIndex < 0 ? argument : argument.slice(0, equalsIndex);
        if (!valueOptions.has(option)) return false;
        const value = equalsIndex < 0 ? parameters[++index] : argument.slice(equalsIndex + 1);
        if (typeof value !== 'string' || value.includes('\0')) return false;
        if (option === '--name' && !CONTAINER_NAME_PATTERN.test(value)) return false;
        if (option === '--network' && !['none', 'bridge'].includes(value)) return false;
        if (option === '--cpus' && (!Number.isFinite(Number(value)) || Number(value) < 0.1 || Number(value) > 2)) return false;
        if (option === '--pids-limit' && (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 256)) return false;
        if (option === '--memory' && !/^(?:[1-9]\d{0,3})m$/.test(value)) return false;
        if (option === '--tmpfs' && !/^\/sandbox\/tmp:size=(?:[1-9]\d?)m,noexec,nosuid,nodev$/.test(value)) return false;
        if (option === '--security-opt' && value !== 'no-new-privileges') return false;
        if (option === '--cap-drop' && value !== 'ALL') return false;
        if (
          option === '--workdir' &&
          !['/sandbox/tmp', '/sandbox/workspace', '/persistent-workspace/source', '/opt/airdd2/backend-python'].includes(value)
        )
          return false;
        if ((option === '--env' || option === '-e') && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(value)) return false;
        if (option === '--mount' && !this.isAllowedMount(value)) return false;
        if (option === '--label' && !/^airdd2\.(?:execution\.attempt|gateway\.op)=[0-9a-f-]{36}$/.test(value)) return false;
        if (option === '--entrypoint' && value !== 'python3') return false;
        values.set(option, value);
        continue;
      }
      if (argument.startsWith('-')) return false;

      const image = argument;
      const allowedImages = new Set(
        [
          'airdd2-runtime-python:3.12-ubuntu-noble',
          'airdd2-runtime-node:24.19.0-ubuntu-noble',
          'airdd2-python-provisioning:3.12-ubuntu-noble',
          process.env.RUNTIME_NODE_IMAGE,
          process.env.RUNTIME_PYTHON_IMAGE,
          process.env.RUNTIME_PYTHON_PROVISIONING_IMAGE,
        ].filter((value): value is string => Boolean(value)),
      );
      if (!allowedImages.has(image) || !RUNTIME_IMAGE_PATTERN.test(image)) return false;

      const commandArgs = parameters.slice(index + 1);
      const entrypoint = values.get('--entrypoint');
      const executionCommandAllowed = entrypoint
        ? entrypoint === 'python3' && commandArgs[0] === '-c'
        : ['python3', 'node'].includes(commandArgs[0]);
      return commandArgs.length >= 2 && executionCommandAllowed && commandArgs.some((value) => value === '-c' || value === '--eval');
    }
    return false;
  }

  private isAllowedMount(value: string): boolean {
    const parts = value.split(',');
    const attributes = new Map(
      parts.map((part) => {
        const separator = part.indexOf('=');
        return separator < 0 ? [part, ''] : [part.slice(0, separator), part.slice(separator + 1)];
      }),
    );
    const source = attributes.get('src');
    const destination = attributes.get('dst');
    if (
      attributes.get('type') !== 'bind' ||
      !source ||
      !path.posix.isAbsolute(source) ||
      !destination ||
      !['/persistent-workspace', '/opt/airdd2/backend-python'].includes(destination)
    ) {
      return false;
    }
    const roots = [
      '/opt/airdd2/backend/python',
      '/opt/airdd2/backend/storage/workspaces',
      ...(process.env.DOCKER_GATEWAY_ALLOWED_BIND_ROOTS ?? '')
        .split(path.delimiter)
        .map((root) => root.trim())
        .filter(Boolean),
    ].map((root) => path.posix.resolve(root));

    const resolvedSource = path.posix.resolve(source);

    const sourceAllowed = roots.some((root) => resolvedSource === root || resolvedSource.startsWith(`${root}/`));

    const destinationMatchesSource =
      destination === '/opt/airdd2/backend-python'
        ? resolvedSource === '/opt/airdd2/backend/python'
        : resolvedSource === '/opt/airdd2/backend/storage/workspaces' ||
          roots.some((root) => root !== '/opt/airdd2/backend/python' && (resolvedSource === root || resolvedSource.startsWith(`${root}/`)));
    const permittedKeys = new Set(['type', 'src', 'dst', 'readonly', 'ro']);
    return (
      sourceAllowed &&
      destinationMatchesSource &&
      attributes.size === parts.length &&
      [...attributes.keys()].every((key) => permittedKeys.has(key)) &&
      [...attributes.entries()].every(([key, attribute]) => !['readonly', 'ro'].includes(key) || attribute === '') &&
      !(attributes.has('readonly') && attributes.has('ro'))
    );
  }

  private send(response: ServerResponse, statusCode: number, body: unknown): void {
    if (response.destroyed || response.writableEnded) {
      return;
    }
    const payload = JSON.stringify(body);
    response.writeHead(statusCode, {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(payload),
      'cache-control': 'no-store',
    });
    response.end(payload);
  }

  private async removeBoundSocket(): Promise<void> {
    const bound = this.boundSocket;
    this.boundSocket = undefined;
    if (!bound) return;
    try {
      const current = await lstat(bound.path);
      if (current.isSocket() && current.dev === bound.device && current.ino === bound.inode) {
        await unlink(bound.path);
      }
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
        return;
      }
      throw error;
    }
  }

  private async removeStaleSocket(socketPath: string): Promise<void> {
    let original: Awaited<ReturnType<typeof lstat>>;
    try {
      original = await lstat(socketPath);
    } catch (error) {
      if (isMissingPath(error)) return;
      throw error;
    }
    if (!original.isSocket()) {
      throw new Error('Docker gateway socket path exists and is not a Unix socket');
    }

    const probe = await new Promise<'connected' | 'refused'>((resolve, reject) => {
      const socket = createConnection(socketPath);
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error('Timed out checking the existing Docker gateway socket'));
      }, 1_000);
      socket.once('connect', () => {
        clearTimeout(timeout);
        socket.destroy();
        resolve('connected');
      });
      socket.once('error', (error: NodeJS.ErrnoException) => {
        clearTimeout(timeout);
        if (error.code === 'ECONNREFUSED') {
          resolve('refused');
        } else {
          reject(error);
        }
      });
    });
    if (probe === 'connected') {
      throw new Error('Docker gateway socket is already served by another process');
    }

    try {
      const current = await lstat(socketPath);
      if (current.isSocket() && current.dev === original.dev && current.ino === original.ino) {
        await unlink(socketPath);
      }
    } catch (error) {
      if (!isMissingPath(error)) throw error;
    }
  }
}

function isMissingPath(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
