import type {
  DockerGatewayFenceResult,
  DockerGatewayFencedOperation,
  DockerGatewayOperation,
  DockerGatewayOperationFencer,
  DockerGatewayQuiescenceVerifier,
} from './DockerGatewayAdmission';

import { DOCKER_GATEWAY_FENCE_LABEL, DOCKER_GATEWAY_OP_LABEL, type DockerGatewayCommandRunner } from './DockerGatewayProtocol';

const CONTAINER_NAME_PATTERN = /^airdd2-[A-Za-z0-9_.-]{1,63}$/;
const ATTEMPT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const OPERATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CONTAINER_ID_PATTERN = /^[0-9a-f]{64}$/;

const GATEWAY_OP_LABEL = DOCKER_GATEWAY_OP_LABEL;
const FENCE_LABEL = DOCKER_GATEWAY_FENCE_LABEL;
const ATTEMPT_LABEL = 'airdd2.execution.attempt';

const CONTAINER_STATES = ['created', 'running', 'paused', 'restarting', 'removing', 'exited', 'dead'] as const;
const TERMINAL_STATES: readonly string[] = ['created', 'exited', 'dead'];

const INSPECT_TIMEOUT_MS = 5_000;
const PS_TIMEOUT_MS = 5_000;
const KILL_TIMEOUT_MS = 5_000;
const CREATE_TIMEOUT_MS = 15_000;
const RECONCILE_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 250;
const GRACE_POLLS = 2;

interface ContainerObservation {
  state: 'created' | 'running' | 'paused' | 'restarting' | 'removing' | 'exited' | 'dead';
}

interface LabeledContainer {
  id: string;
  state: ContainerObservation['state'];
}

interface NamedContainerInspection {
  id: string;
  state: ContainerObservation['state'];
  labels: Record<string, string>;
}

interface ReconcilerOptions {
  inertImage?: string;
  reconcileTimeoutMs?: number;
  pollIntervalMs?: number;
}

type RunnerResult = Awaited<ReturnType<DockerGatewayCommandRunner['run']>>;

export class DockerGatewayOperationReconciler implements DockerGatewayQuiescenceVerifier, DockerGatewayOperationFencer {
  private readonly reconcileTimeoutMs: number;
  private readonly pollIntervalMs: number;

  constructor(
    private readonly runner: DockerGatewayCommandRunner,
    private readonly context: 'in-flight' | 'restart' = 'in-flight',
    private readonly options: ReconcilerOptions = {},
  ) {
    this.reconcileTimeoutMs = options.reconcileTimeoutMs ?? RECONCILE_TIMEOUT_MS;
    this.pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
  }

  async verify(operation: DockerGatewayOperation): Promise<boolean> {
    const effect = operation.effect;
    if (
      !effect ||
      !CONTAINER_NAME_PATTERN.test(effect.containerName) ||
      (effect.attemptId !== undefined && !ATTEMPT_ID_PATTERN.test(effect.attemptId))
    ) {
      return false;
    }
    if (effect.attemptId && effect.containerName !== `airdd2-j7-attempt-${effect.attemptId}`) {
      return false;
    }

    // A disconnected run request may still create or start the container after inspection.
    if (effect.command === 'run') return false;
    // After a restart a delayed kill can still target a later container with the same name.
    if (this.context === 'restart') return false;

    const deadline = Date.now() + this.reconcileTimeoutMs;
    while (Date.now() <= deadline) {
      const observation = await this.inspect(effect.containerName, effect.attemptId);
      if (observation === 'absent') return true;
      if (!observation) return false;
      if (observation.state === 'created' || observation.state === 'exited' || observation.state === 'dead') {
        return true;
      }
      if (observation.state === 'removing') {
        await delay(this.pollIntervalMs);
        continue;
      }
      if (observation.state === 'paused') return false;

      await this.runner.run(['kill', effect.containerName], { timeoutMs: KILL_TIMEOUT_MS });
      await delay(this.pollIntervalMs);
    }
    return false;
  }

