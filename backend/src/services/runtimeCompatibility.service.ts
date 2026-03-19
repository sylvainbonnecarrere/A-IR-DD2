import type { Response } from 'express';
import { RuntimeHealthService } from './runtimeHealth.service';

export interface RuntimeCompatibilityContext {
    checkedAt: string;
    mode: 'rootless' | 'docker-desktop' | 'rootful-linux' | 'unknown';
    securityLevel: 'production-ready' | 'dev-only' | 'unavailable';
    executionReady: boolean;
    preferredRunner: 'docker_sandbox' | 'firecracker';
    warning?: string;
    summary: string;
}

export class RuntimeCompatibilityService {
    private readonly runtimeHealthService = new RuntimeHealthService();
    private cachedContext: RuntimeCompatibilityContext | null = null;
    private cacheExpiresAt = 0;

    constructor(private readonly cacheTtlMs = 5_000) {}

    async getRuntimeCompatibility(): Promise<RuntimeCompatibilityContext> {
        const now = Date.now();
        if (this.cachedContext && now < this.cacheExpiresAt) {
            return this.cachedContext;
        }

        try {
            const report = await this.runtimeHealthService.getHealthReport();
            const context: RuntimeCompatibilityContext = {
                checkedAt: report.checkedAt,
                mode: report.runtime.docker.mode,
                securityLevel: report.runtime.docker.securityLevel,
                executionReady: report.runtime.docker.executionReady,
                preferredRunner: report.runtime.runners.preferred,
                warning: report.runtime.docker.warning,
                summary: report.summary
            };

            this.cachedContext = context;
            this.cacheExpiresAt = now + this.cacheTtlMs;
            return context;
        } catch {
            const fallback: RuntimeCompatibilityContext = {
                checkedAt: new Date(now).toISOString(),
                mode: 'unknown',
                securityLevel: 'unavailable',
                executionReady: false,
                preferredRunner: 'docker_sandbox',
                warning: 'Runtime compatibility unavailable.',
                summary: 'Runtime compatibility unavailable.'
            };

            this.cachedContext = fallback;
            this.cacheExpiresAt = now + this.cacheTtlMs;
            return fallback;
        }
    }

    applyResponseHeaders(response: Response, context: RuntimeCompatibilityContext): void {
        response.setHeader('X-Runtime-Mode', context.mode);
        response.setHeader('X-Runtime-Security-Level', context.securityLevel);
        response.setHeader('X-Runtime-Execution-Ready', String(context.executionReady));
        response.setHeader('X-Runtime-Preferred-Runner', context.preferredRunner);
        if (context.warning) {
            response.setHeader('X-Runtime-Warning', context.warning);
        }
    }
}