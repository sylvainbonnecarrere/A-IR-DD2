import type {
    DockerGatewayAdmissionPort,
    DockerGatewayOperation,
    DockerGatewayOperationFencer,
    DockerGatewayQuiescenceVerifier,
} from './DockerGatewayAdmission';

export interface DockerGatewayServerPort {
    listen(): Promise<void>;
    close(): Promise<void>;
}

export interface DockerGatewayRestartAdmission extends DockerGatewayAdmissionPort {
    recoverAfterRestart(): Promise<DockerGatewayOperation[]>;
}

export interface DockerGatewayDaemonOptions {
    admission: DockerGatewayRestartAdmission;
    server: DockerGatewayServerPort;
    quiescenceVerifier?: DockerGatewayQuiescenceVerifier;
    fencer?: DockerGatewayOperationFencer;
}

export class DockerGatewayDaemon {
    private started = false;

    constructor(private readonly options: DockerGatewayDaemonOptions) {}

    async start(): Promise<void> {
        if (this.started) throw new Error('Docker gateway daemon is already started');

        // Une opération incertaine de l'ancienne epoch ne bloque plus jamais l'ouverture
        // du socket : elle est fencée (confinée dans fencedOperations, réservation de nom
        // best-effort journalisée) et l'admission rouvrira à la prochaine activation d'epoch.
        const pending = await this.options.admission.recoverAfterRestart();
        for (const operation of pending) {
            try {
                const fenced = await this.options.admission.fencePendingOperation(operation.id, 'auto_epoch_rotation');
                if (this.options.fencer) {
                    const result = await this.options.fencer.fence(operation, fenced);
                    await this.options.admission.markNameReservation(operation.id, result.nameReserved);
                    if (result.quiescent) {
                        await this.options.admission.markQuiescenceProven(operation.id);
                    }
                }
            } catch {
                // Best-effort : l'opération reste journalisée ; le socket doit s'ouvrir quoi qu'il arrive.
            }
        }

        await this.options.server.listen();
        this.started = true;
    }

    async stop(): Promise<void> {
        if (!this.started) return;
        this.started = false;
        let closeError: unknown;

        try {
            await this.options.admission.closeAdmission();
        } catch (error) {
            closeError = error;
        }
        try {
            await this.options.server.close();
        } catch (error) {
            closeError = closeError
                ? new Error(`${describeError(closeError)}; ${describeError(error)}`)
                : error;
        }
        if (closeError) throw closeError;
    }
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
