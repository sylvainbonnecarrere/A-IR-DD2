import { act, renderHook, waitFor } from '@testing-library/react';
import { useAgentChat } from '../../hooks/useAgentChat';
import { LLMCapability, LLMProvider, RobotId, type Agent } from '../../types';
import type { UserFunction } from '../../types/function.types';

const mockRunAgentLoop = jest.fn();
const mockCreateAdapter = jest.fn();
const mockResolveHistoryRuntimeConfig = jest.fn(() => ({ config: null, credential: null }));

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
  resolveHistoryRuntimeConfig: (...args: unknown[]) => mockResolveHistoryRuntimeConfig(...args),
}));

const designState = {
  agentInstances: [
    {
      id: 'instance-1',
      workflowId: 'wf-1',
    },
  ],
};

jest.mock('../../stores/useDesignStore', () => {
  const actual = jest.requireActual('../../stores/useDesignStore');

  return {
    ...actual,
    useDesignStore: jest.fn((selector?: (state: Record<string, unknown>) => unknown) => {
      return selector ? selector(designState) : designState;
    }),
  };
});

const runtimeState = {
  getNodeMessages: jest.fn(() => []),
  getNodeInvisibleHistorySummary: jest.fn(() => null),
  addNodeMessage: jest.fn(),
  setNodeInvisibleHistorySummary: jest.fn(),
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

const llmServiceMocks = jest.requireMock('../../services/llmService') as {
  generateContent: jest.Mock;
};

describe('useAgentChat local AgentLoop path', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    designState.agentInstances = [
      {
        id: 'instance-1',
        workflowId: 'wf-1',
      },
    ];
    mockCreateAdapter.mockReturnValue({ provider: LLMProvider.LMStudio });
    mockResolveHistoryRuntimeConfig.mockReturnValue({ config: null, credential: null });
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
    runtimeState.getNodeMessages.mockReturnValue([]);
    runtimeState.getNodeInvisibleHistorySummary.mockReturnValue(null);
    llmServiceMocks.generateContent.mockResolvedValue({ text: 'Résumé caché' });
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

  it('keeps invisible synthesis out of the visible chat while sending summary plus the latest user turn to AgentLoop', async () => {
    runtimeState.getNodeMessages.mockReturnValue([
      {
        id: 'prior-msg-1',
        sender: 'agent',
        text: 'Historique visible ancien',
        timestamp: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);
    mockResolveHistoryRuntimeConfig.mockReturnValue({
      config: { provider: LLMProvider.Gemini, enabled: true, apiKey: 'summary-key' },
      credential: 'summary-key',
    });

    const agent: Agent = {
      id: 'agent-history-1',
      name: 'Local Agent',
      role: 'assistant',
      systemPrompt: 'Use tools when relevant',
      llmProvider: LLMProvider.LMStudio,
      model: 'local-model',
      capabilities: [LLMCapability.Chat, LLMCapability.FunctionCalling],
      toolSelections: [{ toolId: '507f1f77bcf86cd799439022' }],
      historyConfig: {
        enabled: true,
        llmProvider: LLMProvider.Gemini,
        model: 'gemini-2.0-flash',
        role: 'Summarizer',
        systemPrompt: 'Summarize previous turns only.',
        limits: { char: 1, word: 9999, token: 9999, sentence: 9999, message: 9999 },
        enabledLimits: { char: true, word: false, token: false, sentence: false, message: false },
      },
      creator_id: RobotId.Archi,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
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
      await result.current.handleSendMessage('Nouveau message utilisateur', null);
    });

    await waitFor(() => {
      expect(llmServiceMocks.generateContent).toHaveBeenCalledTimes(1);
      expect(mockRunAgentLoop).toHaveBeenCalledTimes(1);
    });

    const summarizationHistory = llmServiceMocks.generateContent.mock.calls[0][4];
    expect(summarizationHistory[0].text).toContain('Historique visible ancien');
    expect(summarizationHistory[0].text).not.toContain('Nouveau message utilisateur');

    const forwardedConversation = mockRunAgentLoop.mock.calls[0][1];
    expect(forwardedConversation).toEqual([
      expect.objectContaining({ sender: 'agent', text: 'Résumé caché' }),
      expect.objectContaining({ sender: 'user', text: 'Nouveau message utilisateur' }),
    ]);
    expect(runtimeState.setNodeMessages).not.toHaveBeenCalled();
    expect(runtimeState.setNodeInvisibleHistorySummary).toHaveBeenCalledWith(
      'node-1',
      expect.objectContaining({
        summary: 'Résumé caché',
        coveredThroughMessageId: 'prior-msg-1',
      })
    );
  });

  it('hydrates tool scope from instance toolSelections when the prototype has none', async () => {
    designState.agentInstances = [
      {
        id: 'instance-1',
        workflowId: 'wf-1',
        configuration_json: {
          toolSelections: [{ toolId: '507f1f77bcf86cd799439022' }],
        },
      },
    ];

    const agent: Agent = {
      id: 'agent-instance-tools-1',
      name: 'Instance Scoped Agent',
      role: 'assistant',
      systemPrompt: 'Use tools when relevant',
      llmProvider: LLMProvider.LMStudio,
      model: 'local-model',
      capabilities: [LLMCapability.Chat, LLMCapability.FunctionCalling],
      toolSelections: [],
      creator_id: RobotId.Archi,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
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
  });

  it('does not crash when a legacy partial historyConfig is enabled on the first chat turn', async () => {
    const agent: Agent = {
      id: 'agent-partial-history-1',
      name: 'Legacy History Agent',
      role: 'assistant',
      systemPrompt: 'Use tools when relevant',
      llmProvider: LLMProvider.LMStudio,
      model: 'local-model',
      capabilities: [LLMCapability.Chat, LLMCapability.FunctionCalling],
      toolSelections: [{ toolId: '507f1f77bcf86cd799439022' }],
      historyConfig: {
        enabled: true,
        llmProvider: LLMProvider.Gemini,
        model: 'gemini-2.0-flash',
        role: 'Summarizer',
        systemPrompt: 'Summarize previous turns only.',
      } as Agent['historyConfig'],
      creator_id: RobotId.Archi,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
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
      await result.current.handleSendMessage('Bonjour, je suis Sylvain', null);
    });

    await waitFor(() => {
      expect(mockRunAgentLoop).toHaveBeenCalledTimes(1);
    });

    expect(runtimeState.addNodeMessage).not.toHaveBeenCalledWith(
      'node-1',
      expect.objectContaining({
        sender: 'agent',
        isError: true,
        text: expect.stringContaining("reading 'char'"),
      })
    );
  });
});
