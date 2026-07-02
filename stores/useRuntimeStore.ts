import { create } from 'zustand';
import { ChatMessage, InvisibleHistorySummaryState, LLMConfig, LLMProvider, LocalLLMProfile, PendingNodeAttachment, RobotId } from '../types';

const isDevelopmentEnvironment = process.env.NODE_ENV !== 'production';

const mergeNodeMessages = (sourceMessages: ChatMessage[] = [], targetMessages: ChatMessage[] = []): ChatMessage[] => {
  if (sourceMessages.length === 0) {
    return targetMessages;
  }

  if (targetMessages.length === 0) {
    return sourceMessages;
  }

  const merged = [...targetMessages];
  const seen = new Set(targetMessages.map((message) => `${message.id}:${message.sender}`));

  for (const message of sourceMessages) {
    const messageKey = `${message.id}:${message.sender}`;
    if (!seen.has(messageKey)) {
      seen.add(messageKey);
      merged.push(message);
    }
  }

  return merged.sort((left, right) => {
    const leftTime = left.timestamp instanceof Date ? left.timestamp.getTime() : new Date(left.timestamp).getTime();
    const rightTime = right.timestamp instanceof Date ? right.timestamp.getTime() : new Date(right.timestamp).getTime();
    return leftTime - rightTime;
  });
};

const renameRecordKey = <T,>(
  record: Record<string, T>,
  fromKey: string,
  toKey: string,
  merge?: (sourceValue: T, targetValue: T | undefined) => T,
): Record<string, T> => {
  if (fromKey === toKey || !Object.prototype.hasOwnProperty.call(record, fromKey)) {
    return record;
  }

  const nextRecord = { ...record };
  const sourceValue = nextRecord[fromKey];
  delete nextRecord[fromKey];

  nextRecord[toKey] = merge
    ? merge(sourceValue, nextRecord[toKey])
    : sourceValue;

  return nextRecord;
};

const renameNodeInSet = (values: Set<string>, fromNodeId: string, toNodeId: string): Set<string> => {
  if (fromNodeId === toNodeId || !values.has(fromNodeId)) {
    return values;
  }

  const renamedValues = new Set(values);
  renamedValues.delete(fromNodeId);
  renamedValues.add(toNodeId);
  return renamedValues;
};

/**
 * Runtime Domain Store - Gère l'exécution et les états temps réel
 * Responsabilité : Messages de chat, exécution des agents,
 * WebSocket states, logs, données volatiles
 */
interface RuntimeStore {
  // Chat & Execution State
  nodeMessages: Record<string, ChatMessage[]>; // nodeId -> messages[]
  nodePendingAttachments: Record<string, PendingNodeAttachment | null>;
  nodeInvisibleHistorySummaries: Record<string, InvisibleHistorySummaryState | null>;
  executingNodes: Set<string>; // nodeIds currently executing

  // LLM Configuration (runtime)
  llmConfigs: LLMConfig[];

  // Local LLM Profiles (runtime)
  localLLMProfiles: LocalLLMProfile[];

  // UI State (runtime only)
  isImagePanelOpen: boolean;
  isImageModificationPanelOpen: boolean;
  currentImageNodeId: string | null;
  editingImageInfo: { nodeId: string; sourceImage: string; mimeType: string } | null;
  fullscreenImage: { src: string; mimeType: string } | null;

  // Fullscreen Chat State
  fullscreenChatNodeId: string | null; // nodeId for fullscreen chat mode
  fullscreenChatAgent: any | null; // Agent object for fullscreen chat (V1 or V2)
  fullscreenChatAgentInstance?: any | null; // ⭐ AgentInstance for accessing instanceId

  // Configuration Modal State
  configModalInstanceId: string | null; // instanceId for configuration modal

  // ⭐ NOUVEAU: Node Minimize State (UI/Visual only, not persisted)
  minimizedNodeIds: Set<string>; // nodeIds currently in minimized state

