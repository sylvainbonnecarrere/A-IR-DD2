import type { RunLease } from './MongoRunLeaseService';
import type { SupervisedAttemptIdentity, SupervisedAttemptStore } from './MongoSupervisedAttemptService';

export interface AttemptLauncher<T> {
    launch(attempt: SupervisedAttemptIdentity, signal: AbortSignal): Promise<T>;
}

export class SupervisedAttemptLauncher<T> {
    constructor(
        private readonly attempts: SupervisedAttemptStore,
        private readonly launcher: AttemptLauncher<T>,
    ) {}

    async launch(lease: RunLease, signal: AbortSignal): Promise<T> {
        if (signal.aborted) {
            throw new Error('Supervised launch interrupted before attempt creation');
        }
        const attempt = await this.attempts.create(lease);
        if (signal.aborted) {
            throw new Error('Supervised launch interrupted after attempt creation; outcome requires reconciliation');
        }
        return this.launcher.launch(attempt, signal);
    }
}
