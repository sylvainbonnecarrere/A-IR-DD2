import type { DockerOperation, DockerOperationKind, DockerOperationOutcome } from './MongoDockerOperationJournal';
import type { SupervisedAttemptIdentity } from './MongoSupervisedAttemptService';

export interface DockerOperationAdmission {
    admit(identity: SupervisedAttemptIdentity, kind: DockerOperationKind): Promise<DockerOperation>;
    recordOutcome(identity: SupervisedAttemptIdentity, operationId: string, outcome: DockerOperationOutcome): Promise<void>;
}

export interface DockerOperationTransport<Request, Response> {
    send(identity: SupervisedAttemptIdentity, kind: DockerOperationKind, request: Request): Promise<Response>;
}

export interface UnreconciledDockerResponse<Response> {
    response: Response;
    operationId: string;
    state: 'unreconciled';
}

export class DockerOperationJournalFailure extends Error {
    constructor(
        readonly transportError: unknown,
        readonly journalError: unknown,
    ) {
        super('Docker operation failed and its uncertain outcome could not be recorded');
        this.name = 'DockerOperationJournalFailure';
    }
}

// Experimental only: this does not exclude other Docker clients or stop an
// already admitted sender. A response alone never clears the pending operation.
export class JournaledDockerOperation<Request, Response> {
    constructor(
        private readonly journal: DockerOperationAdmission,
        private readonly transport: DockerOperationTransport<Request, Response>,
    ) {}

    async send(identity: SupervisedAttemptIdentity, kind: DockerOperationKind, request: Request): Promise<UnreconciledDockerResponse<Response>> {
        const operation = await this.journal.admit(identity, kind);
        try {
            const response = await this.transport.send(identity, kind, request);
            return { response, operationId: operation.id, state: 'unreconciled' };
        } catch (transportError) {
            try {
                await this.journal.recordOutcome(identity, operation.id, 'unknown');
            } catch (journalError) {
                throw new DockerOperationJournalFailure(transportError, journalError);
            }
            throw transportError;
        }
    }
}
