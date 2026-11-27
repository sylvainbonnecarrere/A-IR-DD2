import { useAppShellStore } from '../stores/useAppShellStore';
import { useRuntimeStore } from '../stores/useRuntimeStore';
import { useJournalQueue } from './useJournalQueue';
import { useLocalization } from './useLocalization';
import { generateRuntimeMessageId } from '../utils/runtimeMessageId';
import type { Agent, AgentInstance, ChatMessage, MapsPanelPreloadedResults } from '../types';

/**
 * US-RC-11 (vague 2) — port `MediaPanelActions` : handlers d'ouverture des panneaux
 * média (image / modification d'image / vidéo / maps / fullscreen) et de mise à jour
 * des messages nœud, extraits d'`App.tsx`. Signatures inchangées (contrat stable avec
 * RobotPageRouter / panneaux / FullscreenChatModal).
 *
 * Leçon R1 (US-RC-00a) : accès cross-store via `getState()` dans les handlers
 * (jamais de closure périmée). Le journal passe par `useJournalQueue` encapsulé ici.
 */
interface UseMediaPanelActionsParams {
  resolveCurrentWorkflowId: () => string | null;
}

export function useMediaPanelActions({ resolveCurrentWorkflowId }: UseMediaPanelActionsParams) {
  const { t } = useLocalization();
  const { enqueueEntry: enqueueJournalEntry } = useJournalQueue();

  const setImagePanelOpen = useAppShellStore((state) => state.setImagePanelOpen);
  const setImageModificationPanelOpen = useAppShellStore((state) => state.setImageModificationPanelOpen);
  const setVideoPanelOpen = useAppShellStore((state) => state.setVideoPanelOpen);
  const setMapsPanelOpen = useAppShellStore((state) => state.setMapsPanelOpen);
  const setCurrentImageNodeId = useAppShellStore((state) => state.setCurrentImageNodeId);
  const setCurrentImageAgent = useAppShellStore((state) => state.setCurrentImageAgent);
  const setCurrentImageAgentInstance = useAppShellStore((state) => state.setCurrentImageAgentInstance);
  const setCurrentVideoNodeId = useAppShellStore((state) => state.setCurrentVideoNodeId);
  const setCurrentVideoAgent = useAppShellStore((state) => state.setCurrentVideoAgent);
  const setCurrentVideoAgentInstance = useAppShellStore((state) => state.setCurrentVideoAgentInstance);
  const setCurrentMapsNodeId = useAppShellStore((state) => state.setCurrentMapsNodeId);
  const setEditingImageInfo = useAppShellStore((state) => state.setEditingImageInfo);
  const setMapsPreloadedResults = useAppShellStore((state) => state.setMapsPreloadedResults);
  const setFullscreenImage = useAppShellStore((state) => state.setFullscreenImage);

  const addNodeMessage = useRuntimeStore((state) => state.addNodeMessage);

  const handleOpenImagePanel = (nodeId: string, agent: Agent, agentInstance: AgentInstance) => {
    setCurrentImageNodeId(nodeId);
    setCurrentImageAgent(agent);
    setCurrentImageAgentInstance(agentInstance);
    setImagePanelOpen(true);
  };

  const handleImageGenerated = (nodeId: string, imageBase64: string) => {
    const imageMessage: ChatMessage = {
      id: generateRuntimeMessageId('image'),
      sender: 'agent',
      text: t('app_generatedImageText'),
      image: imageBase64,
      mimeType: 'image/png',
      timestamp: new Date(),
    };
    addNodeMessage(nodeId, imageMessage);

    // ⭐ FIX QA: Persist generated image to journal
    const instanceId = nodeId.replace('node-', '');
    const workflowId = resolveCurrentWorkflowId();
    if (instanceId && workflowId) {
      enqueueJournalEntry(workflowId, instanceId, 'chat', {
        messageId: imageMessage.id,
        role: 'agent',
        content: t('app_generatedImageText'),
        imageBase64: imageBase64,
        mimeType: 'image/png',
      });
    }
  };

  const handleOpenImageModificationPanel = (
    nodeId: string,
    sourceImage: string,
    agent?: Agent,
    agentInstance?: AgentInstance,
    mimeType: string = 'image/png',
  ) => {
    setEditingImageInfo({ nodeId, sourceImage, mimeType, agent, agentInstance });
    setImageModificationPanelOpen(true);
  };

  const handleOpenVideoPanel = (nodeId: string, agent: Agent, agentInstance: AgentInstance) => {
    setCurrentVideoNodeId(nodeId);
    setCurrentVideoAgent(agent);
    setCurrentVideoAgentInstance(agentInstance);
    setVideoPanelOpen(true);
  };

  const handleOpenMapsPanel = (nodeId: string, preloadedResults?: MapsPanelPreloadedResults) => {
    setCurrentMapsNodeId(nodeId);
    setMapsPreloadedResults(preloadedResults || null);
    setMapsPanelOpen(true);
  };

  const handleImageModified = (nodeId: string, newImage: string, text: string) => {
    const message: ChatMessage = {
      id: generateRuntimeMessageId('image-modified'),
      sender: 'agent',
      text: text,
      image: newImage,
      mimeType: 'image/png',
      timestamp: new Date(),
    };
    addNodeMessage(nodeId, message);

    // ⭐ FIX QA: Persist modified image to journal
    const instanceId = nodeId.replace('node-', '');
    const workflowId = resolveCurrentWorkflowId();
    if (instanceId && workflowId) {
      enqueueJournalEntry(workflowId, instanceId, 'chat', {
        messageId: message.id,
        role: 'agent',
        content: text,
        imageBase64: newImage,
        mimeType: 'image/png',
      });
    }
  };

  const handleToggleNodeMinimize = (nodeId: string) => {
    // ⭐ ARCHITECTURE FIX: Store minimize state in useRuntimeStore (transient UI state, not persisted)
    // This approach separates concerns: coordinates in Design Store, UI state in Runtime Store
    const { toggleNodeMinimized } = useRuntimeStore.getState();
    toggleNodeMinimized(nodeId);
    console.debug('[App] Toggled minimize for node:', nodeId);
  };

  const handleUpdateNodeMessages = (nodeId: string, messages: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
    const runtimeStore = useRuntimeStore.getState();
    const previousMessages = runtimeStore.getNodeMessages(nodeId);
    runtimeStore.setNodeMessages(nodeId, typeof messages === 'function' ? messages(previousMessages) : messages);
  };

  const handleOpenFullscreen = (src: string, mimeType: string) => {
    setFullscreenImage({ src, mimeType });
  };

  const _handleOpenAgentFullscreen = (nodeId: string) => {
    // Utiliser le store runtime pour ouvrir le FullscreenChatModal existant
    const { setFullscreenChatNodeId } = useRuntimeStore.getState();
    setFullscreenChatNodeId(nodeId);
  };

  return {
    handleOpenImagePanel,
    handleImageGenerated,
    handleOpenImageModificationPanel,
    handleOpenVideoPanel,
    handleOpenMapsPanel,
    handleImageModified,
    handleToggleNodeMinimize,
    handleUpdateNodeMessages,
    handleOpenFullscreen,
  };
}
