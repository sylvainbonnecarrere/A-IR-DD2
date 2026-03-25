import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FunctionEditorTab } from '../../components/FunctionEditorTab';
import { toolRepository } from '../../services/toolRepository';

const mockStore = jest.fn();
const mockAddNotification = jest.fn();

jest.mock('@monaco-editor/react', () => {
    const React = require('react');
    return function MockEditor(props: any) {
        return React.createElement('textarea', {
            'data-testid': `mock-editor-${props.language}`,
            value: props.value ?? '',
            onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => props.onChange?.(event.target.value),
        });
    };
});

jest.mock('../../stores/useFunctionStore', () => ({
    useFunctionStore: (...args: unknown[]) => mockStore(...args)
}));

jest.mock('../../contexts/NotificationContext', () => ({
    useNotifications: () => ({ addNotification: mockAddNotification })
}));

jest.mock('../../services/toolRepository', () => ({
    toolRepository: {
        downloadArtifact: jest.fn(),
    }
}));

const mockedToolRepository = toolRepository as jest.Mocked<typeof toolRepository>;

const createStoreState = (overrides: Record<string, unknown> = {}) => ({
    getSelectedFunction: jest.fn(() => ({
        _id: 'fn-1',
        toolId: 'tool-1',
        name: 'tool_alpha',
        description: 'Editable tool',
        language: 'python',
        origin: 'custom',
        userId: null,
        workflowId: 'wf-1',
        inputSchema: {},
        outputSchema: {},
        codePath: 'tools/tool_alpha.py',
        resolvedCodePath: 'tools/tool_alpha.py',
        codePathRoot: 'workspace_source',
        codeInline: 'print("initial")',
        dependencies: ['requests'],
        isEnabled: true,
        isReadonly: false,
        version: 2,
        tags: [],
        createdAt: '2026-03-19T12:00:00.000Z',
        updatedAt: '2026-03-19T12:00:00.000Z'
    })),
    updateFunction: jest.fn(async (_id: string, payload: Record<string, unknown>) => ({
        _id: 'fn-1',
        name: 'tool_alpha',
        description: 'Editable tool',
        language: 'python',
        origin: 'custom',
        userId: null,
        workflowId: 'wf-1',
        inputSchema: payload.inputSchema ?? {},
        outputSchema: payload.outputSchema ?? {},
        codePath: 'tools/tool_alpha.py',
        resolvedCodePath: 'tools/tool_alpha.py',
        codePathRoot: 'workspace_source',
        codeInline: (payload.codeInline as string) ?? 'print("initial")',
        dependencies: ['requests'],
        isEnabled: true,
        isReadonly: false,
        version: 2,
        tags: [],
        createdAt: '2026-03-19T12:00:00.000Z',
        updatedAt: '2026-03-19T12:00:00.000Z'
    })),
    updateInlineCodeOptimistic: jest.fn(),
    runInSandbox: jest.fn(async () => undefined),
    checkSyntax: jest.fn(async () => ({ valid: true, errors: [] })),
    clearSandboxResult: jest.fn(),
    loadFunctionRuns: jest.fn(async () => undefined),
    loadArtifactPreview: jest.fn(async () => undefined),
    cleanupFunctionRuns: jest.fn(async () => ({ deletedRuns: 1, deletedArtifacts: [], retainedRuns: 2, dryRun: false })),
    clearArtifactPreview: jest.fn(),
    runBuild: jest.fn(async () => ({
        functionId: 'fn-1',
        functionName: 'tool_alpha',
        language: 'python',
        workspaceId: 'ws-1',
        workflowId: 'wf-1',
        buildRoot: 'build',
        sourcePath: 'source/tool_alpha.py',
        status: 'ready',
        builtAt: '2026-03-19T12:00:00.000Z',
        manifestPaths: ['requirements.txt'],
        artifactPaths: ['build/tool_alpha.pyc'],
        warnings: []
    })),
    loadBuildStatus: jest.fn(async () => undefined),
    clearBuildResult: jest.fn(),
    sandboxResult: null,
    isSandboxRunning: false,
    sandboxError: null,
    functionRuns: [
        {
            executionId: 'run-1',
            status: 'completed',
            runtime: 'python',
            runner: 'docker_sandbox',
            launchContext: 'editor_test',
            createdAt: '2026-03-19T12:00:00.000Z',
            updatedAt: '2026-03-19T12:00:00.000Z',
            timing: { durationMs: 12 },
            outputs: { artifacts: [{ path: 'output/result.json', kind: 'json' }] }
        }
    ],
    functionRunsPagination: { page: 1, limit: 20, total: 1, totalPages: 1, sortBy: 'createdAt', sortOrder: 'desc' },
    isFunctionRunsLoading: false,
    functionRunsError: null,
    artifactPreview: null,
    isArtifactPreviewLoading: false,
    artifactPreviewError: null,
    buildResult: null,
    isBuilding: false,
    buildError: null,
    runtimeHealth: {
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
    },
    isRuntimeHealthLoading: false,
    runtimeHealthError: null,
    loadRuntimeHealth: jest.fn(async () => null),
    ...overrides
});

