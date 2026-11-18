import { JournaledDockerOperation } from './JournaledDockerOperation';
import type {
    DockerOperationAdmission,
    DockerOperationTransport,
    UnreconciledDockerResponse,
} from './JournaledDockerOperation';
import type { DockerOperationKind } from './MongoDockerOperationJournal';
import type { SupervisedAttemptIdentity } from './MongoSupervisedAttemptService';

export interface ClosableDockerOperationAdmission extends DockerOperationAdmission {
    close(identity: SupervisedAttemptIdentity): Promise<void>;
}

// Local fencing only: other instances, processes and requests already sent
// remain outside this gate's control.
export class LocalDockerAdmissionGate<Request, Response> {
    private closing = false;
    private readonly identity: SupervisedAttemptIdentity;
    private readonly sender: JournaledDockerOperation<Request, Response>;

    constructor(
        identity: SupervisedAttemptIdentity,
        private readonly journal: ClosableDockerOperationAdmission,
        transport: DockerOperationTransport<Request, Response>,
    ) {
        this.identity = { ...identity };
        this.sender = new JournaledDockerOperation(journal, {
            send: (attempt, kind, request) => {
                if (this.closing) throw new Error('Local Docker admission gate is closed; admitted operation was not sent');
                return transport.send(attempt, kind, request);
            },
        });
    }

    async send(kind: DockerOperationKind, request: Request): Promise<UnreconciledDockerResponse<Response>> {
        if (this.closing) throw new Error('Local Docker admission gate is closed');
        return this.sender.send(this.identity, kind, request);
    }

    async close(): Promise<void> {
        this.closing = true;
        await this.journal.close(this.identity);
    }
}
