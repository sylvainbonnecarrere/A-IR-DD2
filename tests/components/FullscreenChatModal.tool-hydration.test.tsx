import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FullscreenChatModal } from '../../components/modals/FullscreenChatModal';
import { LLMCapability, LLMProvider, RobotId } from '../../types';
import type { UserFunction } from '../../types/function.types';
import apiClient from '../../utils/apiClient';
import { createTestAgent, createTestAgentInstance, createToolSelection } from '../builders/domainBuilders';
import { resetFullscreenChatHarness } from '../harnesses/fullscreenChatHarness';

let fullscreenChatHarness = resetFullscreenChatHarness();
let runtimeStoreState = fullscreenChatHarness.runtimeStore;
let designStoreState = fullscreenChatHarness.designStore;
let functionStoreState = fullscreenChatHarness.functionStore;
const mockUseAgentChat = jest.fn(() => ({ handleSendMessage: jest.fn(), loadingMessage: '', isHistorySynthesisActive: false }));

jest.mock('../../components/workflow/ToolCallBlock', () => ({ ToolCallBlock: () => <div data-testid="tool-call-block" /> }));
jest.mock('../../components/modals/ConfirmationModal', () => ({ ConfirmationModal: () => null }));
jest.mock('../../components/modals/WebSearchParamsModal', () => ({ WebSearchParamsModal: () => null }));
jest.mock('../../components/panels/ImageGenerationPanel', () => ({
  ImageGenerationPanel: ({ onImageGenerated }: { onImageGenerated?: (nodeId: string, imageBase64: string) => void }) => (
    <button
      data-testid="mock-image-generation-add"
      onClick={() => onImageGenerated?.('node-instance-1', 'generated-image-base64')}
    >
      mock-image-generation-add
    </button>
  )
}));
jest.mock('../../components/panels/VideoGenerationConfigPanel', () => ({ VideoGenerationConfigPanel: () => null }));
jest.mock('../../components/panels/MapsGroundingConfigPanel', () => ({ MapsGroundingConfigPanel: () => null }));
jest.mock('../../hooks/useLocalization', () => ({ useLocalization: () => ({ t: (key: string) => key }) }));
jest.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ isAuthenticated: true, accessToken: 'token-123' }) }));
jest.mock('../../hooks/useAgentChat', () => ({ useAgentChat: () => mockUseAgentChat() }));
jest.mock('../../services/webSearchParamsConfigService', () => ({ persistInstanceWebSearchParams: jest.fn(async () => undefined) }));
jest.mock('../../utils/apiClient', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
  }
}));

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

describe('FullscreenChatModal tool projection hydration', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    const agent = createTestAgent({
      id: 'agent-1',
      name: 'Archi Agent',
      role: 'Archi',
      llmProvider: LLMProvider.OpenAI,
      creator_id: RobotId.Archi,
      toolSelections: [createToolSelection({ toolId: 'tool.weather' })],
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
        name: 'Archi Instance',
        configuration_json: {
          role: 'Archi',
          model: 'gpt-4o-mini',
          llmProvider: LLMProvider.OpenAI,
          systemPrompt: 'Prompt',
          tools: [],
          toolSelections: [createToolSelection({ toolId: 'tool.weather' })],
          position: { x: 0, y: 0 },
        },
      }),
      functionStore: { functions: [] as UserFunction[] },
    });
    runtimeStoreState = fullscreenChatHarness.runtimeStore;
    designStoreState = fullscreenChatHarness.designStore;
    functionStoreState = fullscreenChatHarness.functionStore;

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

  it('rehydrates legacy persisted tool/result pairs into a ToolCallBlock-compatible message', async () => {
    (apiClient.get as jest.Mock).mockResolvedValueOnce({
      data: {
        id: 'instance-1',
        chatMessages: [
          {
            id: 'legacy-tool-msg',
            sender: 'agent',
            text: 'hello_test({"user_name":"Joe"}) [utr-6a1989ce121cd1727a9b6ed8]',
            timestamp: '2026-05-01T09:00:00.000Z',
          },
          {
            id: 'legacy-tool-result-msg',
            sender: 'agent',
            text: '[executionId=utr-6a1989ce121cd1727a9b6ed8] {\n  "result": "Ton nom, Joe, est maintenant enregistré dans ma mémoire"\n}',
            timestamp: '2026-05-01T09:00:00.100Z',
          }
        ]
      }
    });

    render(<FullscreenChatModal />);

    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/api/agent-instances/instance-1'));
    await waitFor(() => expect(runtimeStoreState.setNodeMessages).toHaveBeenCalledWith(
      'node-instance-1',
      expect.arrayContaining([
        expect.objectContaining({
          id: 'legacy-tool-msg',
          sender: 'tool',
          toolCallRecord: expect.objectContaining({
            id: 'legacy-tool-call:utr-6a1989ce121cd1727a9b6ed8',
            functionName: 'hello_test',
            executionId: 'utr-6a1989ce121cd1727a9b6ed8',
            arguments: { user_name: 'Joe' },
            result: {
              result: 'Ton nom, Joe, est maintenant enregistré dans ma mémoire',
            },
            timestamp: expect.any(Date),
          })
        }),
        expect.objectContaining({
          id: 'legacy-tool-result-msg',
          sender: 'tool_result',
          toolCallId: 'legacy-tool-call:utr-6a1989ce121cd1727a9b6ed8',
        })
      ])
    ));
  });

  it('shows the synthesis icon in the chat loader when history synthesis is active', () => {
    runtimeStoreState.isNodeExecuting = jest.fn(() => true);
    mockUseAgentChat.mockReturnValue({
      handleSendMessage: jest.fn(),
      loadingMessage: 'agentNode_history_summarizing',
      isHistorySynthesisActive: true,
    });

    render(<FullscreenChatModal />);

    expect(screen.getByText('agentNode_history_summarizing')).toBeInTheDocument();
    expect(screen.getByTestId('history-synthesis-icon')).toBeInTheDocument();
  });

  it('delegates image add-to-chat to the parent callback without appending locally a second time', async () => {
    const onImageGenerated = jest.fn();
    (apiClient.get as jest.Mock).mockResolvedValueOnce({
      data: {
        id: 'instance-1',
        chatMessages: []
      }
    });

    designStoreState = {
      ...designStoreState,
      agents: [
        {
          ...designStoreState.agents[0],
          capabilities: [LLMCapability.ImageGeneration],
        },
      ],
    };
    fullscreenChatHarness.designStore = designStoreState as typeof fullscreenChatHarness.designStore;

    render(<FullscreenChatModal onImageGenerated={onImageGenerated} />);

    fireEvent.click(screen.getByRole('button', { name: 'Image' }));
    fireEvent.click(screen.getByTestId('mock-image-generation-add'));

    expect(onImageGenerated).toHaveBeenCalledWith('node-instance-1', 'generated-image-base64');
    expect(runtimeStoreState.addNodeMessage).not.toHaveBeenCalledWith(
      'node-instance-1',
      expect.objectContaining({ image: 'generated-image-base64' })
    );
    expect(runtimeStoreState.setNodeMessages).not.toHaveBeenCalledWith(
      'node-instance-1',
      expect.arrayContaining([
        expect.objectContaining({ image: 'generated-image-base64' })
      ])
    );
  });
});