  // Navigation state (for V2AgentNode edit functionality)
  navigationHandler: ((robotId: RobotId, path: string) => void) | null;

  // ⭐ ÉTAPE 3: Persistence & Deduplication
  lastSavedAt: Record<string, Date | null>; // nodeId -> timestamp of last successful save

  // Actions - Messages & Execution
  setNodeMessages: (nodeId: string, messages: ChatMessage[]) => void;
  addNodeMessage: (nodeId: string, message: ChatMessage) => void;
  updateNodeMessage: (nodeId: string, messageId: string, updates: Partial<ChatMessage>) => void;
  clearNodeMessages: (nodeId: string) => void;
  setNodePendingAttachment: (nodeId: string, attachment: PendingNodeAttachment | null) => void;
  updateNodePendingAttachment: (nodeId: string, updates: Partial<PendingNodeAttachment>) => void;
  clearNodePendingAttachment: (nodeId: string) => void;
  setNodeInvisibleHistorySummary: (nodeId: string, summaryState: InvisibleHistorySummaryState | null) => void;
  getNodeInvisibleHistorySummary: (nodeId: string) => InvisibleHistorySummaryState | null;

  setNodeExecuting: (nodeId: string, isExecuting: boolean) => void;

  // Actions - LLM Config
  updateLLMConfigs: (configs: LLMConfig[]) => void;
  updateLocalLLMProfiles: (profiles: LocalLLMProfile[]) => void;

  // Actions - UI State
  setImagePanelOpen: (isOpen: boolean, nodeId?: string) => void;
  setImageModificationPanelOpen: (isOpen: boolean, imageInfo?: { nodeId: string; sourceImage: string; mimeType: string }) => void;
  setFullscreenImage: (image: { src: string; mimeType: string } | null) => void;
  setFullscreenChatNodeId: (nodeId: string | null) => void;
  setFullscreenChatAgent: (agent: any | null) => void;
  setFullscreenChatAgentInstance?: (agentInstance: any | null) => void; // ⭐ setter for instanceId
  setConfigModalInstanceId: (instanceId: string | null) => void;
  setNavigationHandler: (handler: ((robotId: RobotId, path: string) => void) | null) => void;

  // ⭐ NOUVEAU: Node Minimize Actions
  toggleNodeMinimized: (nodeId: string) => void;

  // ⭐ ÉTAPE 3: Persistence & Deduplication - New Actions
  setLastSavedAt: (nodeId: string, timestamp: Date) => void;
  clearLastSavedAt: (nodeId: string) => void;
  getNewMessages: (nodeId: string) => ChatMessage[]; // Returns only messages after lastSavedAt
  renameNodeRuntimeState: (fromNodeId: string, toNodeId: string) => void;

  // Utility
  getNodeMessages: (nodeId: string) => ChatMessage[];
  getNodePendingAttachment: (nodeId: string) => PendingNodeAttachment | null;
  isNodeExecuting: (nodeId: string) => boolean;
  getIsNodeMinimized: (nodeId: string) => boolean;
  
  // ⭐ ÉTAPE 2.2: Reset complet pour wipe à la connexion
  resetAll: () => void;
  
  // ⭐ V2: Reset pour switch de workflow (préserve llmConfigs qui sont user-level)
  resetForWorkflowSwitch: () => void;
}

