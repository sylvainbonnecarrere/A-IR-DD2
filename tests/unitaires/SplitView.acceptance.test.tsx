/**
 * SplitView.acceptance.test.tsx
 * 
 * Test d'acceptation utilisateur (UAT) - Scénarios réalistes
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { FullscreenChatModal } from '../../components/modals/FullscreenChatModal';
import { Agent, LLMProvider, LLMCapability, ChatMessage, LLMConfig, RobotId } from '../../types';

jest.mock('../../services/llmService', () => ({
  generateContentStream: jest.fn(),
  generateImage: jest.fn().mockImplementation(async (provider, apiKey, prompt) => {
    if (!prompt) return { error: 'Prompt is required' };
    return { image: 'data:image/png;base64,mockGeneratedImage', error: null };
  }),
}));

jest.mock('../../hooks/useLocalization', () => ({
  useLocalization: () => ({ t: (key: string) => key }),
}));

jest.mock('../../hooks/useWebSocket', () => ({
  useWebSocket: () => ({ isConnected: true }),
}));

const mockAgent: Agent = {
  id: 'agent-creative',
  name: 'Creative Assistant',
  role: 'creative',
  systemPrompt: 'You are a creative assistant specialized in generating and editing multimedia content.',
  llmProvider: LLMProvider.OpenAI,
  model: 'gpt-4-vision',
  tools: [],
  capabilities: [
    LLMCapability.Chat,
    LLMCapability.ImageGeneration,
    LLMCapability.ImageModification,
    LLMCapability.VideoGeneration,
    LLMCapability.MapsGrounding,
    LLMCapability.WebSearchGrounding,
  ],
  creator_id: RobotId.Archi,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const mockLLMConfig: LLMConfig = {
  provider: LLMProvider.OpenAI,
  apiKey: 'sk-test-key',
  enabled: true,
  capabilities: {
    [LLMCapability.Chat]: true,
    [LLMCapability.ImageGeneration]: true,
    [LLMCapability.ImageModification]: true,
    [LLMCapability.VideoGeneration]: true,
    [LLMCapability.MapsGrounding]: true,
    [LLMCapability.WebSearchGrounding]: true,
  },
};

const mockChatHistory: ChatMessage[] = [
  { id: '1', sender: 'user', text: 'Hello, I need some creative content', timestamp: new Date() },
  { id: '2', sender: 'agent', text: 'I can help you with images, videos, and location research.', timestamp: new Date() },
];

describe('Split-View User Acceptance Tests (UAT)', () => {
  const defaultProps = {
    isOpen: true,
    agent: mockAgent,
    nodeId: 'node-creative-1',
    chatHistory: mockChatHistory,
    llmConfigs: [mockLLMConfig],
    onClose: jest.fn(),
    onSendMessage: jest.fn(),
    onAddImage: jest.fn(),
    onAddVideo: jest.fn(),
    onAddMapsData: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Scénario 1: Image Generation', () => {
    it('UAT-IMG-001: Utilisateur ouvre panel Image et remplit formulaire', async () => {
      render(<FullscreenChatModal {...defaultProps} />);
      const imageButton = screen.getByRole('button', { name: /image|🖼️/i });
      await userEvent.click(imageButton);

      await waitFor(() => {
        const promptInput = screen.getByPlaceholderText(/imageGen_promptPlaceholder/i);
        expect(promptInput).toBeVisible();
      });

      const promptInput = screen.getByPlaceholderText(/imageGen_promptPlaceholder/i);
      await userEvent.type(promptInput, 'A serene landscape with mountains and sunset');
      const generateButton = screen.getByRole('button', { name: /imageGen_generate|generate/i });
      expect(generateButton).not.toBeDisabled();
    });

    it('UAT-IMG-004: Erreur si prompt vide', async () => {
      render(<FullscreenChatModal {...defaultProps} />);
      const imageButton = screen.getByRole('button', { name: /image|🖼️/i });
      await userEvent.click(imageButton);

      await waitFor(() => {
        const generateButton = screen.getByRole('button', { name: /imageGen_generate|generate/i });
        expect(generateButton).toBeDisabled();
      });
    });
  });

  describe('Scénario 2: Video Configuration', () => {
    it('UAT-VID-001: Utilisateur ouvre panel Vidéo', async () => {
      render(<FullscreenChatModal {...defaultProps} />);
      const videoButton = screen.getByRole('button', { name: /video|🎬/i });
      await userEvent.click(videoButton);

      await waitFor(() => {
        expect(screen.getByText(/videoGen_title/i)).toBeInTheDocument();
      });
    });

    it('UAT-VID-003: Utilisateur ferme panel vidéo', async () => {
      render(<FullscreenChatModal {...defaultProps} />);
      const videoButton = screen.getByRole('button', { name: /video|🎬/i });
      await userEvent.click(videoButton);

      await waitFor(() => {
        expect(screen.getByText(/videoGen_title/i)).toBeInTheDocument();
      });

      const closeButtons = screen.getAllByRole('button', { name: /close|×/i });
      const panelCloseButton = closeButtons[closeButtons.length - 1];
      await userEvent.click(panelCloseButton);

      await waitFor(() => {
        expect(screen.queryByText(/videoGen_title/i)).not.toBeInTheDocument();
      });
    });
  });

  describe('Scénario 3: Maps Grounding', () => {
    it('UAT-MAP-001: Utilisateur ouvre panel Maps', async () => {
      render(<FullscreenChatModal {...defaultProps} />);
      const mapsButton = screen.getByRole('button', { name: /maps|🗺️/i });
      await userEvent.click(mapsButton);

      await waitFor(() => {
        expect(screen.getByText(/Maps Grounding|🗺️/i)).toBeInTheDocument();
      });
    });
  });

  describe('Scénario 4: Navigation rapide', () => {
    it('UAT-NAV-001: Basculage Image → Vidéo → Maps', async () => {
      render(<FullscreenChatModal {...defaultProps} />);

      let button = screen.getByRole('button', { name: /image|🖼️/i });
      await userEvent.click(button);
      await waitFor(() => {
        expect(screen.getByPlaceholderText(/imageGen_promptPlaceholder/i)).toBeInTheDocument();
      });

      button = screen.getByRole('button', { name: /video|🎬/i });
      await userEvent.click(button);
      await waitFor(() => {
        expect(screen.getByText(/videoGen_title/i)).toBeInTheDocument();
      });

      button = screen.getByRole('button', { name: /maps|🗺️/i });
      await userEvent.click(button);
      await waitFor(() => {
        expect(screen.getByText(/Maps Grounding/i)).toBeInTheDocument();
      });
    });

    it('UAT-NAV-003: Toggle via double-clic', async () => {
      const { container } = render(<FullscreenChatModal {...defaultProps} />);
      const imageButton = screen.getByRole('button', { name: /image|🖼️/i });

      await userEvent.click(imageButton);
      await waitFor(() => {
        const panel = container.querySelector('[class*="translate-x-0"]');
        expect(panel).toHaveClass('opacity-100');
      });

      await userEvent.click(imageButton);
      await waitFor(() => {
        const panel = container.querySelector('[class*="translate-x-full"]');
        expect(panel).toHaveClass('opacity-0');
      });
    });
  });

  describe('Scénario 5: Gestion erreurs', () => {
    it('UAT-ERR-002: Fermeture après erreur', async () => {
      const onCloseMock = jest.fn();
      render(<FullscreenChatModal {...defaultProps} onClose={onCloseMock} llmConfigs={[]} />);

      const imageButton = screen.getByRole('button', { name: /image|🖼️/i });
      await userEvent.click(imageButton);

      const mainCloseButton = screen.getByRole('button', { name: /close|fermer/i });
      await userEvent.click(mainCloseButton);

      expect(onCloseMock).toHaveBeenCalled();
    });
  });

  describe('Scénario 6: Performance', () => {
    it('UAT-PERF-001: Modal se redimensionne en 500ms', () => {
      const { container } = render(<FullscreenChatModal {...defaultProps} />);
      const mainContainer = container.querySelector('[class*="transition-all"]');
      expect(mainContainer).toHaveClass('duration-500');
      expect(mainContainer).toHaveClass('ease-in-out');
    });
  });

  describe('Scénario 7: Cas complet', () => {
    it('UAT-FULL-001: Conversation avec panneaux', () => {
      render(<FullscreenChatModal {...defaultProps} />);
      expect(screen.getByText(mockChatHistory[0].text)).toBeInTheDocument();
      expect(screen.getByText(mockChatHistory[1].text)).toBeInTheDocument();
    });

    it('UAT-FULL-002: Tous panneaux accessibles', async () => {
      render(<FullscreenChatModal {...defaultProps} />);

      expect(screen.getByRole('button', { name: /image|🖼️/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /video|🎬/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /maps|🗺️/i })).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: /image|🖼️/i }));
      expect(screen.getByPlaceholderText(/imageGen_promptPlaceholder/i)).toBeInTheDocument();
    });
  });
});
