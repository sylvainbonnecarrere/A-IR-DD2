import { act } from '@testing-library/react';
import { useFunctionStore } from '../../stores/useFunctionStore';
import { toolRepository } from '../../services/toolRepository';
import type { RuntimeHealthReport } from '../../types/function.types';

jest.mock('../../services/toolRepository', () => ({
    toolRepository: {
        loadPhilFunctions: jest.fn(),
        loadFunctionRuns: jest.fn(),
        loadRuntimeHealth: jest.fn(),
    }
}));

const mockedToolRepository = toolRepository as jest.Mocked<typeof toolRepository>;

const runtimeHealthFixture: RuntimeHealthReport = {
    status: 'healthy',
    checkedAt: '2026-03-19T12:00:00.000Z',
    summary: 'Runtime ready in dev mode.',
    components: [],
    runtime: {
        node: { available: true, status: 'healthy', executable: 'node', version: '24.8.0' },
        python: { available: true, status: 'healthy', executable: 'python3', version: '3.11.0' },
        docker: {
            available: true,
            status: 'healthy',
            executable: 'docker',
            version: '27.0.0',
            rootless: false,
            mode: 'docker-desktop',
            securityLevel: 'dev-only',
            executionReady: true,
            warning: 'Docker Desktop is dev-only.'
        },
        images: {
            node: { available: true, status: 'healthy', image: 'airdd2/node' },
            python: { available: true, status: 'healthy', image: 'airdd2/python' }
        },
        runners: {
            preferred: 'docker_sandbox',
            dockerSandbox: { runner: 'docker_sandbox', available: true, status: 'healthy' },
            firecracker: { runner: 'firecracker', available: false, status: 'degraded', detail: 'Not configured' }
        },
        typescript: { available: true, status: 'healthy', engine: 'node-subprocess' }
    },
    capabilities: {
        build: { typescript: true, python: true },
        run: { typescript: true, python: true, dockerRootless: false }
    },
    python: { available: true, executable: 'python3', version: '3.11.0' },
    typescript: { available: true, engine: 'node-subprocess' }
};

describe('useFunctionStore hybrid J9 flows', () => {
    beforeEach(() => {
        mockedToolRepository.loadPhilFunctions.mockReset();
        mockedToolRepository.loadFunctionRuns.mockReset();
        mockedToolRepository.loadRuntimeHealth.mockReset();
        useFunctionStore.getState().resetStore();
    });

    it('hydrates Phil reads from the hybrid repository with workspace context', async () => {
        mockedToolRepository.loadPhilFunctions.mockResolvedValue({
            functions: [
                {
                    _id: 'fn-1',
                    name: 'tool_alpha',
                    description: 'Tool projected from user_tools',
                    language: 'python',
                    origin: 'custom',
                    userId: null,
                    workflowId: 'wf-1',
                    inputSchema: {},
                    outputSchema: {},
                    codePath: 'tools/tool_alpha.py',
                    resolvedCodePath: 'tools/tool_alpha.py',
                    codePathRoot: 'workspace_source',
                    codeInline: 'def run(context, args):\n    return {"ok": True}',
                    dependencies: ['requests'],
                    isEnabled: true,
                    isReadonly: false,
                    version: 2,
                    tags: ['demo'],
                    createdAt: '2026-03-19T12:00:00.000Z',
                    updatedAt: '2026-03-19T12:00:00.000Z',
                    workspaceContext: {
                        workspaceId: 'ws-1',
                        logicalRoot: 'wf-demo',
                        runtimeRoots: {
                            sourceRoot: 'source',
                            manifestsRoot: 'manifests',
                            buildRoot: 'build',
                            outputRoot: 'output'
                        },
                        manifests: {
                            packageJson: false,
                            packageLockJson: false,
                            requirementsTxt: true,
                            pyprojectToml: false
                        },
                        status: 'active',
                        lastScanAt: '2026-03-19T12:00:00.000Z'
                    }
                }
            ],
            runtimeCompatibility: {
                checkedAt: '2026-03-19T12:00:00.000Z',
                mode: 'docker-desktop',
                securityLevel: 'dev-only',
                executionReady: true,
                preferredRunner: 'docker_sandbox',
                warning: 'Docker Desktop is dev-only.',
                summary: 'Runtime ready in dev mode.'
            },
            workspace: {
                id: 'ws-1',
                logicalRoot: 'wf-demo',
                runtimeRoots: {
                    sourceRoot: 'source',
                    manifestsRoot: 'manifests',
                    buildRoot: 'build',
                    outputRoot: 'output'
                },
                manifests: {
                    packageJson: false,
                    packageLockJson: false,
                    requirementsTxt: true,
                    pyprojectToml: false
                },
                status: 'active',
                lastScanAt: '2026-03-19T12:00:00.000Z',
                workflowId: 'wf-1'
            }
        });

        await act(async () => {
            await useFunctionStore.getState().loadFunctions('wf-1');
        });

        const state = useFunctionStore.getState();
        expect(mockedToolRepository.loadPhilFunctions).toHaveBeenCalledWith('wf-1');
        expect(state.functions).toHaveLength(1);
        expect(state.activeWorkspace).toEqual(expect.objectContaining({ logicalRoot: 'wf-demo' }));
        expect(state.runtimeCompatibility).toEqual(expect.objectContaining({ mode: 'docker-desktop' }));
    });

    it('updates runtime compatibility from runs and runtime health through the repository', async () => {
        mockedToolRepository.loadFunctionRuns.mockResolvedValue({
            data: {
                items: [
                    {
                        executionId: 'run-1',
                        status: 'completed',
                        runtime: 'python',
                        runner: 'docker_sandbox',
                        launchContext: 'editor_test',
                        createdAt: '2026-03-19T12:00:00.000Z',
                        updatedAt: '2026-03-19T12:00:00.000Z',
                        timing: { durationMs: 15 },
                        outputs: { artifacts: [] }
                    }
                ],
                pagination: { page: 1, limit: 20, total: 1, totalPages: 1, sortBy: 'createdAt', sortOrder: 'desc' },
                runtimeCompatibility: {
                    checkedAt: '2026-03-19T12:00:00.000Z',
                    mode: 'rootless',
                    securityLevel: 'production-ready',
                    executionReady: true,
                    preferredRunner: 'docker_sandbox',
                    summary: 'Rootless runtime ready.'
                }
            }
        } as any);
        mockedToolRepository.loadRuntimeHealth.mockResolvedValue({ data: runtimeHealthFixture } as any);

        await act(async () => {
            await useFunctionStore.getState().loadFunctionRuns('fn-1');
        });

        expect(useFunctionStore.getState().runtimeCompatibility).toEqual(expect.objectContaining({
            mode: 'rootless',
            securityLevel: 'production-ready'
        }));

        await act(async () => {
            await useFunctionStore.getState().loadRuntimeHealth();
        });

        const state = useFunctionStore.getState();
        expect(mockedToolRepository.loadRuntimeHealth).toHaveBeenCalled();
        expect(state.runtimeHealth).toEqual(runtimeHealthFixture);
        expect(state.runtimeCompatibility).toEqual(expect.objectContaining({
            mode: 'docker-desktop',
            warning: 'Docker Desktop is dev-only.'
        }));
    });
});