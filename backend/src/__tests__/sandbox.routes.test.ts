import express from 'express';
import passport from 'passport';
import request from 'supertest';
import '../middleware/auth.middleware';
import { User } from '../models/User.model';
import { UserFunction } from '../models/UserFunction.model';
import { UserTool } from '../models/UserTool.model';
import sandboxRoutes from '../routes/sandbox.routes';
import { generateAccessToken } from '../utils/jwt';
import { BuildPreparationError, BuildService } from '../services/build.service';
import { NativePythonProvisioningService } from '../services/nativePythonProvisioning.service';
import { ExecutionOrchestrator } from '../services/runtime/ExecutionOrchestrator';

type FixtureRuntime = 'typescript' | 'python';

const app = express();
app.use(express.json());
app.use(passport.initialize());
app.use('/api/sandbox', sandboxRoutes);

describe('Sandbox routes', () => {
    afterEach(async () => {
        jest.restoreAllMocks();
        await UserTool.deleteMany({ name: /sandbox-route-/i });
        await UserFunction.deleteMany({ name: /sandbox-route-/i });
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

        const fn = await UserFunction.create({
            userId: user._id,
            workflowId: null,
            name: `sandbox-route-${timestamp}`,
            description: 'Route-level sandbox execution test',
            language,
            origin: 'custom',
            tags: ['test'],
            inputSchema: { type: 'object' },
            outputSchema: { type: 'object' },
            codeInline,
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

    it('executes POST /api/sandbox/run for a simple custom Python function used from the editor', async () => {
        const fixture = await createFixture('python');
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
        expect(executeSpy).toHaveBeenCalledWith(expect.objectContaining({
            userId: fixture.user.id,
            args: { value: 'route-python-ok' },
            launchContext: 'editor_test',
            fn: expect.objectContaining({
                _id: expect.anything(),
                name: fixture.fn.name,
                language: 'python'
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
            dependencies: { python: ['duckduckgo-search==6.1.0'], npm: [] },
            policy: { networkMode: 'restricted', writablePaths: [], secretAliases: [] },
            isReadonly: true,
            isEnabled: true
        });

        const accessToken = generateAccessToken({
            sub: user.id,
            email: user.email,
            role: user.role
        });

        jest.spyOn(NativePythonProvisioningService.prototype, 'provisionToolVersion').mockRejectedValue(
            new BuildPreparationError(
                'This native tool version declares dependencies and requires platform provisioning before sandbox execution.',
                'PLATFORM_PROVISION_REQUIRED'
            )
        );

        const response = await request(app)
            .post('/api/sandbox/run')
            .set('Authorization', `Bearer ${accessToken}`)
            .send({
                functionId: tool.id,
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

    it('auto-provisions a native readonly tool on demand before executing it through toolSelection', async () => {
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
            dependencies: { python: ['duckduckgo-search==6.1.0'], npm: [] },
            policy: { networkMode: 'restricted', writablePaths: [], secretAliases: [] },
            isReadonly: true,
            isEnabled: true
        });

        const accessToken = generateAccessToken({
            sub: user.id,
            email: user.email,
            role: user.role
        });

        const ensureBuildReadySpy = jest.spyOn(BuildService.prototype, 'ensureBuildReadyForTool')
            .mockRejectedValueOnce(new BuildPreparationError(
                'This native tool version declares dependencies and requires platform provisioning before sandbox execution.',
                'PLATFORM_PROVISION_REQUIRED'
            ))
            .mockResolvedValueOnce();

        const provisionSpy = jest.spyOn(NativePythonProvisioningService.prototype, 'provisionToolVersion').mockResolvedValue({
            toolId: tool.id,
            toolName: tool.name,
            toolVersionTag: 'v1',
            status: 'ready',
            provisionedAt: new Date().toISOString(),
            dependencies: ['duckduckgo-search==6.1.0'],
            criticalModules: ['duckduckgo_search'],
            sitePackagesPath: '/tmp/site-packages',
            reportPath: '/tmp/provision-report.json'
        });

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
                        images: { node: true, python: true }
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

        jest.spyOn(ExecutionOrchestrator.prototype, 'execute').mockResolvedValue({
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
        } as any);

        const response = await request(app)
            .post('/api/sandbox/run')
            .set('Authorization', `Bearer ${accessToken}`)
            .send({
                functionId: tool.id,
                toolSelection: {
                    toolId: tool.id,
                    versionRef: { versionTag: 'v1' }
                },
                testArgs: { query: 'meteo paris demain', language: 'fr' }
            })
            .expect(200);

        expect(response.body.success).toBe(true);
        expect(ensureBuildReadySpy).toHaveBeenCalledTimes(2);
        expect(provisionSpy).toHaveBeenCalledWith(tool.id, user.id, 'v1');
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
        expect(response.body.errorDetails).toEqual(expect.objectContaining({
            code: 'RUNTIME_NOT_READY',
            subsystem: 'runtime_readiness',
            retryable: true
        }));
        expect(executeSpy).not.toHaveBeenCalled();
    });

    it('returns sandbox failure diagnostics in a successful HTTP response when execution fails in-container', async () => {
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
        jest.spyOn(ExecutionOrchestrator.prototype, 'execute').mockResolvedValue({
            success: false,
            output: null,
            stdout: '',
            stderr: 'ModuleNotFoundError: No module named duckduckgo_search',
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
            }
        } as any);

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
            message: 'ModuleNotFoundError: No module named duckduckgo_search',
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
});