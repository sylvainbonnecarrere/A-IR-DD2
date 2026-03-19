import React from 'react';
import { render, screen } from '@testing-library/react';
import PhilFunctionsPage from '../../components/PhilFunctionsPage';

const mockUseFunctionStore = jest.fn();

jest.mock('../../hooks/useAuth', () => ({
    useAuth: jest.fn(() => ({
        isAuthenticated: true
    }))
}));

jest.mock('../../contexts/NotificationContext', () => ({
    useNotifications: jest.fn(() => ({
        addNotification: jest.fn()
    }))
}));

jest.mock('../../components/FunctionEditorTab', () => ({
    FunctionEditorTab: () => <div>FunctionEditorTab</div>
}));

jest.mock('../../components/SandboxHealthLoader', () => ({
    SandboxHealthLoader: () => <div>SandboxHealthLoader</div>
}));

jest.mock('../../stores/useFunctionStore', () => ({
    useFunctionStore: (...args: unknown[]) => mockUseFunctionStore(...args)
}));

const createStoreState = (overrides: Record<string, unknown> = {}) => ({
    isLoading: false,
    error: null,
    selectedFunctionId: null,
    filters: { origin: 'all', language: 'all', isEnabled: 'all', search: '' },
    functions: [],
    runtimeCompatibility: {
        checkedAt: '2026-03-19T10:00:00.000Z',
        mode: 'docker-desktop',
        securityLevel: 'dev-only',
        executionReady: true,
        preferredRunner: 'docker_sandbox',
        warning: 'Docker Desktop is dev-only.',
        summary: 'Runtime ready in dev mode.'
    },
    activeWorkspace: null,
    loadFunctions: jest.fn(),
    selectFunction: jest.fn(),
    toggleFunction: jest.fn(),
    deleteFunction: jest.fn(),
    setFilter: jest.fn(),
    getFilteredFunctions: jest.fn(() => []),
    createFunction: jest.fn(),
    getSelectedFunction: jest.fn(() => null),
    updateFunction: jest.fn(),
    ...overrides
});

describe('PhilFunctionsPage runtime compatibility banner', () => {
    beforeEach(() => {
        mockUseFunctionStore.mockImplementation(() => createStoreState());
    });

    it('renders the dev-only banner for Docker Desktop runtime compatibility', () => {
        render(<PhilFunctionsPage />);

        expect(screen.getByText('Compatibilité runtime')).toBeInTheDocument();
        expect(screen.getByText(/^Docker Desktop$/)).toBeInTheDocument();
        expect(screen.getByText(/niveau dev-only/)).toBeInTheDocument();
        expect(screen.getByText(/Docker Desktop is dev-only/)).toBeInTheDocument();
    });

    it('renders workspace context for the selected function in the detail panel', () => {
        mockUseFunctionStore.mockImplementation(() => createStoreState({
            selectedFunctionId: 'fn-1',
            getSelectedFunction: jest.fn(() => ({
                _id: 'fn-1',
                name: 'tool_alpha',
                description: 'Function with workspace context',
                language: 'python',
                origin: 'custom',
                userId: 'user-1',
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
                version: 3,
                tags: ['demo'],
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
                    lastScanAt: '2026-03-19T10:00:00.000Z'
                },
                createdAt: '2026-03-19T10:00:00.000Z',
                updatedAt: '2026-03-19T10:00:00.000Z'
            }))
        }));

        render(<PhilFunctionsPage />);

        expect(screen.getByText('Workspace')).toBeInTheDocument();
        expect(screen.getByText('wf-demo')).toBeInTheDocument();
        expect(screen.getByText('source')).toBeInTheDocument();
    });
});