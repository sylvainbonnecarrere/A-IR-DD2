import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import App from '../../App';
import { selectResolvedAgentExecutionSelectionContext } from '../../stores/useDesignStore';
import apiClient from '../../utils/apiClient';
import { useAuth } from '../../contexts/AuthContext';
import { PersistenceService } from '../../services/persistenceService';
import type { UserFunction } from '../../types/function.types';

const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockHydrateToolMessagesFromPersistedRuns = jest.fn(async (messages: any[]) => messages);
let autoSignalWorkflowCanvasReady = true;

const mockRuntimeStore = {
    llmConfigs: [] as any[],
    localLLMProfiles: [] as any[],
    nodeMessages: {} as Record<string, any[]>,
    updateLLMConfigs: jest.fn((configs: any[]) => {
        mockRuntimeStore.llmConfigs = configs;
    }),
    updateLocalLLMProfiles: jest.fn((profiles: any[]) => {
        mockRuntimeStore.localLLMProfiles = profiles;
    }),
    setNavigationHandler: jest.fn(),
    addNodeMessage: jest.fn(),
    setNodeMessages: jest.fn((nodeId: string, messages: any[]) => {
        mockRuntimeStore.nodeMessages[nodeId] = messages;
    }),
    getNodeMessages: jest.fn((nodeId: string) => mockRuntimeStore.nodeMessages[nodeId] || []),
    resetForWorkflowSwitch: jest.fn(),
    resetAll: jest.fn()
};

const mockDesignStore = {
    agents: [] as any[],
    validateWorkflowIntegrity: jest.fn(() => ({ fixedCount: 0 })),
    cleanupOrphanedInstances: jest.fn(() => 0),
    addAgentInstance: jest.fn(),
    deleteNode: jest.fn(),
    deleteAgentInstance: jest.fn(),
    hydrateFromServer: jest.fn(),
    setCurrentWorkflowId: jest.fn(),
    updateInstanceId: jest.fn(),
    updateAgentInstance: jest.fn(),
    addNode: jest.fn(),
    updateNode: jest.fn(),
    agentInstances: [],
    nodes: [],
    workflows: [] as any[],
    currentWorkflowId: 'workflow-1',
    currentRobotId: 'BO_002',
    resetAll: jest.fn(),
    loadUserWorkflows: jest.fn().mockResolvedValue(undefined)
};

const mockWorkflowStore = {
    hydrateWorkflowFromServer: jest.fn(),
    getCurrentWorkflowId: jest.fn(() => 'workflow-1'),
    resetAll: jest.fn()
};

const mockFunctionStore = {
    loadFunctions: jest.fn().mockResolvedValue(undefined),
    resetStore: jest.fn(),
};

let documentVisibilityState: DocumentVisibilityState = 'visible';
Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => documentVisibilityState,
});

jest.mock('../../contexts/AuthContext', () => ({
    AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useAuth: jest.fn()
}));

jest.mock('../../utils/apiClient', () => ({
    __esModule: true,
    default: {
        get: jest.fn(),
        post: jest.fn()
    }
}));

jest.mock('../../services/bosRunProjectionService', () => ({
    hydrateToolMessagesFromPersistedRuns: (messages: any[]) => mockHydrateToolMessagesFromPersistedRuns(messages),
    buildBosHydrationFingerprint: jest.fn(() => ''),
}));

jest.mock('../../components/NavigationLayout', () => ({
    NavigationLayout: ({ agents }: { agents: Array<unknown> }) => <div data-testid="agents-count">{agents.length}</div>
}));

jest.mock('../../components/RobotPageRouter', () => ({
    RobotPageRouter: ({ onDeleteNode, llmConfigs, onWorkflowCanvasReady, onUpdateNodePosition }: { onDeleteNode?: (nodeId: string) => Promise<void> | void; llmConfigs?: Array<unknown>; onWorkflowCanvasReady?: () => void; onUpdateNodePosition?: (nodeId: string, position: { x: number; y: number }, options?: { persist?: boolean }) => void }) => {
        React.useEffect(() => {
            if (autoSignalWorkflowCanvasReady) {
                onWorkflowCanvasReady?.();
            }
        });

        return (
            <div data-testid="robot-page-router">
                <div data-testid="router-node-count">{mockDesignStore.nodes.length}</div>
                <div data-testid="router-llm-config-count">{llmConfigs?.length ?? 0}</div>
                <button type="button" data-testid="delete-node-button" onClick={() => onDeleteNode?.('node-instance-1')}>
                    delete node
                </button>
                <button type="button" data-testid="move-node-button" onClick={() => onUpdateNodePosition?.('node-instance-1', { x: 111, y: 222 }, { persist: true })}>
                    move node
                </button>
                <button type="button" data-testid="sync-node-button" onClick={() => onUpdateNodePosition?.('node-instance-1', { x: 333, y: 444 })}>
                    sync node
                </button>
                <button type="button" data-testid="canvas-ready-button" onClick={() => onWorkflowCanvasReady?.()}>
                    canvas ready
                </button>
            </div>
        );
    }
}));

jest.mock('../../components/Header', () => ({
    Header: () => <div data-testid="header" />
}));

jest.mock('../../components/HydrationOverlay', () => ({
    HydrationOverlay: ({ isLoading }: { isLoading: boolean }) => (
        <div data-testid="hydration-overlay">{isLoading ? 'loading' : 'idle'}</div>
    )
}));

jest.mock('../../components/WorkflowSwitchOverlay', () => ({
    WorkflowSwitchOverlay: () => null
}));

jest.mock('../../components/HyperspaceReveal', () => ({
    HyperspaceReveal: () => null
}));

jest.mock('../../components/NotificationDisplay', () => ({
    NotificationDisplay: () => null
}));

