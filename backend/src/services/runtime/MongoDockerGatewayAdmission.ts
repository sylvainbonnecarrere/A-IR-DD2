import { createHash, randomUUID } from 'crypto';

import mongoose from 'mongoose';

import {
    type DockerGatewayAdmissionPort,
    type DockerGatewayEpoch,
    type DockerGatewayFenceKind,
    type DockerGatewayFencedOperation,
    type DockerGatewayOperation,
    type DockerGatewayOperationEffect,
    type DockerGatewayQuiescenceVerifier,
} from './DockerGatewayAdmission';

const GATEWAY_STATE_ID = 'docker-gateway';

const DURABLE_WRITE = { w: 'majority' as const, wtimeoutMS: 10_000 };

interface GatewayWorker {
    workerId: string;
    epoch: number;
    tokenDigest: string;
}

interface GatewayOperation extends DockerGatewayOperation {
    state: 'in_flight' | 'unknown' | 'reconciling';
    effect?: DockerGatewayOperationEffect;
}

interface GatewayState {
    _id: string;
    epoch: number;
    activeWorker: GatewayWorker | null;
    admissionClosed: boolean;
    pendingOperation: GatewayOperation | null;
    fencedOperations: DockerGatewayFencedOperation[];
}

function fencedEntryFromPending(fenceKind: DockerGatewayFenceKind, fencedAt: Date): Record<string, unknown> {
    return {
        $mergeObjects: [
            { id: '$pendingOperation.id', epoch: '$pendingOperation.epoch' },
            {
                $cond: [
                    { $ifNull: ['$pendingOperation.effect', null] },
                    { effect: '$pendingOperation.effect' },
                    {},
                ],
            },
            {
                fencedAt: { $literal: fencedAt },
                fenceKind: { $literal: fenceKind },
                nameReservation: {
                    $cond: [
                        { $ifNull: ['$pendingOperation.effect', null] },
                        { containerName: '$pendingOperation.effect.containerName', reserved: false },
                        null,
                    ],
                },
                quiescenceProven: false,
            },
        ],
    };
}

export class MongoDockerGatewayAdmission implements DockerGatewayAdmissionPort {

    constructor(private readonly connection: mongoose.Connection = mongoose.connection) {}

    async recoverAfterRestart(): Promise<DockerGatewayOperation[]> {
        await this.ensureState();
        await this.collection().updateOne(
            { _id: GATEWAY_STATE_ID },
            [{
                $set: {
                    activeWorker: null,
                    admissionClosed: true,
                    pendingOperation: {
                        $cond: [
                            { $eq: [{ $ifNull: ['$pendingOperation', null] }, null] },
                            null,
                            { $mergeObjects: ['$pendingOperation', { state: 'unknown' }] },
                        ],
                    },
                },
            }],
            { writeConcern: DURABLE_WRITE },
        );
        return this.getPendingOperations();
    }

    async activateWorker(workerId: string): Promise<DockerGatewayEpoch> {
        if (!workerId.trim()) throw new Error('Docker gateway worker identity is required');

        await this.ensureState();

        const token = randomUUID();
        const tokenDigest = this.digest(token);
        const fencedAt = new Date();

        // Fencing automatique : une opération en attente de l'ancienne epoch est
        // déplacée dans fencedOperations (auto_epoch_rotation, sans preuve de
        // quiescence) et l'admission rouvre immédiatement.
        const result = await this.collection().updateOne(
            {
                _id: GATEWAY_STATE_ID,
                admissionClosed: true,
            },
            [
                { $set: { epoch: { $add: ['$epoch', 1] } } },
                {
                    $set: {
                        fencedOperations: {
                            $concatArrays: [
                                { $ifNull: ['$fencedOperations', []] },
                                {
                                    $cond: [
                                        { $ifNull: ['$pendingOperation', null] },
                                        [fencedEntryFromPending('auto_epoch_rotation', fencedAt)],
                                        [],
                                    ],
                                },
                            ],
                        },
                        pendingOperation: null,
                        activeWorker: {
                            workerId: { $literal: workerId },
                            epoch: '$epoch',
                            tokenDigest: { $literal: tokenDigest },
                        },
                        admissionClosed: false,
                    },
                },
            ],
            { writeConcern: DURABLE_WRITE },
        );

        if (result.modifiedCount !== 1) {
            throw new Error('Docker gateway cannot activate a worker while admission is open');
        }

        const state = await this.readState();
        if (!state.activeWorker || state.activeWorker.workerId !== workerId
            || state.activeWorker.tokenDigest !== tokenDigest) {
            throw new Error('Docker gateway worker activation could not be confirmed');
        }
        return { workerId, epoch: state.activeWorker.epoch, token };
    }