describe('FunctionEditorTab J9 commands', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockStore.mockImplementation(() => createStoreState());
        mockedToolRepository.downloadArtifact.mockResolvedValue({ data: new Blob(['ok']) } as any);
        jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
        Object.defineProperty(window, 'URL', {
            value: {
                createObjectURL: jest.fn(() => 'blob:preview'),
                revokeObjectURL: jest.fn(),
            },
            writable: true,
        });
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('saves code before running and before preparing a build', async () => {
        const state = createStoreState();
        mockStore.mockImplementation(() => state);

        render(<FunctionEditorTab />);

        await waitFor(() => {
            expect(state.loadBuildStatus).toHaveBeenCalledWith('tool-1');
            expect(state.loadFunctionRuns).toHaveBeenCalledWith('tool-1', expect.objectContaining({ page: 1 }));
        });

        fireEvent.change(screen.getByTestId('mock-editor-python'), { target: { value: 'print("changed")' } });
        fireEvent.click(screen.getByText('Exécuter'));

        await waitFor(() => {
            expect(state.updateFunction).toHaveBeenCalledWith('fn-1', { codeInline: 'print("changed")' });
            expect(state.runInSandbox).toHaveBeenCalledWith('fn-1', {});
        });

        fireEvent.click(screen.getByText('Préparer build'));

        await waitFor(() => {
            expect(state.runBuild).toHaveBeenCalledWith('tool-1');
        });
    });

    it('does not request build status or run builds for non-workflow-scoped functions', async () => {
        const state = createStoreState({
            getSelectedFunction: jest.fn(() => ({
                _id: 'fn-2',
                toolId: 'tool-2',
                name: 'tool_beta',
                description: 'Standalone tool',
                language: 'typescript',
                origin: 'custom',
                userId: null,
                workflowId: null,
                inputSchema: {},
                outputSchema: {},
                codePath: 'tools/tool_beta.ts',
                resolvedCodePath: 'tools/tool_beta.ts',
                codePathRoot: 'workspace_source',
                codeInline: 'export function run() { return { ok: true }; }',
                dependencies: [],
                isEnabled: true,
                isReadonly: false,
                version: 1,
                tags: [],
                createdAt: '2026-03-19T12:00:00.000Z',
                updatedAt: '2026-03-19T12:00:00.000Z'
            }))
        });
        mockStore.mockImplementation(() => state);

        render(<FunctionEditorTab />);

        await waitFor(() => {
            expect(state.loadFunctionRuns).toHaveBeenCalledWith('tool-2', expect.objectContaining({ page: 1 }));
        });
        expect(state.loadBuildStatus).not.toHaveBeenCalled();

        const buildButton = screen.getByText('Préparer build');
        expect(buildButton).toBeDisabled();
        expect(buildButton).toHaveAttribute('title', 'Le build est réservé aux fonctions custom rattachées à un workflow.');

        fireEvent.click(buildButton);

        expect(state.runBuild).not.toHaveBeenCalled();
    });

    it('blocks execution on invalid JSON args and downloads artifacts through the repository', async () => {
        const state = createStoreState();
        mockStore.mockImplementation(() => state);

        render(<FunctionEditorTab />);

        fireEvent.change(screen.getByPlaceholderText('{"param1": "valeur", "param2": 42}'), {
            target: { value: '{ invalid json' }
        });
        fireEvent.click(screen.getByText('Exécuter'));

        await waitFor(() => {
            expect(mockAddNotification).toHaveBeenCalledWith(expect.objectContaining({ title: 'JSON invalide' }));
        });
        expect(state.runInSandbox).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Télécharger output/result.json' }));

        await waitFor(() => {
            expect(mockedToolRepository.downloadArtifact).toHaveBeenCalledWith('tool-1', 'run-1', 'output/result.json');
        });
    });
});