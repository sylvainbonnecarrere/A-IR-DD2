import { act, renderHook, waitFor } from '@testing-library/react';
import { useAgentChat } from '../../hooks/useAgentChat';
import { LLMCapability, LLMProvider, RobotId, type Agent } from '../../types';
import type { UserFunction } from '../../types/function.types';

const mockRunAgentLoop = jest.fn();
const mockCreateAdapter = jest.fn();

jest.mock('../../services/llmService', () => ({
  generateContentStream: jest.fn(),
  generateContent: jest.fn(),
}));

jest.mock('../../services/adapters/AdapterFactory', () => ({
  createAdapter: (...args: unknown[]) => mockCreateAdapter(...args),
}));

jest.mock('../../services/llm/AgentLoop', () => ({
  runAgentLoop: (...args: unknown[]) => mockRunAgentLoop(...args),
}));

jest.mock('../../utils/toolExecutor', () => ({
  executeTool: jest.fn(),
}));

jest.mock('../../services/runtimeConfigResolver', () => ({
  resolveAgentRuntimeConfig: jest.fn(() => ({
    config: { enabled: true, localEndpoint: 'http://localhost:1234' },
    credential: 'http://localhost:1234',
  })),
  resolveHistoryRuntimeConfig: jest.fn(() => ({ config: null, credential: null })),
}));

jest.mock('../../stores/useDesignStore', () => ({
  useDesignStore: jest.fn((selector?: (state: Record<string, unknown>) => unknown) => {
    const state = {
      agentInstances: [
        {
          id: 'instance-1',
          workflowId: 'wf-1',
        },
      ],
    };
    return selector ? selector(state) : state;
  }),
}));

const runtimeState = {
  getNodeMessages: jest.fn(() => []),
  addNodeMessage: jest.fn(),
  setNodeMessages: jest.fn(),
  setNodeExecuting: jest.fn(),
  localLLMProfiles: [],
};

jest.mock('../../stores/useRuntimeStore', () => ({
  useRuntimeStore: jest.fn((selector?: (state: typeof runtimeState) => unknown) => (
    selector ? selector(runtimeState) : runtimeState
  )),
}));

const functionState: { functions: UserFunction[]; loadFunctions: jest.Mock } = {
  functions: [
    {
      _id: '507f1f77bcf86cd799439011',
      toolId: '507f1f77bcf86cd799439022',
      name: 'web_search_py',
      description: 'Search the web',
      language: 'python',
      origin: 'native',
      userId: null,
      workflowId: 'wf-1',
      inputSchema: {},
      outputSchema: {},
      codePath: null,
      codeInline: null,
      dependencies: [],
      isEnabled: true,
      isReadonly: true,
      version: 1,
      versionTag: '1.0.0',
      tags: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
  loadFunctions: jest.fn(async () => undefined),
};

jest.mock('../../stores/useFunctionStore', () => ({
  useFunctionStore: Object.assign(
    jest.fn((selector?: (state: typeof functionState) => unknown) => (
      selector ? selector(functionState) : functionState
    )),
    {
      getState: () => functionState,
    }
  ),
}));

jest.mock('../../contexts/AuthContext', () => ({
  useAuth: jest.fn(() => ({
    accessToken: 'token-123',
    isAuthenticated: true,
  })),
}));

describe('useAgentChat local AgentLoop path', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateAdapter.mockReturnValue({ provider: LLMProvider.LMStudio });
    mockRunAgentLoop.mockResolvedValue({
      finalResponse: 'outil lancé',
      toolCallLog: [
        {
          id: 'tool-record-1',
          functionName: 'web_search_py',
          arguments: { query: 'météo Marseille demain', num_results: 3 },
          result: { ok: true },
          status: 'success',
          durationMs: 10,
          timestamp: new Date('2026-01-01T00:00:00.000Z'),
        },
      ],
      iterations: 1,
      finishReason: 'stop',
    });
  });

  it('uses AgentLoop for local fullscreen chat and keeps web_search_py in scope', async () => {
    const agent: Agent = {
      id: 'agent-1',
      name: 'Local Agent',
      role: 'assistant',
      systemPrompt: 'Use tools when relevant',
      llmProvider: LLMProvider.LMStudio,
      model: 'local-model',
      capabilities: [LLMCapability.Chat, LLMCapability.FunctionCalling],
      toolSelections: [{ toolId: '507f1f77bcf86cd799439022' }],
      creator_id: RobotId.Archi,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      webSearchParams: {
        nb_request_transformation: 1,
        request_list: false,
        max_uses: 5,
        cross_lingual_search: false,
        web_engine_search: true,
        web_engine: 'duckduckgo.com',
        web_engine_nb_result_select: 3,
        dig_snippet: false,
        allowed_domains: [],
        query_transformation: 'Q={{user_query}}',
        reranking_prompt: '',
        relevance_threshold: 7,
        rerank_strategy: 'Fast',
        max_context_tokens: 4000,
      },
    };

    const { result } = renderHook(() => useAgentChat({
      nodeId: 'node-1',
      agent,
      llmConfigs: [],
      t: (key: string) => key,
      instanceId: 'instance-1',
      accessToken: 'token-123',
    }));

    await act(async () => {
      await result.current.handleSendMessage('météo demain Marseille', null);
    });

    await waitFor(() => {
      expect(mockRunAgentLoop).toHaveBeenCalledTimes(1);
    });

    expect(mockRunAgentLoop.mock.calls[0][2]).toEqual([
      expect.objectContaining({ name: 'web_search_py' }),
    ]);
    expect(runtimeState.addNodeMessage).toHaveBeenCalledWith(
      'node-1',
      expect.objectContaining({
        sender: 'agent',
        text: 'outil lancé',
      })
    );
  });
});
