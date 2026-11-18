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

    it('restarts pending work as unknown and blocks activation until verified quiescent', async () => {
        const epoch = await admission.activateWorker('worker-1');
        const operation = await admission.admit(epoch);
        const restarted = new MongoDockerGatewayAdmission();

        expect(await restarted.recoverAfterRestart()).toEqual([operation]);
        await expect(restarted.activateWorker('worker-2')).rejects.toThrow('requires reconciliation');
        await expect(restarted.reconcileUnknown(operation.id, { verify: async () => false })).resolves.toBe(false);
        await expect(restarted.activateWorker('worker-2')).rejects.toThrow('requires reconciliation');
        await expect(restarted.reconcileUnknown(operation.id, { verify: async () => true })).resolves.toBe(true);

        const nextEpoch = await restarted.activateWorker('worker-2');
        expect(nextEpoch.epoch).toBe(epoch.epoch + 1);
    });

    it('keeps an unknown operation blocked when verification fails', async () => {
        const epoch = await admission.activateWorker('worker-1');
        const operation = await admission.admit(epoch);
        await admission.settle(operation, 'unknown');
        await admission.closeWorker(epoch);

        const restarted = new MongoDockerGatewayAdmission();
        await restarted.recoverAfterRestart();
        await expect(restarted.reconcileUnknown(operation.id, {
            verify: async () => { throw new Error('daemon unavailable'); },
        })).rejects.toThrow('daemon unavailable');
        expect(await restarted.getPendingOperations()).toEqual([operation]);
        await expect(restarted.activateWorker('worker-2')).rejects.toThrow('requires reconciliation');
    });

    it('does not open the gateway on restart for an uncertain run, even if the container is absent', async () => {
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

        await expect(daemon.start()).rejects.toThrow('operations require quiescence reconciliation');
        expect(server.listen).not.toHaveBeenCalled();
        expect(commandRunner.run).not.toHaveBeenCalled();
        expect(await restarted.getPendingOperations()).toEqual([operation]);
    });

    it('passes the persisted effect to the verifier after restart and retains it on failure', async () => {
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
        await expect(secondRestart.activateWorker('worker-2')).rejects.toThrow('requires reconciliation');
    });

    it('does not open the gateway on restart for an uncertain kill against a stopped container', async () => {
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

        await expect(daemon.start()).rejects.toThrow('operations require quiescence reconciliation');
        expect(server.listen).not.toHaveBeenCalled();
        expect(commandRunner.run).not.toHaveBeenCalled();
        expect(await restarted.getPendingOperations()).toEqual([operation]);
    });

    it('refuses operation settlement for a non-pending operation', async () => {
        const epoch = await admission.activateWorker('worker-1');
        await expect(admission.settle({ id: randomUUID(), epoch: epoch.epoch }, 'effects_quiescent'))
            .rejects.toThrow('not in flight');
    });
});
