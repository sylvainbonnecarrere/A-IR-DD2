import React, { useState, useCallback, useEffect } from 'react';
import { Agent, LLMConfig, LLMProvider, WorkflowNode, LLMCapability, ChatMessage, HistoryConfig, RobotId } from './types';
import { NavigationLayout } from './components/NavigationLayout';
import { RobotPageRouter } from './components/RobotPageRouter';
import { AgentFormModal } from './components/modals/AgentFormModal';
import { SettingsModal } from './components/modals/SettingsModal';
import { Header } from './components/Header';
import { ImageGenerationPanel } from './components/panels/ImageGenerationPanel';
import { ImageModificationPanel } from './components/panels/ImageModificationPanel';
import { VideoGenerationConfigPanel } from './components/panels/VideoGenerationConfigPanel';
import { MapsGroundingConfigPanel } from './components/panels/MapsGroundingConfigPanel';
import { useLocalization } from './hooks/useLocalization';
import { Button } from './components/UI';
import { ConfirmationModal } from './components/modals/ConfirmationModal';
import { FullscreenChatModal } from './components/modals/FullscreenChatModal';
import { useRuntimeStore } from './stores/useRuntimeStore';
import { useDesignStore } from './stores/useDesignStore';
import { NotificationProvider } from './contexts/NotificationContext';
import { NotificationDisplay } from './components/NotificationDisplay';


const LLM_CONFIGS_KEY = 'llmAgentWorkflow_configs';

interface EditingImageInfo {
  nodeId: string;
  sourceImage: string;
  mimeType: string;
}

const initialLLMConfigs: LLMConfig[] = [
  { provider: LLMProvider.Gemini, enabled: true, apiKey: '', capabilities: { [LLMCapability.Chat]: true, [LLMCapability.FileUpload]: true, [LLMCapability.ImageGeneration]: true, [LLMCapability.ImageModification]: true, [LLMCapability.WebSearch]: true, [LLMCapability.URLAnalysis]: true, [LLMCapability.FunctionCalling]: true, [LLMCapability.OutputFormatting]: true, [LLMCapability.VideoGeneration]: true, [LLMCapability.MapsGrounding]: true, [LLMCapability.WebSearchGrounding]: true } },
  { provider: LLMProvider.OpenAI, enabled: false, apiKey: '', capabilities: { [LLMCapability.Chat]: true, [LLMCapability.FileUpload]: true, [LLMCapability.ImageGeneration]: true, [LLMCapability.FunctionCalling]: true, [LLMCapability.OutputFormatting]: true } },
  { provider: LLMProvider.Mistral, enabled: false, apiKey: '', capabilities: { [LLMCapability.Chat]: true, [LLMCapability.FileUpload]: true, [LLMCapability.FunctionCalling]: true, [LLMCapability.OutputFormatting]: true, [LLMCapability.Embedding]: true, [LLMCapability.OCR]: true } },
  { provider: LLMProvider.Anthropic, enabled: false, apiKey: '', capabilities: { [LLMCapability.Chat]: true, [LLMCapability.FileUpload]: true, [LLMCapability.FunctionCalling]: true, [LLMCapability.OutputFormatting]: true } },
  { provider: LLMProvider.Grok, enabled: false, apiKey: '', capabilities: { [LLMCapability.Chat]: true, [LLMCapability.FileUpload]: true, [LLMCapability.FunctionCalling]: true, [LLMCapability.OutputFormatting]: true } },
  { provider: LLMProvider.Perplexity, enabled: false, apiKey: '', capabilities: { [LLMCapability.Chat]: true, [LLMCapability.FunctionCalling]: true, [LLMCapability.OutputFormatting]: true, [LLMCapability.WebSearch]: true } },
  { provider: LLMProvider.Qwen, enabled: false, apiKey: '', capabilities: { [LLMCapability.Chat]: true, [LLMCapability.FileUpload]: true, [LLMCapability.FunctionCalling]: true, [LLMCapability.OutputFormatting]: true } },
  { provider: LLMProvider.Kimi, enabled: false, apiKey: '', capabilities: { [LLMCapability.Chat]: true, [LLMCapability.FunctionCalling]: true, [LLMCapability.OutputFormatting]: true } },
  { provider: LLMProvider.DeepSeek, enabled: false, apiKey: '', capabilities: { [LLMCapability.Chat]: true, [LLMCapability.FunctionCalling]: true, [LLMCapability.OutputFormatting]: true, [LLMCapability.Reasoning]: true, [LLMCapability.CacheOptimization]: true } },
  { provider: LLMProvider.LMStudio, enabled: false, apiKey: 'http://localhost:3928', capabilities: { [LLMCapability.Chat]: true, [LLMCapability.FunctionCalling]: true, [LLMCapability.OutputFormatting]: true, [LLMCapability.LocalDeployment]: true, [LLMCapability.CodeSpecialization]: true } },
];

