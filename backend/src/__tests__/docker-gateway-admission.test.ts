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

    it('fences an unresolved operation automatically at epoch rotation and reopens admission', () => {
        const gateway = new DockerGatewayAdmission();
        const previous = gateway.activateWorker('worker-1');
        const operation = gateway.admit(previous, { command: 'run', containerName: 'airdd2-attempt' });
        gateway.closeWorker(previous);

        // Nouveau contrat US-J7-05 : plus de blocage global, fencing auto + réouverture.
        const current = gateway.activateWorker('worker-2');
        expect(current.epoch).toBe(previous.epoch + 1);

        expect(gateway.getPendingOperations()).toEqual([]);
        const fenced = gateway.getFencedOperations();
        expect(fenced).toHaveLength(1);
        expect(fenced[0]).toMatchObject({
            id: operation.id,
            epoch: previous.epoch,
            fenceKind: 'auto_epoch_rotation',
            quiescenceProven: false,
            nameReservation: { containerName: 'airdd2-attempt', reserved: false },
        });
        expect(fenced[0].effect).toEqual({ command: 'run', containerName: 'airdd2-attempt' });

        expect(() => gateway.admit(previous)).toThrow('stale or invalid worker epoch');
        expect(gateway.admit(current)).toMatchObject({ epoch: current.epoch });
    });

    it('serializes admission to a single pending operation (two workers cannot execute concurrently)', () => {
        const gateway = new DockerGatewayAdmission();
        const epoch = gateway.activateWorker('worker-1');

        const first = gateway.admit(epoch);
        expect(() => gateway.admit(epoch)).toThrow('pending Docker operation');

        gateway.settle(first, 'effects_quiescent');
        expect(gateway.admit(epoch)).toMatchObject({ epoch: epoch.epoch });
    });

    it('keeps an unknown operation pending until reconciliation, then fences it at activation', async () => {
        const gateway = new DockerGatewayAdmission();
        const previous = gateway.activateWorker('worker-1');
        const operation = gateway.admit(previous);
        gateway.settle(operation, 'unknown');
        gateway.closeWorker(previous);

        const verifier: DockerGatewayQuiescenceVerifier = { verify: jest.fn().mockResolvedValue(false) };
        await expect(gateway.reconcileUnknown(operation.id, verifier)).resolves.toBe(false);

        // Toujours pending (journal jamais effacé) tant qu'aucune epoch ne rotate.
        expect(gateway.getPendingOperations()).toEqual([operation]);
        expect(gateway.getFencedOperations()).toEqual([]);

        const current = gateway.activateWorker('worker-2');
        expect(current.epoch).toBe(previous.epoch + 1);
        expect(gateway.getPendingOperations()).toEqual([]);
        expect(gateway.getFencedOperations().map((fenced) => fenced.id)).toEqual([operation.id]);

        verifier.verify = jest.fn().mockResolvedValue(true);
        await expect(gateway.reconcileUnknown(operation.id, verifier)).rejects.toThrow('not awaiting reconciliation');
    });

    it('retains the unresolved operation when the quiescence verifier fails, then fences it at activation', async () => {
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

        // L'activation fence l'opération incertaine au lieu de bloquer l'admission.
        const next = gateway.activateWorker('worker-2');
        expect(next.epoch).toBe(epoch.epoch + 1);
        expect(gateway.getPendingOperations()).toEqual([]);
        expect(gateway.getFencedOperation(operation.id)).toMatchObject({
            id: operation.id,
            fenceKind: 'auto_epoch_rotation',
            quiescenceProven: false,
        });
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

    it('moves a pending unknown operation to fencedOperations with the requested fence kind', async () => {
        const gateway = new DockerGatewayAdmission();
        const epoch = gateway.activateWorker('worker-1');
        const operation = gateway.admit(epoch, { command: 'run', containerName: 'airdd2-attempt' });
        gateway.settle(operation, 'unknown');
        gateway.closeWorker(epoch);

        const fenced = await gateway.fencePendingOperation(operation.id, 'user_manual_reset');
        expect(fenced).toMatchObject({
            id: operation.id,
            fenceKind: 'user_manual_reset',
            quiescenceProven: false,
            nameReservation: { containerName: 'airdd2-attempt', reserved: false },
        });
        expect(gateway.getPendingOperations()).toEqual([]);
        expect(gateway.getFencedOperation(operation.id)?.id).toBe(operation.id);

        await expect(gateway.fencePendingOperation(operation.id, 'user_manual_reset'))
            .rejects.toThrow('not pending');
    });

    it('refuses to fence an in-flight operation of the active epoch', async () => {
        const gateway = new DockerGatewayAdmission();
        const epoch = gateway.activateWorker('worker-1');
        const operation = gateway.admit(epoch);

        await expect(gateway.fencePendingOperation(operation.id, 'user_manual_reset'))
            .rejects.toThrow('active epoch');

        expect(gateway.getPendingOperations()).toEqual([operation]);
    });

    it('records name reservation and quiescence proof on fenced operations without erasing them', async () => {
        const gateway = new DockerGatewayAdmission();
        const epoch = gateway.activateWorker('worker-1');
        const operation = gateway.admit(epoch, { command: 'kill', containerName: 'airdd2-attempt' });
        gateway.settle(operation, 'unknown');
        gateway.closeWorker(epoch);
        await gateway.fencePendingOperation(operation.id, 'auto_epoch_rotation');

        gateway.markNameReservation(operation.id, true);
        gateway.markQuiescenceProven(operation.id);

        expect(gateway.getFencedOperation(operation.id)).toMatchObject({
            nameReservation: { containerName: 'airdd2-attempt', reserved: true },
            quiescenceProven: true,
        });

        expect(() => gateway.markNameReservation('missing', true)).toThrow('not fenced');
        expect(() => gateway.markQuiescenceProven('missing')).toThrow('not fenced');
    });

    it('accumulates fenced operations without ever deleting the journal', () => {
        const gateway = new DockerGatewayAdmission();
        const first = gateway.activateWorker('worker-1');
        const opA = gateway.admit(first, { command: 'run', containerName: 'airdd2-a' });
        gateway.settle(opA, 'unknown');
        gateway.closeWorker(first);
        const second = gateway.activateWorker('worker-2');

        const opB = gateway.admit(second, { command: 'kill', containerName: 'airdd2-b' });
        gateway.settle(opB, 'unknown');
        gateway.closeWorker(second);
        gateway.activateWorker('worker-3');

        expect(gateway.getFencedOperations().map((fenced) => fenced.id).sort()).toEqual([opA.id, opB.id].sort());
        expect(gateway.getPendingOperations()).toEqual([]);
    });
});