  /**
   * Fencing d'une opération incertaine : kill par ID des conteneurs labelisés
   * (label d'opération, ou label d'attempt), puis réservation inerte du nom
   * (label `airdd2.fence.op=<operationId>`). Best-effort et journalisé : ne prétend
   * pas prouver la quiescence (voir verifyFenced). Aucune commande mutante ne
   * cible un nom nu.
   */
  async fence(operation: DockerGatewayOperation, fenced: DockerGatewayFencedOperation): Promise<DockerGatewayFenceResult> {
    const observed: string[] = [];
    const effect = fenced.effect ?? operation.effect;

    const labeled = await this.listLabeledContainers(operation.id, effect?.attemptId);
    if (labeled === null) {
      observed.push('label-listing-failed');
    } else {
      for (const container of labeled) {
        if (TERMINAL_STATES.includes(container.state)) {
          observed.push(`terminal:${container.id}:${container.state}`);
          continue;
        }
        if (container.state === 'paused') {
          // docker kill ne fonctionne pas sur un conteneur en pause : quarantaine maintenue.
          observed.push(`paused:${container.id}`);
          continue;
        }
        const kill = await this.runCommand(['kill', container.id], KILL_TIMEOUT_MS);
        observed.push(kill.timedOut || kill.errorMessage ? `kill-uncertain:${container.id}` : `killed:${container.id}`);
      }
    }

    let nameReserved = false;
    if (effect && CONTAINER_NAME_PATTERN.test(effect.containerName)) {
      nameReserved = await this.reserveName(operation.id, effect.containerName, effect.attemptId, observed);
    } else {
      observed.push('no-effect-no-reservation');
    }

    const quiescent = await this.verifyFenced(operation, {
      ...fenced,
      nameReservation: effect ? { containerName: effect.containerName, reserved: nameReserved } : null,
    });
    if (quiescent) observed.push('quiescence-proven');

    return { fenced: true, nameReserved, quiescent, observed };
  }

  /**
   * Preuve de quiescence d'une opération fencée, fail-closed et bornée :
   * true ssi, dans la fenêtre RECONCILE_TIMEOUT_MS,
   *  1. aucun conteneur labelisé (op/attempt) n'est non terminal (kill par ID, jamais par nom) ;
   *  2. la réservation inerte existe sous le nom réservé avec le label airdd2.fence.op=<id>
   *     (inspect du nom + vérification du label, jamais le nom seul) ;
   *  3. la fenêtre de grâce (2 x poll) après la dernière observation stable est écoulée.
   * Toute inspection douteuse (erreur, label mismatch, état inconnu) → false.
   */
  async verifyFenced(operation: DockerGatewayOperation, fenced: DockerGatewayFencedOperation): Promise<boolean> {
    const effect = fenced.effect ?? operation.effect;
    if (!effect || !CONTAINER_NAME_PATTERN.test(effect.containerName)) return false;
    if (effect.attemptId !== undefined && !ATTEMPT_ID_PATTERN.test(effect.attemptId)) return false;
    if (!OPERATION_ID_PATTERN.test(operation.id)) return false;

    const deadline = Date.now() + this.reconcileTimeoutMs;
    let stableSince: number | null = null;

    while (Date.now() <= deadline) {
      const listed = await this.listLabeledContainers(operation.id, effect.attemptId);
      if (listed === null) return false;

      const nonTerminal = listed.filter((container) => !TERMINAL_STATES.includes(container.state));
      if (nonTerminal.length > 0) {
        stableSince = null;
        for (const container of nonTerminal) {
          if (container.state === 'paused') return false;
          if (container.state === 'removing') continue;
          // Mutation par ID immuable uniquement, jamais par nom.
          await this.runCommand(['kill', container.id], KILL_TIMEOUT_MS);
        }
        await delay(this.pollIntervalMs);
        continue;
      }

      const reserved = await this.verifyNameReservation(effect.containerName, operation.id);
      if (!reserved) return false;

      const now = Date.now();
      if (stableSince === null) stableSince = now;
      if (now - stableSince >= GRACE_POLLS * this.pollIntervalMs) return true;
      await delay(this.pollIntervalMs);
    }
    return false;
  }

