import { DockerSandboxRunner } from './DockerSandboxRunner';
import type { SandboxExecutionRequest, SandboxExecutionResult } from './execution.types';
import type { SupervisedAttemptIdentity } from './MongoSupervisedAttemptService';
import type { AttemptLauncher } from './SupervisedAttemptLauncher';

export class DockerSupervisedAttemptLauncher implements AttemptLauncher<SandboxExecutionResult> {
    constructor(
        private readonly request: SandboxExecutionRequest,
        private readonly runner: DockerSandboxRunner = new DockerSandboxRunner(),
    ) {}

    launch(attempt: SupervisedAttemptIdentity, signal: AbortSignal): Promise<SandboxExecutionResult> {
        return this.runner.executeForAttempt({ ...this.request, signal }, attempt);
    }
}
