import { createTestAgent, createTestAgentInstance } from '../builders/domainBuilders';
import {
  createDesignStoreTestState,
  createFunctionStoreTestState,
  createRuntimeStoreTestState,
  type DesignStoreTestState,
  type FunctionStoreTestState,
  type RuntimeStoreTestState,
} from '../builders/storeStateBuilders';
import type { Agent, AgentInstance } from '../../types';

export interface FullscreenChatHarnessState {
  runtimeStore: RuntimeStoreTestState;
  designStore: DesignStoreTestState;
  functionStore: FunctionStoreTestState;
}

interface ResetFullscreenChatHarnessOptions {
  runtimeStore?: Partial<RuntimeStoreTestState>;
  designStore?: Partial<DesignStoreTestState>;
  functionStore?: Partial<FunctionStoreTestState>;
  agent?: Agent;
  agentInstance?: AgentInstance;
}

let fullscreenChatHarnessState: FullscreenChatHarnessState;

export function resetFullscreenChatHarness(
  options: ResetFullscreenChatHarnessOptions = {},
): FullscreenChatHarnessState {
  const agent = options.agent ?? createTestAgent();
  const agentInstance = options.agentInstance ?? createTestAgentInstance({
    prototypeId: agent.id,
    workflowId: 'wf-1',
  });

  fullscreenChatHarnessState = {
    runtimeStore: createRuntimeStoreTestState({
      fullscreenChatNodeId: 'node-instance-1',
      fullscreenChatAgent: null,
      fullscreenChatAgentInstance: null,
      setFullscreenChatNodeId: jest.fn(),
      getNodeMessages: jest.fn((_nodeId: string) => []),
      addNodeMessage: jest.fn(),
      setNodeMessages: jest.fn(),
      setNodeExecuting: jest.fn(),
      isNodeExecuting: jest.fn(() => false),
      llmConfigs: [],
      ...options.runtimeStore,
    }),
    designStore: createDesignStoreTestState({
      agents: options.designStore?.agents ?? [agent],
      agentInstances: options.designStore?.agentInstances ?? [agentInstance],
      updateInstanceConfig: jest.fn(),
      ...options.designStore,
    }),
    functionStore: createFunctionStoreTestState({
      functions: [],
      ...options.functionStore,
    }),
  };

  return fullscreenChatHarnessState;
}

export function getFullscreenChatHarness(): FullscreenChatHarnessState {
  if (!fullscreenChatHarnessState) {
    return resetFullscreenChatHarness();
  }

  return fullscreenChatHarnessState;
}