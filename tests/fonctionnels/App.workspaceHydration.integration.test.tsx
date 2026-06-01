import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import App from '../../App';
import apiClient from '../../utils/apiClient';
import { useAuth } from '../../contexts/AuthContext';
import { getAppHydrationHarness, resetAppHydrationHarness } from '../harnesses/appHydrationHarness';
import {
    buildAuthenticatedAuthState,
    buildEmptyWorkspacePayload,
    buildRestoringAuthState,
    buildRuntimeRefreshState,
    buildWorkspacePayload,
    emitHydrationComponentsReady,
} from '../fixtures/workspaceHydration.fixtures';

const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
let mockAppHydrationHarness = resetAppHydrationHarness();
let mockRuntimeStore = mockAppHydrationHarness.runtimeStore;
let mockDesignStore = mockAppHydrationHarness.designStore;
let mockWorkflowStore = mockAppHydrationHarness.workflowStore;
let mockFunctionStore = mockAppHydrationHarness.functionStore;

const waitForHydrationOverlayIdle = () => waitFor(
    () => expect(screen.getByTestId('hydration-overlay')).toHaveTextContent('idle'),
    { timeout: 2000 },
);

Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => getAppHydrationHarness().documentVisibilityState,
});

jest.mock('../../contexts/AuthContext', () => ({
    AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useAuth: jest.fn(),
}));

jest.mock('../../utils/apiClient', () => ({
    __esModule: true,
    default: {
        get: jest.fn(),
        post: jest.fn(),
    },
}));

jest.mock('../../services/bosRunProjectionService', () => ({
    hydrateToolMessagesFromPersistedRuns: jest.fn(async (messages: any[]) => messages),
    buildBosHydrationFingerprint: jest.fn(() => ''),
}));

jest.mock('../../components/NavigationLayout', () => ({
    NavigationLayout: () => {
        const { getAppHydrationHarness } = require('../harnesses/appHydrationHarness');
        const harness = getAppHydrationHarness();
        return <div data-testid="agents-count">{harness.designStore.agents.length}</div>;
    },
}));

jest.mock('../../components/RobotPageRouter', () => ({
    RobotPageRouter: ({ llmConfigs, onWorkflowCanvasReady }: { llmConfigs?: Array<unknown>; onWorkflowCanvasReady?: () => void }) => {
        const { getAppHydrationHarness } = require('../harnesses/appHydrationHarness');
        const harness = getAppHydrationHarness();
        React.useEffect(() => {
            if (harness.autoSignalWorkflowCanvasReady) {
                onWorkflowCanvasReady?.();
                emitHydrationComponentsReady();
            }
        });

        return (
            <div data-testid="robot-page-router">
                <div data-testid="router-node-count">{harness.designStore.nodes.length}</div>
                <div data-testid="router-llm-config-count">{llmConfigs?.length ?? 0}</div>
                <button
                    type="button"
                    data-testid="canvas-ready-button"
                    onClick={() => {
                        onWorkflowCanvasReady?.();
                        emitHydrationComponentsReady();
                    }}
                >
                    canvas ready
                </button>
            </div>
        );
    },
}));

jest.mock('../../components/Header', () => ({
    Header: () => <div data-testid="header" />,
}));

jest.mock('../../components/HydrationOverlay', () => ({
    HydrationOverlay: ({ isLoading }: { isLoading: boolean }) => (
        <div data-testid="hydration-overlay">{isLoading ? 'loading' : 'idle'}</div>
    ),
}));

jest.mock('../../components/WorkflowSwitchOverlay', () => ({
    WorkflowSwitchOverlay: () => null,
}));

jest.mock('../../components/HyperspaceReveal', () => ({
    HyperspaceReveal: () => null,
}));

