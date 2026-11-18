import { request as httpRequest } from 'http';
import type { DockerGatewayEpoch } from './DockerGatewayAdmission';

export class DockerGatewayControlError extends Error {
    constructor(message: string, public readonly statusCode?: number) {
        super(message);
        this.name = 'DockerGatewayControlError';
    }
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
                timeout: 15_000,
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
