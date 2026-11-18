import type { DockerGatewayEpoch } from './DockerGatewayAdmission';

export interface DockerGatewayCommandRequest {
    epoch: DockerGatewayEpoch;
    args: string[];
    stdin?: string;
    timeoutMs?: number;
}

export interface DockerGatewayCommandResult {
    exitCode: number;
    stdout: string;
    stderr: string;
    timedOut: boolean;
    aborted?: boolean;
    errorMessage?: string;
    operationId: string;
    outcome: 'effects_quiescent' | 'unknown';
}

export interface DockerGatewayCommandRunner {
    run(args: string[], options?: {
        stdin?: string;
        timeoutMs?: number;
        signal?: AbortSignal;
    }): Promise<Omit<DockerGatewayCommandResult, 'operationId' | 'outcome'>>;
}
