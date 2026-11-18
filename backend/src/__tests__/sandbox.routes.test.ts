import express from 'express';
import passport from 'passport';
import request from 'supertest';
import '../middleware/auth.middleware';
import { User } from '../models/User.model';
import { UserTool } from '../models/UserTool.model';
import sandboxRoutes from '../routes/sandbox.routes';
import { generateAccessToken } from '../utils/jwt';
import { BuildPreparationError } from '../services/build.service';
import { ExecutionOrchestrator } from '../services/runtime/ExecutionOrchestrator';
import { RuntimeNotReadyError } from '../services/runtime/errors';
import { SandboxService } from '../services/sandbox.service';

type FixtureRuntime = 'typescript' | 'python';

const app = express();
app.use(express.json());
app.use(passport.initialize());
app.use('/api/sandbox', sandboxRoutes);

describe('Sandbox routes', () => {
    afterEach(async () => {
        jest.restoreAllMocks();
        await UserTool.deleteMany({ name: /sandbox-route-/i });
        await User.deleteMany({ email: /sandbox-route-/i });
    });

    async function createFixture(runtime: FixtureRuntime = 'typescript') {
        const timestamp = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const user = await User.create({
            email: `sandbox-route-${timestamp}@test.com`,
            password: 'test-only-password-123',
            username: `sandboxroute${Date.now()}`
        });

        const language = runtime;
        const codeInline = runtime === 'python'
            ? 'def run(args):\n    return {"echoed": args.get("value")}'
            : 'function run(args) { return { echoed: args.value }; }';

        const fn = await UserTool.create({
            ownerUserId: user._id,
            workspaceId: null,
            scopeType: 'user',
            workflowId: null,
            name: `sandbox-route-${timestamp}`,
            description: 'Route-level sandbox execution test',
            runtime: language,
            status: 'ready',
            trustLevel: 'user_private',
            currentVersion: {
                versionTag: 'v1',
                contentHash: `sandbox-route-${timestamp}-${language}`,
                sourceMode: 'inline',
                sourcePath: null,
                sourceInline: codeInline,
                entrypoint: null,
                createdAt: new Date(),
                createdBy: user._id,
                buildStatus: 'not_built',
                validationStatus: 'unknown'
            },
            versions: [{
                versionTag: 'v1',
                contentHash: `sandbox-route-${timestamp}-${language}`,
                sourceMode: 'inline',
                sourcePath: null,
                sourceInline: codeInline,
                entrypoint: null,
                createdAt: new Date(),
                createdBy: user._id,
                buildStatus: 'not_built',
                validationStatus: 'unknown'
            }],
            tags: ['test'],
            inputSchema: { type: 'object' },
            outputSchema: { type: 'object' },
            dependencies: { python: [], npm: [] },
            policy: { networkMode: 'none', writablePaths: [], secretAliases: [] },
            isEnabled: true,
            isReadonly: false
        });

        const accessToken = generateAccessToken({
            sub: user.id,
            email: user.email,
            role: user.role
        });

        return { user, fn, accessToken };
    }

    it('forwards an authenticated workflow run to the durable sandbox service', async () => {
        const fixture = await createFixture();
        const runSpy = jest.spyOn(SandboxService.prototype, 'runFunction').mockResolvedValue({
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
                agentInstanceId: '66c111111111111111111111',
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
        expect(runSpy).toHaveBeenCalledWith(
            fixture.fn.id,
            fixture.user.id,
            { value: 'route-ok' },
            undefined,
            '66c111111111111111111111',
            undefined,
            expect.any(String),
        );
    });

    it('forwards an authenticated Python editor run to the durable sandbox service', async () => {
        const fixture = await createFixture('python');
        const runSpy = jest.spyOn(SandboxService.prototype, 'runFunction').mockResolvedValue({
            success: true,
            output: { echoed: 'route-python-ok' },
            stdout: 'python route test',
            stderr: '',
            durationMs: 16,
            exitCode: 0,
            runner: 'docker_sandbox',
            executionId: 'utr-route-python-test',
            metadata: {
                artifacts: [{ path: 'output/result.json', kind: 'json' }]
            }
        });

        const response = await request(app)
            .post('/api/sandbox/run')
            .set('Authorization', `Bearer ${fixture.accessToken}`)
            .send({
                functionId: fixture.fn.id,
                testArgs: { value: 'route-python-ok' }
            })
            .expect(200);

        expect(response.body).toEqual(expect.objectContaining({
            success: true,
            executionId: 'utr-route-python-test',
            runner: 'docker_sandbox',
            output: { echoed: 'route-python-ok' }
        }));
        expect(runSpy).toHaveBeenCalledWith(
            fixture.fn.id,
            fixture.user.id,
            { value: 'route-python-ok' },
            undefined,
            undefined,
            undefined,
            expect.any(String),
        );
    });

    it('returns 409 when build preparation is required before sandbox execution', async () => {
        const fixture = await createFixture();
        jest.spyOn(SandboxService.prototype, 'runFunction').mockRejectedValue(
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
        expect(response.body.errorDetails).toEqual(expect.objectContaining({
            subsystem: 'build_preparation',
            retryable: false
        }));
    });

    it('returns 409 with a platform provisioning message for native readonly tools selected through toolSelection', async () => {
        const timestamp = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const user = await User.create({
            email: `sandbox-route-${timestamp}@test.com`,
            password: 'test-only-password-123',
            username: `sandboxroute${Date.now()}`
        });

        const tool = await UserTool.create({
            ownerUserId: null,
            workspaceId: null,
            scopeType: 'native',
            workflowId: null,
            name: `sandbox-route-native-${timestamp}`,
            description: 'Native tool requiring platform provisioning',
            runtime: 'python',
            status: 'ready',
            trustLevel: 'internal',
            currentVersion: {
                versionTag: 'v1',
                contentHash: 'sandbox-native-hash',
                sourceMode: 'inline',
                sourcePath: null,
                sourceInline: 'def run(args):\n    return {"ok": True}',
                entrypoint: null,
                createdAt: new Date(),
                createdBy: null,
                buildStatus: 'not_built',
                validationStatus: 'unknown'
            },
            versions: [{
                versionTag: 'v1',
                contentHash: 'sandbox-native-hash',
                sourceMode: 'inline',
                sourcePath: null,
                sourceInline: 'def run(args):\n    return {"ok": True}',
                entrypoint: null,
                createdAt: new Date(),
                createdBy: null,
                buildStatus: 'not_built',
                validationStatus: 'unknown'
            }],
            inputSchema: {},
            outputSchema: {},
            tags: [],
            dependencies: { python: ['requests==2.32.3'], npm: [] },
            policy: { networkMode: 'restricted', writablePaths: [], secretAliases: [] },
            isReadonly: true,
            isEnabled: true
        });

        const accessToken = generateAccessToken({
            sub: user.id,
            email: user.email,
            role: user.role
        });

        jest.spyOn(SandboxService.prototype, 'runFunction').mockRejectedValue(
            new BuildPreparationError(
                'This native tool version declares dependencies and requires platform provisioning before sandbox execution.',
                'PLATFORM_PROVISION_REQUIRED'
            )
        );

        const response = await request(app)
            .post('/api/sandbox/run')
            .set('Authorization', `Bearer ${accessToken}`)
            .send({
                toolSelection: {
                    toolId: tool.id,
                    versionRef: { versionTag: 'v1' }
                },
                testArgs: {}
            })
            .expect(409);

        expect(response.body.error).toContain('platform provisioning');
        expect(response.body.errorDetails).toEqual(expect.objectContaining({
            subsystem: 'build_preparation',
            retryable: false
        }));
    });

    it('forwards a canonical native tool selection to durable execution', async () => {
        const timestamp = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const user = await User.create({
            email: `sandbox-route-${timestamp}@test.com`,
            password: 'test-only-password-123',
            username: `sandboxroute${Date.now()}`
        });

        const tool = await UserTool.create({
            ownerUserId: null,
            workspaceId: null,
            scopeType: 'native',
            workflowId: null,
            name: `sandbox-route-native-autoprovision-${timestamp}`,
            description: 'Native tool requiring on-demand provisioning',
            runtime: 'python',
            status: 'ready',
            trustLevel: 'internal',
            currentVersion: {
                versionTag: 'v1',
                contentHash: 'sandbox-native-autoprovision-hash',
                sourceMode: 'inline',
                sourcePath: null,
                sourceInline: 'def run(args):\n    return {"ok": True}',
                entrypoint: null,
                createdAt: new Date(),
                createdBy: null,
                buildStatus: 'not_built',
                validationStatus: 'unknown'
            },
            versions: [{
                versionTag: 'v1',
                contentHash: 'sandbox-native-autoprovision-hash',
                sourceMode: 'inline',
                sourcePath: null,
                sourceInline: 'def run(args):\n    return {"ok": True}',
                entrypoint: null,
                createdAt: new Date(),
                createdBy: null,
                buildStatus: 'not_built',
                validationStatus: 'unknown'
            }],
            inputSchema: {},
            outputSchema: {},
            tags: [],
            dependencies: { python: ['requests==2.32.3'], npm: [] },
            policy: { networkMode: 'restricted', writablePaths: [], secretAliases: [] },
            isReadonly: true,
            isEnabled: true
        });

        const accessToken = generateAccessToken({
            sub: user.id,
            email: user.email,
            role: user.role
        });

        const runSpy = jest.spyOn(SandboxService.prototype, 'runFunction').mockResolvedValue({
            success: true,
            output: { results: [{ title: 'Meteo Paris', url: 'https://meteofrance.com/previsions-meteo-france/paris/75000' }] },
            stdout: 'route test',
            stderr: '',
            durationMs: 12,
            executionId: 'exec-sandbox-autoprovision',
            runner: 'docker_sandbox',
            exitCode: 0,
            metadata: { containerWorkspaceDir: '/tmp/workspace' },
            resourceUsage: { peakMemoryMb: 24 }
        });

        const response = await request(app)
            .post('/api/sandbox/run')
            .set('Authorization', `Bearer ${accessToken}`)
            .send({
                toolSelection: {
                    toolId: tool.id,
                    versionRef: { versionTag: 'v1' }
                },
                testArgs: { query: 'meteo paris demain', language: 'fr' }
            })
            .expect(200);

        expect(response.body.success).toBe(true);
        expect(runSpy).toHaveBeenCalledWith(
            undefined,
            user.id,
            { query: 'meteo paris demain', language: 'fr' },
            { toolId: tool.id, versionRef: { versionTag: 'v1' } },
            undefined,
            undefined,
            expect.any(String),
        );
    });

    it('accepts a semver versionTag through canonical toolSelection without requiring functionId or legacy mirror sync', async () => {
        const timestamp = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const user = await User.create({
            email: `sandbox-route-${timestamp}@test.com`,
            password: 'test-only-password-123',
            username: `sandboxroute${Date.now()}`
        });

        const tool = await UserTool.create({
            ownerUserId: null,
            workspaceId: null,
            scopeType: 'native',
            workflowId: null,
            name: `sandbox-route-native-semver-${timestamp}`,
            description: 'Native tool version compatibility test',
            runtime: 'python',
            status: 'ready',
            trustLevel: 'internal',
            currentVersion: {
                versionTag: 'v1',
                contentHash: 'sandbox-native-semver-hash',
                sourceMode: 'inline',
                sourcePath: null,
                sourceInline: 'def run(args):\n    return {"ok": True}',
                entrypoint: null,
                createdAt: new Date(),
                createdBy: null,
                buildStatus: 'built',
                validationStatus: 'valid'
            },
            versions: [{
                versionTag: 'v1',
                contentHash: 'sandbox-native-semver-hash',
                sourceMode: 'inline',
                sourcePath: null,
                sourceInline: 'def run(args):\n    return {"ok": True}',
                entrypoint: null,
                createdAt: new Date(),
                createdBy: null,
                buildStatus: 'built',
                validationStatus: 'valid'
            }],
            inputSchema: {},
            outputSchema: {},
            tags: [],
            dependencies: { python: [], npm: [] },
            policy: { networkMode: 'restricted', writablePaths: [], secretAliases: [] },
            isReadonly: true,
            isEnabled: true
        });

        const accessToken = generateAccessToken({
            sub: user.id,
            email: user.email,
            role: user.role
        });

        const runSpy = jest.spyOn(SandboxService.prototype, 'runFunction').mockResolvedValue({
            success: true,
            output: { ok: true },
            stdout: 'route test',
            stderr: '',
            durationMs: 12,
            executionId: 'exec-sandbox-semver',
            runner: 'docker_sandbox',
            exitCode: 0,
            metadata: { containerWorkspaceDir: '/tmp/workspace' },
            resourceUsage: { peakMemoryMb: 24 }
        });

        const response = await request(app)
            .post('/api/sandbox/run')
            .set('Authorization', `Bearer ${accessToken}`)
            .send({
                toolSelection: {
                    toolId: tool.id,
                    versionRef: { versionTag: '1.0.0', versionNumber: 1 }
                },
                testArgs: { query: 'films programmation informatique cinémas Paris semaine 2025', language: 'fr' }
            })
            .expect(200);

        expect(response.body.success).toBe(true);
        expect(runSpy).toHaveBeenCalledWith(
            undefined,
            user.id,
            { query: 'films programmation informatique cinémas Paris semaine 2025', language: 'fr' },
            { toolId: tool.id, versionRef: { versionTag: '1.0.0', versionNumber: 1 } },
            undefined,
            undefined,
            expect.any(String),
        );
    });

    it('returns 503 when durable run setup reports that the runtime is not ready', async () => {
        const fixture = await createFixture();
        const runSpy = jest.spyOn(SandboxService.prototype, 'runFunction')
            .mockRejectedValue(new RuntimeNotReadyError('Sandbox runtime unavailable'));

        const response = await request(app)
            .post('/api/sandbox/run')
            .set('Authorization', `Bearer ${fixture.accessToken}`)
            .send({
                functionId: fixture.fn.id,
                testArgs: {}
            })
            .expect(503);

        expect(response.body.error).toContain('Sandbox runtime unavailable');
        expect(response.body.errorDetails).toEqual(expect.objectContaining({
            code: 'RUNTIME_NOT_READY',
            subsystem: 'runtime_readiness',
            retryable: true
        }));
        expect(runSpy).toHaveBeenCalled();
    });

    it('returns sandbox failure diagnostics in a successful HTTP response when execution fails in-container', async () => {
        const fixture = await createFixture();
        jest.spyOn(SandboxService.prototype, 'runFunction').mockResolvedValue({
            success: false,
            output: null,
            stdout: '',
            stderr: 'ModuleNotFoundError: No module named requests',
            durationMs: 14,
            exitCode: 1,
            runner: 'docker_sandbox',
            executionId: 'utr-route-failure',
            metadata: {
                exitCode: 1,
                failureKind: 'dependency_missing',
                failureSubsystem: 'dependency',
                errorType: 'ModuleNotFoundError',
                traceback: 'Traceback...'
            },
            errorDetails: {
                code: 'DEPENDENCY_MISSING',
                subsystem: 'dependency',
                retryable: false,
                message: 'ModuleNotFoundError: No module named requests',
                failureKind: 'dependency_missing',
                errorType: 'ModuleNotFoundError',
                traceback: 'Traceback...'
            }
        });

        const response = await request(app)
            .post('/api/sandbox/run')
            .set('Authorization', `Bearer ${fixture.accessToken}`)
            .send({
                functionId: fixture.fn.id,
                testArgs: { value: 'route-ko' }
            })
            .expect(200);

        expect(response.body.success).toBe(false);
        expect(response.body.errorDetails).toEqual(expect.objectContaining({
            code: 'DEPENDENCY_MISSING',
            subsystem: 'dependency',
            message: 'ModuleNotFoundError: No module named requests',
            failureKind: 'dependency_missing',
            errorType: 'ModuleNotFoundError',
            traceback: 'Traceback...'
        }));
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

    it('returns 400 when neither legacy functionId nor canonical toolSelection is provided', async () => {
        const fixture = await createFixture();

        const response = await request(app)
            .post('/api/sandbox/run')
            .set('Authorization', `Bearer ${fixture.accessToken}`)
            .send({
                testArgs: {}
            })
            .expect(400);

        expect(response.body.error).toBe('Validation échouée');
        expect(response.body.details).toEqual(expect.arrayContaining([
            expect.objectContaining({ field: 'functionId', message: 'functionId ou toolSelection est requis' })
        ]));
    });

    it('executes POST /api/sandbox/check through auth and runtime-backed Python syntax validation', async () => {
        const fixture = await createFixture('python');
        const checkSyntaxSpy = jest.spyOn(ExecutionOrchestrator.prototype, 'checkSyntax').mockResolvedValue({
            valid: false,
            errors: [{ line: 2, message: 'expected an indented block' }]
        });

        const response = await request(app)
            .post('/api/sandbox/check')
            .set('Authorization', `Bearer ${fixture.accessToken}`)
            .send({
                language: 'python',
                code: 'def run(args):\nreturn {"ok": True}'
            })
            .expect(200);

        expect(response.body).toEqual({
            valid: false,
            errors: [{ line: 2, message: 'expected an indented block' }]
        });
        expect(checkSyntaxSpy).toHaveBeenCalledWith('python', 'def run(args):\nreturn {"ok": True}');
    });

    it('returns 503 on POST /api/sandbox/check when runtime syntax validation is not ready', async () => {
        const fixture = await createFixture('python');
        jest.spyOn(ExecutionOrchestrator.prototype, 'checkSyntax').mockRejectedValue(
            new RuntimeNotReadyError('Sandbox runtime unavailable')
        );

        const response = await request(app)
            .post('/api/sandbox/check')
            .set('Authorization', `Bearer ${fixture.accessToken}`)
            .send({
                language: 'python',
                code: 'def run(args):\n    return {"ok": True}'
            })
            .expect(503);

        expect(response.body.error).toContain('Sandbox runtime unavailable');
        expect(response.body.errorDetails).toEqual(expect.objectContaining({
            code: 'RUNTIME_NOT_READY',
            subsystem: 'runtime_readiness',
            retryable: true,
        }));
    });
});