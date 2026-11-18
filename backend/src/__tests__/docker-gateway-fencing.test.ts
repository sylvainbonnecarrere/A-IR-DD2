import { randomUUID } from 'crypto';

import { DockerGatewayOperationReconciler } from '../services/runtime/DockerGatewayOperationReconciler';

import type { DockerGatewayCommandRunner } from '../services/runtime/DockerGatewayProtocol';

import type { DockerGatewayFencedOperation, DockerGatewayOperation } from '../services/runtime/DockerGatewayAdmission';

const INERT_IMAGE = `sha256:${'ab'.repeat(32)}`;

type FakeState = 'created' | 'running' | 'paused' | 'restarting' | 'removing' | 'exited' | 'dead';

interface FakeContainer {
    id: string;
    name: string;
    state: FakeState;
    labels: Record<string, string>;
}

/**
 * Fake Docker stateful : ps/inspect/kill/create/rm avec une sémantique proche du daemon
 * (conflit de nom à la création, kill par ID, inspect par nom ou ID). Les commandes
 * mutantes reçues sont enregistrées pour prouver qu'aucun nom nu n'est jamais ciblé.
 */
class FakeDocker {
    readonly containers = new Map<string, FakeContainer>();
    readonly mutations: string[][] = [];
    failPs = false;
    failInspect = false;
    private sequence = 0;

    addContainer(name: string, state: FakeState, labels: Record<string, string>): FakeContainer {
        this.sequence += 1;
        const id = `${this.sequence.toString(16).padStart(8, '0')}${'f'.repeat(56)}`.slice(0, 64);
        const container: FakeContainer = { id, name, state, labels };
        this.containers.set(container.id, container);
        return container;
    }

    byName(name: string): FakeContainer | undefined {
        return [...this.containers.values()].find((entry) => entry.name === name);
    }

    runner(): DockerGatewayCommandRunner {
        return {
            run: async (args: string[]) => {
                const [command] = args;
                if (command === 'ps') {
                    if (this.failPs) return { exitCode: 1, stdout: '', stderr: 'daemon error', timedOut: false };
                    const labelFilter = args.find((arg) => arg.startsWith('label='))?.slice('label='.length) ?? '';
                    const [labelKey, labelValue] = labelFilter.split('=');
                    const lines: string[] = [];
                    for (const container of this.containers.values()) {
                        if (container.labels[labelKey] === labelValue) {
                            lines.push(`${container.id}\t${container.state}`);
                        }
                    }
                    return { exitCode: 0, stdout: `${lines.join('\n')}${lines.length ? '\n' : ''}`, stderr: '', timedOut: false };
                }
                if (command === 'inspect') {
                    if (this.failInspect) return { exitCode: 1, stdout: '', stderr: 'daemon error', timedOut: false };
                    const target = args[args.length - 1];
                    const container = this.containers.get(target) ?? this.byName(target);
                    if (!container) return { exitCode: 1, stdout: '', stderr: 'Error: No such container', timedOut: false };
                    return {
                        exitCode: 0,
                        stdout: JSON.stringify([{
                            Id: container.id,
                            Name: `/${container.name}`,
                            Config: { Labels: container.labels },
                            State: { Status: container.state },
                        }]),
                        stderr: '',
                        timedOut: false,
                    };
                }
                if (command === 'kill' || command === 'rm') {
                    this.mutations.push(args);
                    const target = args[args.length - 1];
                    const container = this.containers.get(target) ?? this.byName(target);
                    if (!container) return { exitCode: 1, stdout: '', stderr: 'Error: No such container', timedOut: false };
                    if (command === 'kill') {
                        if (container.state === 'paused') {
                            return { exitCode: 1, stdout: '', stderr: 'Error: container is paused', timedOut: false };
                        }
                        if (container.state === 'created') {
                            return { exitCode: 1, stdout: '', stderr: 'Error: container is not running', timedOut: false };
                        }
                        container.state = 'exited';
                    } else {
                        this.containers.delete(container.id);
                    }
                    return { exitCode: 0, stdout: '', stderr: '', timedOut: false };
                }
                if (command === 'create') {
                    this.mutations.push(args);
                    const nameArg = args.find((arg) => arg.startsWith('--name='));
                    const name = nameArg?.slice('--name='.length);
                    if (!name) return { exitCode: 1, stdout: '', stderr: 'missing name', timedOut: false };
                    if (this.byName(name)) {
                        return { exitCode: 1, stdout: '', stderr: 'Conflict. The container name is already in use', timedOut: false };
                    }
                    const labelIndex = args.findIndex((arg) => arg === '--label');
                    const label = labelIndex >= 0 ? args[labelIndex + 1] : '';
                    const separator = label.indexOf('=');
                    const container = this.addContainer(name, 'created', { [label.slice(0, separator)]: label.slice(separator + 1) });
                    return { exitCode: 0, stdout: container.id, stderr: '', timedOut: false };
                }
                return { exitCode: 1, stdout: '', stderr: `unsupported command ${command}`, timedOut: false };
            },
        };
    }
}