    async fenceAndActivateWorker(workerId: string): Promise<DockerGatewayEpoch> {
        if (!workerId.trim()) throw new Error('Docker gateway worker identity is required');

        await this.ensureState();

        await this.collection().updateOne(
            { _id: GATEWAY_STATE_ID, admissionClosed: false },
            { $set: { admissionClosed: true, activeWorker: null } },
            { writeConcern: DURABLE_WRITE },
        );

        return this.activateWorker(workerId);
    }

    async admit(epoch: DockerGatewayEpoch, effect?: DockerGatewayOperationEffect): Promise<DockerGatewayOperation> {
        this.validateEpoch(epoch);

        const operation = {
            id: randomUUID(),
            epoch: epoch.epoch,
            state: 'in_flight' as const,
            ...(effect ? { effect } : {}),
        };
        const result = await this.collection().updateOne(
            {
                _id: GATEWAY_STATE_ID,
                admissionClosed: false,
                'activeWorker.workerId': epoch.workerId,
                'activeWorker.epoch': epoch.epoch,
                'activeWorker.tokenDigest': this.digest(epoch.token),
                pendingOperation: null,
            },
            { $set: { pendingOperation: operation } },
            { writeConcern: DURABLE_WRITE },
        );

        if (result.modifiedCount !== 1) {
            throw new Error('Docker gateway rejected a stale worker epoch or an unresolved operation is pending');
        }

        return {
            id: operation.id,
            epoch: operation.epoch,
            ...(operation.effect ? { effect: operation.effect } : {}),
        };
    }

    async settle(operation: DockerGatewayOperation, outcome: 'effects_quiescent' | 'unknown'): Promise<void> {
        const result = await this.collection().updateOne(
            {
                _id: GATEWAY_STATE_ID,
                'pendingOperation.id': operation.id,
                'pendingOperation.epoch': operation.epoch,
                'pendingOperation.state': 'in_flight',
            },
            {
                $set: {
                    pendingOperation: outcome === 'unknown'
                        ? { ...operation, state: 'unknown' }
                        : null,
                },
            },
            { writeConcern: DURABLE_WRITE },
        );
        if (result.modifiedCount !== 1) throw new Error('Docker gateway operation is not in flight');
    }

    async reconcileInFlight(
        operation: DockerGatewayOperation,
        verifier: DockerGatewayQuiescenceVerifier,
    ): Promise<boolean> {
        const claimed = await this.collection().updateOne(
            {
                _id: GATEWAY_STATE_ID,
                'pendingOperation.id': operation.id,
                'pendingOperation.epoch': operation.epoch,
                'pendingOperation.state': 'in_flight',
            },
            { $set: { 'pendingOperation.state': 'reconciling' } },
            { writeConcern: DURABLE_WRITE },
        );
        if (claimed.modifiedCount !== 1) throw new Error('Docker gateway operation is not in flight');

        const state = await this.readState();
        const pending = state.pendingOperation;
        if (!pending || pending.id !== operation.id || pending.state !== 'reconciling') {
            throw new Error('Docker gateway reconciliation claim could not be confirmed');
        }
        let quiescent: boolean;
        try {
            quiescent = await verifier.verify({
                id: pending.id,
                epoch: pending.epoch,
                ...(pending.effect ? { effect: pending.effect } : {}),
            });
        } catch (error) {
            await this.restoreInFlight(operation.id);
            throw error;
        }
        const settled = await this.collection().updateOne(
            {
                _id: GATEWAY_STATE_ID,
                'pendingOperation.id': operation.id,
                'pendingOperation.state': 'reconciling',
            },
            { $set: { pendingOperation: quiescent ? null : { ...pending, state: 'unknown' } } },
            { writeConcern: DURABLE_WRITE },
        );

        if (settled.modifiedCount !== 1) {
            throw new Error('Docker gateway reconciliation state changed unexpectedly');
        }
        return quiescent;
    }

