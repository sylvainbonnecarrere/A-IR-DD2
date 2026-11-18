import { request as httpRequest } from 'http';

import type { DockerGatewayEpoch, DockerGatewayFenceKind, DockerGatewayFenceResult } from './DockerGatewayAdmission';

const OPERATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export class DockerGatewayControlError extends Error {
    constructor(message: string, public readonly statusCode?: number) {
        super(message);
        this.name = 'DockerGatewayControlError';
    }
}

export interface DockerGatewayVerifyResult {
    quiescent: boolean;
}

export class DockerGatewayControlClient {
    constructor(private readonly address: { socketPath: string } | { host: string; port: number }) {
        if ('socketPath' in address && !address.socketPath.trim()) {
            throw new Error('Docker gateway socket path is required');
        }
        if ('host' in address && (!address.host.trim() || !Number.isInteger(address.port) || address.port < 1)) {
            throw new Error('Docker gateway control TCP address is invalid');
        }
    }

    activateWorker(workerId: string): Promise<DockerGatewayEpoch> {
        return this.send('/v1/worker/activate', { workerId }).then((value) => {
            if (typeof value !== 'object' || value === null
                || !('workerId' in value) || value.workerId !== workerId
                || !('epoch' in value) || !Number.isSafeInteger(value.epoch)
                || !('token' in value) || typeof value.token !== 'string' || !value.token) {
                throw new Error('Docker gateway returned an invalid worker epoch');
            }
            return {
                workerId,
                epoch: value.epoch as number,
                token: value.token,
            };
        });
    }

    async closeWorker(epoch: DockerGatewayEpoch): Promise<void> {
        await this.send('/v1/worker/close', epoch);
    }

    fenceOperation(operationId: string, fenceKind?: DockerGatewayFenceKind): Promise<DockerGatewayFenceResult> {
        if (!OPERATION_ID_PATTERN.test(operationId)) {
            return Promise.reject(new Error('Docker gateway operation id must be a lowercase UUID v4'));
        }
        return this.send(`/v1/operations/${operationId}/fence`, fenceKind ? { fenceKind } : {}).then((value) => {
            if (typeof value !== 'object' || value === null
                || !('fenced' in value) || value.fenced !== true
                || !('nameReserved' in value) || typeof value.nameReserved !== 'boolean'
                || !('quiescent' in value) || typeof value.quiescent !== 'boolean'
                || !('observed' in value) || !Array.isArray(value.observed)
                || value.observed.some((entry) => typeof entry !== 'string')) {
                throw new Error('Docker gateway returned an invalid fence result');
            }
            return {
                fenced: true,
                nameReserved: value.nameReserved as boolean,
                quiescent: value.quiescent as boolean,
                observed: value.observed as string[],
            };
        });
    }

    verifyFenced(operationId: string): Promise<DockerGatewayVerifyResult> {
        if (!OPERATION_ID_PATTERN.test(operationId)) {
            return Promise.reject(new Error('Docker gateway operation id must be a lowercase UUID v4'));
        }
        return this.send(`/v1/operations/${operationId}/verify`, {}).then((value) => {
            if (typeof value !== 'object' || value === null
                || !('quiescent' in value) || typeof value.quiescent !== 'boolean') {
                throw new Error('Docker gateway returned an invalid verify result');
            }
            return { quiescent: value.quiescent as boolean };
        });
    }

    private send(path: string, body: unknown): Promise<unknown> {
        return new Promise((resolve, reject) => {
            const payload = JSON.stringify(body);
            const request = httpRequest({
                ...('socketPath' in this.address
                    ? { socketPath: this.address.socketPath }
                    : { host: this.address.host, port: this.address.port }),
                method: 'POST',
                path,
                headers: {
                    'content-type': 'application/json',
                    'content-length': Buffer.byteLength(payload),
                },
                // verifyFenced est borné à RECONCILE_TIMEOUT_MS (30 s) + fenêtre de grâce ;
                // le canal de contrôle doit couvrir l'opération complète.
                timeout: 90_000,
            }, (response) => {
                const chunks: Buffer[] = [];
                response.on('data', (chunk: Buffer) => chunks.push(chunk));
                response.on('end', () => {
                    let parsed: unknown;
                    try {
                        parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
                    } catch {
                        reject(new DockerGatewayControlError('Docker gateway returned invalid control JSON'));
                        return;
                    }
                    if (response.statusCode !== 200) {
                        const message = typeof parsed === 'object' && parsed !== null && 'error' in parsed
                            && typeof parsed.error === 'string'
                            ? parsed.error
                            : 'Docker gateway control request refused';
                        reject(new DockerGatewayControlError(message, response.statusCode));
                        return;
                    }
                    resolve(parsed);
                });
                response.on('error', reject);
            });
            request.on('timeout', () => request.destroy(new DockerGatewayControlError('Docker gateway control request timed out')));
            request.on('error', reject);
            request.end(payload);
        });
    }
}