export const useRuntimeStore = create<RuntimeStore>((set, get) => ({
  // Initial state
  nodeMessages: {},
  nodePendingAttachments: {},
  nodeInvisibleHistorySummaries: {},
  executingNodes: new Set(),
  llmConfigs: [],
  localLLMProfiles: [],
  isImagePanelOpen: false,
  isImageModificationPanelOpen: false,
  currentImageNodeId: null,
  editingImageInfo: null,
  fullscreenImage: null,
  fullscreenChatNodeId: null,
  fullscreenChatAgent: null,
  configModalInstanceId: null,
  minimizedNodeIds: new Set(), // ⭐ NOUVEAU: État initial vide
  navigationHandler: null,
  lastSavedAt: {}, // ⭐ ÉTAPE 3: Track last save timestamp per node

  // Message actions
  setNodeMessages: (nodeId, messages) => set((state) => ({
    nodeMessages: { ...state.nodeMessages, [nodeId]: messages }
  })),

  addNodeMessage: (nodeId, message) => set((state) => ({
    nodeMessages: {
      ...state.nodeMessages,
      [nodeId]: [...(state.nodeMessages[nodeId] || []), message]
    }
  })),

  updateNodeMessage: (nodeId, messageId, updates) => set((state) => ({
    nodeMessages: {
      ...state.nodeMessages,
      [nodeId]: (state.nodeMessages[nodeId] || []).map(msg =>
        msg.id === messageId ? { ...msg, ...updates } : msg
      )
    }
  })),

  clearNodeMessages: (nodeId) => set((state) => ({
    nodeMessages: { ...state.nodeMessages, [nodeId]: [] },
    nodeInvisibleHistorySummaries: { ...state.nodeInvisibleHistorySummaries, [nodeId]: null }
  })),

  setNodePendingAttachment: (nodeId, attachment) => set((state) => ({
    nodePendingAttachments: {
      ...state.nodePendingAttachments,
      [nodeId]: attachment,
    }
  })),

  updateNodePendingAttachment: (nodeId, updates) => set((state) => {
    const currentAttachment = state.nodePendingAttachments[nodeId];
    if (!currentAttachment) {
      return state;
    }

    return {
      nodePendingAttachments: {
        ...state.nodePendingAttachments,
        [nodeId]: {
          ...currentAttachment,
          ...updates,
        }
      }
    };
  }),

  clearNodePendingAttachment: (nodeId) => set((state) => ({
    nodePendingAttachments: {
      ...state.nodePendingAttachments,
      [nodeId]: null,
    }
  })),

  setNodeInvisibleHistorySummary: (nodeId, summaryState) => set((state) => ({
    nodeInvisibleHistorySummaries: {
      ...state.nodeInvisibleHistorySummaries,
      [nodeId]: summaryState,
    }
  })),

  // Execution state
  setNodeExecuting: (nodeId, isExecuting) => set((state) => {
    const newExecutingNodes = new Set(state.executingNodes);
    if (isExecuting) {
      newExecutingNodes.add(nodeId);
    } else {
      newExecutingNodes.delete(nodeId);
    }
    return { executingNodes: newExecutingNodes };
  }),

  // LLM Config
  updateLLMConfigs: (configs) => {
    set({ llmConfigs: configs });
  },

  updateLocalLLMProfiles: (profiles) => {
    set({ localLLMProfiles: profiles });
  },

  // UI State actions
  setImagePanelOpen: (isOpen, nodeId) => set({
    isImagePanelOpen: isOpen,
    currentImageNodeId: isOpen ? nodeId || null : null
  }),

  setImageModificationPanelOpen: (isOpen, imageInfo) => set({
    isImageModificationPanelOpen: isOpen,
    editingImageInfo: isOpen ? imageInfo || null : null
  }),

  setFullscreenImage: (image) => set({
    fullscreenImage: image
  }),

  setFullscreenChatNodeId: (nodeId) => set({
    fullscreenChatNodeId: nodeId
  }),

  setFullscreenChatAgent: (agent) => set({
    fullscreenChatAgent: agent
  }),

  setFullscreenChatAgentInstance: (agentInstance) => set({
    fullscreenChatAgentInstance: agentInstance
  }),

  setConfigModalInstanceId: (instanceId) => set({
    configModalInstanceId: instanceId
  }),

  setNavigationHandler: (handler) => set({
    navigationHandler: handler
  }),

  // ⭐ NOUVEAU: Node Minimize Actions (UI state only, not persisted)
  toggleNodeMinimized: (nodeId) => set((state) => {
    const newMinimizedNodeIds = new Set(state.minimizedNodeIds);
    if (newMinimizedNodeIds.has(nodeId)) {
      newMinimizedNodeIds.delete(nodeId); // Restore to normal
    } else {
      newMinimizedNodeIds.add(nodeId); // Minimize
    }
    return { minimizedNodeIds: newMinimizedNodeIds };
  }),

  // Utility functions
  getNodeMessages: (nodeId) => {
    const state = get();
    return state.nodeMessages[nodeId] || [];
  },

  getNodePendingAttachment: (nodeId) => {
    const state = get();
    return state.nodePendingAttachments[nodeId] || null;
  },

  getNodeInvisibleHistorySummary: (nodeId) => {
    const state = get();
    return state.nodeInvisibleHistorySummaries[nodeId] || null;
  },

  isNodeExecuting: (nodeId) => {
    const state = get();
    return state.executingNodes.has(nodeId);
  },

  getIsNodeMinimized: (nodeId) => {
    const state = get();
    return state.minimizedNodeIds.has(nodeId);
  },

  /**
   * ⭐ ÉTAPE 3: Set last saved timestamp for a node
   * Called after successful journal persist
   * Used to filter out already-saved messages on next save
   */
  setLastSavedAt: (nodeId, timestamp) => set((state) => ({
    lastSavedAt: { ...state.lastSavedAt, [nodeId]: timestamp }
  })),

  /**
   * ⭐ ÉTAPE 3: Clear last saved timestamp for a node
   * Rarely needed, but useful for testing or manual reset
   */
  clearLastSavedAt: (nodeId) => set((state) => ({
    lastSavedAt: { ...state.lastSavedAt, [nodeId]: null }
  })),

  /**
   * ⭐ ÉTAPE 3: Get only NEW messages since last save
   * Filters messages by timestamp > lastSavedAt (second-level precision)
   * 
   * LOGIC:
   * - If lastSavedAt[nodeId] is null: return ALL messages (first save)
   * - Otherwise: return only messages newer than lastSavedAt timestamp
   * - Timestamp precision: SECOND-level (more reliable than milliseconds)
   * 
   * @returns Array of messages created after the last save
   */
  getNewMessages: (nodeId) => {
    const state = get();
    const messages = state.nodeMessages[nodeId] || [];
    const lastSaved = state.lastSavedAt[nodeId];

    // First save: return all messages
    if (!lastSaved) {
      console.log(`[useRuntimeStore] getNewMessages(${nodeId}): First save - returning all ${messages.length} messages`);
      return messages;
    }

    // Filter by timestamp > lastSaved (second-level precision to avoid millisecond drift)
    const lastSavedSeconds = Math.floor(lastSaved.getTime() / 1000);
    const newMessages = messages.filter(msg => {
      // Parse message timestamp - default to epoch if missing
      const msgTime = msg.timestamp ? new Date(msg.timestamp).getTime() : 0;
      const msgSeconds = Math.floor(msgTime / 1000);
      return msgSeconds > lastSavedSeconds;
    });

    // Only log in development to avoid production noise
    if (isDevelopmentEnvironment) {
      console.log(`[useRuntimeStore] getNewMessages(${nodeId}): ${newMessages.length} new messages (out of ${messages.length} total). Last saved: ${lastSaved.toISOString()}`);
    }
    return newMessages;
  },

  renameNodeRuntimeState: (fromNodeId, toNodeId) => set((state) => {
    if (!fromNodeId || !toNodeId || fromNodeId === toNodeId) {
      return state;
    }

    const fromInstanceId = fromNodeId.replace(/^node-/, '');
    const toInstanceId = toNodeId.replace(/^node-/, '');

    return {
      nodeMessages: renameRecordKey(state.nodeMessages, fromNodeId, toNodeId, (sourceMessages, targetMessages) => mergeNodeMessages(sourceMessages, targetMessages || [])),
      nodePendingAttachments: renameRecordKey(state.nodePendingAttachments, fromNodeId, toNodeId, (sourceAttachment, targetAttachment) => targetAttachment ?? sourceAttachment),
      nodeInvisibleHistorySummaries: renameRecordKey(state.nodeInvisibleHistorySummaries, fromNodeId, toNodeId, (sourceSummary, targetSummary) => targetSummary ?? sourceSummary),
      executingNodes: renameNodeInSet(state.executingNodes, fromNodeId, toNodeId),
      minimizedNodeIds: renameNodeInSet(state.minimizedNodeIds, fromNodeId, toNodeId),
      lastSavedAt: renameRecordKey(state.lastSavedAt, fromNodeId, toNodeId, (sourceTimestamp, targetTimestamp) => {
        if (!targetTimestamp) {
          return sourceTimestamp;
        }

        return sourceTimestamp > targetTimestamp ? sourceTimestamp : targetTimestamp;
      }),
      currentImageNodeId: state.currentImageNodeId === fromNodeId ? toNodeId : state.currentImageNodeId,
      editingImageInfo: state.editingImageInfo?.nodeId === fromNodeId
        ? { ...state.editingImageInfo, nodeId: toNodeId }
        : state.editingImageInfo,
      fullscreenChatNodeId: state.fullscreenChatNodeId === fromNodeId ? toNodeId : state.fullscreenChatNodeId,
      fullscreenChatAgentInstance: state.fullscreenChatAgentInstance?.id === fromInstanceId
        ? { ...state.fullscreenChatAgentInstance, id: toInstanceId }
        : state.fullscreenChatAgentInstance,
      configModalInstanceId: state.configModalInstanceId === fromInstanceId ? toInstanceId : state.configModalInstanceId,
    };
  }),

  /**
   * ⭐ ÉTAPE 2.2: Reset complet du store runtime pour wipe à la connexion
   * Nettoie tous les messages et états d'exécution
   */
  resetAll: () => set({
    nodeMessages: {},
    nodePendingAttachments: {},
    nodeInvisibleHistorySummaries: {},
    executingNodes: new Set(),
    minimizedNodeIds: new Set(), // ⭐ RESET: Restore à normal
    lastSavedAt: {}, // ⭐ ÉTAPE 3: Reset save timestamps on logout
    llmConfigs: [],
    localLLMProfiles: [],
    isImagePanelOpen: false,
    isImageModificationPanelOpen: false,
    currentImageNodeId: null,
    editingImageInfo: null,
    fullscreenImage: null,
    fullscreenChatNodeId: null,
    fullscreenChatAgent: null,
    fullscreenChatAgentInstance: null, // ⭐ New
    configModalInstanceId: null
    // Note: navigationHandler conservé car c'est une fonction
  }),

  /**
   * ⭐ V2: Reset pour switch de workflow
   * PRÉSERVE llmConfigs car ce sont des configs user-level (pas workflow-scoped)
   * Utilisé par switchToWorkflow() dans App.tsx
   */
  resetForWorkflowSwitch: () => {
    const currentConfigs = get().llmConfigs;
    const currentProfiles = get().localLLMProfiles;
    set({
      nodeMessages: {},
      nodePendingAttachments: {},
      nodeInvisibleHistorySummaries: {},
      executingNodes: new Set(),
      minimizedNodeIds: new Set(),
      lastSavedAt: {},
      llmConfigs: currentConfigs, // ⭐ PRÉSERVÉ: configs sont user-level
      localLLMProfiles: currentProfiles, // ⭐ PRÉSERVÉ: profiles sont user-level
      isImagePanelOpen: false,
      isImageModificationPanelOpen: false,
      currentImageNodeId: null,
      editingImageInfo: null,
      fullscreenImage: null,
      fullscreenChatNodeId: null,
      fullscreenChatAgent: null,
      fullscreenChatAgentInstance: null,
      configModalInstanceId: null
    });
  }
}));