    async closeWorker(epoch: DockerGatewayEpoch): Promise<void> {
        this.validateEpoch(epoch);

        const result = await this.collection().updateOne(
            {
                _id: GATEWAY_STATE_ID,
                admissionClosed: false,
                'activeWorker.workerId': epoch.workerId,
                'activeWorker.epoch': epoch.epoch,
                'activeWorker.tokenDigest': this.digest(epoch.token),
            },
            { $set: { admissionClosed: true, activeWorker: null } },
            { writeConcern: DURABLE_WRITE },
        );
        if (result.modifiedCount !== 1) throw new Error('Docker gateway worker epoch is no longer active');

    }

    async closeAdmission(): Promise<void> {
        await this.ensureState();
        await this.collection().updateOne(
            { _id: GATEWAY_STATE_ID },
            { $set: { admissionClosed: true, activeWorker: null } },
            { writeConcern: DURABLE_WRITE },
        );
    }

    async reconcileUnknown(
        operationId: string,
        verifier: DockerGatewayQuiescenceVerifier,
    ): Promise<boolean> {
        const claimed = await this.collection().updateOne(
            {
                _id: GATEWAY_STATE_ID,
                admissionClosed: true,
                'pendingOperation.id': operationId,
                'pendingOperation.state': 'unknown',
            },
            { $set: { 'pendingOperation.state': 'reconciling' } },
            { writeConcern: DURABLE_WRITE },
        );
        if (claimed.modifiedCount !== 1) {
            throw new Error('Docker gateway operation is not awaiting reconciliation');
        }

        const state = await this.readState();
        const pending = state.pendingOperation;
        if (!pending || pending.id !== operationId || pending.state !== 'reconciling') {
            throw new Error('Docker gateway reconciliation claim could not be confirmed');
        }

        let quiescent: boolean;
        try {
            quiescent = await verifier.verify({
                id: pending.id,
                epoch: pending.epoch,
                ...(pending.effect ? { effect: pending.effect } : {}),
            });
        } catch (error) {
            await this.restoreUnknown(operationId);
            throw error;
        }

        const settled = await this.collection().updateOne(
            {
                _id: GATEWAY_STATE_ID,
                admissionClosed: true,
                'pendingOperation.id': operationId,
                'pendingOperation.state': 'reconciling',
            },
            {
                $set: {
                    pendingOperation: quiescent ? null : { ...pending, state: 'unknown' },
                },
            },
            { writeConcern: DURABLE_WRITE },
        );
        if (settled.modifiedCount !== 1) {
            throw new Error('Docker gateway reconciliation state changed unexpectedly');
        }
        return quiescent;
    }

    async getPendingOperations(): Promise<DockerGatewayOperation[]> {
        const pending = (await this.readState()).pendingOperation;
        return pending
            ? [{ id: pending.id, epoch: pending.epoch, ...(pending.effect ? { effect: pending.effect } : {}) }]
            : [];
    }

    async getFencedOperations(): Promise<DockerGatewayFencedOperation[]> {
        const state = await this.readState();
        return (state.fencedOperations ?? []).map((fenced) => ({ ...fenced }));
    }

    async getFencedOperation(operationId: string): Promise<DockerGatewayFencedOperation | null> {
        const fenced = (await this.getFencedOperations()).find((entry) => entry.id === operationId);
        return fenced ?? null;
    }

