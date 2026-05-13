import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import App from '../../App';
import { selectResolvedAgentExecutionSelectionContext } from '../../stores/useDesignStore';
import apiClient from '../../utils/apiClient';
import { useAuth } from '../../contexts/AuthContext';
import type { UserFunction } from '../../types/function.types';

const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;

const mockRuntimeStore = {
    nodeMessages: {} as Record<string, any[]>,
    updateLLMConfigs: jest.fn(),
    updateLocalLLMProfiles: jest.fn(),
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
    validateWorkflowIntegrity: jest.fn(() => ({ fixedCount: 0 })),
    cleanupOrphanedInstances: jest.fn(() => 0),
    addAgentInstance: jest.fn(),
    deleteNode: jest.fn(),
    deleteAgentInstance: jest.fn(),
    hydrateFromServer: jest.fn(),
    setCurrentWorkflowId: jest.fn(),
    updateInstanceId: jest.fn(),
    addNode: jest.fn(),
    agentInstances: [],
    nodes: [],
    resetAll: jest.fn(),
    loadUserWorkflows: jest.fn().mockResolvedValue(undefined)
};

const mockWorkflowStore = {
    hydrateWorkflowFromServer: jest.fn(),
    getCurrentWorkflowId: jest.fn(() => 'workflow-1'),
    resetAll: jest.fn()
};

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

jest.mock('../../components/NavigationLayout', () => ({
    NavigationLayout: ({ agents }: { agents: Array<unknown> }) => <div data-testid="agents-count">{agents.length}</div>
}));

jest.mock('../../components/RobotPageRouter', () => ({
    RobotPageRouter: () => <div data-testid="robot-page-router" />
}));

jest.mock('../../components/Header', () => ({
    Header: () => <div data-testid="header" />
}));

jest.mock('../../components/HydrationOverlay', () => ({
    HydrationOverlay: () => null
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
jest.mock('../../components/modals/AgentConfigurationModal', () => ({ AgentConfigurationModal: () => null }));
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
    useFunctionStore: Object.assign(() => ({ loadFunctions: jest.fn() }), {
        getState: () => ({ loadFunctions: jest.fn().mockResolvedValue(undefined) })
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
        mockRuntimeStore.nodeMessages = {};
        Object.values(mockRuntimeStore).forEach((value) => {
            if (typeof value === 'function' && 'mockClear' in value) {
                value.mockClear();
            }
        });
        Object.values(mockDesignStore).forEach((value) => {
            if (typeof value === 'function' && 'mockClear' in value) {
                value.mockClear();
            }
        });
        Object.values(mockWorkflowStore).forEach((value) => {
            if (typeof value === 'function' && 'mockClear' in value) {
                value.mockClear();
            }
        });
        (apiClient.get as jest.Mock).mockResolvedValue({ data: workspacePayload });
        (apiClient.post as jest.Mock).mockResolvedValue({ data: { success: true, reloadedData: workspacePayload } });
        sessionStorage.clear();
        localStorage.clear();
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

    it('preserves in-flight runtime chat messages during a resume workspace refresh', async () => {
        const refreshRuntimeConfigState = jest.fn().mockResolvedValue(undefined);

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

        window.dispatchEvent(new Event('focus'));

        await waitFor(() => expect(apiClient.get).toHaveBeenCalledTimes(2));
        expect(refreshRuntimeConfigState).toHaveBeenCalledTimes(1);

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

        render(<App />);

        await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/api/user/workspace'));
        await waitFor(() => expect(mockRuntimeStore.nodeMessages['node-instance-1']).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    id: 'persisted-tool-msg',
                    sender: 'tool',
                    toolCallRecord: expect.objectContaining({
                        id: 'call-1',
                        toolId: 'tool.weather',
                        functionId: 'legacy-weather',
                        executionId: 'exec-1'
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