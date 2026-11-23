import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../../App';
import { useAuth } from '../../contexts/AuthContext';
import { PersistenceService } from '../../services/persistenceService';
import { useAppShellStore } from '../../stores/useAppShellStore';
import { Agent, AgentInstance, LLMCapability, LLMProvider, RobotId } from '../../types';
import apiClient from '../../utils/apiClient';
import { getAppHydrationHarness, resetAppHydrationHarness } from '../harnesses/appHydrationHarness';
import { buildEmptyWorkspacePayload } from '../fixtures/workspaceHydration.fixtures';

/**
 * ⭐ US-RC-00a (R1, P0) — régression stale closure dans `App.tsx`.
 *
 * `addAgentToWorkflow` (useCallback) remappe `currentImageAgentInstance` /
 * `currentVideoAgentInstance` vers le `persistedBackendId` après création backend,
 * mais ces deux états sont lus via des sélecteurs HORS du deps array → closure
 * périmée : si l'agent image/vidéo courant change entre deux ajouts, le remap
 * s'applique à la mauvaise instance (ou à null).
 *
 * Scénario : deux ajouts consécutifs avec changement d'agent image entre les deux
 * → le remap doit être appliqué à l'instance COURANTE à chaque ajout.
 * Ce test ÉCHOUE sur le code actuel (closure = valeur au montage) et passe après
 * le fix (`useAppShellStore.getState()` dans le callback).
 */

const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockCreateAgentInstance = PersistenceService.createAgentInstance as jest.MockedFunction<
  typeof PersistenceService.createAgentInstance
>;

const buildTestAgent = (id: string): Agent => ({
  id,
  name: `Agent ${id}`,
  role: 'assistant',
  systemPrompt: 'prompt',
  llmProvider: LLMProvider.Mistral,
  model: 'model-x',
  capabilities: [LLMCapability.Chat],
  creator_id: RobotId.Bos,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
});

const buildTestInstance = (id: string): AgentInstance => ({
  id,
  prototypeId: 'proto-x',
  name: `Instance ${id}`,
  position: { x: 0, y: 0 },
  isMinimized: false,
  isMaximized: false,
  configuration_json: null,
});

// "mock" prefix : référencée dans la factory jest.mock (résolue au rendu, pas au hoist)
const mockAgentsToAdd: Agent[] = [buildTestAgent('proto-1'), buildTestAgent('proto-2')];

jest.mock('../../contexts/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth: jest.fn(),
}));

jest.mock('../../utils/apiClient', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
    delete: jest.fn(),
  },
}));

jest.mock('../../services/bosRunProjectionService', () => ({
  hydrateToolMessagesFromPersistedRuns: (messages: unknown[]) => Promise.resolve(messages),
  buildBosHydrationFingerprint: jest.fn(() => ''),
}));

jest.mock('../../components/NavigationLayout', () => ({
  NavigationLayout: () => <div data-testid="navigation-layout" />,
}));

jest.mock('../../components/RobotPageRouter', () => ({
  RobotPageRouter: ({ onAddToWorkflow }: { onAddToWorkflow?: (agent: Agent) => void }) => (
    <div data-testid="robot-page-router">
      {mockAgentsToAdd.map((agent, index) => (
        <button key={agent.id} type="button" data-testid={`add-agent-${index}`} onClick={() => onAddToWorkflow?.(agent)}>
          {`add ${agent.id}`}
        </button>
      ))}
    </div>
  ),
}));

jest.mock('../../components/Header', () => ({
  Header: () => <div data-testid="header" />,
}));

jest.mock('../../components/HydrationOverlay', () => ({
  HydrationOverlay: ({ isLoading }: { isLoading: boolean }) => <div data-testid="hydration-overlay">{isLoading ? 'loading' : 'idle'}</div>,
}));

jest.mock('../../components/WorkflowSwitchOverlay', () => ({ WorkflowSwitchOverlay: () => null }));
jest.mock('../../components/HyperspaceReveal', () => ({ HyperspaceReveal: () => null }));
jest.mock('../../components/NotificationDisplay', () => ({ NotificationDisplay: () => null }));

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
  useRuntimeStore: Object.assign(
    (selector?: (state: ReturnType<typeof getAppHydrationHarness>['runtimeStore']) => unknown) => {
      const state = getAppHydrationHarness().runtimeStore;
      return selector ? selector(state) : state;
    },
    { getState: () => getAppHydrationHarness().runtimeStore },
  ),
}));

