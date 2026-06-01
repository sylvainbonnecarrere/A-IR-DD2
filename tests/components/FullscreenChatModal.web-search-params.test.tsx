import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { FullscreenChatModal } from '../../components/modals/FullscreenChatModal';
import { LLMProvider, RobotId } from '../../types';
import type { UserFunction } from '../../types/function.types';
import apiClient from '../../utils/apiClient';
import { createTestAgent, createTestAgentInstance, createToolSelection } from '../builders/domainBuilders';
import { resetFullscreenChatHarness } from '../harnesses/fullscreenChatHarness';

let fullscreenChatHarness = resetFullscreenChatHarness();
let runtimeStoreState: Record<string, unknown> = fullscreenChatHarness.runtimeStore;
let designStoreState: Record<string, unknown> = fullscreenChatHarness.designStore;
let functionStoreState: { functions: UserFunction[] } = fullscreenChatHarness.functionStore;

const createWebSearchFunction = (): UserFunction => ({
  _id: 'fn-1',
  toolId: 'tool.web-search',
  name: 'web_search_py',
  description: 'Web search',
  language: 'python',
  origin: 'native',
  userId: null,
  workflowId: null,
  inputSchema: {},
  outputSchema: {},
  codePath: null,
  codeInline: null,
  dependencies: [],
  isEnabled: true,
  isReadonly: true,
  version: 1,
  tags: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

jest.mock('../../components/workflow/ToolCallBlock', () => ({ ToolCallBlock: () => null }));
jest.mock('../../components/modals/ConfirmationModal', () => ({ ConfirmationModal: () => null }));
jest.mock('../../components/panels/ImageGenerationPanel', () => ({ ImageGenerationPanel: () => null }));
jest.mock('../../components/panels/VideoGenerationConfigPanel', () => ({ VideoGenerationConfigPanel: () => null }));
jest.mock('../../components/panels/MapsGroundingConfigPanel', () => ({ MapsGroundingConfigPanel: () => null }));
jest.mock('../../utils/apiClient', () => ({ __esModule: true, default: { get: jest.fn() } }));
jest.mock('../../hooks/useLocalization', () => ({
  useLocalization: () => ({
    t: (key: string, fallbackOrParams?: string | Record<string, string | number>, params?: Record<string, string | number>) => {
      if (typeof fallbackOrParams === 'string') {
        return Object.entries(params ?? {}).reduce(
          (value, [paramKey, paramValue]) => value.replace(`{${paramKey}}`, String(paramValue)),
          fallbackOrParams,
        );
      }

      return key;
    },
  }),
}));
jest.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ isAuthenticated: true, accessToken: 'token-123' }) }));
jest.mock('../../hooks/useAgentChat', () => ({ useAgentChat: () => ({ handleSendMessage: jest.fn(), loadingMessage: '' }) }));
jest.mock('../../services/webSearchParamsConfigService', () => ({ persistInstanceWebSearchParams: jest.fn(async () => undefined) }));

jest.mock('../../stores/useRuntimeStore', () => ({
  useRuntimeStore: jest.fn((selector?: (state: Record<string, unknown>) => unknown) => {
    const state = require('../harnesses/fullscreenChatHarness').getFullscreenChatHarness().runtimeStore;
    return selector ? selector(state) : state;
  }),
}));

jest.mock('../../stores/useDesignStore', () => {
  const actual = jest.requireActual('../../stores/useDesignStore');

  return {
    ...actual,
    useDesignStore: jest.fn((selector?: (state: Record<string, unknown>) => unknown) => {
      const state = require('../harnesses/fullscreenChatHarness').getFullscreenChatHarness().designStore;
      return selector ? selector(state) : state;
    }),
  };
});

jest.mock('../../stores/useFunctionStore', () => ({
  useFunctionStore: jest.fn((selector?: (state: { functions: UserFunction[] }) => unknown) => {
    const state = require('../harnesses/fullscreenChatHarness').getFullscreenChatHarness().functionStore;
    return selector ? selector(state) : state;
  }),
}));

describe('FullscreenChatModal web search params entrypoint', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (apiClient.get as jest.Mock).mockResolvedValue({ data: { chatMessages: [] } });

    const agent = createTestAgent({
      id: 'agent-1',
      name: 'Phil Agent',
      role: 'Phil',
      systemPrompt: 'Prompt',
      llmProvider: LLMProvider.OpenAI,
      model: 'gpt-4o-mini',
      capabilities: [],
      toolSelections: [createToolSelection({ toolId: 'tool.web-search' })],
      creator_id: RobotId.Phil,
    });

    fullscreenChatHarness = resetFullscreenChatHarness({
      runtimeStore: {
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
      },
      agent,
      agentInstance: createTestAgentInstance({
        id: 'instance-1',
        prototypeId: agent.id,
        workflowId: 'wf-1',
        name: 'Phil Instance',
        configuration_json: {
          role: 'Phil',
          model: 'gpt-4o-mini',
          llmProvider: LLMProvider.OpenAI,
          systemPrompt: 'Prompt',
          tools: [],
          toolSelections: [createToolSelection({ toolId: 'tool.web-search' })],
          position: { x: 0, y: 0 },
        },
      }),
      functionStore: { functions: [createWebSearchFunction()] },
    });

    runtimeStoreState = fullscreenChatHarness.runtimeStore;
    designStoreState = fullscreenChatHarness.designStore;
    functionStoreState = fullscreenChatHarness.functionStore;
  });

  it('shows the web search params button and opens the modal', async () => {
    render(<FullscreenChatModal />);

    fireEvent.click(screen.getByTitle("Paramètres Web Search de l'agent"));

    expect(screen.getByText(/Paramètres Web Search de l'agent/)).toBeInTheDocument();
  });

  it('falls back to the prototype configuration when instance configuration_json is null', async () => {
    designStoreState = {
      ...designStoreState,
      agentInstances: [
        {
          ...designStoreState.agentInstances[0],
          configuration_json: null,
        },
      ],
    };
    fullscreenChatHarness.designStore = designStoreState as typeof fullscreenChatHarness.designStore;

    render(<FullscreenChatModal />);

    fireEvent.click(screen.getByTitle("Paramètres Web Search de l'agent"));

    expect(screen.getByText(/Paramètres Web Search de l'agent/)).toBeInTheDocument();
  });
});