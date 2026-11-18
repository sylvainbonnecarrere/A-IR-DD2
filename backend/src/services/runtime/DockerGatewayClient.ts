import { request as httpRequest } from 'http';
import type { DockerProcessRunner } from './DockerSandboxRunner';
import type { DockerGatewayEpoch } from './DockerGatewayAdmission';
import type { DockerGatewayCommandRequest, DockerGatewayCommandResult } from './DockerGatewayProtocol';

export interface DockerGatewayClientOptions {
    socketPath?: string;
    host?: string;
    port?: number;
    epoch: DockerGatewayEpoch;
}

export class DockerGatewayClient implements DockerProcessRunner {
    private commandQueue: Promise<void> = Promise.resolve();

    constructor(private readonly options: DockerGatewayClientOptions) {
        if (!(options.socketPath?.trim())
            && !(options.host?.trim() && Number.isInteger(options.port) && (options.port ?? 0) > 0)) {
            throw new Error('Docker gateway requires a Unix socket path or a TCP test address');
        }
    }

    async run(_command: string, args: string[], options: {
        stdin?: string;
        timeoutMs?: number;
        signal?: AbortSignal;
    } = {}): Promise<{
        exitCode: number;
        stdout: string;
        stderr: string;
        timedOut: boolean;
        aborted?: boolean;
        errorMessage?: string;
    }> {
        const execution = this.commandQueue.then(() => this.execute(args, options));
        this.commandQueue = execution.then(() => undefined, () => undefined);
        return execution;
    }

    private async execute(args: string[], options: {
        stdin?: string;
        timeoutMs?: number;
        signal?: AbortSignal;
    }): Promise<{
        exitCode: number;
        stdout: string;
        stderr: string;
        timedOut: boolean;
        aborted?: boolean;
        errorMessage?: string;
    }> {
        if (options.signal?.aborted) {
            return {
                exitCode: 1,
                stdout: '',
                stderr: 'Docker gateway request aborted before admission',
                timedOut: false,
                aborted: true,
                errorMessage: 'Docker gateway request aborted before admission',
            };
        }
        const body: DockerGatewayCommandRequest = {
            epoch: this.options.epoch,
            args,
            ...(options.stdin !== undefined ? { stdin: options.stdin } : {}),
            ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
        };
        const response = await this.send(body, options.signal, (options.timeoutMs ?? 15_000) + 5_000);
        if (!response.ok) {
            return {
                exitCode: 1,
                stdout: '',
                stderr: response.error,
                timedOut: false,
                aborted: options.signal?.aborted,
                errorMessage: response.error,
            };
        }
        return {
            exitCode: response.result.exitCode,
            stdout: response.result.stdout,
            stderr: response.result.stderr,
            timedOut: response.result.timedOut,
            ...(response.result.aborted !== undefined ? { aborted: response.result.aborted } : {}),
            ...(response.result.errorMessage !== undefined ? { errorMessage: response.result.errorMessage } : {}),
        };
    }

    private send(
        body: DockerGatewayCommandRequest,
        signal: AbortSignal | undefined,
        timeoutMs: number,
    ): Promise<
        | { ok: true; result: DockerGatewayCommandResult }
        | { ok: false; error: string }
    > {
        return new Promise((resolve) => {
            const payload = JSON.stringify(body);
            const request = httpRequest({
                ...(this.options.socketPath ? { socketPath: this.options.socketPath } : {
                    host: this.options.host,
                    port: this.options.port,
                }),
                method: 'POST',
                path: '/v1/docker/command',
                headers: {
                    'content-type': 'application/json',
                    'content-length': Buffer.byteLength(payload),
                },
                timeout: timeoutMs,
            }, (response) => {
                const chunks: Buffer[] = [];
                response.on('data', (chunk: Buffer) => chunks.push(chunk));
                response.on('end', () => {
                    let parsed: unknown;
                    try {
                        parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
                    } catch {
                        resolve({ ok: false, error: 'Docker gateway returned invalid JSON' });
                        return;
                    }
                    if (response.statusCode !== 200 || !this.isCommandResult(parsed)) {
                        const message = typeof parsed === 'object' && parsed !== null && 'error' in parsed
                            && typeof parsed.error === 'string'
                            ? parsed.error
                            : 'Docker gateway refused the command';
                        resolve({ ok: false, error: message });
                        return;
                    }
                    resolve({ ok: true, result: parsed });
                });
                response.on('error', (error) => resolve({ ok: false, error: error.message }));
            });

            const onAbort = () => request.destroy(new Error('Docker gateway request aborted'));
            if (signal?.aborted) {
                onAbort();
            } else {
                signal?.addEventListener('abort', onAbort, { once: true });
            }
            request.once('close', () => signal?.removeEventListener('abort', onAbort));
            request.on('timeout', () => request.destroy(new Error('Docker gateway request timed out')));
            request.on('error', (error) => resolve({ ok: false, error: error.message }));
            request.end(payload);
        });
    }

    private isCommandResult(value: unknown): value is DockerGatewayCommandResult {
        if (typeof value !== 'object' || value === null) return false;
        const result = value as Record<string, unknown>;
        return Number.isInteger(result.exitCode)
            && typeof result.stdout === 'string'
            && typeof result.stderr === 'string'
            && typeof result.timedOut === 'boolean'
            && typeof result.operationId === 'string'
            && (result.outcome === 'effects_quiescent' || result.outcome === 'unknown');
    }
}
