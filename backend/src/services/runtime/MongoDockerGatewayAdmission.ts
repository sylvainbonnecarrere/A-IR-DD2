import { createHash, randomUUID } from 'crypto';
import mongoose from 'mongoose';
import {
    type DockerGatewayAdmissionPort,
    type DockerGatewayEpoch,
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
        const result = await this.collection().updateOne(
            {
                _id: GATEWAY_STATE_ID,
                admissionClosed: true,
                pendingOperation: null,
            },
            [
                { $set: { epoch: { $add: ['$epoch', 1] } } },
                {
                    $set: {
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
            const state = await this.readState();
            if (state.pendingOperation?.state === 'in_flight') {
                throw new Error('Docker gateway worker activation blocked: a Docker operation is still in flight');
            }
            throw new Error('Docker gateway cannot activate a worker while admission is open or an operation requires reconciliation');
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
