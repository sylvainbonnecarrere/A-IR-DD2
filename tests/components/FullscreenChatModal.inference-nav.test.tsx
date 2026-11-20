import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { FullscreenChatModal } from '../../components/modals/FullscreenChatModal';
import { LLMProvider, RobotId } from '../../types';
import type { ChatMessage } from '../../types';
import type { UserFunction } from '../../types/function.types';
import apiClient from '../../utils/apiClient';
import { createTestAgent, createTestAgentInstance, createToolSelection } from '../builders/domainBuilders';
import { resetFullscreenChatHarness } from '../harnesses/fullscreenChatHarness';

let fullscreenChatHarness = resetFullscreenChatHarness();
const mockUseAgentChat = jest.fn(() => ({ handleSendMessage: jest.fn(), loadingMessage: '', isHistorySynthesisActive: false }));

jest.mock('../../components/workflow/ToolCallBlock', () => ({ ToolCallBlock: () => <div data-testid="tool-call-block" /> }));
jest.mock('../../components/modals/ConfirmationModal', () => ({ ConfirmationModal: () => null }));
jest.mock('../../components/modals/WebSearchParamsModal', () => ({ WebSearchParamsModal: () => null }));
jest.mock('../../components/panels/ImageGenerationPanel', () => ({ ImageGenerationPanel: () => null }));
jest.mock('../../components/panels/VideoGenerationConfigPanel', () => ({ VideoGenerationConfigPanel: () => null }));
jest.mock('../../components/panels/MapsGroundingConfigPanel', () => ({ MapsGroundingConfigPanel: () => null }));
jest.mock('../../hooks/useLocalization', () => ({ useLocalization: () => ({ t: (key: string) => key }) }));
jest.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ isAuthenticated: true, accessToken: 'token-123' }) }));
jest.mock('../../hooks/useAgentChat', () => ({ useAgentChat: () => mockUseAgentChat() }));
jest.mock('../../services/webSearchParamsConfigService', () => ({ persistInstanceWebSearchParams: jest.fn(async () => undefined) }));
jest.mock('../../utils/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));

jest.mock('../../stores/useRuntimeStore', () => {
  const actual = jest.requireActual('../../stores/useRuntimeStore');
  return {
    ...actual,
    useRuntimeStore: jest.fn((selector?: (state: Record<string, unknown>) => unknown) => {
      const state = require('../harnesses/fullscreenChatHarness').getFullscreenChatHarness().runtimeStore;
      return selector ? selector(state) : state;
    }),
  };
});

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

const msg = (id: string, sender: ChatMessage['sender'], text: string): ChatMessage => ({
  id,
  sender,
  text,
  timestamp: new Date('2026-05-01T09:00:00.000Z'),
});

const conversation: ChatMessage[] = [
  msg('q1', 'user', 'Question 1'),
  msg('a1', 'agent', 'Réponse 1'),
  msg('q2', 'user', 'Question 2'),
  msg('a2', 'agent', 'Réponse 2'),
  msg('q3', 'user', 'Question 3'),
];

describe('FullscreenChatModal — flèches de navigation des questions d’inférence', () => {
  let scrolledTo: (string | null)[];

  beforeEach(() => {
    jest.clearAllMocks();
    scrolledTo = [];
    // jsdom n'implémente pas scrollIntoView : on espionne et on capture l'élément cible
    (Element.prototype as unknown as { scrollIntoView: unknown }).scrollIntoView = function (this: HTMLElement) {
      scrolledTo.push(this.getAttribute('data-message-id'));
    };

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
        getNodeMessages: jest.fn((_nodeId: string) => conversation),
        isNodeExecuting: jest.fn(() => false),
        llmConfigs: [],
      },
      agent,
      agentInstance: createTestAgentInstance({ id: 'instance-1', prototypeId: agent.id, workflowId: 'wf-1', name: 'Archi Instance' }),
    });

    (apiClient.get as jest.Mock).mockResolvedValue({ data: { chatMessages: [] } });
  });

  it('affiche les flèches cyan en coin bas droite du contenu inférences quand il y a des questions user', () => {
    render(<FullscreenChatModal />);
    const arrows = screen.getByTestId('inference-nav-arrows');
    expect(arrows).toBeInTheDocument();
    // coin bas droite de la partie contenu
    expect(arrows).toHaveClass('absolute', 'bottom-4', 'right-4');
    // charte : bleu clair/cyan futuriste
    const prev = screen.getByTestId('inference-nav-prev');
    const next = screen.getByTestId('inference-nav-next');
    expect(prev).toHaveClass('text-cyan-300', 'border-cyan-400/50');
    expect(next).toHaveClass('text-cyan-300', 'border-cyan-400/50');
    expect(prev).toHaveAttribute('aria-label', 'chat_inference_nav_prev');
    expect(next).toHaveAttribute('aria-label', 'chat_inference_nav_next');
    // les messages portent les data-sender utilisés par la nav
    expect(document.querySelectorAll('[data-sender="user"]')).toHaveLength(3);
  });

  it('chaque clic navigue vers la question précédente puis suivante (scrollIntoView sur le bon message)', () => {
    render(<FullscreenChatModal />);
    // index courant initial = dernière question (q3)
    fireEvent.click(screen.getByTestId('inference-nav-prev'));
    expect(scrolledTo[scrolledTo.length - 1]).toBe('q2');
    fireEvent.click(screen.getByTestId('inference-nav-prev'));
    expect(scrolledTo[scrolledTo.length - 1]).toBe('q1');
    // clamp en haut : reste sur q1
    fireEvent.click(screen.getByTestId('inference-nav-prev'));
    expect(scrolledTo[scrolledTo.length - 1]).toBe('q1');
    fireEvent.click(screen.getByTestId('inference-nav-next'));
    expect(scrolledTo[scrolledTo.length - 1]).toBe('q2');
    fireEvent.click(screen.getByTestId('inference-nav-next'));
    expect(scrolledTo[scrolledTo.length - 1]).toBe('q3');
    // clamp en bas : reste sur q3
    fireEvent.click(screen.getByTestId('inference-nav-next'));
    expect(scrolledTo[scrolledTo.length - 1]).toBe('q3');
  });

  it('n’affiche pas les flèches s’il n’y a aucune question user', () => {
    fullscreenChatHarness.runtimeStore.getNodeMessages = jest.fn((_nodeId: string) => [msg('a1', 'agent', 'Réponse seule')]) as never;
    render(<FullscreenChatModal />);
    expect(screen.queryByTestId('inference-nav-arrows')).toBeNull();
  });
});
