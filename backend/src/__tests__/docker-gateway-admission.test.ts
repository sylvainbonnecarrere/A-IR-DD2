import {
    DockerGatewayAdmission,
    type DockerGatewayQuiescenceVerifier,
} from '../services/runtime/DockerGatewayAdmission';

describe('DockerGatewayAdmission', () => {
    it('fences the previous worker epoch after closing it', () => {
        const gateway = new DockerGatewayAdmission();
        const previous = gateway.activateWorker('worker-1');
        gateway.closeWorker(previous);
        const current = gateway.activateWorker('worker-2');

        expect(current.epoch).toBe(previous.epoch + 1);
        expect(current.token).not.toBe(previous.token);
        expect(() => gateway.admit(previous)).toThrow('stale or invalid worker epoch');
        expect(gateway.admit(current)).toMatchObject({ epoch: current.epoch });
    });

    it('does not promote a new worker while an admitted Docker operation is unresolved', () => {
        const gateway = new DockerGatewayAdmission();
        const previous = gateway.activateWorker('worker-1');
        const operation = gateway.admit(previous);
        gateway.closeWorker(previous);

        expect(() => gateway.activateWorker('worker-2')).toThrow('require reconciliation');
        expect(() => gateway.admit(previous)).toThrow('epoch is closed');

        gateway.settle(operation, 'effects_quiescent');
        expect(gateway.activateWorker('worker-2').epoch).toBe(previous.epoch + 1);
    });

    it('keeps an unknown operation fenced until quiescence is verified', async () => {
        const gateway = new DockerGatewayAdmission();
        const previous = gateway.activateWorker('worker-1');
        const operation = gateway.admit(previous);
        gateway.settle(operation, 'unknown');
        gateway.closeWorker(previous);

        const verifier: DockerGatewayQuiescenceVerifier = { verify: jest.fn().mockResolvedValue(false) };
        await expect(gateway.reconcileUnknown(operation.id, verifier)).resolves.toBe(false);
        expect(() => gateway.activateWorker('worker-2')).toThrow('require reconciliation');

        verifier.verify = jest.fn().mockResolvedValue(true);
        await expect(gateway.reconcileUnknown(operation.id, verifier)).resolves.toBe(true);
        expect(gateway.getPendingOperations()).toEqual([]);
        expect(gateway.activateWorker('worker-2').epoch).toBe(previous.epoch + 1);
    });

    it('retains the unresolved operation when the quiescence verifier fails', async () => {
        const gateway = new DockerGatewayAdmission();
        const epoch = gateway.activateWorker('worker-1');
        const operation = gateway.admit(epoch);
        gateway.settle(operation, 'unknown');
        gateway.closeWorker(epoch);
        const verifierError = new Error('Docker daemon is unavailable');

        await expect(gateway.reconcileUnknown(operation.id, {
            verify: jest.fn().mockRejectedValue(verifierError),
        })).rejects.toBe(verifierError);

        expect(gateway.getPendingOperations()).toEqual([operation]);
        expect(() => gateway.activateWorker('worker-2')).toThrow('require reconciliation');
    });

    it('requires an epoch to be closed before reconciling uncertain operations', async () => {
        const gateway = new DockerGatewayAdmission();
        const epoch = gateway.activateWorker('worker-1');
        const operation = gateway.admit(epoch);
        gateway.settle(operation, 'unknown');

        await expect(gateway.reconcileUnknown(operation.id, { verify: jest.fn() }))
            .rejects.toThrow('close the worker epoch');
    });

    it('passes the complete admitted effect to the verifier of an unknown operation', async () => {
        const gateway = new DockerGatewayAdmission();
        const epoch = gateway.activateWorker('worker-1');
        const operation = gateway.admit(epoch, { command: 'run', containerName: 'airdd2-attempt' });
        gateway.settle(operation, 'unknown');
        gateway.closeWorker(epoch);
        const verify = jest.fn().mockResolvedValue(false);

        await expect(gateway.reconcileUnknown(operation.id, { verify })).resolves.toBe(false);
        expect(verify).toHaveBeenCalledWith(operation);
        expect(gateway.getPendingOperations()).toEqual([operation]);
    });
});
