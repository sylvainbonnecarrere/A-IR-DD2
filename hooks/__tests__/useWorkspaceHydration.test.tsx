import React from 'react';
import { render, waitFor, cleanup } from '@testing-library/react';
import { useWorkspaceHydration, type UseWorkspaceHydrationResult } from '../useWorkspaceHydration';
import { useAuth } from '../useAuth';
import { useDesignStore } from '../../stores/useDesignStore';
import { useRuntimeStore } from '../../stores/useRuntimeStore';
import { useWorkflowStore } from '../../stores/useWorkflowStore';

jest.mock('../useAuth', () => ({
    useAuth: jest.fn()
}));

const mockedUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;

describe('useWorkspaceHydration', () => {
    let latestResult: UseWorkspaceHydrationResult | null = null;

    function HookProbe() {
        latestResult = useWorkspaceHydration();
        return null;
    }

    beforeEach(() => {
        latestResult = null;
        useDesignStore.getState().resetAll();
        useRuntimeStore.getState().resetAll();
        useWorkflowStore.getState().resetAll();
        localStorage.clear();
        mockedUseAuth.mockReturnValue({
            isAuthenticated: true,
            accessToken: 'test-token',
            isLoading: false,
            sessionStatus: 'ready',
            user: { id: 'user-1', email: 'user@example.com' },
            login: jest.fn(),
            register: jest.fn(),
            logout: jest.fn(),
            updateUser: jest.fn()
        } as any);
        global.fetch = jest.fn();
    });

    afterEach(() => {
        cleanup();
        jest.clearAllMocks();
        useDesignStore.getState().resetAll();
        useRuntimeStore.getState().resetAll();
        useWorkflowStore.getState().resetAll();
        localStorage.clear();
    });

    it('hydrates additive workspaceContext and toolRuns from the API contract', async () => {
        (global.fetch as jest.Mock).mockResolvedValue({
            ok: true,
            json: async () => ({
                workspaceContext: {
                    id: 'workspace-1',
                    scopeType: 'workflow',
                    scopeId: 'workflow-1',
                    status: 'active',
                    manifests: {
                        packageJson: true,
                        packageLockJson: false,
                        requirementsTxt: true,
                        pyprojectToml: false
                    },
                    lastScanAt: '2026-03-17T10:00:00.000Z'
                },
                workflow: {
                    id: 'workflow-1',
                    name: 'Workflow API',
                    isActive: true,
                    isDefault: true,
                    isDirty: false,
                    canvasState: { zoom: 1, panX: 0, panY: 0 },
                    createdAt: '2026-03-17T09:00:00.000Z',
                    updatedAt: '2026-03-17T09:30:00.000Z'
                },
                nodes: [],
                edges: [],
                agentInstances: [{
                    id: 'instance-1',
                    prototypeId: 'prototype-1',
                    workflowId: 'workflow-1',
                    name: 'Hydrated Agent',
                    position: { x: 120, y: 180 },
                    llmProvider: 'openai',
                    llmModel: 'gpt-4o-mini',
                    configuration_json: {
                        role: 'assistant',
                        model: 'gpt-4o-mini',
                        llmProvider: 'openai',
                        systemPrompt: 'Be precise',
                        capabilities: ['chat'],
                        tools: [],
                        historyConfig: {},
                        outputConfig: {},
                        position: { x: 120, y: 180 }
                    },
                    chatMessages: [{
                        sender: 'agent',
                        text: 'restored from backend',
                        timestamp: '2026-03-17T10:05:00.000Z'
                    }]
                }],
                llmConfigs: [],
                toolRuns: [{
                    id: 'run-1',
                    executionId: 'exec-1',
                    toolId: 'prototype-1',
                    toolVersionTag: 'v1',
                    toolContentHash: 'hash-1',
                    workflowId: 'workflow-1',
                    agentPrototypeId: 'prototype-1',
                    agentInstanceId: 'instance-1',
                    launchContext: 'workflow_run',
                    status: 'completed',
                    runtime: 'python',
                    runner: 'docker_rootless',
                    inputs: {},
                    timing: {
                        queuedAt: '2026-03-17T10:00:00.000Z',
                        startedAt: '2026-03-17T10:00:05.000Z',
                        finishedAt: '2026-03-17T10:00:12.000Z',
                        durationMs: 7000
                    },
                    createdAt: '2026-03-17T10:00:00.000Z',
                    updatedAt: '2026-03-17T10:00:12.000Z'
                }],
                userSettings: {
                    language: 'fr',
                    theme: 'dark'
                },
                metadata: {
                    loadedAt: '2026-03-17T10:05:00.000Z',
                    userId: 'user-1',
                    hasWorkflow: true
                }
            })
        });

        render(<HookProbe />);

        await waitFor(() => expect(latestResult?.isLoading).toBe(false));

        expect(latestResult?.error).toBeNull();
        expect(latestResult?.source).toBe('api');
        expect(latestResult?.workspace?.workspaceContext).toEqual(expect.objectContaining({
            id: 'workspace-1',
            scopeType: 'workflow',
            scopeId: 'workflow-1',
            status: 'active'
        }));
        expect(latestResult?.workspace?.toolRuns).toHaveLength(1);
        expect(latestResult?.workspace?.toolRuns[0]).toEqual(expect.objectContaining({
            executionId: 'exec-1',
            status: 'completed',
            runtime: 'python'
        }));

        const designState = useDesignStore.getState();
        expect(designState.agentInstances).toHaveLength(1);
        expect(designState.agentInstances[0].name).toBe('Hydrated Agent');
        expect(designState.nodes).toHaveLength(1);

        const runtimeState = useRuntimeStore.getState();
        expect(runtimeState.nodeMessages['instance-1']).toHaveLength(1);
        expect(runtimeState.nodeMessages['instance-1'][0].text).toBe('restored from backend');

        const workflowState = useWorkflowStore.getState();
        expect(workflowState.currentWorkflow).toEqual(expect.objectContaining({
            id: 'workflow-1',
            name: 'Workflow API',
            isActive: true,
            isDefault: true,
            canvasState: { zoom: 1, panX: 0, panY: 0 }
        }));
        expect(workflowState.getCurrentWorkflowId()).toBe('workflow-1');
    });

    it('waits for a stable authenticated session before calling the workspace API', async () => {
        mockedUseAuth.mockReturnValue({
            isAuthenticated: true,
            accessToken: 'refreshing-token',
            isLoading: false,
            sessionStatus: 'restoring-session',
            user: { id: 'user-1', email: 'user@example.com' },
            login: jest.fn(),
            register: jest.fn(),
            logout: jest.fn(),
            updateUser: jest.fn()
        } as any);

        render(<HookProbe />);

        await waitFor(() => expect(latestResult?.isLoading).toBe(true));
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('remains compatible with API payloads that omit additive fields', async () => {
        (global.fetch as jest.Mock).mockResolvedValue({
            ok: true,
            json: async () => ({
                workflow: {
                    id: 'workflow-legacy',
                    name: 'Legacy Workflow',
                    isActive: true,
                    isDefault: true,
                    isDirty: false,
                    canvasState: { zoom: 1, panX: 0, panY: 0 },
                    createdAt: '2026-03-17T08:00:00.000Z',
                    updatedAt: '2026-03-17T08:30:00.000Z'
                },
                nodes: [],
                edges: [],
                agentInstances: [{
                    id: 'legacy-instance',
                    name: 'Legacy Agent',
                    position: { x: 20, y: 40 },
                    llmProvider: 'gemini',
                    llmModel: 'gemini-2.0-flash',
                    chatMessages: []
                }],
                llmConfigs: [],
                userSettings: {
                    language: 'en',
                    theme: 'light'
                },
                metadata: {
                    loadedAt: '2026-03-17T08:35:00.000Z',
                    userId: 'user-legacy',
                    hasWorkflow: true
                }
            })
        });

        render(<HookProbe />);

        await waitFor(() => expect(latestResult?.isLoading).toBe(false));

        expect(latestResult?.error).toBeNull();
        expect(latestResult?.source).toBe('api');
        expect(latestResult?.workspace?.workspaceContext).toBeUndefined();
        expect(latestResult?.workspace?.toolRuns).toBeUndefined();

        const designState = useDesignStore.getState();
        expect(designState.agentInstances).toHaveLength(1);
        expect(designState.agentInstances[0].name).toBe('Legacy Agent');
        expect(designState.nodes).toHaveLength(1);

        const workflowState = useWorkflowStore.getState();
        expect(workflowState.currentWorkflow).toEqual(expect.objectContaining({
            id: 'workflow-legacy',
            name: 'Legacy Workflow',
            isActive: true,
            isDefault: true
        }));
    });

    it('wipes workflow, design, and runtime stores before hydrating a new authenticated session', async () => {
        (global.fetch as jest.Mock).mockResolvedValue({
            ok: true,
            json: async () => ({
                workflow: {
                    id: 'workflow-auth',
                    name: 'Authenticated Workflow',
                    isActive: true,
                    isDefault: true,
                    isDirty: false,
                    canvasState: { zoom: 2, panX: 10, panY: 20 },
                    createdAt: '2026-03-17T08:00:00.000Z',
                    updatedAt: '2026-03-17T08:30:00.000Z'
                },
                nodes: [],
                edges: [],
                agentInstances: [
                    {
                        id: 'auth-instance',
                        name: 'Auth Agent',
                        position: { x: 20, y: 40 },
                        llmProvider: 'gemini',
                        llmModel: 'gemini-2.0-flash',
                        chatMessages: []
                    }
                ],
                llmConfigs: [],
                userSettings: {
                    language: 'fr',
                    theme: 'dark'
                },
                metadata: {
                    loadedAt: '2026-03-17T08:35:00.000Z',
                    userId: 'user-auth',
                    hasWorkflow: true
                }
            })
        });

        mockedUseAuth.mockReturnValue({
            isAuthenticated: false,
            accessToken: null,
            isLoading: false,
            sessionStatus: 'ready',
            user: null,
            login: jest.fn(),
            register: jest.fn(),
            logout: jest.fn(),
            updateUser: jest.fn()
        } as any);

        useDesignStore.getState().hydrateFromServer({
            agentInstances: [{
                id: 'guest-instance',
                prototypeId: 'guest-prototype',
                name: 'Guest Agent',
                position: { x: 1, y: 2 },
                isMinimized: false,
                isMaximized: false,
                configuration_json: null
            } as any],
            nodes: [],
            edges: []
        });
        useRuntimeStore.getState().setNodeMessages('guest-instance', [{
            id: 'guest-msg',
            sender: 'agent',
            text: 'guest',
            timestamp: new Date('2026-03-17T07:00:00.000Z')
        }]);
        useWorkflowStore.getState().hydrateWorkflowFromServer({
            id: 'guest-workflow',
            name: 'Guest Workflow',
            isActive: true,
            isDefault: true,
            canvasState: { zoom: 1, panX: 0, panY: 0 }
        });

        const { rerender } = render(<HookProbe />);

        await waitFor(() => expect(latestResult?.source).toBe('localStorage'));

        mockedUseAuth.mockReturnValue({
            isAuthenticated: true,
            accessToken: 'auth-token',
            isLoading: false,
            sessionStatus: 'ready',
            user: { id: 'user-auth', email: 'auth@example.com' },
            login: jest.fn(),
            register: jest.fn(),
            logout: jest.fn(),
            updateUser: jest.fn()
        } as any);

        rerender(<HookProbe />);

        await waitFor(() => expect(latestResult?.source).toBe('api'));

        const designState = useDesignStore.getState();
        expect(designState.agentInstances).toHaveLength(1);
        expect(designState.agentInstances[0].id).toBe('auth-instance');
        expect(designState.agentInstances.find((instance) => instance.id === 'guest-instance')).toBeUndefined();

        const runtimeState = useRuntimeStore.getState();
        expect(runtimeState.nodeMessages['guest-instance']).toBeUndefined();

        const workflowState = useWorkflowStore.getState();
        expect(workflowState.currentWorkflow).toEqual(expect.objectContaining({
            id: 'workflow-auth',
            name: 'Authenticated Workflow'
        }));
        expect(workflowState.currentWorkflow?.id).not.toBe('guest-workflow');
    });
});