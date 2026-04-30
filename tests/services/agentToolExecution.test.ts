import { LLMProvider, RobotId, type Agent } from '../../types';
import type { UserFunction } from '../../types/function.types';
import { executeAgentToolCall } from '../../services/agentToolExecution';

jest.mock('../../utils/toolExecutor', () => ({
  executeTool: jest.fn(),
}));

const weatherSearchAgent: Agent = {
  id: 'agent-1',
  name: 'Weather Agent',
  role: 'assistant',
  systemPrompt: 'Use web search when needed',
  llmProvider: LLMProvider.OpenAI,
  model: 'gpt-4o-mini',
  capabilities: [],
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

const webSearchFunction: UserFunction = {
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
};

describe('agentToolExecution', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('uses Top N résultats moteur for web_search_py sandbox execution instead of max_uses', async () => {
    global.fetch = jest.fn(async (_url, init) => {
      const payload = JSON.parse(String(init?.body ?? '{}'));

      expect(payload.testArgs).toEqual(expect.objectContaining({
        query: 'météo Marseille demain',
        num_results: 3,
      }));
      expect(payload.testArgs.num_results).not.toBe(5);
      expect(payload.privateContext).toEqual(expect.objectContaining({
        web_search: expect.objectContaining({
          params: expect.objectContaining({
            web_engine_nb_result_select: 3,
            max_uses: 5,
          }),
        }),
      }));

      return {
        ok: true,
        json: async () => ({
          success: true,
          output: { ok: true },
          executionId: 'exec-123',
          runner: 'docker_sandbox',
          exitCode: 0,
          metadata: { artifacts: [] },
        }),
      } as Response;
    }) as typeof fetch;

    const result = await executeAgentToolCall({
      toolCall: {
        id: 'tool-1',
        name: 'web_search_py',
        arguments: JSON.stringify({
          query: 'météo Marseille demain',
          num_results: 5,
        }),
      },
      agent: weatherSearchAgent,
      availableFunctions: [webSearchFunction],
      authToken: 'token-123',
    });

    expect(result.executedArguments.num_results).toBe(3);
    expect(result.executionId).toBe('exec-123');
  });
});