const loadLLMConfigs = (): LLMConfig[] => {
  try {
    const storedConfigsJSON = localStorage.getItem(LLM_CONFIGS_KEY);
    if (!storedConfigsJSON) return initialLLMConfigs;

    const storedConfigs = JSON.parse(storedConfigsJSON) as LLMConfig[];
    const storedProviders = new Map(storedConfigs.map(c => [c.provider, c]));

    const syncedConfigs = initialLLMConfigs.map(initialConfig => {
      const storedConfig = storedProviders.get(initialConfig.provider);

      if (!storedConfig) {
        return initialConfig; // No user settings for this provider, use default.
      }

      // Sync capabilities: Use initialConfig as the source of truth for which capabilities exist.
      // Use storedConfig for the user's enabled/disabled preference.
      const syncedCapabilities: { [key in LLMCapability]?: boolean } = {};
      for (const capKey in initialConfig.capabilities) {
        const cap = capKey as LLMCapability;
        // If the user has a stored preference for this valid capability, use it. Otherwise, use the default.
        if (storedConfig.capabilities[cap] !== undefined) {
          syncedCapabilities[cap] = storedConfig.capabilities[cap];
        } else {
          syncedCapabilities[cap] = initialConfig.capabilities[cap];
        }
      }

      // Merge: Start with the default, override with stored general settings, then add the synced capabilities.
      return {
        ...initialConfig,
        enabled: storedConfig.enabled,
        apiKey: storedConfig.apiKey,
        capabilities: syncedCapabilities,
      };
    });

    return syncedConfigs;

  } catch (error) {
    console.error("Failed to load or sync LLM configs from localStorage", error);
    // On failure, return the default to prevent a crash.
    return initialLLMConfigs;
  }
};


interface DeleteConfirmationState {
  agentId: string;
  agentName: string;
}

interface UpdateConfirmationState {
  agentData: Omit<Agent, 'id'>;
  agentId: string;
  count: number;
}