jest.mock('../../components/modals/AgentFormModal', () => ({ AgentFormModal: () => null }));
jest.mock('../../components/modals/SettingsModal', () => ({ SettingsModal: () => null }));
jest.mock('../../components/modals/LoginModal', () => ({ LoginModal: () => null }));
jest.mock('../../components/modals/RegisterModal', () => ({ RegisterModal: () => null }));
jest.mock('../../components/modals/ConfirmationModal', () => ({ ConfirmationModal: () => null }));
jest.mock('../../components/modals/FullscreenChatModal', () => ({ FullscreenChatModal: () => null }));
jest.mock('../../components/modals/AgentConfigurationModal', () => ({
    AgentConfigurationModal: ({ llmConfigs, localLLMProfiles }: { llmConfigs?: Array<unknown>; localLLMProfiles?: Array<unknown> }) => (
        <div data-testid="agent-config-modal-state">
            {`${llmConfigs?.length ?? 0}:${localLLMProfiles?.length ?? 0}`}
        </div>
    )
}));
jest.mock('../../components/panels/ImageGenerationPanel', () => ({ ImageGenerationPanel: () => null }));
jest.mock('../../components/panels/ImageModificationPanel', () => ({ ImageModificationPanel: () => null }));
jest.mock('../../components/panels/VideoGenerationConfigPanel', () => ({ VideoGenerationConfigPanel: () => null }));
jest.mock('../../components/panels/MapsGroundingConfigPanel', () => ({ MapsGroundingConfigPanel: () => null }));

jest.mock('../../providers', () => ({
    QueryProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>
}));

jest.mock('../../contexts', () => ({
    NotificationProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>
}));

jest.mock('../../hooks/useLocalization', () => ({
    useLocalization: () => ({ t: (key: string) => key })
}));

jest.mock('../../hooks/useJournalQueue', () => ({
    useJournalQueue: () => ({ enqueueEntry: jest.fn() })
}));

jest.mock('../../services/persistenceService', () => ({
    PersistenceService: {
        saveAgentInstance: jest.fn().mockResolvedValue({ success: true }),
        createAgentInstance: jest.fn(),
        saveWorkflow: jest.fn(),
        saveCanvasState: jest.fn(),
        addAgentInstanceContent: jest.fn(),
        createChatContent: jest.fn(),
        createErrorContent: jest.fn(),
        createImageContent: jest.fn(),
    }
}));

jest.mock('../../utils/SettingsStorage', () => ({
    getSettingsStorage: () => ({
        getSidebarCollapsed: () => false,
        setSidebarCollapsed: jest.fn()
    })
}));

jest.mock('../../stores/useRuntimeStore', () => ({
    useRuntimeStore: Object.assign((selector?: (state: typeof mockRuntimeStore) => unknown) => selector ? selector(mockRuntimeStore) : mockRuntimeStore, {
        getState: () => mockRuntimeStore
    })
}));

jest.mock('../../stores/useDesignStore', () => {
    const actual = jest.requireActual('../../stores/useDesignStore');

    return {
        ...actual,
        useDesignStore: Object.assign((selector?: (state: typeof mockDesignStore) => unknown) => selector ? selector(mockDesignStore) : mockDesignStore, {
            getState: () => mockDesignStore
        })
    };
});

jest.mock('../../stores/useWorkflowStore', () => ({
    useWorkflowStore: Object.assign((selector?: (state: typeof mockWorkflowStore) => unknown) => selector ? selector(mockWorkflowStore) : mockWorkflowStore, {
        getState: () => mockWorkflowStore
    })
}));

jest.mock('../../stores/useFunctionStore', () => ({
    useFunctionStore: Object.assign(() => mockFunctionStore, {
        getState: () => mockFunctionStore
    })
}));

