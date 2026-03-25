import express from 'express';
import passport from 'passport';
import request from 'supertest';
import '../middleware/auth.middleware';
import { User } from '../models/User.model';
import { UserFunction } from '../models/UserFunction.model';
import sandboxRoutes from '../routes/sandbox.routes';
import { generateAccessToken } from '../utils/jwt';
import { BuildPreparationError, BuildService } from '../services/build.service';
import { ExecutionOrchestrator } from '../services/runtime/ExecutionOrchestrator';

const app = express();
app.use(express.json());
app.use(passport.initialize());
app.use('/api/sandbox', sandboxRoutes);

describe('Sandbox routes', () => {
    afterEach(async () => {
        jest.restoreAllMocks();
        await UserFunction.deleteMany({ name: /sandbox-route-/i });
        await User.deleteMany({ email: /sandbox-route-/i });
    });

    async function createFixture() {
        const timestamp = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const user = await User.create({
            email: `sandbox-route-${timestamp}@test.com`,
            password: 'test-only-password-123',
            username: `sandboxroute${Date.now()}`
        });

        const fn = await UserFunction.create({
            userId: user._id,
            workflowId: null,
            name: `sandbox-route-${timestamp}`,
            description: 'Route-level sandbox execution test',
            language: 'typescript',
            origin: 'custom',
            tags: ['test'],
            inputSchema: { type: 'object' },
            outputSchema: { type: 'object' },
            codeInline: 'function run(args) { return { echoed: args.value }; }',
            isEnabled: true,
            isReadonly: false,
            version: 1
        });

        const accessToken = generateAccessToken({
            sub: user.id,
            email: user.email,
            role: user.role
        });

        return { user, fn, accessToken };
    }

    it('executes POST /api/sandbox/run through auth, service, and orchestrator', async () => {
        const fixture = await createFixture();
        jest.spyOn(BuildService.prototype, 'ensureBuildReadyForRun').mockResolvedValue();
        jest.spyOn(ExecutionOrchestrator.prototype, 'getPreferredRunnerReadiness').mockResolvedValue({
            report: {
                status: 'healthy',
                summary: 'Docker sandbox ready',
                python: { available: true, executable: 'python', version: 'Python 3.12.0' },
                runtime: {
                    mode: 'docker_desktop',
                    securityLevel: 'dev-only',
                    executionReady: true,
                    warning: 'Docker Desktop dev-only',
                    docker: {
                        available: true,
                        rootless: false,
                        context: 'desktop-linux',
                        socketPath: '//./pipe/dockerDesktopLinuxEngine',
                        warning: 'Docker Desktop dev-only',
                        executionReady: true,
                        images: {
                            node: true,
                            python: true
                        }
                    },
                    firecracker: {
                        available: false,
                        enabled: false,
                        kvmAvailable: false,
                        warning: 'Firecracker unavailable'
                    },
                    runners: {
                        preferred: 'docker_sandbox',
                        available: ['docker_sandbox']
                    }
                },
                capabilities: {
                    syntaxCheck: { python: true, typescript: true },
                    run: { python: true, typescript: true }
                }
            } as any,
            runner: {
                getRunnerId: () => 'docker_sandbox',
                getLabel: () => 'Docker sandbox',
                supportsRuntime: () => true,
                getReadiness: () => ({ ready: true })
            },
            readiness: { ready: true }
        });
        const executeSpy = jest.spyOn(ExecutionOrchestrator.prototype, 'execute').mockResolvedValue({
            success: true,
            output: { echoed: 'route-ok' },
            stdout: 'route test',
            stderr: '',
            durationMs: 12,
            exitCode: 0,
            runner: 'docker_sandbox',
            executionId: 'utr-route-test',
            metadata: {
                artifacts: [{ path: 'output/result.json', kind: 'json' }]
            }
        });

        const response = await request(app)
            .post('/api/sandbox/run')
            .set('Authorization', `Bearer ${fixture.accessToken}`)
            .send({
                functionId: fixture.fn.id,
                testArgs: { value: 'route-ok' }
            })
            .expect(200);

        expect(response.body).toEqual(expect.objectContaining({
            success: true,
            executionId: 'utr-route-test',
            runner: 'docker_sandbox',
            output: { echoed: 'route-ok' }
        }));
        expect(response.body.metadata).toEqual(expect.objectContaining({
            artifacts: [{ path: 'output/result.json', kind: 'json' }]
        }));
        expect(executeSpy).toHaveBeenCalledWith(expect.objectContaining({
            userId: fixture.user.id,
            args: { value: 'route-ok' },
            launchContext: 'editor_test',
            fn: expect.objectContaining({
                _id: expect.anything(),
                name: fixture.fn.name,
                language: 'typescript'
            })
        }));
    });

    it('returns 409 when build preparation is required before sandbox execution', async () => {
        const fixture = await createFixture();
        jest.spyOn(BuildService.prototype, 'ensureBuildReadyForRun').mockRejectedValue(
            new BuildPreparationError('Function must be prepared via the build workflow before sandbox execution.')
        );

        const response = await request(app)
            .post('/api/sandbox/run')
            .set('Authorization', `Bearer ${fixture.accessToken}`)
            .send({
                functionId: fixture.fn.id,
                testArgs: {}
            })
            .expect(409);

        expect(response.body.error).toContain('prepared via the build workflow');
    });

    it('returns 503 when the preferred runner is not ready', async () => {
        const fixture = await createFixture();
        jest.spyOn(BuildService.prototype, 'ensureBuildReadyForRun').mockResolvedValue();
        jest.spyOn(ExecutionOrchestrator.prototype, 'getPreferredRunnerReadiness').mockResolvedValue({
            report: { summary: 'Sandbox runtime unavailable' } as any,
            runner: {
                getRunnerId: () => 'docker_sandbox',
                getLabel: () => 'Docker sandbox',
                supportsRuntime: () => true,
                getReadiness: () => ({ ready: false, reason: 'Sandbox runtime unavailable' })
            },
            readiness: { ready: false, reason: 'Sandbox runtime unavailable' }
        });
        const executeSpy = jest.spyOn(ExecutionOrchestrator.prototype, 'execute');

        const response = await request(app)
            .post('/api/sandbox/run')
            .set('Authorization', `Bearer ${fixture.accessToken}`)
            .send({
                functionId: fixture.fn.id,
                testArgs: {}
            })
            .expect(503);

        expect(response.body.error).toContain('Sandbox runtime unavailable');
        expect(executeSpy).not.toHaveBeenCalled();
    });

    it('returns 400 when sandbox run input validation fails', async () => {
        const fixture = await createFixture();

        const response = await request(app)
            .post('/api/sandbox/run')
            .set('Authorization', `Bearer ${fixture.accessToken}`)
            .send({
                functionId: 'invalid-object-id',
                testArgs: []
            })
            .expect(400);

        expect(response.body.error).toBe('Validation échouée');
        expect(response.body.details).toEqual(expect.arrayContaining([
            expect.objectContaining({ field: 'functionId' })
        ]));
    });
});