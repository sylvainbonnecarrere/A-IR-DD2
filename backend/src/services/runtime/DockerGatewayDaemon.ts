import type {
    DockerGatewayAdmissionPort,
    DockerGatewayOperation,
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
}

export class DockerGatewayDaemon {
    private started = false;

    constructor(private readonly options: DockerGatewayDaemonOptions) {}

    async start(): Promise<void> {
        if (this.started) throw new Error('Docker gateway daemon is already started');

        const pending = await this.options.admission.recoverAfterRestart();
        const unresolved: string[] = [];
        for (const operation of pending) {
            if (!this.options.quiescenceVerifier
                || !await this.options.admission.reconcileUnknown(operation.id, this.options.quiescenceVerifier)) {
                unresolved.push(operation.id);
            }
        }
        if (unresolved.length > 0) {
            const ids = unresolved.join(', ');
            throw new Error(`Docker gateway startup blocked: operations require quiescence reconciliation (${ids})`);
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
