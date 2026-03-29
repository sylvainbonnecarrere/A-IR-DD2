import { ToolReadinessService } from '../services/toolReadiness.service';

describe('ToolReadinessService', () => {
    it('marks a provisioned native tool as not_ready when the runtime is unavailable', () => {
        const service = new ToolReadinessService();

        const readiness = service.evaluateToolReadiness({
            scopeType: 'native',
            isReadonly: true,
            workflowId: null,
            dependencies: { npm: [], python: ['duckduckgo-search==6.1.0'] },
            currentVersion: {
                buildStatus: 'built'
            }
        }, {
            checkedAt: '2026-01-01T00:00:00.000Z',
            mode: 'docker-desktop',
            securityLevel: 'dev-only',
            executionReady: false,
            preferredRunner: 'docker_sandbox',
            warning: 'Docker available but execution is blocked.',
            summary: 'Sandbox runtime unavailable.'
        });

        expect(readiness).toEqual(expect.objectContaining({
            requirement: 'platform_provision',
            state: 'not_ready',
            prepared: true,
            runnable: false,
            dependencyReadiness: 'satisfied',
            runtimeReady: false,
            actionLabel: 'Attendre le runtime'
        }));
    });
});