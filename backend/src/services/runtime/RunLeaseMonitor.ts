import type { RunLease, RunLeaseObservation } from './MongoRunLeaseService';

export interface RunLeaseObserver {
    renewAndObserve(lease: RunLease): Promise<RunLeaseObservation>;
}

export type RunLeaseMonitorState =
    | 'idle'
    | 'active'
    | 'cancellation_requested'
    | 'lease_lost'
    | 'observation_failed'
    | 'stopped';

export class RunLeaseMonitor {
    private readonly controller = new AbortController();
    private state: RunLeaseMonitorState = 'idle';
    private timer?: ReturnType<typeof setTimeout>;
    private inFlight?: Promise<void>;

    constructor(
        private readonly observer: RunLeaseObserver,
        private lease: RunLease,
        private readonly intervalMs: number,
        private readonly timeoutMs: number,
        leaseDurationMs: number,
    ) {
        if (!Number.isSafeInteger(intervalMs) || intervalMs < 1
            || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1
            || !Number.isSafeInteger(leaseDurationMs) || leaseDurationMs < 1000
            || leaseDurationMs > 86_400_000
            || intervalMs + timeoutMs >= leaseDurationMs) {
            throw new RangeError('Lease monitor interval and timeout must fit within the lease duration');
        }
    }

    get signal(): AbortSignal {
        return this.controller.signal;
    }

    getState(): RunLeaseMonitorState {
        return this.state;
    }

    async start(): Promise<void> {
        if (this.state !== 'idle') {
            throw new Error('Lease monitor can only be started once');
        }
        this.state = 'active';
        await this.check();
    }

    async stop(): Promise<void> {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
        if (this.state === 'active' || this.state === 'idle') {
            this.state = 'stopped';
        }
        await this.inFlight;
    }

    private async check(): Promise<void> {
        const work = this.observe();
        this.inFlight = work;
        try {
            await work;
        } finally {
            if (this.inFlight === work) {
                this.inFlight = undefined;
            }
        }
        if (this.state === 'active') {
            this.timer = setTimeout(() => {
                this.timer = undefined;
                void this.check();
            }, this.intervalMs);
        }
    }

    private async observe(): Promise<void> {
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
            const observation = await Promise.race([
                this.observer.renewAndObserve(this.lease),
                new Promise<never>((_, reject) => {
                    timeout = setTimeout(() => reject(new Error('Lease observation timed out')), this.timeoutMs);
                }),
            ]);
            if (this.state !== 'active') {
                return;
            }
            if (observation.kind === 'lost') {
                this.state = 'lease_lost';
                this.controller.abort();
            } else if (observation.kind === 'cancellation_requested') {
                this.lease = observation.lease;
                this.state = 'cancellation_requested';
                this.controller.abort();
            } else {
                this.lease = observation.lease;
            }
        } catch (error) {
            if (this.state === 'active') {
                this.state = 'observation_failed';
                console.error('[RunLeaseMonitor] Lease observation failed', {
                    executionId: this.lease.executionId,
                    errorType: error instanceof Error ? error.name : 'UnknownError',
                });
                this.controller.abort();
            }
        } finally {
            if (timeout) {
                clearTimeout(timeout);
            }
        }
    }
}