describe('App workspace hydration orchestration', () => {
    const workspacePayload = {
        workflow: {
            id: 'workflow-1',
            name: 'Workspace principal',
            isActive: true,
            isDefault: true,
            canvasState: { zoom: 1, panX: 0, panY: 0 }
        },
        agentPrototypes: [
            {
                id: 'prototype-1',
                name: 'Agent stable',
                description: 'assistant',
                systemPrompt: 'Be stable',
                provider: 'gemini',
                model: 'gemini-2.0-flash',
                capabilities: [],
                tools: [],
                toolSelections: []
            }
        ],
        agentInstances: [
            {
                id: 'instance-1',
                prototypeId: 'prototype-1',
                name: 'Agent stable',
                position: { x: 10, y: 20 },
                isMinimized: false,
                isMaximized: false,
                configuration_json: {
                    role: 'assistant',
                    model: 'gemini-2.0-flash',
                    llmProvider: 'gemini',
                    systemPrompt: 'Be stable',
                    capabilities: [],
                    tools: [],
                    toolSelections: [],
                    historyConfig: {},
                    outputConfig: {},
                    position: { x: 10, y: 20 }
                }
            }
        ],
        nodes: [],
        edges: []
    };

    beforeEach(() => {
        jest.clearAllMocks();
        autoSignalWorkflowCanvasReady = true;
        mockHydrateToolMessagesFromPersistedRuns.mockReset().mockImplementation(async (messages: any[]) => messages);
        mockRuntimeStore.llmConfigs = [];
        mockRuntimeStore.localLLMProfiles = [];
        mockRuntimeStore.nodeMessages = {};
        mockDesignStore.agents = [];
        mockDesignStore.agentInstances = [];
        mockDesignStore.nodes = [];
        mockDesignStore.workflows = [];
        mockDesignStore.currentWorkflowId = 'workflow-1';
        documentVisibilityState = 'visible';
        const clearMock = (value: unknown) => {
            if (typeof value === 'function' && typeof (value as { mockClear?: unknown }).mockClear === 'function') {
                (value as jest.Mock).mockClear();
            }
        };
        Object.values(mockRuntimeStore).forEach((value) => {
            clearMock(value);
        });
        Object.values(mockDesignStore).forEach((value) => {
            clearMock(value);
        });
        Object.values(mockWorkflowStore).forEach((value) => {
            clearMock(value);
        });
        Object.values(mockFunctionStore).forEach((value) => {
            clearMock(value);
        });
        mockDesignStore.hydrateFromServer.mockImplementation((data: { agents?: any[]; agentInstances?: any[]; nodes?: any[] }) => {
            mockDesignStore.agents = data.agents || [];
            mockDesignStore.agentInstances = data.agentInstances || [];
            mockDesignStore.nodes = data.nodes || [];
        });
        mockDesignStore.deleteNode.mockImplementation((nodeId: string) => {
            mockDesignStore.nodes = mockDesignStore.nodes.filter((node: any) => node.id !== nodeId);
        });
        mockDesignStore.deleteAgentInstance.mockImplementation((instanceId: string) => {
            mockDesignStore.agentInstances = mockDesignStore.agentInstances.filter((instance: any) => instance.id !== instanceId);
        });
        mockDesignStore.updateNode.mockImplementation((nodeId: string, updates: { position?: { x: number; y: number } }) => {
            mockDesignStore.nodes = mockDesignStore.nodes.map((node: any) => node.id === nodeId ? { ...node, ...updates } : node);
        });
        mockDesignStore.updateAgentInstance.mockImplementation((instanceId: string, updates: { position?: { x: number; y: number } }) => {
            mockDesignStore.agentInstances = mockDesignStore.agentInstances.map((instance: any) => instance.id === instanceId ? { ...instance, ...updates } : instance);
        });
        mockFunctionStore.loadFunctions.mockResolvedValue(undefined);
        (apiClient.get as jest.Mock).mockResolvedValue({ data: workspacePayload });
        (apiClient.post as jest.Mock).mockResolvedValue({ data: { success: true, reloadedData: workspacePayload } });
        (apiClient as any).delete = jest.fn().mockResolvedValue({ data: { success: true } });
        sessionStorage.clear();
        localStorage.clear();
    });

    it('persists drag-stop positions only for explicit user move intents', async () => {
        mockUseAuth.mockReturnValue({
            isAuthenticated: true,
            accessToken: 'token-ready',
            runtimeLLMConfigs: [],
            localLLMProfiles: [],
            user: { id: 'user-1', email: 'user@example.com' },
            logout: jest.fn(),
            refreshRuntimeConfigState: jest.fn(),
            sessionStatus: 'ready',
            isLoading: false,
            error: null,
        } as any);

        render(<App />);

        await waitFor(() => expect(mockDesignStore.hydrateFromServer).toHaveBeenCalled());
        await waitFor(() => expect(screen.getByTestId('router-node-count')).toHaveTextContent('1'));

        act(() => {
            screen.getByTestId('move-node-button').click();
        });

        await waitFor(() => expect(PersistenceService.saveAgentInstance).toHaveBeenCalledWith({
            id: 'instance-1',
            position: { x: 111, y: 222 },
        }, {
            isAuthenticated: true,
            accessToken: 'token-ready',
        }));

        act(() => {
            screen.getByTestId('sync-node-button').click();
        });

        expect(PersistenceService.saveAgentInstance).toHaveBeenCalledTimes(1);
        expect(mockDesignStore.updateNode).toHaveBeenNthCalledWith(1, 'node-instance-1', { position: { x: 111, y: 222 } });
        expect(mockDesignStore.updateNode).toHaveBeenNthCalledWith(2, 'node-instance-1', { position: { x: 333, y: 444 } });
        expect(mockDesignStore.updateAgentInstance).toHaveBeenNthCalledWith(1, 'instance-1', { position: { x: 111, y: 222 } });
        expect(mockDesignStore.updateAgentInstance).toHaveBeenNthCalledWith(2, 'instance-1', { position: { x: 333, y: 444 } });
    });

    it('calls /api/user/workspace only after the session becomes ready', async () => {
        let authState: any = {
            isAuthenticated: true,
            accessToken: 'token-restoring',
            runtimeLLMConfigs: [],
            localLLMProfiles: [],
            user: { id: 'user-1', email: 'user@example.com' },
            logout: jest.fn(),
            refreshRuntimeConfigState: jest.fn(),
            sessionStatus: 'restoring-session',
            error: null
        };

        mockUseAuth.mockImplementation(() => authState);

        const { rerender } = render(<App />);

        expect(apiClient.get).not.toHaveBeenCalled();
        expect(screen.getByTestId('agents-count')).toHaveTextContent('0');

        authState = {
            ...authState,
            accessToken: 'token-ready',
            sessionStatus: 'ready'
        };

        rerender(<App />);

        await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/api/user/workspace'));
        await waitFor(() => expect(screen.getByTestId('agents-count')).toHaveTextContent('1'));
    });

    it('does not wipe hydrated agents on access token refresh for the same user', async () => {
        let authState: any = {
            isAuthenticated: true,
            accessToken: 'token-1',
            runtimeLLMConfigs: [],
            localLLMProfiles: [],
            user: { id: 'user-1', email: 'user@example.com' },
            logout: jest.fn(),
            refreshRuntimeConfigState: jest.fn(),
            sessionStatus: 'ready',
            error: null
        };

        mockUseAuth.mockImplementation(() => authState);

        const { rerender } = render(<App />);

        await waitFor(() => expect(apiClient.get).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(screen.getByTestId('agents-count')).toHaveTextContent('1'));

        authState = {
            ...authState,
            accessToken: 'token-2'
        };

        rerender(<App />);

        await waitFor(() => expect(screen.getByTestId('agents-count')).toHaveTextContent('1'));
        expect(apiClient.get).toHaveBeenCalledTimes(1);
    });

    it('preserves in-flight runtime chat messages during a silent resume workspace refresh', async () => {
        const runtimeState = {
            llmApiKeys: [],
            runtimeLLMConfigs: [{ provider: 'gemini' }],
            localLLMProfiles: [{ id: 'local-1', name: 'LM Studio', provider: 'lmstudio', baseUrl: 'http://localhost:1234' }]
        } as any;
        const refreshRuntimeConfigState = jest.fn().mockResolvedValue(runtimeState);

        const payloadWithoutPersistedChat = {
            ...workspacePayload,
            agentInstances: [
                {
                    ...workspacePayload.agentInstances[0],
                    chatMessages: []
                }
            ]
        };

        mockUseAuth.mockImplementation(() => ({
            isAuthenticated: true,
            accessToken: 'token-ready',
            runtimeLLMConfigs: [],
            localLLMProfiles: [],
            user: { id: 'user-1', email: 'user@example.com' },
            logout: jest.fn(),
            refreshRuntimeConfigState,
            sessionStatus: 'ready',
            error: null
        } as any));

        (apiClient.get as jest.Mock)
            .mockResolvedValueOnce({ data: payloadWithoutPersistedChat })
            .mockResolvedValueOnce({ data: payloadWithoutPersistedChat });

        render(<App />);

        await waitFor(() => expect(apiClient.get).toHaveBeenCalledTimes(1));
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 650));
        });
        refreshRuntimeConfigState.mockClear();

        mockRuntimeStore.setNodeMessages('node-instance-1', [
            {
                id: 'local-user-msg',
                sender: 'user',
                text: 'En consultant internet, donne moi la meteo sur Paris pour demain',
                timestamp: new Date('2026-04-28T13:03:00.000Z')
            },
            {
                id: 'local-error-msg',
                sender: 'agent',
                text: '[Erreur LLM] Le modele local a retourne une reponse vide sans appel d\'outil.',
                isError: true,
                timestamp: new Date('2026-04-28T13:04:00.000Z')
            }
        ]);

        act(() => {
            window.dispatchEvent(new Event('focus'));
        });

        await waitFor(() => expect(apiClient.get).toHaveBeenCalledTimes(2));
        expect(refreshRuntimeConfigState).toHaveBeenCalledTimes(1);
        expect(mockRuntimeStore.updateLLMConfigs).toHaveBeenCalledWith(runtimeState.runtimeLLMConfigs);
        expect(mockRuntimeStore.updateLocalLLMProfiles).toHaveBeenCalledWith(runtimeState.localLLMProfiles);
        expect(screen.getByTestId('hydration-overlay')).toHaveTextContent('idle');
        expect(sessionStorage.getItem('_arc_hydrating')).toBeNull();

        expect(mockRuntimeStore.nodeMessages['node-instance-1']).toEqual([
            expect.objectContaining({
                id: 'local-user-msg',
                sender: 'user',
                text: 'En consultant internet, donne moi la meteo sur Paris pour demain'
            }),
            expect.objectContaining({
                id: 'local-error-msg',
                sender: 'agent',
                isError: true,
                text: '[Erreur LLM] Le modele local a retourne une reponse vide sans appel d\'outil.'
            })
        ]);
    });

    it('silently refreshes runtime authority and workspace when the page becomes visible again', async () => {
        const runtimeState = {
            llmApiKeys: [],
            runtimeLLMConfigs: [{ provider: 'gemini' }],
            localLLMProfiles: [{ id: 'local-1', name: 'LM Studio', provider: 'lmstudio', baseUrl: 'http://localhost:1234' }]
        } as any;
        const refreshRuntimeConfigState = jest.fn().mockResolvedValue(runtimeState);

        (apiClient.get as jest.Mock)
            .mockResolvedValueOnce({ data: workspacePayload })
            .mockResolvedValueOnce({ data: workspacePayload });

        mockUseAuth.mockImplementation(() => ({
            isAuthenticated: true,
            accessToken: 'token-ready',
            runtimeLLMConfigs: [],
            localLLMProfiles: [],
            user: { id: 'user-1', email: 'user@example.com' },
            logout: jest.fn(),
            refreshRuntimeConfigState,
            sessionStatus: 'ready',
            error: null
        } as any));

        render(<App />);

        await waitFor(() => expect(apiClient.get).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(mockFunctionStore.loadFunctions).toHaveBeenCalledWith('workflow-1'));
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 650));
        });

        refreshRuntimeConfigState.mockClear();
        mockFunctionStore.loadFunctions.mockClear();
        mockRuntimeStore.updateLLMConfigs.mockClear();
        mockRuntimeStore.updateLocalLLMProfiles.mockClear();

        documentVisibilityState = 'hidden';
        act(() => {
            document.dispatchEvent(new Event('visibilitychange'));
        });

        expect(apiClient.get).toHaveBeenCalledTimes(1);

        documentVisibilityState = 'visible';
        act(() => {
            document.dispatchEvent(new Event('visibilitychange'));
        });

        await waitFor(() => expect(apiClient.get).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(mockFunctionStore.loadFunctions).toHaveBeenCalledWith('workflow-1'));
        expect(refreshRuntimeConfigState).toHaveBeenCalledTimes(1);
        expect(mockRuntimeStore.updateLLMConfigs).toHaveBeenCalledWith(runtimeState.runtimeLLMConfigs);
        expect(mockRuntimeStore.updateLocalLLMProfiles).toHaveBeenCalledWith(runtimeState.localLLMProfiles);
        expect(screen.getByTestId('hydration-overlay')).toHaveTextContent('idle');
        expect(sessionStorage.getItem('_arc_hydrating')).toBeNull();
    });

    it('keeps store-backed runtime config surfaces visible while auth config refresh is still pending', async () => {
        mockRuntimeStore.llmConfigs = [{ provider: 'gemini' }];
        mockRuntimeStore.localLLMProfiles = [{ id: 'local-1', name: 'LM Studio', provider: 'lmstudio', baseUrl: 'http://localhost:1234' }];

        mockUseAuth.mockImplementation(() => ({
            isAuthenticated: true,
            accessToken: 'token-restoring',
            runtimeLLMConfigs: [],
            localLLMProfiles: [],
            user: { id: 'user-1', email: 'user@example.com' },
            logout: jest.fn(),
            refreshRuntimeConfigState: jest.fn(),
            sessionStatus: 'restoring-session',
            error: null
        } as any));

        render(<App />);

        expect(screen.getByTestId('router-llm-config-count')).toHaveTextContent('1');
        expect(screen.getByTestId('agent-config-modal-state')).toHaveTextContent('1:1');
        expect(mockRuntimeStore.updateLLMConfigs).not.toHaveBeenCalledWith([]);
        expect(mockRuntimeStore.updateLocalLLMProfiles).not.toHaveBeenCalledWith([]);
    });

    it('keeps the loader idle while a resume refresh settles in the background', async () => {
        const runtimeState = {
            llmApiKeys: [],
            runtimeLLMConfigs: [{ provider: 'gemini' }],
            localLLMProfiles: []
        } as any;
        const refreshRuntimeConfigState = jest.fn().mockResolvedValue(runtimeState);

        (apiClient.get as jest.Mock)
            .mockResolvedValueOnce({ data: workspacePayload })
            .mockResolvedValueOnce({ data: workspacePayload });

        mockUseAuth.mockImplementation(() => ({
            isAuthenticated: true,
            accessToken: 'token-ready',
            runtimeLLMConfigs: [],
            localLLMProfiles: [],
            user: { id: 'user-1', email: 'user@example.com' },
            logout: jest.fn(),
            refreshRuntimeConfigState,
            sessionStatus: 'ready',
            error: null
        } as any));

        render(<App />);

        await waitFor(() => expect(apiClient.get).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(mockFunctionStore.loadFunctions).toHaveBeenCalledWith('workflow-1'));
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 650));
        });
        await waitFor(() => expect(screen.getByTestId('hydration-overlay')).toHaveTextContent('idle'));

        let resolveDeferredLoad: (() => void) | null = null;
        mockFunctionStore.loadFunctions.mockImplementation(
            () => new Promise<void>((resolve) => {
                resolveDeferredLoad = resolve;
            })
        );

        const originalRequestAnimationFrame = window.requestAnimationFrame;
        window.requestAnimationFrame = jest.fn((callback: FrameRequestCallback) => {
            callback(performance.now());
            return 1;
        });

        try {
            documentVisibilityState = 'hidden';
            act(() => {
                document.dispatchEvent(new Event('visibilitychange'));
            });

            documentVisibilityState = 'visible';
            act(() => {
                document.dispatchEvent(new Event('visibilitychange'));
            });

            await waitFor(() => expect(apiClient.get).toHaveBeenCalledTimes(2));
            expect(screen.getByTestId('hydration-overlay')).toHaveTextContent('idle');
            expect(sessionStorage.getItem('_arc_hydrating')).toBeNull();

            resolveDeferredLoad?.();
            await act(async () => {
                await Promise.resolve();
            });

            await waitFor(() => expect(screen.getByTestId('hydration-overlay')).toHaveTextContent('idle'));
            expect(sessionStorage.getItem('_arc_hydrating')).toBeNull();
        } finally {
            window.requestAnimationFrame = originalRequestAnimationFrame;
        }
    });

    it('keeps the auth hydration overlay active until workflows are loaded', async () => {
        const refreshRuntimeConfigState = jest.fn().mockResolvedValue({
            llmApiKeys: [],
            runtimeLLMConfigs: [{ provider: 'gemini' }],
            localLLMProfiles: []
        } as any);

        let resolveWorkflowLoad: (() => void) | null = null;
        mockDesignStore.loadUserWorkflows.mockImplementationOnce(() => new Promise<void>((resolve) => {
            resolveWorkflowLoad = resolve;
        }));

        mockUseAuth.mockImplementation(() => ({
            isAuthenticated: true,
            accessToken: 'token-ready',
            runtimeLLMConfigs: [],
            localLLMProfiles: [],
            user: { id: 'user-1', email: 'user@example.com' },
            logout: jest.fn(),
            refreshRuntimeConfigState,
            sessionStatus: 'ready',
            error: null
        } as any));

        render(<App />);

        await waitFor(() => expect(apiClient.get).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(mockFunctionStore.loadFunctions).toHaveBeenCalledWith('workflow-1'));
        await waitFor(() => expect(mockDesignStore.loadUserWorkflows).toHaveBeenCalledTimes(1));
        expect(screen.getByTestId('hydration-overlay')).toHaveTextContent('loading');

        resolveWorkflowLoad?.();

        await waitFor(() => expect(screen.getByTestId('hydration-overlay')).toHaveTextContent('idle'));
        expect(sessionStorage.getItem('_arc_hydrating')).toBeNull();
    });

    it('preserves persisted tool block metadata during workspace hydration', async () => {
        const workspaceWithPersistedToolMessages = {
            ...workspacePayload,
            agentInstances: [
                {
                    ...workspacePayload.agentInstances[0],
                    chatMessages: [
                        {
                            id: 'persisted-tool-msg',
                            sender: 'tool',
                            text: 'Weather Tool({"city":"Paris"}) [exec-1]',
                            timestamp: '2026-04-29T09:00:00.000Z',
                            toolCallRecord: {
                                id: 'call-1',
                                toolId: 'tool.weather',
                                functionId: 'legacy-weather',
                                functionName: 'Weather Tool',
                                arguments: { city: 'Paris' },
                                result: { temperature: 21 },
                                status: 'success',
                                executionId: 'exec-1',
                                timestamp: '2026-04-29T09:00:00.000Z'
                            }
                        },
                        {
                            id: 'persisted-tool-result-msg',
                            sender: 'tool_result',
                            text: '[executionId=exec-1] {"temperature":21}',
                            timestamp: '2026-04-29T09:00:01.000Z',
                            toolCallId: 'call-1',
                            toolName: 'Weather Tool'
                        }
                    ]
                }
            ]
        };

        mockUseAuth.mockImplementation(() => ({
            isAuthenticated: true,
            accessToken: 'token-ready',
            runtimeLLMConfigs: [],
            localLLMProfiles: [],
            user: { id: 'user-1', email: 'user@example.com' },
            logout: jest.fn(),
            refreshRuntimeConfigState: jest.fn(),
            sessionStatus: 'ready',
            error: null
        } as any));

        (apiClient.get as jest.Mock).mockResolvedValue({ data: workspaceWithPersistedToolMessages });
        mockHydrateToolMessagesFromPersistedRuns.mockImplementationOnce(async (messages: any[]) => messages.map((message) => (
            message.sender === 'tool'
                ? {
                    ...message,
                    toolCallRecord: {
                        ...message.toolCallRecord,
                        persistedRunStatus: 'completed',
                        persistedRunUpdatedAt: '2026-04-29T09:00:02.000Z',
                        artifacts: [{ path: 'output/report.json', kind: 'json' }],
                    },
                }
                : message
        )));

        render(<App />);

        await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/api/user/workspace'));
        await waitFor(() => expect(mockHydrateToolMessagesFromPersistedRuns).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(mockRuntimeStore.nodeMessages['node-instance-1']).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    id: 'persisted-tool-msg',
                    sender: 'tool',
                    toolCallRecord: expect.objectContaining({
                        id: 'call-1',
                        toolId: 'tool.weather',
                        functionId: 'legacy-weather',
                        executionId: 'exec-1',
                        persistedRunStatus: 'completed',
                        artifacts: [{ path: 'output/report.json', kind: 'json' }],
                    })
                }),
                expect.objectContaining({
                    id: 'persisted-tool-result-msg',
                    sender: 'tool_result',
                    toolCallId: 'call-1',
                    toolName: 'Weather Tool'
                })
            ])
        ));
    });

    it('keeps the auth hydration overlay active until persisted tool projections are ready', async () => {
        const workspaceWithPersistedToolMessages = {
            ...workspacePayload,
            agentInstances: [
                {
                    ...workspacePayload.agentInstances[0],
                    chatMessages: [
                        {
                            id: 'persisted-tool-msg',
                            sender: 'tool',
                            text: 'Weather Tool({"city":"Paris"}) [exec-1]',
                            timestamp: '2026-04-29T09:00:00.000Z',
                            toolCallRecord: {
                                id: 'call-1',
                                toolId: 'tool.weather',
                                functionId: 'legacy-weather',
                                functionName: 'Weather Tool',
                                arguments: { city: 'Paris' },
                                result: { temperature: 21 },
                                status: 'success',
                                executionId: 'exec-1',
                                timestamp: '2026-04-29T09:00:00.000Z'
                            }
                        }
                    ]
                }
            ]
        };

        let resolveProjection: ((messages: any[]) => void) | null = null;
        mockHydrateToolMessagesFromPersistedRuns.mockImplementationOnce((messages: any[]) => new Promise((resolve) => {
            resolveProjection = resolve;
        }));

        mockUseAuth.mockImplementation(() => ({
            isAuthenticated: true,
            accessToken: 'token-ready',
            runtimeLLMConfigs: [],
            localLLMProfiles: [],
            user: { id: 'user-1', email: 'user@example.com' },
            logout: jest.fn(),
            refreshRuntimeConfigState: jest.fn(),
            sessionStatus: 'ready',
            error: null
        } as any));

        (apiClient.get as jest.Mock).mockResolvedValue({ data: workspaceWithPersistedToolMessages });

        render(<App />);

        await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/api/user/workspace'));
        expect(screen.getByTestId('hydration-overlay')).toHaveTextContent('loading');

        resolveProjection?.([
            {
                id: 'persisted-tool-msg',
                sender: 'tool',
                text: 'Weather Tool({"city":"Paris"}) [exec-1]',
                timestamp: new Date('2026-04-29T09:00:00.000Z'),
                toolCallRecord: {
                    id: 'call-1',
                    toolId: 'tool.weather',
                    functionId: 'legacy-weather',
                    functionName: 'Weather Tool',
                    arguments: { city: 'Paris' },
                    result: { temperature: 21 },
                    status: 'success',
                    executionId: 'exec-1',
                    persistedRunStatus: 'completed',
                    persistedRunUpdatedAt: '2026-04-29T09:00:02.000Z',
                    artifacts: [{ path: 'output/report.json', kind: 'json' }],
                    timestamp: new Date('2026-04-29T09:00:00.000Z'),
                }
            }
        ] as any);

        await waitFor(() => expect(screen.getByTestId('hydration-overlay')).toHaveTextContent('idle'));
        expect(mockRuntimeStore.nodeMessages['node-instance-1']).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    toolCallRecord: expect.objectContaining({
                        persistedRunStatus: 'completed',
                        artifacts: [{ path: 'output/report.json', kind: 'json' }],
                    }),
                }),
            ])
        );
    });

    it('keeps the auth hydration overlay active until the workflow canvas reports visual readiness', async () => {
        autoSignalWorkflowCanvasReady = false;

        mockUseAuth.mockImplementation(() => ({
            isAuthenticated: true,
            accessToken: 'token-ready',
            runtimeLLMConfigs: [],
            localLLMProfiles: [],
            user: { id: 'user-1', email: 'user@example.com' },
            logout: jest.fn(),
            refreshRuntimeConfigState: jest.fn(),
            sessionStatus: 'ready',
            error: null
        } as any));

        (apiClient.get as jest.Mock).mockResolvedValue({ data: workspacePayload });

        render(<App />);

        await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/api/user/workspace'));
        await waitFor(() => expect(screen.getByTestId('hydration-overlay')).toHaveTextContent('loading'));

        act(() => {
            screen.getByTestId('canvas-ready-button').click();
        });

        await waitFor(() => expect(screen.getByTestId('hydration-overlay')).toHaveTextContent('idle'));
    });

    it('hydrates canonical tool selections that the runtime selector can resolve after snapshot reload', async () => {
        const workspaceWithCanonicalToolSelections = {
            ...workspacePayload,
            agentPrototypes: [
                {
                    ...workspacePayload.agentPrototypes[0],
                    toolSelections: [],
                }
            ],
            agentInstances: [
                {
                    ...workspacePayload.agentInstances[0],
                    configuration_json: {
                        ...workspacePayload.agentInstances[0].configuration_json,
                        toolSelections: [{
                            toolId: 'tool.web-search',
                            versionRef: {
                                versionTag: 'v1',
                                versionNumber: 1,
                                workspaceId: 'workflow-1'
                            }
                        }],
                    }
                }
            ]
        };

        const availableFunctions: UserFunction[] = [
            {
                _id: 'fn-1',
                toolId: 'tool.web-search',
                name: 'web_search_py',
                description: 'Web search',
                language: 'python',
                origin: 'native',
                userId: null,
                workflowId: 'workflow-1',
                inputSchema: {},
                outputSchema: {},
                codePath: null,
                codeInline: null,
                dependencies: [],
                isEnabled: true,
                isReadonly: true,
                version: 1,
                versionTag: 'v1',
                tags: [],
                createdAt: '2026-01-01T00:00:00.000Z',
                updatedAt: '2026-01-01T00:00:00.000Z',
            }
        ];

        (apiClient.get as jest.Mock).mockResolvedValue({ data: workspaceWithCanonicalToolSelections });

        render(<App />);

        await waitFor(() => expect(mockDesignStore.hydrateFromServer).toHaveBeenCalled());

        const hydratedSnapshot = mockDesignStore.hydrateFromServer.mock.calls.at(-1)?.[0] as {
            agents: any[];
            agentInstances: any[];
        };
        const staleNodeAgent = {
            ...hydratedSnapshot.agents[0],
            toolSelections: [],
        };

        const selectionContext = selectResolvedAgentExecutionSelectionContext(
            {
                agents: hydratedSnapshot.agents,
                agentInstances: hydratedSnapshot.agentInstances,
            },
            staleNodeAgent,
            'instance-1',
            availableFunctions,
        );

        expect(selectionContext.selectedToolIds).toEqual(['tool.web-search']);
        expect(selectionContext.scopedFunctions).toEqual([
            expect.objectContaining({
                name: 'web_search_py',
                toolId: 'tool.web-search',
            })
        ]);
    });

    it('derives legacy functionIds from canonical prototype toolSelections during hydration when the alias is empty', async () => {
        const workspaceWithPrototypeSelectionAliasGap = {
            ...workspacePayload,
            agentPrototypes: [
                {
                    ...workspacePayload.agentPrototypes[0],
                    functionIds: [],
                    toolSelections: [{ toolId: 'tool.web-search' }],
                }
            ],
        };

        (apiClient.get as jest.Mock).mockResolvedValue({ data: workspaceWithPrototypeSelectionAliasGap });

        render(<App />);

        await waitFor(() => expect(mockDesignStore.hydrateFromServer).toHaveBeenCalled());

        const hydratedSnapshot = mockDesignStore.hydrateFromServer.mock.calls.at(-1)?.[0] as {
            agents: any[];
        };

        expect(hydratedSnapshot.agents[0]).toEqual(expect.objectContaining({
            functionIds: ['tool.web-search'],
            toolSelections: [{ toolId: 'tool.web-search' }],
        }));
    });

    it('hydrates prototype persistenceConfig cloud profile references from the workspace snapshot', async () => {
        const workspaceWithPrototypePersistenceConfig = {
            ...workspacePayload,
            agentPrototypes: [
                {
                    ...workspacePayload.agentPrototypes[0],
                    persistenceConfig: {
                        saveChat: true,
                        saveErrors: true,
                        saveHistorySummary: false,
                        saveLinks: false,
                        saveTasks: false,
                        saveMedia: true,
                        mediaStorage: 'cloud',
                        allowWorkspaceWrite: true,
                        cloudConnectionProfileId: 'cloud-profile-1',
                    },
                }
            ],
        };

        (apiClient.get as jest.Mock).mockResolvedValue({ data: workspaceWithPrototypePersistenceConfig });

        render(<App />);

        await waitFor(() => expect(mockDesignStore.hydrateFromServer).toHaveBeenCalled());

        const hydratedSnapshot = mockDesignStore.hydrateFromServer.mock.calls.at(-1)?.[0] as {
            agents: any[];
        };

        expect(hydratedSnapshot.agents[0]).toEqual(expect.objectContaining({
            persistenceConfig: expect.objectContaining({
                mediaStorage: 'cloud',
                cloudConnectionProfileId: 'cloud-profile-1',
            }),
        }));
    });

    it('normalizes hydrated instance persistenceConfig before storing the workspace snapshot', async () => {
        const workspaceWithInstancePersistenceConfig = {
            ...workspacePayload,
            agentInstances: [
                {
                    ...workspacePayload.agentInstances[0],
                    persistenceConfig: {
                        saveChat: true,
                        saveErrors: true,
                        saveHistorySummary: false,
                        saveLinks: false,
                        saveTasks: false,
                        saveMedia: true,
                        mediaStorage: 'local',
                        allowWorkspaceWrite: true,
                        cloudConnectionProfileId: null,
                        cloudStorageConfig: {
                            provider: 's3',
                            bucketName: 'legacy-bucket',
                        },
                        retentionDays: null,
                    },
                }
            ],
        };

        (apiClient.get as jest.Mock).mockResolvedValue({ data: workspaceWithInstancePersistenceConfig });

        render(<App />);

        await waitFor(() => expect(mockDesignStore.hydrateFromServer).toHaveBeenCalled());

        const hydratedSnapshot = mockDesignStore.hydrateFromServer.mock.calls.at(-1)?.[0] as {
            agentInstances: any[];
        };

        expect(hydratedSnapshot.agentInstances[0]).toEqual(expect.objectContaining({
            persistenceConfig: expect.objectContaining({
                saveMedia: true,
                mediaStorage: 'workspace',
                allowWorkspaceWrite: true,
            }),
        }));
        expect(hydratedSnapshot.agentInstances[0].persistenceConfig.cloudConnectionProfileId).toBeUndefined();
        expect(hydratedSnapshot.agentInstances[0].persistenceConfig.cloudStorageConfig).toBeUndefined();
        expect(hydratedSnapshot.agentInstances[0].persistenceConfig.retentionDays).toBeUndefined();
    });

    it('deletes a hydrated store node without relying on a local legacy mirror', async () => {
        mockUseAuth.mockImplementation(() => ({
            isAuthenticated: true,
            accessToken: 'token-ready',
            runtimeLLMConfigs: [],
            localLLMProfiles: [],
            user: { id: 'user-1', email: 'user@example.com' },
            logout: jest.fn(),
            refreshRuntimeConfigState: jest.fn(),
            sessionStatus: 'ready',
            error: null
        } as any));

        render(<App />);

        await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/api/user/workspace'));
        await waitFor(() => expect(screen.getByTestId('router-node-count')).toHaveTextContent('1'));

        await act(async () => {
            screen.getByTestId('delete-node-button').click();
        });

        expect(mockDesignStore.deleteNode).toHaveBeenCalledWith('node-instance-1');
        expect(mockDesignStore.deleteAgentInstance).toHaveBeenCalledWith('instance-1');
        expect((apiClient as any).delete).toHaveBeenCalledWith('/api/workflows/workflow-1/instances/instance-1');
        expect(mockDesignStore.nodes).toHaveLength(0);
    });

    it('switches workflow from the server snapshot and clears stale nodes without a local fallback mirror', async () => {
        const switchedWorkspacePayload = {
            workflow: {
                id: 'workflow-2',
                name: 'Workflow vide',
                isActive: true,
                isDefault: false,
                canvasState: { zoom: 0.8, panX: 10, panY: 20 }
            },
            agentPrototypes: [],
            agentInstances: [],
            nodes: [],
            edges: []
        };

        mockUseAuth.mockImplementation(() => ({
            isAuthenticated: true,
            accessToken: 'token-ready',
            runtimeLLMConfigs: [],
            localLLMProfiles: [],
            user: { id: 'user-1', email: 'user@example.com' },
            logout: jest.fn(),
            refreshRuntimeConfigState: jest.fn(),
            sessionStatus: 'ready',
            error: null
        } as any));

        (apiClient.post as jest.Mock).mockResolvedValueOnce({
            data: {
                success: true,
                reloadedData: switchedWorkspacePayload,
            }
        });

        render(<App />);

        await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/api/user/workspace'));
        await waitFor(() => expect(screen.getByTestId('router-node-count')).toHaveTextContent('1'));
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 650));
        });

        await act(async () => {
            window.dispatchEvent(new CustomEvent('workflow:switch', {
                detail: { workflowId: 'workflow-2', workflowName: 'Workflow vide' }
            }));
        });

        await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/api/workflows/workflow-2/select'));
        await waitFor(() => expect(screen.getByTestId('router-node-count')).toHaveTextContent('0'));
        expect(mockRuntimeStore.resetForWorkflowSwitch).toHaveBeenCalled();
        expect(mockFunctionStore.loadFunctions).toHaveBeenCalledWith('workflow-2');
        expect(mockDesignStore.loadUserWorkflows).toHaveBeenCalled();
    });

    it('drops legacy tool id arrays from hydrated provider tool payloads after workspace refresh while preserving canonical selections', async () => {
        const workspaceWithLegacyToolIds = {
            ...workspacePayload,
            agentPrototypes: [
                {
                    ...workspacePayload.agentPrototypes[0],
                    tools: ['legacy-tool-id-1', 'legacy-tool-id-2'],
                    functionIds: ['tool.web-fetch', 'tool.hello-test'],
                    toolSelections: [
                        { toolId: 'tool.web-fetch' },
                        { toolId: 'tool.hello-test' },
                    ],
                }
            ],
            agentInstances: [
                {
                    ...workspacePayload.agentInstances[0],
                    tools: ['legacy-tool-id-1', 'legacy-tool-id-2'],
                    configuration_json: {
                        ...workspacePayload.agentInstances[0].configuration_json,
                        tools: ['legacy-tool-id-1', 'legacy-tool-id-2'],
                        toolSelections: [
                            { toolId: 'tool.web-fetch' },
                            { toolId: 'tool.hello-test' },
                        ],
                    },
                }
            ],
        };

        (apiClient.get as jest.Mock).mockResolvedValue({ data: workspaceWithLegacyToolIds });

        render(<App />);

        await waitFor(() => expect(mockDesignStore.hydrateFromServer).toHaveBeenCalled());

        const hydratedSnapshot = mockDesignStore.hydrateFromServer.mock.calls.at(-1)?.[0] as {
            agents: any[];
            agentInstances: any[];
        };

        expect(hydratedSnapshot.agents[0]).toEqual(expect.objectContaining({
            tools: [],
            functionIds: ['tool.web-fetch', 'tool.hello-test'],
            toolSelections: [
                { toolId: 'tool.web-fetch' },
                { toolId: 'tool.hello-test' },
            ],
        }));

        expect(hydratedSnapshot.agentInstances[0]?.configuration_json).toEqual(expect.objectContaining({
            tools: [],
            toolSelections: [
                { toolId: 'tool.web-fetch' },
                { toolId: 'tool.hello-test' },
            ],
        }));
    });
});