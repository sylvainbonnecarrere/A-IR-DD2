import type { DockerGatewayEpoch } from './DockerGatewayAdmission';

export const DOCKER_GATEWAY_OP_LABEL = 'airdd2.gateway.op';
export const DOCKER_GATEWAY_FENCE_LABEL = 'airdd2.fence.op';

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