function App() {
  const [isSettingsModalOpen, setSettingsModalOpen] = useState(false);
  const [isAgentModalOpen, setAgentModalOpen] = useState(false);
  const [isImagePanelOpen, setImagePanelOpen] = useState(false);
  const [isImageModificationPanelOpen, setImageModificationPanelOpen] = useState(false);
  const [isVideoPanelOpen, setVideoPanelOpen] = useState(false);
  const [isMapsPanelOpen, setMapsPanelOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);

  const [agents, setAgents] = useState<Agent[]>([]);
  const [workflowNodes, setWorkflowNodes] = useState<WorkflowNode[]>([]);
  const [llmConfigs, setLlmConfigs] = useState<LLMConfig[]>(loadLLMConfigs);
  const [currentImageNodeId, setCurrentImageNodeId] = useState<string | null>(null);
  const [currentVideoNodeId, setCurrentVideoNodeId] = useState<string | null>(null);
  const [currentMapsNodeId, setCurrentMapsNodeId] = useState<string | null>(null);
  const [editingImageInfo, setEditingImageInfo] = useState<EditingImageInfo | null>(null);
  const [isSidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [fullscreenImage, setFullscreenImage] = useState<{ src: string; mimeType: string } | null>(null);
  const { t } = useLocalization();

  // Runtime Store access
  const { updateLLMConfigs, setNavigationHandler, addNodeMessage } = useRuntimeStore();

  // Design Store access for integrity validation  
  const { validateWorkflowIntegrity, cleanupOrphanedInstances, addAgentInstance } = useDesignStore();

  // Sync LLM configs with runtime store
  useEffect(() => {
    updateLLMConfigs(llmConfigs);
  }, [llmConfigs, updateLLMConfigs]);

  // Configure navigation handler for agent nodes
  useEffect(() => {
    setNavigationHandler(handleRobotNavigation);
  }, [setNavigationHandler]);

  // PHASE 1B: Integrity validation on app startup
  useEffect(() => {
    // Clean up any orphaned instances first
    const cleanedCount = cleanupOrphanedInstances();

    // Then validate workflow integrity
    const { fixedCount } = validateWorkflowIntegrity();

    if (cleanedCount > 0 || fixedCount > 0) {
      console.log(`🚀 App startup integrity check completed: cleaned ${cleanedCount} instances, fixed ${fixedCount} nodes`);
    }
  }, [cleanupOrphanedInstances, validateWorkflowIntegrity]);

  const [deleteConfirmation, setDeleteConfirmation] = useState<DeleteConfirmationState | null>(null);
  const [updateConfirmation, setUpdateConfirmation] = useState<UpdateConfirmationState | null>(null);

  // Robot Navigation State
  const [currentPath, setCurrentPath] = useState('/bos/dashboard');

  const handleRobotNavigation = (robotId: RobotId, path: string) => {
    setCurrentPath(path);
    // TODO: Implement proper routing logic
    console.log(`Navigating to robot ${robotId} at path ${path}`);
  };

  const handleSaveSettings = (newLLMConfigs: LLMConfig[]) => {
    try {
      localStorage.setItem(LLM_CONFIGS_KEY, JSON.stringify(newLLMConfigs));
      setLlmConfigs(newLLMConfigs);
    } catch (error) {
      console.error("Failed to save settings to localStorage", error);
    }
  };

  const handleOpenEditAgentModal = (agent: Agent) => {
    setEditingAgent(agent);
    setAgentModalOpen(true);
  };

  const handleSaveAgent = (agentData: Omit<Agent, 'id'>, agentId?: string) => {
    if (agentId) { // Editing existing agent
      const instancesCount = workflowNodes.filter(n => n.agent.id === agentId).length;
      if (instancesCount > 0) {
        setUpdateConfirmation({ agentData, agentId, count: instancesCount });
      } else {
        // No instances, just save directly
        const updatedAgent = { ...agentData, id: agentId };
        setAgents(prev => prev.map(a => a.id === agentId ? updatedAgent : a));
      }
    } else { // Creating new agent
      setAgents(prev => [...prev, { ...agentData, id: `agent-${Date.now()}` }]);
    }
    setAgentModalOpen(false);
    setEditingAgent(null);
  };

  const handleUpdateConfirmation = (updateInstances: boolean) => {
    if (updateConfirmation) {
      const { agentData, agentId } = updateConfirmation;
      const updatedAgent = { ...agentData, id: agentId };

      // Update the prototype agent
      setAgents(prev => prev.map(a => a.id === agentId ? updatedAgent : a));

      if (updateInstances) {
        setWorkflowNodes(prev => prev.map(node =>
          node.agent.id === agentId
            ? { ...node, agent: updatedAgent }
            : node
        ));
      }
    }
    setUpdateConfirmation(null);
  };

  const handleDeleteAgent = (agentId: string) => {
    const agentToDelete = agents.find(agent => agent.id === agentId);
    if (agentToDelete) {
      setDeleteConfirmation({ agentId, agentName: agentToDelete.name });
    }
  };

  const confirmDeleteAgent = () => {
    if (deleteConfirmation) {
      const { agentId } = deleteConfirmation;
      setAgents(prev => prev.filter(agent => agent.id !== agentId));
      setWorkflowNodes(prev => prev.filter(node => node.agent.id !== agentId));
      setDeleteConfirmation(null);
    }
  };

  const addAgentToWorkflow = useCallback((agent: Agent) => {
    // Calculate position based on existing instances
    const position = {
      x: (workflowNodes.length % 4) * 420 + 20,
      y: Math.floor(workflowNodes.length / 4) * 540 + 20,
    };

    // Add agent instance to DesignStore instead of local state
    const instanceId = addAgentInstance(agent.id, position);

    // Legacy: Also add to local state for now to maintain compatibility
    const newNode: WorkflowNode = {
      id: `node-${Date.now()}`,
      agent,
      position,
      messages: [],
      isMinimized: false,
    };
    setWorkflowNodes(prev => [...prev, newNode]);
  }, [workflowNodes, addAgentInstance]);

  const handleDeleteNode = (nodeId: string) => {
    setWorkflowNodes(prev => prev.filter(node => node.id !== nodeId));
  };

  const handleUpdateNodePosition = (nodeId: string, position: { x: number; y: number }) => {
    setWorkflowNodes(prev =>
      prev.map(node => (node.id === nodeId ? { ...node, position } : node))
    );
  };

  const handleOpenImagePanel = (nodeId: string) => {
    setCurrentImageNodeId(nodeId);
    setImagePanelOpen(true);
  };

  const handleImageGenerated = (nodeId: string, imageBase64: string) => {
    const imageMessage: ChatMessage = {
      id: `msg-${Date.now()}`,
      sender: 'agent',
      text: t('app_generatedImageText'),
      image: imageBase64,
      mimeType: 'image/png',
    };
    handleUpdateNodeMessages(nodeId, prev => [...prev, imageMessage]);
    addNodeMessage(nodeId, imageMessage);
  };

  const handleOpenImageModificationPanel = (nodeId: string, sourceImage: string, mimeType: string = 'image/png') => {
    setEditingImageInfo({ nodeId, sourceImage, mimeType });
    setImageModificationPanelOpen(true);
  };

  const handleOpenVideoPanel = (nodeId: string) => {
    setCurrentVideoNodeId(nodeId);
    setVideoPanelOpen(true);
  };

  const handleOpenMapsPanel = (nodeId: string) => {
    setCurrentMapsNodeId(nodeId);
    setMapsPanelOpen(true);
  };

  const handleImageModified = (nodeId: string, newImage: string, text: string) => {
    const message: ChatMessage = {
      id: `msg-${Date.now()}`,
      sender: 'agent',
      text: text,
      image: newImage,
      mimeType: 'image/png',
    };
    handleUpdateNodeMessages(nodeId, prev => [...prev, message]);
    addNodeMessage(nodeId, message);
  };

  const handleToggleNodeMinimize = (nodeId: string) => {
    setWorkflowNodes(prev => prev.map(node =>
      node.id === nodeId ? { ...node, isMinimized: !node.isMinimized } : node
    ));
  };

  const handleUpdateNodeMessages = (nodeId: string, messages: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
    setWorkflowNodes(prev => prev.map(node =>
      node.id === nodeId
        ? { ...node, messages: typeof messages === 'function' ? messages(node.messages) : messages }
        : node
    ));
  };

  const handleOpenFullscreen = (src: string, mimeType: string) => {
    setFullscreenImage({ src, mimeType });
  };

  const handleAddToWorkflow = (agent: Agent) => {
    addAgentToWorkflow(agent);
  };

  return (
    <NotificationProvider>
      <div className="flex flex-col h-screen bg-gray-900 text-gray-100 font-sans">
        <Header
          onOpenSettings={() => setSettingsModalOpen(true)}
        />
        <div className="flex flex-1 overflow-hidden">
          <NavigationLayout
            agents={agents}
            isCollapsed={isSidebarCollapsed}
            onToggleCollapse={() => setSidebarCollapsed(!isSidebarCollapsed)}
            onAddAgent={() => { setEditingAgent(null); setAgentModalOpen(true); }}
            onAddToWorkflow={addAgentToWorkflow}
            onDeleteAgent={handleDeleteAgent}
            onEditAgent={handleOpenEditAgentModal}
            currentPath={currentPath}
            onNavigate={handleRobotNavigation}
          />
          <main className="flex-1 bg-gray-800/50 overflow-hidden">
            <RobotPageRouter
              currentPath={currentPath}
              llmConfigs={llmConfigs}
              onNavigate={handleRobotNavigation}
              agents={agents}
              workflowNodes={workflowNodes}
              onDeleteNode={handleDeleteNode}
              onUpdateNodeMessages={handleUpdateNodeMessages}
              onUpdateNodePosition={handleUpdateNodePosition}
              onToggleNodeMinimize={handleToggleNodeMinimize}
              onOpenImagePanel={handleOpenImagePanel}
              onOpenImageModificationPanel={handleOpenImageModificationPanel}
              onOpenVideoPanel={handleOpenVideoPanel}
              onOpenMapsPanel={handleOpenMapsPanel}
              onOpenFullscreen={handleOpenFullscreen}
              onAddToWorkflow={handleAddToWorkflow}
            />
          </main>
        </div>

        {isSettingsModalOpen && (
          <SettingsModal
            llmConfigs={llmConfigs}
            onClose={() => setSettingsModalOpen(false)}
            onSave={handleSaveSettings}
          />
        )}

        {isAgentModalOpen && (
          <AgentFormModal
            onClose={() => { setAgentModalOpen(false); setEditingAgent(null); }}
            onSave={handleSaveAgent}
            llmConfigs={llmConfigs}
            existingAgent={editingAgent}
          />
        )}

        {updateConfirmation && (
          <ConfirmationModal
            isOpen={true}
            title={t('dialog_update_title')}
            message={t('dialog_update_message', { count: updateConfirmation.count })}
            confirmText={t('dialog_update_confirmButton')}
            cancelText={t('dialog_update_cancelButton')}
            onConfirm={() => handleUpdateConfirmation(true)}
            onCancel={() => handleUpdateConfirmation(false)}
          />
        )}

        {deleteConfirmation && (
          <ConfirmationModal
            isOpen={true}
            title={t('dialog_delete_title')}
            message={t('dialog_delete_message', { agentName: deleteConfirmation.agentName })}
            confirmText={t('dialog_delete_confirmButton')}
            onConfirm={confirmDeleteAgent}
            onCancel={() => setDeleteConfirmation(null)}
            variant="danger"
          />
        )}

        <ImageGenerationPanel
          isOpen={isImagePanelOpen}
          nodeId={currentImageNodeId}
          llmConfigs={llmConfigs}
          workflowNodes={workflowNodes}
          onClose={() => setImagePanelOpen(false)}
          onImageGenerated={handleImageGenerated}
          onOpenImageModificationPanel={handleOpenImageModificationPanel}
        />

        <ImageModificationPanel
          isOpen={isImageModificationPanelOpen}
          editingImageInfo={editingImageInfo}
          llmConfigs={llmConfigs}
          workflowNodes={workflowNodes}
          onClose={() => setImageModificationPanelOpen(false)}
          onImageModified={handleImageModified}
        />

        <VideoGenerationConfigPanel
          isOpen={isVideoPanelOpen}
          nodeId={currentVideoNodeId}
          llmConfigs={llmConfigs}
          workflowNodes={workflowNodes}
          onClose={() => setVideoPanelOpen(false)}
        />

        <MapsGroundingConfigPanel
          isOpen={isMapsPanelOpen}
          nodeId={currentMapsNodeId}
          llmConfigs={llmConfigs}
          workflowNodes={workflowNodes}
          onClose={() => setMapsPanelOpen(false)}
        />

        {fullscreenImage && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-80 backdrop-blur-sm"
            onClick={() => setFullscreenImage(null)}
          >
            <img
              src={`data:${fullscreenImage.mimeType};base64,${fullscreenImage.src}`}
              alt={t('fullscreenModal_alt')}
              className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg"
              onClick={(e) => e.stopPropagation()}
            />
            <Button
              variant="ghost"
              onClick={() => setFullscreenImage(null)}
              className="absolute top-4 right-4 text-white text-2xl px-2 py-2"
              aria-label={t('fullscreenModal_close_aria')}
            >
              &times;
            </Button>
          </div>
        )}

        {/* Fullscreen Chat Modal */}
        <FullscreenChatModal />

        <NotificationDisplay />
      </div>
    </NotificationProvider>
  );
}

export default App;
