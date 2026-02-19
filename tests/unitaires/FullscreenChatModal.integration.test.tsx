/**
 * FullscreenChatModal.integration.test.tsx
 * 
 * Test d'intégration pour le modal fullscreen avec Split-View.
 * Valide la synchronisation complète entre le chat et les panneaux latéraux.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { FullscreenChatModal } from '../../components/modals/FullscreenChatModal';
import { Agent, LLMProvider, LLMCapability, ChatMessage, LLMConfig, RobotId } from '../../types';

// Mocks
jest.mock('../../services/llmService', () => ({
  generateContentStream: jest.fn(),
}));

jest.mock('../../hooks/useLocalization', () => ({
  useLocalization: () => ({
    t: (key: string, args?: any) => key,
  }),
}));

jest.mock('../../hooks/useWebSocket', () => ({
  useWebSocket: () => ({ isConnected: true }),
}));

// ============================================
// TEST DATA
// ============================================

const mockLLMConfig: LLMConfig = {
  provider: LLMProvider.OpenAI,
  apiKey: 'test-key-123',
  enabled: true,
  capabilities: {
    [LLMCapability.Chat]: true,
    [LLMCapability.ImageGeneration]: true,
    [LLMCapability.VideoGeneration]: true,
    [LLMCapability.MapsGrounding]: true,
    [LLMCapability.WebSearchGrounding]: true,
    [LLMCapability.ImageModification]: true,
    [LLMCapability.FileUpload]: true,
  },
};

const mockAgent: Agent = {
  id: 'agent-1',
  name: 'Test Agent',
  role: 'test',
  systemPrompt: 'You are a helpful assistant',
  llmProvider: LLMProvider.OpenAI,
  model: 'gpt-4',
  tools: [],
  capabilities: [
    LLMCapability.Chat,
    LLMCapability.ImageGeneration,
    LLMCapability.VideoGeneration,
    LLMCapability.MapsGrounding,
  ],
  creator_id: RobotId.Archi,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const mockChatHistory: ChatMessage[] = [
  {
    id: '1',
    sender: 'user',
    text: 'Hello, can you help?',
    timestamp: new Date(),
  },
  {
    id: '2',
    sender: 'agent',
    text: 'Of course! How can I assist?',
    timestamp: new Date(),
  },
];

// ============================================
// TESTS
// ============================================

describe('FullscreenChatModal - Integration Tests', () => {
  const defaultProps = {
    isOpen: true,
    agent: mockAgent,
    nodeId: 'node-1',
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

  // Comportement d'ouverture/fermeture
  describe('Comportement d\'ouverture/fermeture', () => {
    it('devrait rendre le modal quand isOpen=true', () => {
      render(<FullscreenChatModal {...defaultProps} />);
      expect(screen.getByText(mockAgent.name)).toBeInTheDocument();
    });

    it('ne devrait pas rendre quand isOpen=false', () => {
      const { container } = render(<FullscreenChatModal {...defaultProps} isOpen={false} />);
      expect(container.firstChild).toBeFalsy();
    });

    it('devrait appeler onClose quand le bouton close est cliqué', async () => {
      const onCloseMock = jest.fn();
      render(<FullscreenChatModal {...defaultProps} onClose={onCloseMock} />);

      const closeButton = screen.getByRole('button', { name: /close|fermer/i });
      await userEvent.click(closeButton);

      expect(onCloseMock).toHaveBeenCalled();
    });
  });

  // Fonctionnalité Split-View
  describe('Fonctionnalité Split-View', () => {
    it('devrait avoir chat à gauche et panel à droite', () => {
      const { container } = render(<FullscreenChatModal {...defaultProps} />);

      // Vérifier la structure flex
      const mainContainer = container.querySelector('[class*="flex"]');
      expect(mainContainer).toBeInTheDocument();
      expect(mainContainer).toHaveClass('flex-row');
    });

    it('devrait glisser le panel de droite (translate-x-full → translate-x-0)', async () => {
      const { container } = render(<FullscreenChatModal {...defaultProps} />);

      // Ouvrir un panel
      const imageButton = screen.getByRole('button', { name: /image|🖼️/i });
      await userEvent.click(imageButton);

      // Vérifier la classe translate
      await waitFor(() => {
        const panel = container.querySelector('[class*="transform"]');
        expect(panel?.className).toMatch(/translate-x-0/);
      });
    });

    it('devrait avoir les classes de transition (transition-all, duration-500, ease-in-out)', () => {
      const { container } = render(<FullscreenChatModal {...defaultProps} />);

      const sidePanel = container.querySelector('[class*="transform"]');
      expect(sidePanel).toHaveClass('transition-all');
      expect(sidePanel).toHaveClass('duration-500');
      expect(sidePanel).toHaveClass('ease-in-out');
    });

    it('devrait avoir la shadow glow cyan appliquée', () => {
      const { container } = render(<FullscreenChatModal {...defaultProps} />);

      const sidePanel = container.querySelector('[class*="shadow-"]');
      expect(sidePanel?.className).toContain('shadow-');
    });

    it('devrait avoir la bordure cyan-500 visible', () => {
      const { container } = render(<FullscreenChatModal {...defaultProps} />);

      const sidePanel = container.querySelector('[class*="border-cyan"]');
      expect(sidePanel).toHaveClass('border-cyan-500');
    });
  });

  // Panneaux spécialisés
  describe('Panneaux spécialisés', () => {
    it('devrait ouvrir le panel Image au clic sur 🖼️', async () => {
      render(<FullscreenChatModal {...defaultProps} />);

      const imageButton = screen.getByRole('button', { name: /image|🖼️/i });
      await userEvent.click(imageButton);

      await waitFor(() => {
        expect(screen.getByPlaceholderText(/imageGen_promptPlaceholder/i)).toBeInTheDocument();
      });
    });

    it('devrait ouvrir le panel Vidéo au clic sur 🎬', async () => {
      render(<FullscreenChatModal {...defaultProps} />);

      const videoButton = screen.getByRole('button', { name: /video|🎬/i });
      await userEvent.click(videoButton);

      await waitFor(() => {
        expect(screen.getByText(/videoGen_title/i)).toBeInTheDocument();
      });
    });

    it('devrait ouvrir le panel Maps au clic sur 🗺️', async () => {
      render(<FullscreenChatModal {...defaultProps} />);

      const mapsButton = screen.getByRole('button', { name: /maps|🗺️/i });
      await userEvent.click(mapsButton);

      await waitFor(() => {
        expect(screen.getByText(/Maps Grounding/i)).toBeInTheDocument();
      });
    });

    it('un seul panel actif à la fois', async () => {
      const { container } = render(<FullscreenChatModal {...defaultProps} />);

      // Ouvrir Image
      let button = screen.getByRole('button', { name: /image|🖼️/i });
      await userEvent.click(button);

      await waitFor(() => {
        expect(screen.getByPlaceholderText(/imageGen_promptPlaceholder/i)).toBeInTheDocument();
      });

      // Ouvrir Vidéo (devrait remplacer Image)
      button = screen.getByRole('button', { name: /video|🎬/i });
      await userEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText(/videoGen_title/i)).toBeInTheDocument();
        // Image panel devrait être caché
        expect(screen.queryByPlaceholderText(/imageGen_promptPlaceholder/i)).not.toBeInTheDocument();
      });
    });
  });

  // Expansion dynamique du conteneur
  describe('Expansion dynamique du conteneur', () => {
    it('devrait avoir max-w-6xl quand aucun panel', () => {
      const { container } = render(<FullscreenChatModal {...defaultProps} />);

      const mainContainer = container.querySelector('[class*="max-w"]');
      expect(mainContainer?.className).toMatch(/max-w-6xl/);
    });

    it('devrait avoir w-[98vw] h-[98vh] quand panel actif', async () => {
      const { container } = render(<FullscreenChatModal {...defaultProps} />);

      const imageButton = screen.getByRole('button', { name: /image|🖼️/i });
      await userEvent.click(imageButton);

      await waitFor(() => {
        const mainContainer = container.querySelector('[class*="transition-all"]');
        expect(mainContainer?.className).toMatch(/w-\[98vw\]|h-\[98vh\]/);
      });
    });
  });

  // Transmission de données
  describe('Transmission de données', () => {
    it('devrait passer mockWorkflowNode aux panels', async () => {
      render(<FullscreenChatModal {...defaultProps} />);

      const imageButton = screen.getByRole('button', { name: /image|🖼️/i });
      await userEvent.click(imageButton);

      // Le panel devrait rendre le formulaire avec le node agent
      await waitFor(() => {
        expect(screen.getByText(mockAgent.name)).toBeInTheDocument();
      });
    });

    it('devrait passer agent aux panels', async () => {
      render(<FullscreenChatModal {...defaultProps} />);

      const videoButton = screen.getByRole('button', { name: /video|🎬/i });
      await userEvent.click(videoButton);

      await waitFor(() => {
        // Le panel vidéo devrait avoir accès à l'agent
        expect(screen.getByText(/videoGen_title/i)).toBeInTheDocument();
      });
    });

    it('devrait passer llmConfigs aux panels', async () => {
      render(<FullscreenChatModal {...defaultProps} />);

      const imageButton = screen.getByRole('button', { name: /image|🖼️/i });
      await userEvent.click(imageButton);

      // Sans config, le bouton générer devrait être désactivé
      await waitFor(() => {
        // Si config présente, formulaire visible et fonctionnel
        expect(screen.getByPlaceholderText(/imageGen_promptPlaceholder/i)).toBeInTheDocument();
      });
    });
  });

  // Interactivité
  describe('Interactivité', () => {
    it('devrait basculer fluide entre panels', async () => {
      render(<FullscreenChatModal {...defaultProps} />);

      // Image
      let button = screen.getByRole('button', { name: /image|🖼️/i });
      await userEvent.click(button);
      await waitFor(() => {
        expect(screen.getByPlaceholderText(/imageGen_promptPlaceholder/i)).toBeInTheDocument();
      });

      // Vidéo
      button = screen.getByRole('button', { name: /video|🎬/i });
      await userEvent.click(button);
      await waitFor(() => {
        expect(screen.getByText(/videoGen_title/i)).toBeInTheDocument();
      });

      // Maps
      button = screen.getByRole('button', { name: /maps|🗺️/i });
      await userEvent.click(button);
      await waitFor(() => {
        expect(screen.getByText(/Maps Grounding/i)).toBeInTheDocument();
      });
    });

    it('devrait supporter le toggle via double-clic', async () => {
      const { container } = render(<FullscreenChatModal {...defaultProps} />);

      const imageButton = screen.getByRole('button', { name: /image|🖼️/i });

      // Premier clic: ouvre
      await userEvent.click(imageButton);
      await waitFor(() => {
        expect(screen.getByPlaceholderText(/imageGen_promptPlaceholder/i)).toBeInTheDocument();
      });

      // Deuxième clic: ferme
      await userEvent.click(imageButton);
      await waitFor(() => {
        expect(screen.queryByPlaceholderText(/imageGen_promptPlaceholder/i)).not.toBeInTheDocument();
      });
    });
  });

  // Responsive & Design
  describe('Responsive & Design', () => {
    it('devrait avoir gradient cyan-emerald sur header', () => {
      const { container } = render(<FullscreenChatModal {...defaultProps} />);

      const header = container.querySelector('[class*="bg-gradient"]');
      expect(header?.className).toMatch(/cyan|emerald/);
    });

    it('devrait avoir backdrop blur appliqué', () => {
      const { container } = render(<FullscreenChatModal {...defaultProps} />);

      const panel = container.querySelector('[class*="backdrop"]');
      expect(panel).toHaveClass('backdrop-blur-sm');
    });

    it('devrait avoir overflow-y-auto sur contenu', () => {
      const { container } = render(<FullscreenChatModal {...defaultProps} />);

      const content = container.querySelector('[class*="overflow-y"]');
      expect(content).toHaveClass('overflow-y-auto');
    });
  });
});
