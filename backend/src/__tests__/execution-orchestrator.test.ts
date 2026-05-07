import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import mongoose from 'mongoose';
import { ExecutionOrchestrator } from '../services/runtime/ExecutionOrchestrator';

describe('ExecutionOrchestrator', () => {
    it('captures newly generated output artifacts and persists them on the run', async () => {
        const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'airdd2-orchestrator-'));
        const outputRoot = path.join(tempRoot, 'output');
        await fs.mkdir(path.join(outputRoot, 'nested'), { recursive: true });
        await fs.writeFile(path.join(outputRoot, 'stale.json'), '{"stale":true}', 'utf-8');

        const orchestrator = new ExecutionOrchestrator();
        const createQueuedRun = jest.fn().mockResolvedValue(undefined);
        const markRunning = jest.fn().mockResolvedValue(undefined);
        const completeRun = jest.fn().mockResolvedValue(undefined);
        const failRun = jest.fn().mockResolvedValue(undefined);

        (orchestrator as any).runtimeHealthService = {
            getHealthReport: jest.fn().mockResolvedValue({ summary: 'ready' })
        };
        (orchestrator as any).buildService = {
            getBuildStatus: jest.fn().mockResolvedValue(null)
        };
        (orchestrator as any).workspaceManager = {
            ensureWorkflowWorkspace: jest.fn().mockResolvedValue({
                workspaceId: 'workspace-1',
                wasCreated: false,
                logicalRoot: tempRoot,
                runtimeRoots: {
                    sourceRoot: path.join(tempRoot, 'source'),
                    manifestsRoot: path.join(tempRoot, 'manifests'),
                    buildRoot: path.join(tempRoot, 'build'),
                    outputRoot
                },
                manifests: {
                    packageJson: false,
                    packageLockJson: false,
                    requirementsTxt: false,
                    pyprojectToml: false
                },
                status: 'active',
                lastScanAt: null
            })
        };
        (orchestrator as any).sandboxRunnerFactory = {
            getPreferredRunner: jest.fn().mockReturnValue({
                getRunnerId: () => 'docker_sandbox',
                getReadiness: () => ({ ready: true })
            })
        };
        (orchestrator as any).dockerRunner = {
            execute: jest.fn().mockImplementation(async () => {
                await fs.writeFile(path.join(outputRoot, 'nested', 'result.json'), '{"ok":true}', 'utf-8');
                await fs.writeFile(path.join(outputRoot, 'run.log'), 'sandbox ok', 'utf-8');
                return {
                    success: true,
                    output: { ok: true },
                    stdout: 'sandbox ok',
                    stderr: '',
                    durationMs: 25,
                    exitCode: 0,
                    runner: 'docker_sandbox',
                    metadata: {
                        exitCode: 0,
                        containerWorkspaceDir: '/persistent-workspace/source',
                        maxMemoryMb: 256
                    },
                    resourceUsage: {
                        wallTimeMs: 25,
                        memoryLimitMb: 256
                    }
                };
            })
        };
        (orchestrator as any).firecrackerRunner = {
            execute: jest.fn()
        };
        (orchestrator as any).userToolRunService = {
            createQueuedRun,
            markRunning,
            completeRun,
            failRun,
            timeoutRun: jest.fn().mockResolvedValue(undefined)
        };

        const result = await orchestrator.execute({
            fn: {
                _id: new mongoose.Types.ObjectId(),
                userId: new mongoose.Types.ObjectId(),
                workflowId: new mongoose.Types.ObjectId(),
                name: 'artifact_test',
                displayName: 'Artifact Test',
                description: 'Capture output artifacts',
                language: 'typescript',
                origin: 'custom',
                tags: [],
                inputSchema: { type: 'object' },
                outputSchema: { type: 'object' },
                codeInline: 'function run() { return { ok: true }; }',
                dependencies: { npm: [], python: [] },
                isEnabled: true,
                isReadonly: false,
                version: 1,
                createdAt: new Date(),
                updatedAt: new Date()
            } as any,
            userId: new mongoose.Types.ObjectId().toString(),
            args: {},
            launchContext: 'editor_test'
        });

        expect(result.metadata).toEqual(expect.objectContaining({
            artifacts: [
                { path: 'output/nested/result.json', kind: 'json' },
                { path: 'output/run.log', kind: 'log' }
            ]
        }));
        expect(completeRun).toHaveBeenCalledWith(
            result.executionId,
            expect.objectContaining({
                outputs: expect.objectContaining({
                    artifacts: [
                        { path: 'output/nested/result.json', kind: 'json' },
                        { path: 'output/run.log', kind: 'log' }
                    ]
                }),
                resourceUsage: expect.objectContaining({
                    wallTimeMs: 25,
                    memoryLimitMb: 256
                })
            })
        );
        expect(createQueuedRun).toHaveBeenCalledTimes(1);
        expect(markRunning).toHaveBeenCalledTimes(1);
        expect(failRun).not.toHaveBeenCalled();

        await fs.rm(tempRoot, { recursive: true, force: true });
    });

    it('isolates persisted artifacts between sequential runs in the same workspace', async () => {
        const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'airdd2-orchestrator-'));
        const outputRoot = path.join(tempRoot, 'output');
        await fs.mkdir(path.join(outputRoot, 'first'), { recursive: true });

        const orchestrator = new ExecutionOrchestrator();
        const createQueuedRun = jest.fn().mockResolvedValue(undefined);
        const markRunning = jest.fn().mockResolvedValue(undefined);
        const completeRun = jest.fn().mockResolvedValue(undefined);
        const failRun = jest.fn().mockResolvedValue(undefined);

        (orchestrator as any).runtimeHealthService = {
            getHealthReport: jest.fn().mockResolvedValue({ summary: 'ready' })
        };
        (orchestrator as any).buildService = {
            getBuildStatus: jest.fn().mockResolvedValue(null)
        };
        (orchestrator as any).workspaceManager = {
            ensureWorkflowWorkspace: jest.fn().mockResolvedValue({
                workspaceId: 'workspace-1',
                wasCreated: false,
                logicalRoot: tempRoot,
                runtimeRoots: {
                    sourceRoot: path.join(tempRoot, 'source'),
                    manifestsRoot: path.join(tempRoot, 'manifests'),
                    buildRoot: path.join(tempRoot, 'build'),
                    outputRoot
                },
                manifests: {
                    packageJson: false,
                    packageLockJson: false,
                    requirementsTxt: false,
                    pyprojectToml: false
                },
                status: 'active',
                lastScanAt: null
            })
        };
        (orchestrator as any).sandboxRunnerFactory = {
            getPreferredRunner: jest.fn().mockReturnValue({
                getRunnerId: () => 'docker_sandbox',
                getReadiness: () => ({ ready: true })
            })
        };

        let executionIndex = 0;
        (orchestrator as any).dockerRunner = {
            execute: jest.fn().mockImplementation(async () => {
                executionIndex += 1;

                if (executionIndex === 1) {
                    await fs.mkdir(path.join(outputRoot, 'first'), { recursive: true });
                    await fs.writeFile(path.join(outputRoot, 'first', 'result.json'), '{"first":true}', 'utf-8');
                    return {
                        success: true,
                        output: { first: true },
                        stdout: 'first run',
                        stderr: '',
                        durationMs: 20,
                        exitCode: 0,
                        runner: 'docker_sandbox',
                        metadata: { exitCode: 0 },
                        resourceUsage: { wallTimeMs: 20, memoryLimitMb: 256 }
                    };
                }

                await fs.mkdir(path.join(outputRoot, 'second'), { recursive: true });
                await fs.writeFile(path.join(outputRoot, 'second', 'result.json'), '{"second":true}', 'utf-8');
                return {
                    success: true,
                    output: { second: true },
                    stdout: 'second run',
                    stderr: '',
                    durationMs: 30,
                    exitCode: 0,
                    runner: 'docker_sandbox',
                    metadata: { exitCode: 0 },
                    resourceUsage: { wallTimeMs: 30, memoryLimitMb: 256 }
                };
            })
        };
        (orchestrator as any).firecrackerRunner = {
            execute: jest.fn()
        };
        (orchestrator as any).userToolRunService = {
            createQueuedRun,
            markRunning,
            completeRun,
            failRun,
            timeoutRun: jest.fn().mockResolvedValue(undefined)
        };

        const fn = {
            _id: new mongoose.Types.ObjectId(),
            userId: new mongoose.Types.ObjectId(),
            workflowId: new mongoose.Types.ObjectId(),
            name: 'artifact_isolation_test',
            displayName: 'Artifact Isolation Test',
            description: 'Capture only fresh artifacts per execution',
            language: 'typescript',
            origin: 'custom',
            tags: [],
            inputSchema: { type: 'object' },
            outputSchema: { type: 'object' },
            codeInline: 'function run() { return { ok: true }; }',
            dependencies: { npm: [], python: [] },
            isEnabled: true,
            isReadonly: false,
            version: 1,
            createdAt: new Date(),
            updatedAt: new Date()
        } as any;

        await orchestrator.execute({
            fn,
            userId: new mongoose.Types.ObjectId().toString(),
            args: {},
            launchContext: 'editor_test'
        });

        await orchestrator.execute({
            fn,
            userId: new mongoose.Types.ObjectId().toString(),
            args: {},
            launchContext: 'editor_test'
        });

        expect(completeRun).toHaveBeenCalledTimes(2);
        expect(completeRun.mock.calls[0][1]).toEqual(expect.objectContaining({
            outputs: expect.objectContaining({
                artifacts: [{ path: 'output/first/result.json', kind: 'json' }]
            })
        }));
        expect(completeRun.mock.calls[1][1]).toEqual(expect.objectContaining({
            outputs: expect.objectContaining({
                artifacts: [{ path: 'output/second/result.json', kind: 'json' }]
            })
        }));
        expect(completeRun.mock.calls[1][1].outputs.artifacts).not.toEqual(
            expect.arrayContaining([{ path: 'output/first/result.json', kind: 'json' }])
        );
        expect(createQueuedRun).toHaveBeenCalledTimes(2);
        expect(markRunning).toHaveBeenCalledTimes(2);
        expect(failRun).not.toHaveBeenCalled();

        await fs.rm(tempRoot, { recursive: true, force: true });
    });

    it('sustains a basic burst of parallel orchestrations without leaking artifacts between isolated workspaces', async () => {
        const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'airdd2-orchestrator-burst-'));
        const orchestrator = new ExecutionOrchestrator();
        const createQueuedRun = jest.fn().mockResolvedValue(undefined);
        const markRunning = jest.fn().mockResolvedValue(undefined);
        const completeRun = jest.fn().mockResolvedValue(undefined);
        const failRun = jest.fn().mockResolvedValue(undefined);

        const workspaceByWorkflow = new Map<string, string>();

        (orchestrator as any).runtimeHealthService = {
            getHealthReport: jest.fn().mockResolvedValue({ summary: 'ready' })
        };
        (orchestrator as any).buildService = {
            getBuildStatus: jest.fn().mockResolvedValue(null)
        };
        (orchestrator as any).workspaceManager = {
            ensureWorkflowWorkspace: jest.fn().mockImplementation(async (_userId: string, workflowId: string) => {
                let logicalRoot = workspaceByWorkflow.get(workflowId);
                if (!logicalRoot) {
                    logicalRoot = path.join(tempRoot, workflowId);
                    workspaceByWorkflow.set(workflowId, logicalRoot);
                    await fs.mkdir(path.join(logicalRoot, 'output'), { recursive: true });
                }

                return {
                    workspaceId: `workspace-${workflowId}`,
                    wasCreated: false,
                    logicalRoot,
                    runtimeRoots: {
                        sourceRoot: path.join(logicalRoot, 'source'),
                        manifestsRoot: path.join(logicalRoot, 'manifests'),
                        buildRoot: path.join(logicalRoot, 'build'),
                        outputRoot: path.join(logicalRoot, 'output')
                    },
                    manifests: {
                        packageJson: false,
                        packageLockJson: false,
                        requirementsTxt: false,
                        pyprojectToml: false
                    },
                    status: 'active',
                    lastScanAt: null
                };
            })
        };
        (orchestrator as any).sandboxRunnerFactory = {
            getPreferredRunner: jest.fn().mockReturnValue({
                getRunnerId: () => 'docker_sandbox',
                getReadiness: () => ({ ready: true })
            })
        };
        (orchestrator as any).dockerRunner = {
            execute: jest.fn().mockImplementation(async (request: any) => {
                const executionFile = `${request.executionId}.json`;
                await fs.writeFile(
                    path.join(request.workspace.runtimeRoots.outputRoot, executionFile),
                    JSON.stringify({ executionId: request.executionId }),
                    'utf-8'
                );

                return {
                    success: true,
                    output: { executionId: request.executionId },
                    stdout: request.executionId,
                    stderr: '',
                    durationMs: 15,
                    exitCode: 0,
                    runner: 'docker_sandbox',
                    metadata: { exitCode: 0 },
                    resourceUsage: { wallTimeMs: 15, memoryLimitMb: 256 }
                };
            })
        };
        (orchestrator as any).firecrackerRunner = {
            execute: jest.fn()
        };
        (orchestrator as any).userToolRunService = {
            createQueuedRun,
            markRunning,
            completeRun,
            failRun,
            timeoutRun: jest.fn().mockResolvedValue(undefined)
        };

        const requests = Array.from({ length: 4 }, (_, index) => {
            const workflowObjectId = new mongoose.Types.ObjectId();
            return {
                fn: {
                    _id: new mongoose.Types.ObjectId(),
                    userId: new mongoose.Types.ObjectId(),
                    workflowId: workflowObjectId,
                    name: `burst_${index}`,
                    displayName: `Burst ${index}`,
                    description: 'Parallel burst orchestration',
                    language: 'typescript',
                    origin: 'custom',
                    tags: [],
                    inputSchema: { type: 'object' },
                    outputSchema: { type: 'object' },
                    codeInline: 'function run() { return { ok: true }; }',
                    dependencies: { npm: [], python: [] },
                    isEnabled: true,
                    isReadonly: false,
                    version: 1,
                    createdAt: new Date(),
                    updatedAt: new Date()
                } as any,
                userId: new mongoose.Types.ObjectId().toString(),
                args: { index },
                launchContext: 'editor_test' as const
            };
        });

        const results = await Promise.all(requests.map((request) => orchestrator.execute(request)));

        expect(results).toHaveLength(4);
        expect(new Set(results.map((result) => result.executionId)).size).toBe(4);
        expect(createQueuedRun).toHaveBeenCalledTimes(4);
        expect(markRunning).toHaveBeenCalledTimes(4);
        expect(completeRun).toHaveBeenCalledTimes(4);
        expect(failRun).not.toHaveBeenCalled();

        const persistedArtifactPaths = completeRun.mock.calls.map(([, payload]) => payload.outputs.artifacts[0].path);
        expect(persistedArtifactPaths).toHaveLength(4);
        expect(new Set(persistedArtifactPaths).size).toBe(4);
        persistedArtifactPaths.forEach((artifactPath: string) => {
            expect(artifactPath).toMatch(/^output\/utr-[a-f0-9]{24}\.json$/);
        });

        await fs.rm(tempRoot, { recursive: true, force: true });
    });

    it('serializes concurrent orchestrations in the same workspace to prevent artifact cross-attribution', async () => {
        const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'airdd2-orchestrator-same-workspace-'));
        const outputRoot = path.join(tempRoot, 'output');
        await fs.mkdir(outputRoot, { recursive: true });

        const orchestrator = new ExecutionOrchestrator();
        const createQueuedRun = jest.fn().mockResolvedValue(undefined);
        const markRunning = jest.fn().mockResolvedValue(undefined);
        const completeRun = jest.fn().mockResolvedValue(undefined);
        const failRun = jest.fn().mockResolvedValue(undefined);

        const workspace = {
            workspaceId: 'workspace-shared',
            wasCreated: false,
            logicalRoot: tempRoot,
            runtimeRoots: {
                sourceRoot: path.join(tempRoot, 'source'),
                manifestsRoot: path.join(tempRoot, 'manifests'),
                buildRoot: path.join(tempRoot, 'build'),
                outputRoot
            },
            manifests: {
                packageJson: false,
                packageLockJson: false,
                requirementsTxt: false,
                pyprojectToml: false
            },
            status: 'active',
            lastScanAt: null
        };

        let activeExecutions = 0;
        let maxConcurrentExecutions = 0;

        (orchestrator as any).runtimeHealthService = {
            getHealthReport: jest.fn().mockResolvedValue({ summary: 'ready' })
        };
        (orchestrator as any).buildService = {
            getBuildStatus: jest.fn().mockResolvedValue(null)
        };
        (orchestrator as any).workspaceManager = {
            ensureWorkflowWorkspace: jest.fn().mockResolvedValue(workspace)
        };
        (orchestrator as any).sandboxRunnerFactory = {
            getPreferredRunner: jest.fn().mockReturnValue({
                getRunnerId: () => 'docker_sandbox',
                getReadiness: () => ({ ready: true })
            })
        };
        (orchestrator as any).dockerRunner = {
            execute: jest.fn().mockImplementation(async (request: any) => {
                activeExecutions += 1;
                maxConcurrentExecutions = Math.max(maxConcurrentExecutions, activeExecutions);

                const marker = String(request.args.marker);
                await new Promise((resolve) => setTimeout(resolve, marker === 'A' ? 25 : 5));
                await fs.writeFile(
                    path.join(request.workspace.runtimeRoots.outputRoot, `${marker}.json`),
                    JSON.stringify({ marker, executionId: request.executionId }),
                    'utf-8'
                );

                activeExecutions -= 1;
                return {
                    success: true,
                    output: { marker },
                    stdout: marker,
                    stderr: '',
                    durationMs: marker === 'A' ? 25 : 5,
                    exitCode: 0,
                    runner: 'docker_sandbox',
                    metadata: { exitCode: 0 },
                    resourceUsage: { wallTimeMs: marker === 'A' ? 25 : 5, memoryLimitMb: 256 }
                };
            })
        };
        (orchestrator as any).firecrackerRunner = {
            execute: jest.fn()
        };
        (orchestrator as any).userToolRunService = {
            createQueuedRun,
            markRunning,
            completeRun,
            failRun,
            timeoutRun: jest.fn().mockResolvedValue(undefined)
        };

        const fn = {
            _id: new mongoose.Types.ObjectId(),
            userId: new mongoose.Types.ObjectId(),
            workflowId: new mongoose.Types.ObjectId(),
            name: 'same_workspace_parallel',
            displayName: 'Same Workspace Parallel',
            description: 'Prevent artifact cross-attribution inside one workspace',
            language: 'typescript',
            origin: 'custom',
            tags: [],
            inputSchema: { type: 'object' },
            outputSchema: { type: 'object' },
            codeInline: 'function run() { return { ok: true }; }',
            dependencies: { npm: [], python: [] },
            isEnabled: true,
            isReadonly: false,
            version: 1,
            createdAt: new Date(),
            updatedAt: new Date()
        } as any;

        await Promise.all([
            orchestrator.execute({
                fn,
                userId: new mongoose.Types.ObjectId().toString(),
                args: { marker: 'A' },
                launchContext: 'editor_test'
            }),
            orchestrator.execute({
                fn,
                userId: new mongoose.Types.ObjectId().toString(),
                args: { marker: 'B' },
                launchContext: 'editor_test'
            })
        ]);

        expect(maxConcurrentExecutions).toBe(1);
        expect(createQueuedRun).toHaveBeenCalledTimes(2);
        expect(markRunning).toHaveBeenCalledTimes(2);
        expect(completeRun).toHaveBeenCalledTimes(2);
        expect(completeRun.mock.calls[0][1]).toEqual(expect.objectContaining({
            outputs: expect.objectContaining({
                artifacts: [{ path: 'output/A.json', kind: 'json' }]
            })
        }));
        expect(completeRun.mock.calls[1][1]).toEqual(expect.objectContaining({
            outputs: expect.objectContaining({
                artifacts: [{ path: 'output/B.json', kind: 'json' }]
            })
        }));
        expect(completeRun.mock.calls[1][1].outputs.artifacts).not.toEqual(
            expect.arrayContaining([{ path: 'output/A.json', kind: 'json' }])
        );
        expect(failRun).not.toHaveBeenCalled();

        await fs.rm(tempRoot, { recursive: true, force: true });
    });

    it('transpiles inline TypeScript before dispatching to the sandbox runner', async () => {
        const orchestrator = new ExecutionOrchestrator();
        const execute = jest.fn().mockResolvedValue({
            success: true,
            output: { ok: true },
            stdout: '',
            stderr: '',
            durationMs: 8,
            exitCode: 0,
            runner: 'docker_sandbox',
            metadata: { exitCode: 0 },
            resourceUsage: { wallTimeMs: 8, memoryLimitMb: 256 }
        });

        (orchestrator as any).runtimeHealthService = {
            getHealthReport: jest.fn().mockResolvedValue({ summary: 'ready' })
        };
        (orchestrator as any).buildService = {
            getBuildStatus: jest.fn().mockResolvedValue(null)
        };
        (orchestrator as any).workspaceManager = {
            ensureWorkflowWorkspace: jest.fn().mockResolvedValue(null)
        };
        (orchestrator as any).sandboxRunnerFactory = {
            getPreferredRunner: jest.fn().mockReturnValue({
                getRunnerId: () => 'docker_sandbox',
                getReadiness: () => ({ ready: true })
            })
        };
        (orchestrator as any).dockerRunner = { execute };
        (orchestrator as any).firecrackerRunner = { execute: jest.fn() };
        (orchestrator as any).userToolRunService = {
            createQueuedRun: jest.fn().mockResolvedValue(undefined),
            markRunning: jest.fn().mockResolvedValue(undefined),
            completeRun: jest.fn().mockResolvedValue(undefined),
            failRun: jest.fn().mockResolvedValue(undefined),
            timeoutRun: jest.fn().mockResolvedValue(undefined)
        };

        await orchestrator.execute({
            fn: {
                _id: new mongoose.Types.ObjectId(),
                userId: new mongoose.Types.ObjectId(),
                workflowId: null,
                name: 'hello_test',
                displayName: 'Hello Test',
                description: 'Inline TS sample',
                language: 'typescript',
                origin: 'custom',
                tags: [],
                inputSchema: { type: 'object' },
                outputSchema: { type: 'object' },
                codeInline: 'export function run(context: FunctionContext, args: { user_name: string }): unknown { const userName = typeof args.user_name === "string" && args.user_name.trim().length > 0 ? args.user_name.trim() : "inconnu"; return { result: `Ton nom, ${userName}, est maintenant enregistré dans ma mémoire` }; }',
                dependencies: { npm: [], python: [] },
                isEnabled: true,
                isReadonly: false,
                version: 1,
                createdAt: new Date(),
                updatedAt: new Date()
            } as any,
            userId: new mongoose.Types.ObjectId().toString(),
            args: { user_name: 'Ada' },
            launchContext: 'editor_test'
        });

        expect(execute).toHaveBeenCalledWith(expect.objectContaining({
            sourceCode: expect.stringContaining('exports.run = run;')
        }));
        expect(execute).toHaveBeenCalledWith(expect.objectContaining({
            sourceCode: expect.not.stringContaining('context: FunctionContext')
        }));
        expect(execute).toHaveBeenCalledWith(expect.objectContaining({
            sourceCode: expect.stringContaining('Ton nom, ')
        }));
    });

    it('persists a runtime escape attempt as a sandbox runtime error without inventing artifacts', async () => {
        const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'airdd2-orchestrator-escape-'));
        const outputRoot = path.join(tempRoot, 'output');
        await fs.mkdir(outputRoot, { recursive: true });
        await fs.writeFile(path.join(outputRoot, 'stale.log'), 'old artifact', 'utf-8');

        const orchestrator = new ExecutionOrchestrator();
        const failRun = jest.fn().mockResolvedValue(undefined);

        (orchestrator as any).runtimeHealthService = {
            getHealthReport: jest.fn().mockResolvedValue({ summary: 'ready' })
        };
        (orchestrator as any).buildService = {
            getBuildStatus: jest.fn().mockResolvedValue(null)
        };
        (orchestrator as any).workspaceManager = {
            ensureWorkflowWorkspace: jest.fn().mockResolvedValue({
                workspaceId: 'workspace-escape',
                wasCreated: false,
                logicalRoot: tempRoot,
                runtimeRoots: {
                    sourceRoot: path.join(tempRoot, 'source'),
                    manifestsRoot: path.join(tempRoot, 'manifests'),
                    buildRoot: path.join(tempRoot, 'build'),
                    outputRoot
                },
                manifests: {
                    packageJson: false,
                    packageLockJson: false,
                    requirementsTxt: false,
                    pyprojectToml: false
                },
                status: 'active',
                lastScanAt: null
            })
        };
        (orchestrator as any).sandboxRunnerFactory = {
            getPreferredRunner: jest.fn().mockReturnValue({
                getRunnerId: () => 'docker_sandbox',
                getReadiness: () => ({ ready: true })
            })
        };
        (orchestrator as any).dockerRunner = {
            execute: jest.fn().mockResolvedValue({
                success: false,
                output: null,
                stdout: '',
                stderr: 'Permission denied: /etc/passwd',
                durationMs: 12,
                exitCode: 1,
                runner: 'docker_sandbox',
                metadata: {
                    exitCode: 1,
                    failureKind: 'sandbox_runtime_error'
                },
                resourceUsage: {
                    wallTimeMs: 12,
                    memoryLimitMb: 256
                }
            })
        };
        (orchestrator as any).firecrackerRunner = {
            execute: jest.fn()
        };
        (orchestrator as any).userToolRunService = {
            createQueuedRun: jest.fn().mockResolvedValue(undefined),
            markRunning: jest.fn().mockResolvedValue(undefined),
            completeRun: jest.fn().mockResolvedValue(undefined),
            failRun,
            timeoutRun: jest.fn().mockResolvedValue(undefined)
        };

        const result = await orchestrator.execute({
            fn: {
                _id: new mongoose.Types.ObjectId(),
                userId: new mongoose.Types.ObjectId(),
                workflowId: new mongoose.Types.ObjectId(),
                name: 'escape_attempt',
                displayName: 'Escape Attempt',
                description: 'Try to write outside sandbox',
                language: 'python',
                origin: 'custom',
                tags: [],
                inputSchema: { type: 'object' },
                outputSchema: { type: 'object' },
                codeInline: 'def run(args):\n    open("/etc/passwd", "w")',
                dependencies: { npm: [], python: [] },
                isEnabled: true,
                isReadonly: false,
                version: 1,
                createdAt: new Date(),
                updatedAt: new Date()
            } as any,
            userId: new mongoose.Types.ObjectId().toString(),
            args: {},
            launchContext: 'editor_test'
        });

        expect(result.success).toBe(false);
        expect(result.metadata).toEqual(expect.objectContaining({
            failureKind: 'sandbox_runtime_error'
        }));
        expect(failRun).toHaveBeenCalledWith(
            result.executionId,
            expect.objectContaining({
                error: expect.objectContaining({
                    code: 'SANDBOX_RUNTIME_ERROR',
                    subsystem: 'sandbox_runtime',
                    failureKind: 'sandbox_runtime_error',
                    message: 'Permission denied: /etc/passwd'
                }),
                outputs: expect.not.objectContaining({
                    artifacts: expect.anything()
                })
            })
        );

        await fs.rm(tempRoot, { recursive: true, force: true });
    });
});