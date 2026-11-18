import { randomUUID } from 'crypto';

export interface DockerGatewayEpoch {
    workerId: string;
    epoch: number;
    token: string;
}

export interface DockerGatewayOperation {
    id: string;
    epoch: number;
    effect?: DockerGatewayOperationEffect;
}

export interface DockerGatewayOperationEffect {
    command: 'run' | 'kill';
    containerName: string;
    attemptId?: string;
}

export interface DockerGatewayQuiescenceVerifier {
    verify(operation: DockerGatewayOperation): Promise<boolean>;
}

export interface DockerGatewayAdmissionPort {
    activateWorker(workerId: string): DockerGatewayEpoch | Promise<DockerGatewayEpoch>;
    fenceAndActivateWorker(workerId: string): DockerGatewayEpoch | Promise<DockerGatewayEpoch>;
    admit(epoch: DockerGatewayEpoch, effect?: DockerGatewayOperationEffect): DockerGatewayOperation | Promise<DockerGatewayOperation>;
    settle(operation: DockerGatewayOperation, outcome: 'effects_quiescent' | 'unknown'): void | Promise<void>;
    reconcileInFlight(operation: DockerGatewayOperation, verifier: DockerGatewayQuiescenceVerifier): Promise<boolean>;
    closeWorker(epoch: DockerGatewayEpoch): void | Promise<void>;
    closeAdmission(): void | Promise<void>;
    reconcileUnknown(operationId: string, verifier: DockerGatewayQuiescenceVerifier): Promise<boolean>;
    getPendingOperations(): DockerGatewayOperation[] | Promise<DockerGatewayOperation[]>;
}

type OperationState = 'in_flight' | 'unknown' | 'reconciling';

interface PendingOperation extends DockerGatewayOperation {
    state: OperationState;
}

export class DockerGatewayAdmission implements DockerGatewayAdmissionPort {
    private epoch = 0;
    private activeEpoch: DockerGatewayEpoch | undefined;
    private activeEpochClosed = false;
    private readonly pendingOperations = new Map<string, PendingOperation>();

    activateWorker(workerId: string): DockerGatewayEpoch {
        if (!workerId.trim()) {
            throw new Error('Docker gateway worker identity is required');
        }
        if (this.activeEpoch && !this.activeEpochClosed) {
            throw new Error('Docker gateway already has an active worker epoch');
        }
        if (this.pendingOperations.size > 0) {
            throw new Error('Docker gateway cannot activate a worker while Docker operations require reconciliation');
        }

        this.epoch += 1;
        this.activeEpoch = { workerId, epoch: this.epoch, token: randomUUID() };
        this.activeEpochClosed = false;
        return { ...this.activeEpoch };
    }

    fenceAndActivateWorker(workerId: string): DockerGatewayEpoch {
        this.activeEpochClosed = true;
        return this.activateWorker(workerId);
    }

    admit(epoch: DockerGatewayEpoch, effect?: DockerGatewayOperationEffect): DockerGatewayOperation {
        this.assertActiveEpoch(epoch);
        if (this.activeEpochClosed) {
            throw new Error('Docker gateway worker epoch is closed');
        }

        const operation = { id: randomUUID(), epoch: epoch.epoch, ...(effect ? { effect } : {}) };
        this.pendingOperations.set(operation.id, { ...operation, state: 'in_flight' });
        return operation;
    }

    settle(operation: DockerGatewayOperation, outcome: 'effects_quiescent' | 'unknown'): void {
        const pending = this.pendingOperations.get(operation.id);
        if (!pending || pending.epoch !== operation.epoch || pending.state !== 'in_flight') {
            throw new Error('Docker gateway operation is not in flight');
        }

        if (outcome === 'effects_quiescent') {
            this.pendingOperations.delete(operation.id);
        } else {
            pending.state = 'unknown';
        }
    }

    async reconcileInFlight(
        operation: DockerGatewayOperation,
        verifier: DockerGatewayQuiescenceVerifier,
    ): Promise<boolean> {
        const pending = this.pendingOperations.get(operation.id);
        if (!pending || pending.epoch !== operation.epoch || pending.state !== 'in_flight') {
            throw new Error('Docker gateway operation is not in flight');
        }
        pending.state = 'reconciling';
        try {
            const quiescent = await verifier.verify({ ...pending });
            if (quiescent) {
                this.pendingOperations.delete(operation.id);
                return true;
            }
            pending.state = 'unknown';
            return false;
        } catch (error) {
            pending.state = 'unknown';
            throw error;
        }
    }

    closeWorker(epoch: DockerGatewayEpoch): void {
        this.assertActiveEpoch(epoch);
        this.activeEpochClosed = true;
    }

    closeAdmission(): void {
        this.activeEpochClosed = true;
        this.activeEpoch = undefined;
    }

    async reconcileUnknown(
        operationId: string,
        verifier: DockerGatewayQuiescenceVerifier,
    ): Promise<boolean> {
        const pending = this.pendingOperations.get(operationId);
        if (!pending || pending.state !== 'unknown') {
            throw new Error('Docker gateway operation is not awaiting reconciliation');
        }
        if (!this.activeEpochClosed) {
            throw new Error('Docker gateway must close the worker epoch before reconciliation');
        }

        pending.state = 'reconciling';
        try {
            const quiescent = await verifier.verify({
                id: pending.id,
                epoch: pending.epoch,
                ...(pending.effect ? { effect: pending.effect } : {}),
            });
            if (quiescent) {
                this.pendingOperations.delete(operationId);
                return true;
            }
            pending.state = 'unknown';
            return false;
        } catch (error) {
            pending.state = 'unknown';
            throw error;
        }
    }

    getPendingOperations(): DockerGatewayOperation[] {
        return Array.from(this.pendingOperations.values(), ({ id, epoch, effect }) => ({
            id,
            epoch,
            ...(effect ? { effect } : {}),
        }));
    }

    private assertActiveEpoch(epoch: DockerGatewayEpoch): void {
        if (!this.activeEpoch
            || epoch.epoch !== this.activeEpoch.epoch
            || epoch.workerId !== this.activeEpoch.workerId
            || epoch.token !== this.activeEpoch.token) {
            throw new Error('Docker gateway rejected a stale or invalid worker epoch');
        }
    }
}