function makeOperation(overrides: Partial<DockerGatewayOperation> = {}): DockerGatewayOperation {
    return {
        id: randomUUID(),
        epoch: 1,
        effect: { command: 'run', containerName: `airdd2-j7-attempt-${randomUUID()}` },
        ...overrides,
    };
}

function makeFenced(operation: DockerGatewayOperation, overrides: Partial<DockerGatewayFencedOperation> = {}): DockerGatewayFencedOperation {
    return {
        id: operation.id,
        epoch: operation.epoch,
        effect: operation.effect,
        fencedAt: new Date(),
        fenceKind: 'auto_epoch_rotation',
        nameReservation: operation.effect ? { containerName: operation.effect.containerName, reserved: false } : null,
        quiescenceProven: false,
        ...overrides,
    };
}

function makeReconciler(docker: FakeDocker, overrides: { reconcileTimeoutMs?: number; pollIntervalMs?: number; inert?: boolean } = {}) {
    return new DockerGatewayOperationReconciler(docker.runner(), 'restart', {
        ...(overrides.inert === false ? {} : { inertImage: INERT_IMAGE }),
        reconcileTimeoutMs: overrides.reconcileTimeoutMs ?? 2_000,
        pollIntervalMs: overrides.pollIntervalMs ?? 20,
    });
}