jest.mock('../../stores/useDesignStore', () => {
  const actual = jest.requireActual('../../stores/useDesignStore');
  return {
    ...actual,
    useDesignStore: Object.assign(
      (selector?: (state: ReturnType<typeof getAppHydrationHarness>['designStore']) => unknown) => {
        const state = getAppHydrationHarness().designStore;
        return selector ? selector(state) : state;
      },
      { getState: () => getAppHydrationHarness().designStore },
    ),
  };
});

jest.mock('../../stores/useWorkflowStore', () => ({
  useWorkflowStore: Object.assign(
    (selector?: (state: ReturnType<typeof getAppHydrationHarness>['workflowStore']) => unknown) => {
      const state = getAppHydrationHarness().workflowStore;
      return selector ? selector(state) : state;
    },
    { getState: () => getAppHydrationHarness().workflowStore },
  ),
}));

jest.mock('../../stores/useFunctionStore', () => ({
  useFunctionStore: Object.assign(() => getAppHydrationHarness().functionStore, {
    getState: () => getAppHydrationHarness().functionStore,
  }),
}));

describe('US-RC-00a — stale closure addAgentToWorkflow (R1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const harness = resetAppHydrationHarness();
    // renameNodeRuntimeState est appelé par addAgentToWorkflow : l'ajouter au store mocké
    (harness.runtimeStore as unknown as Record<string, unknown>).renameNodeRuntimeState = jest.fn();
    harness.designStore.addAgentInstance = jest.fn().mockReturnValueOnce('local-1').mockReturnValueOnce('local-2');
    harness.designStore.currentWorkflowId = 'wf-1';

    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      accessToken: 'token-123',
      runtimeLLMConfigs: [],
      localLLMProfiles: [],
      user: { id: 'user-1', email: 'user@example.com' },
      logout: jest.fn(),
      refreshRuntimeConfigState: jest.fn(),
      sessionStatus: 'ready',
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useAuth>);

    (apiClient.get as jest.Mock).mockReset().mockResolvedValue({ data: buildEmptyWorkspacePayload() });
    (apiClient.post as jest.Mock).mockReset().mockResolvedValue({ data: { success: true } });
    (apiClient.delete as jest.Mock).mockReset().mockResolvedValue({ data: { success: true } });

    mockCreateAgentInstance
      .mockReset()
      .mockResolvedValueOnce({
        success: true,
        backendId: 'srv-1',
        instance: { persistenceConfig: null, configuration_json: { role: 'assistant' } },
      } as unknown as Awaited<ReturnType<typeof PersistenceService.createAgentInstance>>)
      .mockResolvedValueOnce({
        success: true,
        backendId: 'srv-2',
        instance: { persistenceConfig: null, configuration_json: { role: 'assistant' } },
      } as unknown as Awaited<ReturnType<typeof PersistenceService.createAgentInstance>>);

    useAppShellStore.setState({
      currentImageAgentInstance: null,
      currentVideoAgentInstance: null,
      currentImageNodeId: null,
      currentVideoNodeId: null,
    });
    sessionStorage.clear();
    localStorage.clear();
  });

  it('applique le remap du persistedBackendId à l’instance courante, même si elle change entre deux ajouts', async () => {
    render(<App />);

    // Le panneau image est ouvert sur l'instance du 1er agent (local-1)
    act(() => {
      useAppShellStore.getState().setCurrentImageAgentInstance(buildTestInstance('local-1'));
      useAppShellStore.getState().setCurrentVideoAgentInstance(buildTestInstance('local-1'));
    });

    // 1er ajout : local-1 -> srv-1
    fireEvent.click(screen.getByTestId('add-agent-0'));
    await waitFor(() => expect(useAppShellStore.getState().currentImageAgentInstance?.id).toBe('srv-1'), { timeout: 3000 });
    await waitFor(() => expect(useAppShellStore.getState().currentVideoAgentInstance?.id).toBe('srv-1'), { timeout: 3000 });

    // Changement d'agent image/vidéo entre les deux ajouts (ex. panneau ouvert sur le 2e agent)
    act(() => {
      useAppShellStore.getState().setCurrentImageAgentInstance(buildTestInstance('local-2'));
      useAppShellStore.getState().setCurrentVideoAgentInstance(buildTestInstance('local-2'));
    });

    // 2e ajout : local-2 -> srv-2 — le remap doit viser l'instance COURANTE (local-2)
    fireEvent.click(screen.getByTestId('add-agent-1'));
    await waitFor(() => expect(useAppShellStore.getState().currentImageAgentInstance?.id).toBe('srv-2'), { timeout: 3000 });
    await waitFor(() => expect(useAppShellStore.getState().currentVideoAgentInstance?.id).toBe('srv-2'), { timeout: 3000 });
  });
});
