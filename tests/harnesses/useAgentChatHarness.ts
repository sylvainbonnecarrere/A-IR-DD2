import type { Agent, AgentInstance } from '../../types';
import {
  createTestAgent,
  createTestAgentInstance,
} from '../builders/domainBuilders';
import {
  createDesignStoreTestState,
  createFunctionStoreTestState,
  createRuntimeStoreTestState,
  type DesignStoreTestState,
  type FunctionStoreTestState,
  type RuntimeStoreTestState,
} from '../builders/storeStateBuilders';

type UseAgentChatRuntimeStoreTestState = RuntimeStoreTestState & {
  getNodeInvisibleHistorySummary: jest.Mock;
  setNodeInvisibleHistorySummary: jest.Mock;
  setNodeExecuting: jest.Mock;
};

type UseAgentChatFunctionStoreTestState = FunctionStoreTestState & {
  getState: () => UseAgentChatFunctionStoreTestState;
};

type UseAgentChatAuthState = {
  accessToken: string | null;
  isAuthenticated: boolean;
};

interface ResetUseAgentChatHarnessOptions {
  agent?: Agent;
  agentInstance?: AgentInstance;
  runtimeStore?: Partial<UseAgentChatRuntimeStoreTestState>;
  designStore?: Partial<DesignStoreTestState>;
  functionStore?: Partial<FunctionStoreTestState>;
  authState?: Partial<UseAgentChatAuthState>;
}

export interface UseAgentChatHarnessState {
  agent: Agent;
  agentInstance: AgentInstance;
  runtimeStore: UseAgentChatRuntimeStoreTestState;
  designStore: DesignStoreTestState;
  functionStore: UseAgentChatFunctionStoreTestState;
  authState: UseAgentChatAuthState;
}

let currentUseAgentChatHarness: UseAgentChatHarnessState | null = null;

export function resetUseAgentChatHarness(
  options: ResetUseAgentChatHarnessOptions = {},
): UseAgentChatHarnessState {
  const agent = options.agent ?? createTestAgent();
  const agentInstance = options.agentInstance ?? createTestAgentInstance({
    prototypeId: agent.id,
    configuration_json: null,
  });

  const runtimeStore = {
    ...createRuntimeStoreTestState({
      getNodeMessages: jest.fn((_nodeId: string) => []),
      setNodeMessages: jest.fn(),
      localLLMProfiles: [],
      ...options.runtimeStore,
    }),
    getNodeInvisibleHistorySummary:
      options.runtimeStore?.getNodeInvisibleHistorySummary ?? jest.fn(() => null),
    setNodeInvisibleHistorySummary:
      options.runtimeStore?.setNodeInvisibleHistorySummary ?? jest.fn(),
    setNodeExecuting:
      options.runtimeStore?.setNodeExecuting ?? jest.fn(),
  } satisfies UseAgentChatRuntimeStoreTestState;

  if (!options.runtimeStore?.addNodeMessage) {
    runtimeStore.addNodeMessage = jest.fn((nodeId: string, message: unknown) => {
      const currentMessages = runtimeStore.nodeMessages[nodeId] ?? [];
      runtimeStore.nodeMessages[nodeId] = [...currentMessages, message as never];
    });
  }

  if (!options.runtimeStore?.resetAll) {
    runtimeStore.resetAll = jest.fn(() => {
      runtimeStore.nodeMessages = {};
      runtimeStore.llmConfigs = [];
      runtimeStore.localLLMProfiles = [];
    });
  }

  const designStore = createDesignStoreTestState({
    agents: options.designStore?.agents ?? [],
    agentInstances: [agentInstance],
    ...options.designStore,
  });

  const functionStore = createFunctionStoreTestState({
    ...options.functionStore,
  }) as UseAgentChatFunctionStoreTestState;

  functionStore.getState = () => functionStore;

  currentUseAgentChatHarness = {
    agent,
    agentInstance,
    runtimeStore,
    designStore,
    functionStore,
    authState: {
      accessToken: 'token-123',
      isAuthenticated: true,
      ...options.authState,
    },
  };

  return currentUseAgentChatHarness;
}

export function getUseAgentChatHarness(): UseAgentChatHarnessState {
  if (!currentUseAgentChatHarness) {
    return resetUseAgentChatHarness();
  }

  return currentUseAgentChatHarness;
}