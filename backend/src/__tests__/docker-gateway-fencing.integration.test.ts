import { execFile } from 'child_process';

import { randomUUID } from 'crypto';

import { tmpdir } from 'os';

import path from 'path';

import { promisify } from 'util';

import mongoose from 'mongoose';

import { DockerGatewayDaemon } from '../services/runtime/DockerGatewayDaemon';

import { DockerGatewayControlClient } from '../services/runtime/DockerGatewayControlClient';

import { DockerGatewayServer } from '../services/runtime/DockerGatewayServer';

import { MongoDockerGatewayAdmission } from '../services/runtime/MongoDockerGatewayAdmission';

import { DockerGatewayOperationReconciler } from '../services/runtime/DockerGatewayOperationReconciler';

import { SpawnDockerProcessRunner } from '../services/runtime/DockerSandboxRunner';

const describeDocker = process.env.AIRDD2_TEST_DOCKER_RESERVATION === '1' ? describe : describe.skip;

const execFileAsync = promisify(execFile);

describeDocker('Docker gateway fencing against the real Linux daemon (US-J7-05)', () => {

    const processRunner = new SpawnDockerProcessRunner();
    const testId = randomUUID();
    const testLabel = `airdd2.gateway-fencing.test=${testId}`;
    const fencedOperationIds = new Set<string>();

    let socketPath: string;
    let inertImage: string;
    let daemon: DockerGatewayDaemon | undefined;

    async function docker(...args: string[]): Promise<string> {
        return (await execFileAsync('docker', args, { timeout: 20_000 })).stdout.trim();
    }

    async function dockerFail(...args: string[]): Promise<{ code: number; stderr: string }> {
        try {
            await execFileAsync('docker', args, { timeout: 20_000 });
            return { code: 0, stderr: '' };
        } catch (error) {
            const err = error as { code?: number; stderr?: string };
            return { code: err.code ?? 1, stderr: err.stderr ?? '' };
        }
    }

    function commandRunner() {
        return { run: (args: string[], options?: { stdin?: string; timeoutMs?: number; signal?: AbortSignal }) =>
            processRunner.run('docker', args, options) };
    }

    async function startGateway(admission: MongoDockerGatewayAdmission): Promise<void> {
        socketPath = process.platform === 'win32'
            ? `\\\\.\\pipe\\airdd2-fencing-${randomUUID()}`
            : path.join(tmpdir(), `airdd2-fencing-${randomUUID()}.sock`);
        const reconciler = new DockerGatewayOperationReconciler(commandRunner(), 'restart', { inertImage });
        const server = new DockerGatewayServer({ socketPath, admission, commandRunner: commandRunner(), inertImage });
        daemon = new DockerGatewayDaemon({ admission, server, quiescenceVerifier: reconciler, fencer: reconciler });
        await daemon.start();
    }

    async function stopGateway(): Promise<void> {
        const current = daemon;
        daemon = undefined;
        await current?.stop();
    }

    beforeAll(async () => {
        inertImage = (await docker('image', 'inspect', 'ubuntu:noble', '--format', '{{.Id}}')).trim();
        if (!/^sha256:[0-9a-f]{64}$/.test(inertImage)) throw new Error('ubuntu:noble image id is invalid');
    });

    beforeEach(async () => {
        await mongoose.connection.db!.collection<{ _id: string }>('docker_gateway_state')
            .deleteOne({ _id: 'docker-gateway' });
    });

    afterEach(async () => {
        await stopGateway();
        const filters = [testLabel, ...[...fencedOperationIds].map((id) => `airdd2.fence.op=${id}`)];
        for (const filter of filters) {
            const ids = await docker('container', 'ls', '--all', '--no-trunc', '--filter',
                `label=${filter}`, '--format', '{{.ID}}');
            for (const id of ids.split(/\s+/).filter(Boolean)) {
                if (!/^[0-9a-f]{64}$/.test(id)) throw new Error('Invalid test container ID');
                await docker('rm', '--force', id);
            }
        }
        fencedOperationIds.clear();
    });

    async function createLabeledContainer(name: string, operationId: string, attemptId: string): Promise<string> {
        const id = await docker('run', '-d', `--name=${name}`, '--pull=never',
            '--label', testLabel, '--label', `airdd2.gateway.op=${operationId}`,
            '--label', `airdd2.execution.attempt=${attemptId}`,
            '--network=none', 'ubuntu:noble', 'sleep', '300');
        if (!/^[0-9a-f]{64}$/.test(id)) throw new Error('Invalid created test container ID');
        return id;
    }

    it('restart with an unknown run operation reopens admission, fences it, reserves the name, and blocks delayed name-based effects', async () => {
        // --- Premier démarrage : un run incertain est journalisé puis l'epoch est fermée.
        const admission = new MongoDockerGatewayAdmission();
        await admission.recoverAfterRestart();
        await startGateway(admission);
        const oldEpoch = await admission.activateWorker('old-worker');

        const attemptId = randomUUID();
        const containerName = `airdd2-j7-attempt-${attemptId}`;
        const operation = await admission.admit(oldEpoch, {
            command: 'run',
            containerName,
            attemptId,
        });
        fencedOperationIds.add(operation.id);
        await admission.settle(operation, 'unknown');
        await admission.closeWorker(oldEpoch);

        // "Création différée" : le conteneur apparaît après la déconnexion, avec le label d'opération.
        const delayedId = await createLabeledContainer(containerName, operation.id, attemptId);
        expect(await docker('inspect', '--format', '{{.State.Status}}', delayedId)).toBe('running');

        // --- Redémarrage du gateway : le socket doit s'ouvrir malgré l'opération unknown.
        await stopGateway();
        const restarted = new MongoDockerGatewayAdmission();
        await startGateway(restarted);

        // L'opération est passée en fenced (auto_epoch_rotation), journalisée, non supprimée.
        // Ici le fencing best-effort du démarrage a pu prouver la quiescence (conteneur tué
        // par ID + nom réservé) ; sans preuve, quiescenceProven resterait false (cas pause ci-dessous).
        const fenced = await restarted.getFencedOperations();
        expect(fenced).toHaveLength(1);
        expect(fenced[0]).toMatchObject({
            id: operation.id,
            fenceKind: 'auto_epoch_rotation',
            quiescenceProven: true,
        });
        expect(fenced[0].nameReservation).toEqual({ containerName, reserved: true });
        expect(await restarted.getPendingOperations()).toEqual([]);

        // Le conteneur labelisé a été tué par ID puis supprimé ; la réservation inerte occupe le nom.
        expect(await dockerFail('inspect', '--format', '{{.State.Status}}', delayedId))
            .toMatchObject({ code: 1 });
        const reservation = JSON.parse(await docker('inspect', containerName)) as Array<{
            Id: string;
            Config: { Labels: Record<string, string> };
            State: { Status: string };
        }>;
        expect(reservation[0].Config.Labels['airdd2.fence.op']).toBe(operation.id);
        expect(reservation[0].State.Status).toBe('created');

        // --- Rotation d'epoch via le control plane : l'admission rouvre, l'epoch périmée est rejetée.
        const control = new DockerGatewayControlClient({ socketPath });
        const nextEpoch = await control.activateWorker('new-worker');
        expect(nextEpoch.epoch).toBe(oldEpoch.epoch + 1);
        await expect(restarted.admit(oldEpoch)).rejects.toThrow('stale worker epoch');
        await expect(restarted.admit(nextEpoch)).resolves.toMatchObject({ epoch: nextEpoch.epoch });

        // --- Création différée par nom après fencing : refusée (nom réservé).
        const delayedCreate = await dockerFail('create', `--name=${containerName}`, '--pull=never',
            '--network=none', '--label', testLabel, inertImage, '/bin/true');
        expect(delayedCreate.code).not.toBe(0);
        expect(delayedCreate.stderr).toMatch(/already in use/i);

        // --- Kill différé par nom : ne touche pas la réservation (conteneur inerte jamais démarré).
        const delayedKill = await dockerFail('kill', containerName);
        expect(delayedKill.code).not.toBe(0);
        const after = JSON.parse(await docker('inspect', containerName)) as Array<{
            Config: { Labels: Record<string, string> };
            State: { Status: string };
        }>;
        expect(after[0].Config.Labels['airdd2.fence.op']).toBe(operation.id);
        expect(after[0].State.Status).toBe('created');

        // --- Preuve de quiescence par label/ID + réservation + fenêtre de grâce.
        const verify = await control.verifyFenced(operation.id);
        expect(verify).toEqual({ quiescent: true });
        expect((await restarted.getFencedOperation(operation.id))?.quiescenceProven).toBe(true);

        const fence = await control.fenceOperation(operation.id, 'user_manual_reset');
        expect(fence).toMatchObject({ fenced: true, nameReserved: true, quiescent: true });
    }, 90_000);

    it('a paused labeled container keeps the operation in quarantine (verifyFenced false)', async () => {
        const admission = new MongoDockerGatewayAdmission();
        await admission.recoverAfterRestart();
        await startGateway(admission);
        const epoch = await admission.activateWorker('worker-1');

        const attemptId = randomUUID();
        const containerName = `airdd2-j7-attempt-${attemptId}`;
        const operation = await admission.admit(epoch, {
            command: 'run',
            containerName,
            attemptId,
        });
        fencedOperationIds.add(operation.id);
        await admission.settle(operation, 'unknown');
        await admission.closeWorker(epoch);

        const containerId = await createLabeledContainer(containerName, operation.id, attemptId);
        await docker('pause', containerId);

        try {
            await stopGateway();
            const restarted = new MongoDockerGatewayAdmission();
            await startGateway(restarted);

            const control = new DockerGatewayControlClient({ socketPath });
            await control.activateWorker('worker-2');

            // Le conteneur en pause n'est pas tué : pas de réservation possible (nom tenu),
            // quiescence non prouvée, l'opération reste en quarantaine.
            const fenced = await restarted.getFencedOperation(operation.id);
            expect(fenced).toMatchObject({
                fenceKind: 'auto_epoch_rotation',
                quiescenceProven: false,
            });
            expect(fenced?.nameReservation).toEqual({ containerName, reserved: false });

            const verify = await control.verifyFenced(operation.id);
            expect(verify).toEqual({ quiescent: false });

            expect(await docker('inspect', '--format', '{{.State.Status}}', containerId)).toBe('paused');
        } finally {
            await docker('unpause', containerId).catch(() => undefined);
        }
    }, 90_000);
});
