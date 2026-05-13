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
      expect(payload.toolSelection).toEqual({
        toolId: '507f1f77bcf86cd799439022',
        versionRef: {
          versionTag: '1.0.0',
          versionNumber: 1,
          workspaceId: null,
        },
      });
      expect(payload).not.toHaveProperty('functionId');
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

  it('sends a minimal sandbox payload while forwarding the selected web engine from agent settings into private context', async () => {
    const googleSearchAgent: Agent = {
      ...weatherSearchAgent,
      webSearchParams: {
        ...weatherSearchAgent.webSearchParams,
        web_engine: 'google.com',
      },
    };

    global.fetch = jest.fn(async (_url, init) => {
      const payload = JSON.parse(String(init?.body ?? '{}'));

      expect(payload.testArgs).toEqual({
        query: 'météo Marseille demain',
        num_results: 3,
      });
      expect(JSON.stringify(payload.testArgs)).not.toContain('query_transformation');
      expect(JSON.stringify(payload.testArgs)).not.toContain('duckduckgo.com');
      expect(payload.toolSelection).toEqual({
        toolId: '507f1f77bcf86cd799439022',
        versionRef: {
          versionTag: '1.0.0',
          versionNumber: 1,
          workspaceId: null,
        },
      });
      expect(payload).not.toHaveProperty('functionId');

      expect(payload.privateContext).toEqual(expect.objectContaining({
        web_search: expect.objectContaining({
          params: expect.objectContaining({
            web_engine: 'google.com',
            query_transformation: 'Q={{user_query}}',
          }),
          llm: expect.objectContaining({
            provider: LLMProvider.OpenAI,
            model: 'gpt-4o-mini',
            localLLMProfileId: null,
          }),
        }),
      }));

      return {
        ok: true,
        json: async () => ({
          success: true,
          output: {
            query: 'météo Marseille demain',
            trace: {
              transformed_query_raw: 'Marseille météo demain',
              queries: [
                {
                  engine: 'google.com',
                  engine_query_text: 'Marseille météo demain',
                },
              ],
            },
          },
          executionId: 'exec-456',
          runner: 'docker_sandbox',
          exitCode: 0,
          metadata: { artifacts: [] },
        }),
      } as Response;
    }) as typeof fetch;

    const result = await executeAgentToolCall({
      toolCall: {
        id: 'tool-2',
        name: 'web_search_py',
        arguments: JSON.stringify({
          query: 'météo Marseille demain',
          num_results: 2,
        }),
      },
      agent: googleSearchAgent,
      availableFunctions: [webSearchFunction],
      authToken: 'token-123',
    });

    expect(result.executionId).toBe('exec-456');
    expect(result.serializedArguments).toBe('{"query":"météo Marseille demain","num_results":3}');
    expect(result.result).toEqual(expect.objectContaining({
      trace: expect.objectContaining({
        transformed_query_raw: 'Marseille météo demain',
        queries: [
          expect.objectContaining({
            engine: 'google.com',
            engine_query_text: 'Marseille météo demain',
          }),
        ],
      }),
    }));
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