    async fencePendingOperation(operationId: string, fenceKind: DockerGatewayFenceKind): Promise<DockerGatewayFencedOperation> {
        const state = await this.readState();
        const pending = state.pendingOperation;
        if (!pending || pending.id !== operationId
            || (pending.state !== 'unknown' && pending.state !== 'in_flight')) {
            throw new Error('Docker gateway operation is not pending');
        }
        if (pending.state === 'in_flight' && !state.admissionClosed) {
            throw new Error('Docker gateway cannot fence an in-flight operation of the active epoch');
        }

        const result = await this.collection().updateOne(
            {
                _id: GATEWAY_STATE_ID,
                'pendingOperation.id': operationId,
                'pendingOperation.state': pending.state,
            },
            [{
                $set: {
                    fencedOperations: {
                        $concatArrays: [
                            { $ifNull: ['$fencedOperations', []] },
                            [fencedEntryFromPending(fenceKind, new Date())],
                        ],
                    },
                    pendingOperation: null,
                },
            }],
            { writeConcern: DURABLE_WRITE },
        );
        if (result.modifiedCount !== 1) {
            throw new Error('Docker gateway operation state changed unexpectedly while fencing');
        }
        const fenced = await this.getFencedOperation(operationId);
        if (!fenced) throw new Error('Docker gateway fenced operation could not be read back');
        return fenced;
    }

    async markNameReservation(operationId: string, reserved: boolean): Promise<void> {
        const fenced = await this.getFencedOperation(operationId);
        if (!fenced) throw new Error('Docker gateway operation is not fenced');
        const containerName = fenced.nameReservation?.containerName ?? fenced.effect?.containerName;
        if (!containerName) throw new Error('Docker gateway fenced operation has no name to reserve');

        const result = await this.collection().updateOne(
            { _id: GATEWAY_STATE_ID, 'fencedOperations.id': operationId },
            { $set: { 'fencedOperations.$.nameReservation': { containerName, reserved } } },
            { writeConcern: DURABLE_WRITE },
        );
        if (result.matchedCount !== 1) throw new Error('Docker gateway operation is not fenced');
    }

    async markQuiescenceProven(operationId: string): Promise<void> {
        const result = await this.collection().updateOne(
            { _id: GATEWAY_STATE_ID, 'fencedOperations.id': operationId },
            { $set: { 'fencedOperations.$.quiescenceProven': true } },
            { writeConcern: DURABLE_WRITE },
        );
        if (result.matchedCount !== 1) throw new Error('Docker gateway operation is not fenced');
    }

    private async restoreUnknown(operationId: string): Promise<void> {
        await this.collection().updateOne(
            {
                _id: GATEWAY_STATE_ID,
                'pendingOperation.id': operationId,
                'pendingOperation.state': 'reconciling',
            },
            { $set: { 'pendingOperation.state': 'unknown' } },
            { writeConcern: DURABLE_WRITE },
        );
    }

    private async restoreInFlight(operationId: string): Promise<void> {
        await this.collection().updateOne(
            {
                _id: GATEWAY_STATE_ID,
                'pendingOperation.id': operationId,
                'pendingOperation.state': 'reconciling',
            },
            { $set: { 'pendingOperation.state': 'in_flight' } },
            { writeConcern: DURABLE_WRITE },
        );
    }

    private async ensureState(): Promise<void> {
        await this.collection().updateOne(
            { _id: GATEWAY_STATE_ID },
            {
                $setOnInsert: {
                    epoch: 0,
                    activeWorker: null,
                    admissionClosed: true,
                    pendingOperation: null,
                    fencedOperations: [],
                },
            },
            { upsert: true, writeConcern: DURABLE_WRITE },
        );
    }

    private async readState(): Promise<GatewayState> {
        const state = await this.collection().findOne(
            { _id: GATEWAY_STATE_ID },
            { readConcern: { level: 'majority' } },
        );
        if (!state) throw new Error('Docker gateway state is not initialized');
        return state;
    }

    private validateEpoch(epoch: DockerGatewayEpoch): void {
        if (!epoch.workerId.trim() || !Number.isSafeInteger(epoch.epoch) || epoch.epoch < 1 || !epoch.token.trim()) {
            throw new Error('Docker gateway worker epoch is invalid');
        }
    }

    private digest(token: string): string {
        return createHash('sha256').update(token).digest('hex');
    }

    private collection() {
        if (this.connection.readyState !== 1 || !this.connection.db) {
            throw new Error('MongoDB must be connected to coordinate Docker gateway admission');
        }
        return this.connection.db.collection<GatewayState>('docker_gateway_state');
    }
}
