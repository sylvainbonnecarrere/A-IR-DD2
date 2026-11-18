import { randomUUID } from 'crypto';

import mongoose from 'mongoose';

import { MongoDockerGatewayAdmission } from '../services/runtime/MongoDockerGatewayAdmission';

import { DockerGatewayDaemon } from '../services/runtime/DockerGatewayDaemon';

import { DockerGatewayOperationReconciler } from '../services/runtime/DockerGatewayOperationReconciler';

describe('Mongo Docker gateway admission', () => {
    let admission: MongoDockerGatewayAdmission;

    beforeEach(async () => {
        await mongoose.connection.db!.collection<{ _id: string }>('docker_gateway_state')
            .deleteOne({ _id: 'docker-gateway' });
        admission = new MongoDockerGatewayAdmission();
        await admission.recoverAfterRestart();
    });

    it('persists monotonic epochs and refuses tokens from a previous gateway epoch', async () => {
        const firstEpoch = await admission.activateWorker('worker-1');
        const restarted = new MongoDockerGatewayAdmission();

        expect(await restarted.recoverAfterRestart()).toEqual([]);

        const secondEpoch = await restarted.activateWorker('worker-1');

        expect(secondEpoch.epoch).toBe(firstEpoch.epoch + 1);

        await expect(restarted.admit(firstEpoch)).rejects.toThrow('stale worker epoch');

        await expect(restarted.admit(secondEpoch)).resolves.toMatchObject({ epoch: secondEpoch.epoch });

        const state = await mongoose.connection.db!.collection<{ _id: string; activeWorker?: Record<string, unknown> | null }>('docker_gateway_state')
            .findOne({ _id: 'docker-gateway' });
        expect(state?.activeWorker).not.toHaveProperty('token');
        expect(state?.activeWorker).not.toHaveProperty('tokenDigest', secondEpoch.token);
    });

    it('serializes competing admissions across independent gateway instances', async () => {
        const epoch = await admission.activateWorker('worker-1');

        const instances = Array.from({ length: 12 }, () => new MongoDockerGatewayAdmission());
        const results = await Promise.allSettled(instances.map((instance) => instance.admit(epoch)));

        expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
        expect(results.filter((result) => result.status === 'rejected')).toHaveLength(11);

        expect(await admission.getPendingOperations()).toHaveLength(1);
    });

    it('restarts pending work as unknown and auto-fences it at the next epoch activation (admission reopens)', async () => {
        const epoch = await admission.activateWorker('worker-1');
        const operation = await admission.admit(epoch, {
            command: 'run',
            containerName: 'airdd2-test-attempt',
        });
        const restarted = new MongoDockerGatewayAdmission();

        expect(await restarted.recoverAfterRestart()).toEqual([operation]);

        await expect(restarted.reconcileUnknown(operation.id, { verify: async () => false })).resolves.toBe(false);
        expect(await restarted.getPendingOperations()).toEqual([operation]);

        // Nouveau contrat US-J7-05 : l'activation fence l'opération unknown et rouvre l'admission.
        const nextEpoch = await restarted.activateWorker('worker-2');
        expect(nextEpoch.epoch).toBe(epoch.epoch + 1);

        expect(await restarted.getPendingOperations()).toEqual([]);
        const fenced = await restarted.getFencedOperations();
        expect(fenced).toHaveLength(1);
        expect(fenced[0]).toMatchObject({
            id: operation.id,
            epoch: epoch.epoch,
            fenceKind: 'auto_epoch_rotation',
            quiescenceProven: false,
            nameReservation: { containerName: 'airdd2-test-attempt', reserved: false },
        });
        expect(fenced[0].effect).toEqual({ command: 'run', containerName: 'airdd2-test-attempt' });

        await expect(restarted.admit(epoch)).rejects.toThrow('stale worker epoch');
        await expect(restarted.admit(nextEpoch)).resolves.toMatchObject({ epoch: nextEpoch.epoch });
    });

    it('keeps an unknown operation when verification fails, then fences it at activation instead of blocking', async () => {
        const epoch = await admission.activateWorker('worker-1');
        const operation = await admission.admit(epoch);

        await admission.settle(operation, 'unknown');
        await admission.closeWorker(epoch);

        const restarted = new MongoDockerGatewayAdmission();
        await restarted.recoverAfterRestart();

        await expect(restarted.reconcileUnknown(operation.id, {
            verify: async () => { throw new Error('daemon unavailable'); },
        })).rejects.toThrow('daemon unavailable');

        // Journal intact : l'opération reste pending unknown.
        expect(await restarted.getPendingOperations()).toEqual([operation]);
        expect(await restarted.getFencedOperations()).toEqual([]);

        // L'activation rouvre l'admission en fençant l'opération (pas de blocage global).
        const nextEpoch = await restarted.activateWorker('worker-2');
        expect(nextEpoch.epoch).toBe(epoch.epoch + 1);
        expect(await restarted.getPendingOperations()).toEqual([]);
        expect((await restarted.getFencedOperations()).map((fenced) => fenced.id)).toEqual([operation.id]);
    });

    it('opens the gateway on restart for an uncertain run: the operation is fenced, the socket listens', async () => {
        const epoch = await admission.activateWorker('worker-1');
        const operation = await admission.admit(epoch, {
            command: 'run',
            containerName: 'airdd2-test-attempt',
        });
        const restarted = new MongoDockerGatewayAdmission();
        const commandRunner = { run: jest.fn().mockResolvedValue({
            exitCode: 1, stdout: '', stderr: 'No such container', timedOut: false,
        }) };
        const server = { listen: jest.fn(), close: jest.fn() };
        const daemon = new DockerGatewayDaemon({
            admission: restarted,
            server,
            quiescenceVerifier: new DockerGatewayOperationReconciler(commandRunner),
        });

        await daemon.start();

        // Le socket s'ouvre malgré l'opération run incertaine ; elle est confinée, pas supprimée.
        expect(server.listen).toHaveBeenCalledTimes(1);
        expect(await restarted.getPendingOperations()).toEqual([]);
        const fenced = await restarted.getFencedOperations();
        expect(fenced).toHaveLength(1);
        expect(fenced[0]).toMatchObject({ id: operation.id, fenceKind: 'auto_epoch_rotation', quiescenceProven: false });
        // Sans fencer, aucune commande Docker n'est exécutée au démarrage.
        expect(commandRunner.run).not.toHaveBeenCalled();
    });

    it('passes the persisted effect to the verifier after restart and retains it on failure, then keeps it fenced', async () => {
        const epoch = await admission.activateWorker('worker-1');
        const operation = await admission.admit(epoch, {
            command: 'run', containerName: 'airdd2-test-attempt',
        });
        const restarted = new MongoDockerGatewayAdmission();
        await restarted.recoverAfterRestart();
        const verify = jest.fn().mockResolvedValue(false);

        await expect(restarted.reconcileUnknown(operation.id, { verify })).resolves.toBe(false);
        expect(verify).toHaveBeenCalledWith(operation);
        expect(await restarted.getPendingOperations()).toEqual([operation]);

        const secondRestart = new MongoDockerGatewayAdmission();
        expect(await secondRestart.recoverAfterRestart()).toEqual([operation]);

        const nextEpoch = await secondRestart.activateWorker('worker-2');
        expect(nextEpoch.epoch).toBe(epoch.epoch + 1);
        const fenced = await secondRestart.getFencedOperation(operation.id);
        expect(fenced).toMatchObject({ id: operation.id, fenceKind: 'auto_epoch_rotation' });
        expect(fenced?.effect).toEqual(operation.effect);
        expect(await secondRestart.getPendingOperations()).toEqual([]);
    });

    it('opens the gateway on restart for an uncertain kill: the operation is fenced, the socket listens', async () => {
        const epoch = await admission.activateWorker('worker-1');
        const operation = await admission.admit(epoch, {
            command: 'kill', containerName: 'airdd2-test-attempt',
        });
        const restarted = new MongoDockerGatewayAdmission();
        const commandRunner = { run: jest.fn().mockResolvedValue({
            exitCode: 1, stdout: '', stderr: 'No such container', timedOut: false,
        }) };
        const server = { listen: jest.fn(), close: jest.fn() };
        const daemon = new DockerGatewayDaemon({
            admission: restarted,
            server,
            quiescenceVerifier: new DockerGatewayOperationReconciler(commandRunner, 'restart'),
        });

        await daemon.start();

        expect(server.listen).toHaveBeenCalledTimes(1);
        expect(await restarted.getPendingOperations()).toEqual([]);
        expect((await restarted.getFencedOperations()).map((fenced) => fenced.id)).toEqual([operation.id]);
        expect(commandRunner.run).not.toHaveBeenCalled();
    });

    it('fences a pending unknown operation with a manual fence kind via the control plane path', async () => {
        const epoch = await admission.activateWorker('worker-1');
        const operation = await admission.admit(epoch, {
            command: 'run',
            containerName: 'airdd2-test-attempt',
        });
        await admission.settle(operation, 'unknown');
        await admission.closeWorker(epoch);

        const fenced = await admission.fencePendingOperation(operation.id, 'user_manual_reset');
        expect(fenced).toMatchObject({
            id: operation.id,
            fenceKind: 'user_manual_reset',
            nameReservation: { containerName: 'airdd2-test-attempt', reserved: false },
            quiescenceProven: false,
        });
        expect(await admission.getPendingOperations()).toEqual([]);

        await admission.markNameReservation(operation.id, true);
        await admission.markQuiescenceProven(operation.id);

        const stored = await admission.getFencedOperation(operation.id);
        expect(stored).toMatchObject({
            nameReservation: { containerName: 'airdd2-test-attempt', reserved: true },
            quiescenceProven: true,
        });

        // Le journal persiste après un nouveau redémarrage.
        const restarted = new MongoDockerGatewayAdmission();
        expect(await restarted.recoverAfterRestart()).toEqual([]);
        expect((await restarted.getFencedOperations()).map((entry) => entry.id)).toEqual([operation.id]);
    });

    it('accumulates fenced operations across rotations without erasing the journal', async () => {
        const first = await admission.activateWorker('worker-1');
        const opA = await admission.admit(first, { command: 'run', containerName: 'airdd2-a' });
        await admission.settle(opA, 'unknown');
        await admission.closeWorker(first);
        const second = await admission.activateWorker('worker-2');

        const opB = await admission.admit(second, { command: 'kill', containerName: 'airdd2-b' });
        await admission.settle(opB, 'unknown');
        await admission.closeWorker(second);
        await admission.activateWorker('worker-3');

        const fenced = await admission.getFencedOperations();
        expect(fenced.map((entry) => entry.id).sort()).toEqual([opA.id, opB.id].sort());
        expect(fenced.every((entry) => entry.fenceKind === 'auto_epoch_rotation')).toBe(true);
        expect(await admission.getPendingOperations()).toEqual([]);
    });

    it('refuses operation settlement for a non-pending operation', async () => {
        const epoch = await admission.activateWorker('worker-1');
        await expect(admission.settle({ id: randomUUID(), epoch: epoch.epoch }, 'effects_quiescent'))
            .rejects.toThrow('not in flight');
    });
});