  /**
   * Supprime les réservations de nom inertes devenues orphelines (état terminal
   * created/exited/dead, label fence lisible, opération plus dans l'ensemble actif)
   * — typiquement des leftovers de crash/SIGKILL. Suppression par ID immuable
   * uniquement, jamais par nom. Fail-closed : toute inspection douteuse ou tout
   * conteneur non terminal est conservé.
   */
  async sweepOrphanReservations(activeOperationIds: ReadonlySet<string>): Promise<string[]> {
    const ps = await this.runCommand(['ps', '-a', '--no-trunc', '--filter', `label=${FENCE_LABEL}`, '--format', '{{.ID}}'], PS_TIMEOUT_MS);
    if (ps.timedOut || ps.errorMessage || ps.exitCode !== 0) return [];
    const removed: string[] = [];
    for (const line of ps.stdout.split('\n')) {
      const id = line.trim().split(/\s+/)[0] ?? '';
      if (!CONTAINER_ID_PATTERN.test(id)) continue;
      const inspection = await this.inspectById(id);
      if (!inspection) continue; // inspection douteuse -> on conserve
      if (!TERMINAL_STATES.includes(inspection.state)) continue; // jamais un conteneur actif
      const operationId = inspection.labels[FENCE_LABEL];
      if (!operationId || !OPERATION_ID_PATTERN.test(operationId)) continue; // label illisible -> on conserve
      if (activeOperationIds.has(operationId)) continue; // opération encore active -> on garde
      const rm = await this.runCommand(['rm', '--force', id], KILL_TIMEOUT_MS);
      if (!rm.timedOut && !rm.errorMessage && rm.exitCode === 0) removed.push(id);
    }
    return removed;
  }

  private async inspectById(id: string): Promise<NamedContainerInspection | null> {
    const result = await this.runCommand(['inspect', id], INSPECT_TIMEOUT_MS);
    if (result.timedOut || result.errorMessage || result.exitCode !== 0) return null;

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
    const containerId = container.Id;
    if (
      typeof containerId !== 'string' ||
      containerId !== id ||
      typeof config !== 'object' ||
      config === null ||
      typeof state !== 'object' ||
      state === null
    ) {
      return null;
    }
    const labels = (config as Record<string, unknown>).Labels;
    const status = (state as Record<string, unknown>).Status;
    if (typeof labels !== 'object' || labels === null || !CONTAINER_STATES.includes(String(status) as ContainerObservation['state'])) {
      return null;
    }
    const normalized: Record<string, string> = {};
    for (const [key, value] of Object.entries(labels as Record<string, unknown>)) {
      if (typeof value === 'string') normalized[key] = value;
    }
    return { id: containerId, state: String(status) as ContainerObservation['state'], labels: normalized };
  }

  private async reserveName(
    operationId: string,
    containerName: string,
    attemptId: string | undefined,
    observed: string[],
  ): Promise<boolean> {
    if (await this.verifyNameReservation(containerName, operationId)) {
      observed.push('reservation-already-present');
      return true;
    }
    const image = this.options.inertImage;
    if (!image) {
      observed.push('no-inert-image');
      return false;
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const created = await this.runCommand(
        [
          'create',
          `--name=${containerName}`,
          '--pull=never',
          '--label',
          `${FENCE_LABEL}=${operationId}`,
          '--network=none',
          '--read-only',
          '--cap-drop=ALL',
          '--no-healthcheck',
          '--entrypoint=/bin/true',
          image,
          '/bin/true',
        ],
        CREATE_TIMEOUT_MS,
      );
      if (!created.timedOut && !created.errorMessage && created.exitCode === 0) {
        observed.push('reservation-created');
        return await this.verifyNameReservation(containerName, operationId);
      }
      observed.push('reservation-create-refused');

      // Le nom peut encore être tenu par un conteneur labelisé terminal (exited) :
      // on ne le libère que par rm de son ID immuable, jamais par nom.
      const holder = await this.inspectByName(containerName);
      if (
        holder &&
        TERMINAL_STATES.includes(holder.state) &&
        (holder.labels[GATEWAY_OP_LABEL] === operationId || (attemptId !== undefined && holder.labels[ATTEMPT_LABEL] === attemptId))
      ) {
        const removed = await this.runCommand(['rm', '--force', holder.id], KILL_TIMEOUT_MS);
        if (!removed.timedOut && !removed.errorMessage && removed.exitCode === 0) {
          observed.push(`removed-labeled-terminal:${holder.id}`);
          continue;
        }
        observed.push(`remove-uncertain:${holder.id}`);
      }
      return false;
    }
    return await this.verifyNameReservation(containerName, operationId);
  }