jest.mock('../../components/NotificationDisplay', () => ({
    NotificationDisplay: () => null,
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
    QueryProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('../../contexts', () => ({
    NotificationProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('../../hooks/useLocalization', () => ({
    useLocalization: () => ({ t: (key: string) => key }),
}));

jest.mock('../../hooks/useJournalQueue', () => ({
    useJournalQueue: () => ({ enqueueEntry: jest.fn() }),
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
    },
}));

jest.mock('../../utils/SettingsStorage', () => ({
    getSettingsStorage: () => ({
        getSidebarCollapsed: () => false,
        setSidebarCollapsed: jest.fn(),
    }),
}));

jest.mock('../../stores/useRuntimeStore', () => ({
    useRuntimeStore: Object.assign((selector?: (state: ReturnType<typeof getAppHydrationHarness>['runtimeStore']) => unknown) => {
        const { getAppHydrationHarness } = require('../harnesses/appHydrationHarness');
        const state = getAppHydrationHarness().runtimeStore;
        return selector ? selector(state) : state;
    }, {
        getState: () => require('../harnesses/appHydrationHarness').getAppHydrationHarness().runtimeStore,
    }),
}));

jest.mock('../../stores/useDesignStore', () => {
    const actual = jest.requireActual('../../stores/useDesignStore');

    return {
        ...actual,
        useDesignStore: Object.assign((selector?: (state: ReturnType<typeof getAppHydrationHarness>['designStore']) => unknown) => {
            const { getAppHydrationHarness } = require('../harnesses/appHydrationHarness');
            const state = getAppHydrationHarness().designStore;
            return selector ? selector(state) : state;
        }, {
            getState: () => require('../harnesses/appHydrationHarness').getAppHydrationHarness().designStore,
        }),
    };
});

jest.mock('../../stores/useWorkflowStore', () => ({
    useWorkflowStore: Object.assign((selector?: (state: ReturnType<typeof getAppHydrationHarness>['workflowStore']) => unknown) => {
        const { getAppHydrationHarness } = require('../harnesses/appHydrationHarness');
        const state = getAppHydrationHarness().workflowStore;
        return selector ? selector(state) : state;
    }, {
        getState: () => require('../harnesses/appHydrationHarness').getAppHydrationHarness().workflowStore,
    }),
}));

jest.mock('../../stores/useFunctionStore', () => ({
    useFunctionStore: Object.assign(() => require('../harnesses/appHydrationHarness').getAppHydrationHarness().functionStore, {
        getState: () => require('../harnesses/appHydrationHarness').getAppHydrationHarness().functionStore,
    }),
}));

describe('App workspace hydration integration flows', () => {
    const workspacePayload = buildWorkspacePayload();

    beforeEach(() => {
        jest.clearAllMocks();
        mockAppHydrationHarness = resetAppHydrationHarness();
        mockRuntimeStore = mockAppHydrationHarness.runtimeStore;
        mockDesignStore = mockAppHydrationHarness.designStore;
        mockWorkflowStore = mockAppHydrationHarness.workflowStore;
        mockFunctionStore = mockAppHydrationHarness.functionStore;
        mockAppHydrationHarness.autoSignalWorkflowCanvasReady = true;
        mockAppHydrationHarness.documentVisibilityState = 'visible';

        mockDesignStore.hydrateFromServer.mockImplementation((data: { agents?: any[]; agentInstances?: any[]; nodes?: any[] }) => {
            mockDesignStore.agents = data.agents || [];
            mockDesignStore.agentInstances = data.agentInstances || [];
            mockDesignStore.nodes = data.nodes || [];
        });

        mockFunctionStore.loadFunctions.mockResolvedValue(undefined);
        (apiClient.get as jest.Mock).mockResolvedValue({ data: workspacePayload });
        (apiClient.post as jest.Mock).mockResolvedValue({ data: { success: true, reloadedData: workspacePayload } });

        sessionStorage.clear();
        localStorage.clear();
    });

    it('bootstraps only when the authenticated session becomes ready and completes visual hydration', async () => {
        let authState: any = buildRestoringAuthState();
        mockUseAuth.mockImplementation(() => authState);

        const { rerender } = render(<App />);

        expect(apiClient.get).not.toHaveBeenCalled();
        expect(screen.getByTestId('hydration-overlay')).toHaveTextContent('loading');

        authState = buildAuthenticatedAuthState();
        rerender(<App />);

        await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/api/user/workspace'));
        await waitFor(() => expect(screen.getByTestId('router-node-count')).toHaveTextContent('1'));
        await waitForHydrationOverlayIdle();
    });

    it('switches workflow from an explicit event and clears stale canvas state from the previous snapshot', async () => {
        const switchedWorkspacePayload = buildEmptyWorkspacePayload();

        mockUseAuth.mockImplementation(() => buildAuthenticatedAuthState() as any);
        (apiClient.post as jest.Mock).mockResolvedValueOnce({
            data: {
                success: true,
                reloadedData: switchedWorkspacePayload,
            },
        });

        render(<App />);

        await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/api/user/workspace'));
        await waitFor(() => expect(screen.getByTestId('router-node-count')).toHaveTextContent('1'));
        await waitForHydrationOverlayIdle();

        await act(async () => {
            window.dispatchEvent(new CustomEvent('workflow:switch', {
                detail: { workflowId: 'workflow-2', workflowName: 'Workflow vide' },
            }));
        });

        await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/api/workflows/workflow-2/select'));
        await waitFor(() => expect(screen.getByTestId('router-node-count')).toHaveTextContent('0'));
        expect(mockRuntimeStore.resetForWorkflowSwitch).toHaveBeenCalled();
        expect(mockFunctionStore.loadFunctions).toHaveBeenCalledWith('workflow-2');
        expect(mockDesignStore.loadUserWorkflows).toHaveBeenCalled();
    });

    it('revalidates silently on visibility resume without reactivating the blocking hydration overlay', async () => {
        const runtimeState = buildRuntimeRefreshState({
            localLLMProfiles: [{ id: 'local-1', name: 'LM Studio', provider: 'lmstudio', baseUrl: 'http://localhost:1234' }],
        }) as any;
        const refreshRuntimeConfigState = jest.fn().mockResolvedValue(runtimeState);

        (apiClient.get as jest.Mock)
            .mockResolvedValueOnce({ data: workspacePayload })
            .mockResolvedValueOnce({ data: workspacePayload });

        mockUseAuth.mockImplementation(() => buildAuthenticatedAuthState({ refreshRuntimeConfigState }) as any);

        render(<App />);

        await waitFor(() => expect(apiClient.get).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(mockFunctionStore.loadFunctions).toHaveBeenCalledWith('workflow-1'));
        await waitForHydrationOverlayIdle();
        refreshRuntimeConfigState.mockClear();

            mockAppHydrationHarness.documentVisibilityState = 'hidden';
        act(() => {
            document.dispatchEvent(new Event('visibilitychange'));
        });

            mockAppHydrationHarness.documentVisibilityState = 'visible';
        act(() => {
            document.dispatchEvent(new Event('visibilitychange'));
        });

        await waitFor(() => expect(apiClient.get).toHaveBeenCalledTimes(2));
        expect(refreshRuntimeConfigState).toHaveBeenCalledTimes(1);
        expect(mockRuntimeStore.updateLLMConfigs).toHaveBeenCalledWith(runtimeState.runtimeLLMConfigs);
        expect(mockRuntimeStore.updateLocalLLMProfiles).toHaveBeenCalledWith(runtimeState.localLLMProfiles);
        expect(screen.getByTestId('hydration-overlay')).toHaveTextContent('idle');
        expect(sessionStorage.getItem('_arc_hydrating')).toBeNull();
    });
});