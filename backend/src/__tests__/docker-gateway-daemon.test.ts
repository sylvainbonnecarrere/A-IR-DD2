import { DockerGatewayDaemon } from '../services/runtime/DockerGatewayDaemon';
import type { DockerGatewayOperation } from '../services/runtime/DockerGatewayAdmission';
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

    it('does not listen when restart recovery finds uncertain Docker work', async () => {
        const operation = { id: 'uncertain-operation', epoch: 1 };
        const admission = createAdmission([operation]);
        const server = createServer();
        const daemon = new DockerGatewayDaemon({ admission, server });

        await expect(daemon.start()).rejects.toThrow('operations require quiescence reconciliation');

        expect(admission.recoverAfterRestart).toHaveBeenCalledTimes(1);
        expect(server.listen).not.toHaveBeenCalled();
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

    it('reconciles pending operations before opening the socket', async () => {
        const events: string[] = [];
        const operation: DockerGatewayOperation = {
            id: 'uncertain-operation',
            epoch: 1,
            effect: { command: 'kill', containerName: 'airdd2-attempt' },
        };
        const admission = createAdmission([operation], events);
        jest.mocked(admission.reconcileUnknown).mockImplementation(async () => {
            events.push('reconciled');
            return true;
        });
        const server = createServer(events);
        const daemon = new DockerGatewayDaemon({
            admission,
            server,
            quiescenceVerifier: { verify: jest.fn().mockResolvedValue(true) },
        });

        await daemon.start();

        expect(events).toEqual(['reconciled', 'listened']);
        expect(admission.reconcileUnknown).toHaveBeenCalledWith(
            operation.id,
            expect.objectContaining({ verify: expect.any(Function) }),
        );
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
