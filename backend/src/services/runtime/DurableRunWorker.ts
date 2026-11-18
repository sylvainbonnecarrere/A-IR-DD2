import type { RunLease } from './MongoRunLeaseService';
import type { OrchestratedExecutionResult } from './execution.types';
import type { DeferredDispatch, QuarantinedDispatch } from './MonitoredRunDispatch';
import { isReconstructionRejectionCode } from '../../domain/execution/runReconstructionQuarantine';

export interface QueuedLeaseSource {
    claimQueued(owner: string): Promise<RunLease | null>;
    releaseQueued(lease: RunLease): Promise<boolean>;
}

export interface LeasedRunDispatch {
    dispatch(lease: RunLease): Promise<OrchestratedExecutionResult | QuarantinedDispatch | DeferredDispatch>;
}

export type DurableRunWorkerState = 'idle' | 'running' | 'stopping' | 'stopped' | 'failed';
export type DurableRunWorkerFailure = 'claim_failed' | 'release_failed' | 'dispatch_failed' | 'unexpected_dispatch_result';

export class DurableRunWorker {
    private state: DurableRunWorkerState = 'idle';
    private work?: Promise<void>;
    private timer?: ReturnType<typeof setTimeout>;
    private wake?: () => void;
    private failure?: DurableRunWorkerFailure;

    constructor(
        private readonly owner: string,
        private readonly leases: QueuedLeaseSource,
        private readonly dispatcher: LeasedRunDispatch,
        private readonly pollIntervalMs: number,
    ) {
        if (!owner.trim()) {
            throw new Error('Worker owner is required');
        }
        if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 1 || pollIntervalMs > 86_400_000) {
            throw new RangeError('Worker poll interval must be an integer between 1 and 86400000 milliseconds');
        }
    }

    getState(): DurableRunWorkerState {
        return this.state;
    }

    getFailure(): DurableRunWorkerFailure | undefined {
        return this.failure;
    }

    start(): void {
        if (this.state !== 'idle') {
            throw new Error('Worker can only be started once');
        }
        this.state = 'running';
        this.work = this.run();
    }

    async stop(): Promise<void> {
        if (this.state === 'idle') {
            this.state = 'stopped';
            return;
        }
        if (this.state === 'running') {
            this.state = 'stopping';
            this.wake?.();
        }
        await this.work;
    }

    private async run(): Promise<void> {
        let failure: DurableRunWorkerFailure = 'claim_failed';
        let executionId: string | undefined;
        try {
            while (this.state === 'running') {
                failure = 'claim_failed';
                executionId = undefined;
                const lease = await this.leases.claimQueued(this.owner);
                if (this.state !== 'running') {
                    if (lease) {
                        executionId = lease.executionId;
                        failure = 'release_failed';
                        if (!await this.leases.releaseQueued(lease)) {
                            throw new Error('Unstarted claim could not be released');
                        }
                    }
                    break;
                }
                if (lease) {
                    executionId = lease.executionId;
                    failure = 'dispatch_failed';
                    const result = await this.dispatcher.dispatch(lease);
                    if ('kind' in result && result.kind === 'quarantined'
                        && result.executionId === lease.executionId && isReconstructionRejectionCode(result.code)) {
                        continue;
                    }
                    if ('kind' in result && result.kind === 'deferred' && result.executionId === lease.executionId) {
                        await this.waitForPoll();
                        continue;
                    }
                    if (result.executionId === lease.executionId && 'status' in result && result.status === 'running') {
                        continue;
                    }
                    if (result.executionId !== lease.executionId
                        || !('status' in result) || !result.status
                        || !['completed', 'failed', 'stopped', 'timed_out'].includes(result.status)) {
                        failure = 'unexpected_dispatch_result';
                        throw new Error('Dispatch did not return a terminal outcome for the claimed run');
                    }
                } else {
                    await this.waitForPoll();
                }
            }
            this.state = 'stopped';
        } catch (error) {
            this.failure = failure;
            this.state = 'failed';
            console.error('[DurableRunWorker] Worker stopped after an error', {
                failure,
                executionId,
                errorType: error instanceof Error ? error.name : 'UnknownError',
            });
        }
    }

    private waitForPoll(): Promise<void> {
        if (this.state !== 'running') {
            return Promise.resolve();
        }
        return new Promise((resolve) => {
            this.wake = () => {
                if (this.timer) {
                    clearTimeout(this.timer);
                    this.timer = undefined;
                }
                this.wake = undefined;
                resolve();
            };
            this.timer = setTimeout(this.wake, this.pollIntervalMs);
        });
    }
}
