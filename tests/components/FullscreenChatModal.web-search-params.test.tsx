import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { FullscreenChatModal } from '../../components/modals/FullscreenChatModal';
import { LLMProvider, RobotId } from '../../types';
import type { UserFunction } from '../../types/function.types';

let runtimeStoreState: Record<string, unknown>;
let designStoreState: Record<string, unknown>;
let functionStoreState: { functions: UserFunction[] };

jest.mock('../../components/workflow/ToolCallBlock', () => ({ ToolCallBlock: () => null }));
jest.mock('../../components/modals/ConfirmationModal', () => ({ ConfirmationModal: () => null }));
jest.mock('../../components/panels/ImageGenerationPanel', () => ({ ImageGenerationPanel: () => null }));
jest.mock('../../components/panels/VideoGenerationConfigPanel', () => ({ VideoGenerationConfigPanel: () => null }));
jest.mock('../../components/panels/MapsGroundingConfigPanel', () => ({ MapsGroundingConfigPanel: () => null }));
jest.mock('../../hooks/useLocalization', () => ({ useLocalization: () => ({ t: (key: string) => key }) }));
jest.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ isAuthenticated: true, accessToken: 'token-123' }) }));
jest.mock('../../hooks/useAgentChat', () => ({ useAgentChat: () => ({ handleSendMessage: jest.fn(), loadingMessage: '' }) }));
jest.mock('../../services/webSearchParamsConfigService', () => ({ persistInstanceWebSearchParams: jest.fn(async () => undefined) }));

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

describe('FullscreenChatModal web search params entrypoint', () => {
  beforeEach(() => {
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
          name: 'Phil Agent',
          role: 'Phil',
          systemPrompt: 'Prompt',
          llmProvider: LLMProvider.OpenAI,
          model: 'gpt-4o-mini',
          capabilities: [],
          toolSelections: [{ toolId: 'tool.web-search' }],
          creator_id: RobotId.Phil,
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
        },
      ],
      agentInstances: [
        {
          id: 'instance-1',
          prototypeId: 'agent-1',
          workflowId: 'wf-1',
          name: 'Phil Instance',
          position: { x: 0, y: 0 },
          isMinimized: false,
          isMaximized: false,
          configuration_json: {
            role: 'Phil',
            model: 'gpt-4o-mini',
            llmProvider: LLMProvider.OpenAI,
            systemPrompt: 'Prompt',
            tools: [],
            toolSelections: [{ toolId: 'tool.web-search' }],
            position: { x: 0, y: 0 },
          },
        },
      ],
      updateInstanceConfig: jest.fn(),
    };

    functionStoreState = {
      functions: [
        {
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
        },
      ],
    };
  });

  it('shows the web search params button and opens the modal', async () => {
    render(<FullscreenChatModal />);

    fireEvent.click(screen.getByTitle("Paramètres Web Search de l'agent"));

    expect(screen.getByText(/Paramètres Web Search de l'agent/)).toBeInTheDocument();
  });
});