describe('DockerGatewayOperationReconciler fence/verifyFenced', () => {
    it('verifyFenced is true only with a labeled reservation, no non-terminal labeled container, and an elapsed grace window', async () => {
        const docker = new FakeDocker();
        const operation = makeOperation();
        docker.addContainer(operation.effect!.containerName, 'created', { 'airdd2.fence.op': operation.id });

        const reconciler = makeReconciler(docker);
        await expect(reconciler.verifyFenced(operation, makeFenced(operation))).resolves.toBe(true);
    });

    it('verifyFenced is false when the reservation is absent', async () => {
        const docker = new FakeDocker();
        const operation = makeOperation();

        const reconciler = makeReconciler(docker);
        await expect(reconciler.verifyFenced(operation, makeFenced(operation))).resolves.toBe(false);
    });

    it('verifyFenced is false on reservation label mismatch (fail-closed)', async () => {
        const docker = new FakeDocker();
        const operation = makeOperation();
        docker.addContainer(operation.effect!.containerName, 'created', { 'airdd2.fence.op': randomUUID() });

        const reconciler = makeReconciler(docker);
        await expect(reconciler.verifyFenced(operation, makeFenced(operation))).resolves.toBe(false);
    });

    it('verifyFenced is false when the ps inspection fails (fail-closed)', async () => {
        const docker = new FakeDocker();
        const operation = makeOperation();
        docker.addContainer(operation.effect!.containerName, 'created', { 'airdd2.fence.op': operation.id });
        docker.failPs = true;

        const reconciler = makeReconciler(docker);
        await expect(reconciler.verifyFenced(operation, makeFenced(operation))).resolves.toBe(false);
    });

    it('verifyFenced is false when the inspect fails (fail-closed)', async () => {
        const docker = new FakeDocker();
        const operation = makeOperation();
        docker.addContainer(operation.effect!.containerName, 'created', { 'airdd2.fence.op': operation.id });
        docker.failInspect = true;

        const reconciler = makeReconciler(docker);
        await expect(reconciler.verifyFenced(operation, makeFenced(operation))).resolves.toBe(false);
    });

    it('verifyFenced kills a running labeled container by immutable ID, never by name, and stays false without reservation', async () => {
        const docker = new FakeDocker();
        const operation = makeOperation();
        const name = operation.effect!.containerName;
        const running = docker.addContainer(name, 'running', { 'airdd2.gateway.op': operation.id });

        const reconciler = makeReconciler(docker);
        await expect(reconciler.verifyFenced(operation, makeFenced(operation))).resolves.toBe(false);

        const killMutations = docker.mutations.filter((args) => args[0] === 'kill');
        expect(killMutations).toHaveLength(1);
        expect(killMutations[0]).toEqual(['kill', running.id]);
        expect(docker.mutations.flat().some((arg) => arg === name)).toBe(false);
    });

    it('verifyFenced stays false for a paused container (remains in quarantine)', async () => {
        const docker = new FakeDocker();
        const operation = makeOperation();
        const name = operation.effect!.containerName;
        docker.addContainer(name, 'paused', { 'airdd2.gateway.op': operation.id });

        const reconciler = makeReconciler(docker, { reconcileTimeoutMs: 400, pollIntervalMs: 20 });
        await expect(reconciler.verifyFenced(operation, makeFenced(operation))).resolves.toBe(false);
        // Aucune commande mutante n'a ciblé le conteneur en pause (kill par ID inutile ici).
        expect(docker.mutations).toHaveLength(0);
    });

    it('verifyFenced is false when a non-terminal labeled container persists until the deadline', async () => {
        const docker = new FakeDocker();
        const operation = makeOperation();
        const name = operation.effect!.containerName;
        // Conteneur labelisé en 'removing' sous un autre nom : le kill n'est pas tenté, on attend la borne.
        docker.addContainer('airdd2-labeled-removing', 'removing', { 'airdd2.gateway.op': operation.id });
        docker.addContainer(name, 'created', { 'airdd2.fence.op': operation.id });

        const reconciler = makeReconciler(docker, { reconcileTimeoutMs: 400, pollIntervalMs: 20 });
        await expect(reconciler.verifyFenced(operation, makeFenced(operation))).resolves.toBe(false);
        expect(docker.mutations.filter((args) => args[0] === 'kill')).toHaveLength(0);
    });

    it('fence kills labeled containers by ID, reserves the name with the fence label, and proves quiescence', async () => {
        const docker = new FakeDocker();
        const operation = makeOperation();
        const name = operation.effect!.containerName;
        const running = docker.addContainer(name, 'running', { 'airdd2.gateway.op': operation.id });

        const reconciler = makeReconciler(docker);
        const result = await reconciler.fence(operation, makeFenced(operation));

        expect(result).toMatchObject({ fenced: true, nameReserved: true, quiescent: true });
        expect(result.observed).toContain(`killed:${running.id}`);

        // Le conteneur labelisé a été tué puis supprimé par ID pour libérer le nom.
        const mutations = docker.mutations.map((args) => args.join(' '));
        expect(mutations).toContain(`kill ${running.id}`);
        expect(mutations).toContain(`rm --force ${running.id}`);
        // Aucun nom nu dans les commandes mutantes après fencing.
        expect(docker.mutations.flat().some((arg) => arg === name)).toBe(false);

        // Réservation inerte présente avec le label fence.
        const reservation = docker.byName(name);
        expect(reservation).toBeDefined();
        expect(reservation?.labels['airdd2.fence.op']).toBe(operation.id);
        expect(reservation?.state).toBe('created');

        await expect(reconciler.verifyFenced(operation, makeFenced(operation, {
            nameReservation: { containerName: name, reserved: true },
        }))).resolves.toBe(true);
    });

    it('fence fails closed (nameReserved=false) when the name is held by a foreign container', async () => {
        const docker = new FakeDocker();
        const operation = makeOperation();
        const name = operation.effect!.containerName;
        docker.addContainer(name, 'exited', { 'airdd2.fence.op': randomUUID() });

        const reconciler = makeReconciler(docker);
        const result = await reconciler.fence(operation, makeFenced(operation));

        expect(result.fenced).toBe(true);
        expect(result.nameReserved).toBe(false);
        expect(result.quiescent).toBe(false);
        // Le conteneur étranger n'est ni tué ni supprimé (label mismatch -> fail-closed).
        expect(docker.mutations.filter((args) => args[0] === 'kill' || args[0] === 'rm')).toHaveLength(0);
    });

    it('fence fails closed when no inert image is configured', async () => {
        const docker = new FakeDocker();
        const operation = makeOperation();

        const reconciler = makeReconciler(docker, { inert: false, reconcileTimeoutMs: 300 });
        const result = await reconciler.fence(operation, makeFenced(operation));

        expect(result).toMatchObject({ fenced: true, nameReserved: false, quiescent: false });
        expect(result.observed).toContain('no-inert-image');
    });

    it('a delayed name-based create fails while the reservation holds the name', async () => {
        const docker = new FakeDocker();
        const operation = makeOperation();
        const name = operation.effect!.containerName;

        const reconciler = makeReconciler(docker);
        await reconciler.fence(operation, makeFenced(operation));

        const delayed = await docker.runner().run([
            'create', `--name=${name}`, '--pull=never', '--network=none', INERT_IMAGE, '/bin/true',
        ]);
        expect(delayed.exitCode).toBe(1);
        expect(delayed.stderr).toMatch(/already in use/i);

        await expect(reconciler.verifyFenced(operation, makeFenced(operation, {
            nameReservation: { containerName: name, reserved: true },
        }))).resolves.toBe(true);
    });

    it('a delayed name-based kill does not touch the inert reservation (never started)', async () => {
        const docker = new FakeDocker();
        const operation = makeOperation();
        const name = operation.effect!.containerName;

        const reconciler = makeReconciler(docker);
        await reconciler.fence(operation, makeFenced(operation));

        const reservation = docker.byName(name)!;
        const delayedKill = await docker.runner().run(['kill', name]);
        expect(delayedKill.exitCode).toBe(1);

        expect(docker.containers.get(reservation.id)).toMatchObject({
            state: 'created',
            labels: { 'airdd2.fence.op': operation.id },
        });
    });

    it('verifyFenced returns false for an operation without effect (fail-closed)', async () => {
        const docker = new FakeDocker();
        const operation: DockerGatewayOperation = { id: randomUUID(), epoch: 1 };

        const reconciler = makeReconciler(docker);
        await expect(reconciler.verifyFenced(operation, makeFenced(operation))).resolves.toBe(false);
    });

    it('verifyFenced rejects a malformed operation id (fail-closed)', async () => {
        const docker = new FakeDocker();
        const operation = makeOperation({ id: 'not-a-uuid' });

        const reconciler = makeReconciler(docker);
        await expect(reconciler.verifyFenced(operation, makeFenced(operation))).resolves.toBe(false);
    });
});
