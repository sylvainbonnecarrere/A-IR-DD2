import { DockerGatewayDaemon } from '../services/runtime/DockerGatewayDaemon';

import type { DockerGatewayFenceKind, DockerGatewayOperation } from '../services/runtime/DockerGatewayAdmission';

import type { DockerGatewayRestartAdmission, DockerGatewayServerPort } from '../services/runtime/DockerGatewayDaemon';

describe('Docker gateway daemon lifecycle', () => {

    function createAdmission(pending: DockerGatewayOperation[] = [], events: string[] = []) {
        const admission: DockerGatewayRestartAdmission = {
            recoverAfterRestart: jest.fn().mockResolvedValue(pending),
            activateWorker: jest.fn(),
            fenceAndActivateWorker: jest.fn(),
            admit: jest.fn(),
            settle: jest.fn(),
            reconcileInFlight: jest.fn(),
            closeWorker: jest.fn(),
            closeAdmission: jest.fn().mockImplementation(async () => { events.push('admission-closed'); }),
            reconcileUnknown: jest.fn(),
            getPendingOperations: jest.fn().mockResolvedValue([]),
            getFencedOperations: jest.fn().mockResolvedValue([]),
            getFencedOperation: jest.fn().mockResolvedValue(null),
            fencePendingOperation: jest.fn().mockImplementation(
                async (operationId: string, fenceKind: DockerGatewayFenceKind) => ({
                    id: operationId,
                    epoch: 1,
                    fencedAt: new Date(),
                    fenceKind,
                    nameReservation: null,
                    quiescenceProven: false,
                }),
            ),
            markNameReservation: jest.fn().mockResolvedValue(undefined),
            markQuiescenceProven: jest.fn().mockResolvedValue(undefined),
        };
        return admission;
    }

    function createServer(events: string[] = []) {
        const server: DockerGatewayServerPort = {
            listen: jest.fn().mockImplementation(async () => { events.push('listened'); }),
            close: jest.fn().mockImplementation(async () => { events.push('server-closed'); }),
        };
        return server;
    }

    it('opens the socket even when restart recovery finds uncertain Docker work (fenced, never blocking)', async () => {
        const operation = { id: 'uncertain-operation', epoch: 1 };
        const admission = createAdmission([operation]);
        const server = createServer();
        const daemon = new DockerGatewayDaemon({ admission, server });

        await daemon.start();

        expect(admission.recoverAfterRestart).toHaveBeenCalledTimes(1);
        expect(admission.fencePendingOperation).toHaveBeenCalledWith(operation.id, 'auto_epoch_rotation');
        expect(server.listen).toHaveBeenCalledTimes(1);
    });

    it('recovers durable state before listening and closes admission before shutdown', async () => {
        const events: string[] = [];
        const admission = createAdmission([], events);
        const server = createServer(events);
        const daemon = new DockerGatewayDaemon({ admission, server });

        await daemon.start();
        expect(events).toEqual(['listened']);

        await daemon.stop();
        expect(events).toEqual(['listened', 'admission-closed', 'server-closed']);
    });

    it('fences pending operations best-effort before opening the socket, without failing on fencer errors', async () => {
        const events: string[] = [];
        const operation: DockerGatewayOperation = {
            id: 'uncertain-operation',
            epoch: 1,
            effect: { command: 'kill', containerName: 'airdd2-attempt' },
        };
        const admission = createAdmission([operation], events);
        const server = createServer(events);
        const fencer = {
            fence: jest.fn().mockResolvedValue({ fenced: true, nameReserved: true, quiescent: true, observed: ['killed:abc'] }),
            verifyFenced: jest.fn().mockResolvedValue(true),
        };
        const daemon = new DockerGatewayDaemon({ admission, server, fencer });

        await daemon.start();

        expect(events).toEqual(['listened']);
        expect(fencer.fence).toHaveBeenCalledWith(
            operation,
            expect.objectContaining({ id: operation.id, fenceKind: 'auto_epoch_rotation' }),
        );
        expect(admission.markNameReservation).toHaveBeenCalledWith(operation.id, true);
        expect(admission.markQuiescenceProven).toHaveBeenCalledWith(operation.id);
    });

    it('still opens the socket when fencing the pending operation fails', async () => {
        const operation = { id: 'uncertain-operation', epoch: 1 };
        const admission = createAdmission([operation]);
        jest.mocked(admission.fencePendingOperation).mockRejectedValue(new Error('MongoDB unavailable'));
        const server = createServer();
        const daemon = new DockerGatewayDaemon({ admission, server });

        await daemon.start();

        expect(server.listen).toHaveBeenCalledTimes(1);
    });

    it('does not close the admission service if the socket cannot bind', async () => {
        const admission = createAdmission();
        const server = createServer();
        jest.mocked(server.listen).mockRejectedValue(new Error('socket unavailable'));
        const daemon = new DockerGatewayDaemon({ admission, server });

        await expect(daemon.start()).rejects.toThrow('socket unavailable');
        expect(admission.closeAdmission).not.toHaveBeenCalled();
    });
});
