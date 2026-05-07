import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { FullscreenChatModal } from '../../components/modals/FullscreenChatModal';
import { LLMProvider, RobotId } from '../../types';
import type { UserFunction } from '../../types/function.types';
import apiClient from '../../utils/apiClient';

let runtimeStoreState: Record<string, any>;
let designStoreState: Record<string, any>;
let functionStoreState: { functions: UserFunction[] };

jest.mock('../../components/workflow/ToolCallBlock', () => ({ ToolCallBlock: () => <div data-testid="tool-call-block" /> }));
jest.mock('../../components/modals/ConfirmationModal', () => ({ ConfirmationModal: () => null }));
jest.mock('../../components/modals/WebSearchParamsModal', () => ({ WebSearchParamsModal: () => null }));
jest.mock('../../components/panels/ImageGenerationPanel', () => ({ ImageGenerationPanel: () => null }));
jest.mock('../../components/panels/VideoGenerationConfigPanel', () => ({ VideoGenerationConfigPanel: () => null }));
jest.mock('../../components/panels/MapsGroundingConfigPanel', () => ({ MapsGroundingConfigPanel: () => null }));
jest.mock('../../hooks/useLocalization', () => ({ useLocalization: () => ({ t: (key: string) => key }) }));
jest.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ isAuthenticated: true, accessToken: 'token-123' }) }));
jest.mock('../../hooks/useAgentChat', () => ({ useAgentChat: () => ({ handleSendMessage: jest.fn(), loadingMessage: '' }) }));
jest.mock('../../services/webSearchParamsConfigService', () => ({ persistInstanceWebSearchParams: jest.fn(async () => undefined) }));
jest.mock('../../utils/apiClient', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
  }
}));

jest.mock('../../stores/useRuntimeStore', () => ({
  useRuntimeStore: jest.fn((selector?: (state: Record<string, unknown>) => unknown) => (
    selector ? selector(runtimeStoreState) : runtimeStoreState
  )),
}));

jest.mock('../../stores/useDesignStore', () => ({
  useDesignStore: jest.fn((selector?: (state: Record<string, unknown>) => unknown) => (
    selector ? selector(designStoreState) : designStoreState
  )),
}));

jest.mock('../../stores/useFunctionStore', () => ({
  useFunctionStore: jest.fn((selector?: (state: { functions: UserFunction[] }) => unknown) => (
    selector ? selector(functionStoreState) : functionStoreState
  )),
}));

describe('FullscreenChatModal tool projection hydration', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    runtimeStoreState = {
      fullscreenChatNodeId: 'node-instance-1',
      fullscreenChatAgent: null,
      fullscreenChatAgentInstance: null,
      setFullscreenChatNodeId: jest.fn(),
      getNodeMessages: jest.fn(() => []),
      addNodeMessage: jest.fn(),
      setNodeMessages: jest.fn(),
      setNodeExecuting: jest.fn(),
      isNodeExecuting: jest.fn(() => false),
      llmConfigs: [],
    };

    designStoreState = {
      agents: [
        {
          id: 'agent-1',
          name: 'Archi Agent',
          role: 'Archi',
          systemPrompt: 'Prompt',
          llmProvider: LLMProvider.OpenAI,
          model: 'gpt-4o-mini',
          capabilities: [],
          toolSelections: [{ toolId: 'tool.weather' }],
          creator_id: RobotId.Archi,
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
        },
      ],
      agentInstances: [
        {
          id: 'instance-1',
          prototypeId: 'agent-1',
          workflowId: 'wf-1',
          name: 'Archi Instance',
          position: { x: 0, y: 0 },
          isMinimized: false,
          isMaximized: false,
          configuration_json: {
            role: 'Archi',
            model: 'gpt-4o-mini',
            llmProvider: LLMProvider.OpenAI,
            systemPrompt: 'Prompt',
            tools: [],
            toolSelections: [{ toolId: 'tool.weather' }],
            position: { x: 0, y: 0 },
          },
        },
      ],
      updateInstanceConfig: jest.fn(),
    };

    functionStoreState = { functions: [] };

    (apiClient.get as jest.Mock).mockResolvedValue({
      data: {
        id: 'instance-1',
        chatMessages: [
          {
            id: 'persisted-tool-msg',
            sender: 'tool',
            text: 'Weather Tool({"city":"Paris"}) [exec-1]',
            timestamp: '2026-05-01T09:00:00.000Z',
            toolCallRecord: {
              id: 'call-1',
              toolId: 'tool.weather',
              functionId: 'legacy-weather',
              functionName: 'Weather Tool',
              arguments: { city: 'Paris' },
              result: { temperature: 21 },
              status: 'success',
              executionId: 'exec-1',
              timestamp: '2026-05-01T09:00:00.000Z'
            }
          }
        ]
      }
    });
  });

  it('hydrates projected chatMessages for tool blocks using the derived instanceId', async () => {
    render(<FullscreenChatModal />);

    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/api/agent-instances/instance-1'));
    await waitFor(() => expect(runtimeStoreState.setNodeMessages).toHaveBeenCalledWith(
      'node-instance-1',
      expect.arrayContaining([
        expect.objectContaining({
          id: 'persisted-tool-msg',
          sender: 'tool',
          toolCallRecord: expect.objectContaining({
            id: 'call-1',
            toolId: 'tool.weather',
            functionId: 'legacy-weather',
            executionId: 'exec-1',
            timestamp: expect.any(Date)
          })
        })
      ])
    ));
  });
});