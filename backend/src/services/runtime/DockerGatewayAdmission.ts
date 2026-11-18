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

export type DockerGatewayFenceKind =
    | 'auto_epoch_rotation'
    | 'user_manual_reset'
    | 'agent_auto_recovery'
    | 'admin_maintenance';

export interface DockerGatewayNameReservation {
    containerName: string;
    reserved: boolean;
}

export interface DockerGatewayFencedOperation {
    id: string;
    epoch: number;
    effect?: DockerGatewayOperationEffect;
    fencedAt: Date;
    fenceKind: DockerGatewayFenceKind;
    nameReservation: DockerGatewayNameReservation | null;
    quiescenceProven: boolean;
}

export interface DockerGatewayFenceResult {
    fenced: boolean;
    nameReserved: boolean;
    quiescent: boolean;
    observed: string[];
}

export interface DockerGatewayQuiescenceVerifier {
    verify(operation: DockerGatewayOperation): Promise<boolean>;
}

export interface DockerGatewayOperationFencer {
    fence(operation: DockerGatewayOperation, fenced: DockerGatewayFencedOperation): Promise<DockerGatewayFenceResult>;
    verifyFenced(operation: DockerGatewayOperation, fenced: DockerGatewayFencedOperation): Promise<boolean>;
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
    getFencedOperations(): DockerGatewayFencedOperation[] | Promise<DockerGatewayFencedOperation[]>;
    getFencedOperation(operationId: string): DockerGatewayFencedOperation | null | Promise<DockerGatewayFencedOperation | null>;
    fencePendingOperation(operationId: string, fenceKind: DockerGatewayFenceKind): Promise<DockerGatewayFencedOperation>;
    markNameReservation(operationId: string, reserved: boolean): void | Promise<void>;
    markQuiescenceProven(operationId: string): void | Promise<void>;
}

type OperationState = 'in_flight' | 'unknown' | 'reconciling';

interface PendingOperation extends DockerGatewayOperation {
    state: OperationState;
}

function toFencedOperation(pending: PendingOperation, fenceKind: DockerGatewayFenceKind): DockerGatewayFencedOperation {
    return {
        id: pending.id,
        epoch: pending.epoch,
        ...(pending.effect ? { effect: pending.effect } : {}),
        fencedAt: new Date(),
        fenceKind,
        nameReservation: pending.effect
            ? { containerName: pending.effect.containerName, reserved: false }
            : null,
        quiescenceProven: false,
    };
}

export class DockerGatewayAdmission implements DockerGatewayAdmissionPort {
    private epoch = 0;
    private activeEpoch: DockerGatewayEpoch | undefined;
    private activeEpochClosed = false;
    private readonly pendingOperations = new Map<string, PendingOperation>();
    private readonly fencedOperations = new Map<string, DockerGatewayFencedOperation>();

    activateWorker(workerId: string): DockerGatewayEpoch {
        if (!workerId.trim()) {
            throw new Error('Docker gateway worker identity is required');
        }
        if (this.activeEpoch && !this.activeEpochClosed) {
            throw new Error('Docker gateway already has an active worker epoch');
        }

        // Fencing automatique : toute opération en attente de l'ancienne epoch est
        // confinée dans fencedOperations (sans prétendre prouver la quiescence) et
        // l'admission rouvre immédiatement.
        for (const pending of this.pendingOperations.values()) {
            this.fencedOperations.set(pending.id, toFencedOperation(pending, 'auto_epoch_rotation'));
        }
        this.pendingOperations.clear();

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
        if (this.pendingOperations.size > 0) {
            throw new Error('Docker gateway already has a pending Docker operation');
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

    getFencedOperations(): DockerGatewayFencedOperation[] {
        return Array.from(this.fencedOperations.values(), (fenced) => ({ ...fenced }));
    }

    getFencedOperation(operationId: string): DockerGatewayFencedOperation | null {
        const fenced = this.fencedOperations.get(operationId);
        return fenced ? { ...fenced } : null;
    }

    async fencePendingOperation(operationId: string, fenceKind: DockerGatewayFenceKind): Promise<DockerGatewayFencedOperation> {
        const pending = this.pendingOperations.get(operationId);
        if (!pending || (pending.state !== 'unknown' && pending.state !== 'in_flight')) {
            throw new Error('Docker gateway operation is not pending');
        }
        if (pending.state === 'in_flight' && !this.activeEpochClosed) {
            throw new Error('Docker gateway cannot fence an in-flight operation of the active epoch');
        }
        const fenced = toFencedOperation(pending, fenceKind);
        this.pendingOperations.delete(operationId);
        this.fencedOperations.set(operationId, fenced);
        return { ...fenced };
    }

    markNameReservation(operationId: string, reserved: boolean): void {
        const fenced = this.fencedOperations.get(operationId);
        if (!fenced) {
            throw new Error('Docker gateway operation is not fenced');
        }
        if (!fenced.nameReservation) {
            if (!fenced.effect) {
                throw new Error('Docker gateway fenced operation has no name to reserve');
            }
            fenced.nameReservation = { containerName: fenced.effect.containerName, reserved };
        } else {
            fenced.nameReservation.reserved = reserved;
        }
    }

    markQuiescenceProven(operationId: string): void {
        const fenced = this.fencedOperations.get(operationId);
        if (!fenced) {
            throw new Error('Docker gateway operation is not fenced');
        }
        fenced.quiescenceProven = true;
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
