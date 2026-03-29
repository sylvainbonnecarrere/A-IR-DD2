import React from 'react';
import { render, screen } from '@testing-library/react';
import { SandboxHealthLoader } from '../../components/SandboxHealthLoader';

const mockUseAuth = jest.fn();
const mockUseFunctionStore = jest.fn();

jest.mock('../../contexts/AuthContext', () => ({
    useAuth: () => mockUseAuth()
}));

jest.mock('../../stores/useFunctionStore', () => ({
    useFunctionStore: () => mockUseFunctionStore()
}));

describe('SandboxHealthLoader', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockUseAuth.mockReturnValue({
            accessToken: 'token',
            isAuthenticated: true
        });
        mockUseFunctionStore.mockReturnValue({
            runtimeHealth: {
                status: 'degraded',
                checkedAt: '2026-03-19T12:00:00.000Z',
                summary: 'Runtime MVP incomplet: imports natifs critiques',
                components: [],
                nativePython: {
                    available: false,
                    status: 'degraded',
                    summary: 'Imports critiques manquants ou cassés pour: web_search_py',
                    probes: [
                        {
                            toolName: 'web_search_py',
                            status: 'degraded',
                            summary: 'Imports critiques indisponibles pour web_search_py: duckduckgo_search',
                            checkedAt: '2026-03-19T12:00:00.000Z',
                            imports: [
                                {
                                    dependency: 'duckduckgo-search',
                                    module: 'duckduckgo_search',
                                    available: false,
                                    detail: 'ModuleNotFoundError: No module named duckduckgo_search'
                                }
                            ]
                        }
                    ]
                },
                runtime: {
                    node: { available: true, status: 'healthy', executable: 'node', version: '24.8.0' },
                    python: { available: true, status: 'healthy', executable: 'python3', version: '3.11.0' },
                    docker: {
                        available: true,
                        status: 'degraded',
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
                        dockerSandbox: { runner: 'docker_sandbox', available: true, status: 'degraded' },
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
            loadRuntimeHealth: jest.fn(async () => null)
        });
    });

    it('shows native Python import health in the runtime badge', () => {
        render(<SandboxHealthLoader />);

        expect(screen.getByText(/Runtime dev\/test \(dev-only\)/)).toBeInTheDocument();
        expect(screen.getByText(/imports natifs a verifier: web_search_py/)).toBeInTheDocument();
    });
});