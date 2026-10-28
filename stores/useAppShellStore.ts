import { create } from 'zustand';
import type { Agent, AgentInstance, MapsPanelPreloadedResults } from '../types';

export interface EditingImageInfo {
  nodeId: string;
  sourceImage: string;
  mimeType: string;
  agent?: Agent;
  agentInstance?: AgentInstance;
}

interface AppShellStore {
  isSettingsModalOpen: boolean;
  isLoginModalOpen: boolean;
  isRegisterModalOpen: boolean;
  isImagePanelOpen: boolean;
  isImageModificationPanelOpen: boolean;
  isVideoPanelOpen: boolean;
  isMapsPanelOpen: boolean;

  currentImageNodeId: string | null;
  currentImageAgent: Agent | null;
  currentImageAgentInstance: AgentInstance | null;
  currentVideoNodeId: string | null;
  currentVideoAgent: Agent | null;
  currentVideoAgentInstance: AgentInstance | null;
  currentMapsNodeId: string | null;
  editingImageInfo: EditingImageInfo | null;
  mapsPreloadedResults: MapsPanelPreloadedResults | null;
  fullscreenImage: { src: string; mimeType: string } | null;

  currentPath: string;
  showHyperspace: boolean;
  hyperspaceActive: boolean;

  setSettingsModalOpen: (isOpen: boolean) => void;
  setLoginModalOpen: (isOpen: boolean) => void;
  setRegisterModalOpen: (isOpen: boolean) => void;
  setImagePanelOpen: (isOpen: boolean) => void;
  setImageModificationPanelOpen: (isOpen: boolean) => void;
  setVideoPanelOpen: (isOpen: boolean) => void;
  setMapsPanelOpen: (isOpen: boolean) => void;

  setCurrentImageNodeId: (nodeId: string | null | ((previous: string | null) => string | null)) => void;
  setCurrentImageAgent: (agent: Agent | null) => void;
  setCurrentImageAgentInstance: (agentInstance: AgentInstance | null) => void;
  setCurrentVideoNodeId: (nodeId: string | null | ((previous: string | null) => string | null)) => void;
  setCurrentVideoAgent: (agent: Agent | null) => void;
  setCurrentVideoAgentInstance: (agentInstance: AgentInstance | null) => void;
  setCurrentMapsNodeId: (nodeId: string | null | ((previous: string | null) => string | null)) => void;
  setEditingImageInfo: (info: EditingImageInfo | null | ((previous: EditingImageInfo | null) => EditingImageInfo | null)) => void;
  setMapsPreloadedResults: (results: MapsPanelPreloadedResults | null) => void;
  setFullscreenImage: (image: { src: string; mimeType: string } | null) => void;

  setCurrentPath: (path: string) => void;
  setShowHyperspace: (isVisible: boolean) => void;
  setHyperspaceActive: (isActive: boolean) => void;

  clearTransientUiState: () => void;
  resetGuestShellState: () => void;
}

export const useAppShellStore = create<AppShellStore>((set) => ({
  isSettingsModalOpen: false,
  isLoginModalOpen: false,
  isRegisterModalOpen: false,
  isImagePanelOpen: false,
  isImageModificationPanelOpen: false,
  isVideoPanelOpen: false,
  isMapsPanelOpen: false,

  currentImageNodeId: null,
  currentImageAgent: null,
  currentImageAgentInstance: null,
  currentVideoNodeId: null,
  currentVideoAgent: null,
  currentVideoAgentInstance: null,
  currentMapsNodeId: null,
  editingImageInfo: null,
  mapsPreloadedResults: null,
  fullscreenImage: null,

  currentPath: '/bos/dashboard',
  showHyperspace: false,
  hyperspaceActive: false,

  setSettingsModalOpen: (isOpen) => set({ isSettingsModalOpen: isOpen }),
  setLoginModalOpen: (isOpen) => set({ isLoginModalOpen: isOpen }),
  setRegisterModalOpen: (isOpen) => set({ isRegisterModalOpen: isOpen }),
  setImagePanelOpen: (isOpen) => set({ isImagePanelOpen: isOpen }),
  setImageModificationPanelOpen: (isOpen) => set({ isImageModificationPanelOpen: isOpen }),
  setVideoPanelOpen: (isOpen) => set({ isVideoPanelOpen: isOpen }),
  setMapsPanelOpen: (isOpen) => set({ isMapsPanelOpen: isOpen }),

  setCurrentImageNodeId: (nodeId) => set((state) => ({
    currentImageNodeId: typeof nodeId === 'function' ? nodeId(state.currentImageNodeId) : nodeId,
  })),
  setCurrentImageAgent: (agent) => set({ currentImageAgent: agent }),
  setCurrentImageAgentInstance: (agentInstance) => set({ currentImageAgentInstance: agentInstance }),
  setCurrentVideoNodeId: (nodeId) => set((state) => ({
    currentVideoNodeId: typeof nodeId === 'function' ? nodeId(state.currentVideoNodeId) : nodeId,
  })),
  setCurrentVideoAgent: (agent) => set({ currentVideoAgent: agent }),
  setCurrentVideoAgentInstance: (agentInstance) => set({ currentVideoAgentInstance: agentInstance }),
  setCurrentMapsNodeId: (nodeId) => set((state) => ({
    currentMapsNodeId: typeof nodeId === 'function' ? nodeId(state.currentMapsNodeId) : nodeId,
  })),
  setEditingImageInfo: (info) => set((state) => ({
    editingImageInfo: typeof info === 'function' ? info(state.editingImageInfo) : info,
  })),
  setMapsPreloadedResults: (results) => set({ mapsPreloadedResults: results }),
  setFullscreenImage: (image) => set({ fullscreenImage: image }),

  setCurrentPath: (path) => set({ currentPath: path }),
  setShowHyperspace: (isVisible) => set({ showHyperspace: isVisible }),
  setHyperspaceActive: (isActive) => set({ hyperspaceActive: isActive }),

  clearTransientUiState: () => set({
    isImagePanelOpen: false,
    isImageModificationPanelOpen: false,
    isVideoPanelOpen: false,
    isMapsPanelOpen: false,
    currentImageNodeId: null,
    currentImageAgent: null,
    currentImageAgentInstance: null,
    currentVideoNodeId: null,
    currentVideoAgent: null,
    currentVideoAgentInstance: null,
    currentMapsNodeId: null,
    editingImageInfo: null,
    mapsPreloadedResults: null,
    fullscreenImage: null,
  }),

  resetGuestShellState: () => set({
    isSettingsModalOpen: false,
    isLoginModalOpen: false,
    isRegisterModalOpen: false,
    isImagePanelOpen: false,
    isImageModificationPanelOpen: false,
    isVideoPanelOpen: false,
    isMapsPanelOpen: false,
    currentImageNodeId: null,
    currentImageAgent: null,
    currentImageAgentInstance: null,
    currentVideoNodeId: null,
    currentVideoAgent: null,
    currentVideoAgentInstance: null,
    currentMapsNodeId: null,
    editingImageInfo: null,
    mapsPreloadedResults: null,
    fullscreenImage: null,
    currentPath: '/bos/dashboard',
    showHyperspace: false,
    hyperspaceActive: false,
  }),
}));
