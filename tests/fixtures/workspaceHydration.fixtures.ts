import { publishHydrationComponentReady } from '../../utils/hydrationComponentReadiness';

export interface WorkspacePayloadFixture {
  workflow: {
    id: string;
    name: string;
    isActive: boolean;
    isDefault: boolean;
    canvasState: { zoom: number; panX: number; panY: number };
  };
  agentPrototypes: Array<Record<string, unknown>>;
  agentInstances: Array<Record<string, unknown>>;
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
}

type WorkspacePayloadOverrides = Partial<WorkspacePayloadFixture> & {
  workflow?: Partial<WorkspacePayloadFixture['workflow']>;
};

type AuthStateOverrides = Record<string, unknown>;
type RuntimeStateOverrides = Record<string, unknown>;

export const emitHydrationComponentsReady = () => {
  const emitStructuredSignals = () => {
    try {
      publishHydrationComponentReady({
        source: 'workflow-canvas-stable',
        workflowId: 'workflow-1',
        nodeCount: 1,
      });
      publishHydrationComponentReady({
        source: 'bos-media-button',
        workflowId: 'workflow-1',
      });
    } catch {
      // ignore test-only dispatch failures
    }
  };

  try {
    window.dispatchEvent(new Event('hydration:components:ready'));
  } catch {
    // ignore test-only dispatch failures
  }

  emitStructuredSignals();

  setTimeout(() => {
    try {
      window.dispatchEvent(new Event('hydration:components:ready'));
    } catch {
      // ignore test-only dispatch failures
    }

    emitStructuredSignals();
  }, 0);

  setTimeout(() => {
    try {
      window.dispatchEvent(new Event('hydration:components:ready'));
    } catch {
      // ignore test-only dispatch failures
    }

    emitStructuredSignals();
  }, 250);
};

export const buildWorkspacePayload = (
  overrides: WorkspacePayloadOverrides = {},
): WorkspacePayloadFixture => {
  const base: WorkspacePayloadFixture = {
    workflow: {
      id: 'workflow-1',
      name: 'Workspace principal',
      isActive: true,
      isDefault: true,
      canvasState: { zoom: 1, panX: 0, panY: 0 },
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
        toolSelections: [],
      },
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
          position: { x: 10, y: 20 },
        },
      },
    ],
    nodes: [],
    edges: [],
  };

  return {
    ...base,
    ...overrides,
    workflow: {
      ...base.workflow,
      ...(overrides.workflow ?? {}),
    },
    agentPrototypes: overrides.agentPrototypes ?? base.agentPrototypes,
    agentInstances: overrides.agentInstances ?? base.agentInstances,
    nodes: overrides.nodes ?? base.nodes,
    edges: overrides.edges ?? base.edges,
  };
};

export const buildEmptyWorkspacePayload = (
  overrides: WorkspacePayloadOverrides = {},
): WorkspacePayloadFixture => buildWorkspacePayload({
  workflow: {
    id: 'workflow-2',
    name: 'Workflow vide',
    isActive: true,
    isDefault: false,
    canvasState: { zoom: 0.8, panX: 10, panY: 20 },
    ...(overrides.workflow ?? {}),
  },
  agentPrototypes: [],
  agentInstances: [],
  nodes: [],
  edges: [],
  ...overrides,
});

export const buildWorkspacePayloadWithoutPersistedChat = (
  overrides: WorkspacePayloadOverrides = {},
): WorkspacePayloadFixture => {
  const payload = buildWorkspacePayload(overrides);
  return {
    ...payload,
    agentInstances: payload.agentInstances.map((instance, index) => (
      index === 0
        ? {
            ...instance,
            chatMessages: [],
          }
        : instance
    )),
  };
};

export const buildRuntimeRefreshState = (overrides: RuntimeStateOverrides = {}) => ({
  llmApiKeys: [],
  runtimeLLMConfigs: [{ provider: 'gemini' }],
  localLLMProfiles: [],
  ...overrides,
});

export const buildAuthenticatedAuthState = (overrides: AuthStateOverrides = {}) => ({
  isAuthenticated: true,
  accessToken: 'token-ready',
  runtimeLLMConfigs: [],
  localLLMProfiles: [],
  user: { id: 'user-1', email: 'user@example.com' },
  logout: () => undefined,
  refreshRuntimeConfigState: async () => buildRuntimeRefreshState(),
  sessionStatus: 'ready',
  isLoading: false,
  error: null,
  ...overrides,
});

export const buildRestoringAuthState = (overrides: AuthStateOverrides = {}) => buildAuthenticatedAuthState({
  accessToken: 'token-restoring',
  sessionStatus: 'restoring-session',
  ...overrides,
});