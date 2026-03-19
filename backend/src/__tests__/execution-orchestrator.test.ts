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
        const createAndStartRun = jest.fn().mockResolvedValue(undefined);
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
            createAndStartRun,
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
        expect(failRun).not.toHaveBeenCalled();

        await fs.rm(tempRoot, { recursive: true, force: true });
    });
});