  private async verifyNameReservation(containerName: string, operationId: string): Promise<boolean> {
    const inspection = await this.inspectByName(containerName);
    if (!inspection) return false;
    if (!TERMINAL_STATES.includes(inspection.state)) return false;
    return inspection.labels[FENCE_LABEL] === operationId;
  }

  private async listLabeledContainers(operationId: string, attemptId?: string): Promise<LabeledContainer[] | null> {
    const labels = [`${GATEWAY_OP_LABEL}=${operationId}`];
    if (attemptId) labels.push(`${ATTEMPT_LABEL}=${attemptId}`);

    const seen = new Map<string, ContainerObservation['state']>();
    for (const label of labels) {
      const result = await this.runCommand(
        ['ps', '-a', '--no-trunc', '--filter', `label=${label}`, '--format', '{{.ID}} {{.State}}'],
        PS_TIMEOUT_MS,
      );
      if (result.timedOut || result.errorMessage || result.exitCode !== 0) return null;
      for (const line of result.stdout.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const match = /^([0-9a-f]{64})\s+(\S+)$/.exec(trimmed);
        if (!match || !CONTAINER_STATES.includes(match[2] as ContainerObservation['state'])) {
          return null;
        }
        seen.set(match[1], match[2] as ContainerObservation['state']);
      }
    }
    return Array.from(seen, ([id, state]) => ({ id, state }));
  }

  private async inspectByName(name: string): Promise<NamedContainerInspection | null> {
    const result = await this.runCommand(['inspect', name], INSPECT_TIMEOUT_MS);
    if (result.timedOut || result.errorMessage || result.exitCode !== 0) return null;

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
    const id = container.Id;
    if (
      typeof id !== 'string' ||
      !CONTAINER_ID_PATTERN.test(id) ||
      container.Name !== `/${name}` ||
      typeof config !== 'object' ||
      config === null ||
      typeof state !== 'object' ||
      state === null
    ) {
      return null;
    }
    const labels = (config as Record<string, unknown>).Labels;
    const status = (state as Record<string, unknown>).Status;
    if (typeof labels !== 'object' || labels === null || !CONTAINER_STATES.includes(String(status) as ContainerObservation['state'])) {
      return null;
    }
    const normalized: Record<string, string> = {};
    for (const [key, value] of Object.entries(labels as Record<string, unknown>)) {
      if (typeof value === 'string') normalized[key] = value;
    }
    return { id, state: String(status) as ContainerObservation['state'], labels: normalized };
  }

  private async runCommand(args: string[], timeoutMs: number): Promise<RunnerResult> {
    try {
      return await this.runner.run(args, { timeoutMs });
    } catch (error) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: '',
        timedOut: false,
        errorMessage: error instanceof Error ? error.message : 'Docker command failed with an unknown outcome',
      };
    }
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
    if (container.Name !== `/${name}` || typeof config !== 'object' || config === null || typeof state !== 'object' || state === null) {
      return null;
    }
    if (attemptId) {
      const labels = (config as Record<string, unknown>).Labels;
      if (typeof labels !== 'object' || labels === null || (labels as Record<string, unknown>)['airdd2.execution.attempt'] !== attemptId) {
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
