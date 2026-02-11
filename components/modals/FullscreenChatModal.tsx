import React, { useState, useRef, useEffect } from 'react';
import { Button } from '../UI';
import { CloseIcon, UploadIcon, SendIcon, ImageIcon, EditIcon } from '../Icons';
import { useRuntimeStore } from '../../stores/useRuntimeStore';
import { useDesignStore } from '../../stores/useDesignStore';
import { useAgentChat } from '../../hooks/useAgentChat';
import { useLocalization } from '../../hooks/useLocalization';
import { useAuth } from '../../contexts/AuthContext';
import { ChatMessage, Agent, LLMCapability, WorkflowNode } from '../../types';
import { ConfirmationModal } from './ConfirmationModal';
import { ImageGenerationPanel } from '../panels/ImageGenerationPanel';
import { VideoGenerationConfigPanel } from '../panels/VideoGenerationConfigPanel';
import { MapsGroundingConfigPanel } from '../panels/MapsGroundingConfigPanel';

// Minimize icon
const MinimizeIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
    <line x1="5" y1="12" x2="19" y2="12"></line>
  </svg>
);

// Video icon Arc-LLM
const VideoIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <polygon points="23 7 16 12 23 17 23 7"></polygon>
    <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
  </svg>
);

// Map icon Arc-LLM
const MapIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"></polygon>
    <line x1="8" y1="2" x2="8" y2="18"></line>
    <line x1="16" y1="6" x2="16" y2="22"></line>
  </svg>
);

// Web Search icon Arc-LLM
const WebSearchIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <circle cx="11" cy="11" r="8"></circle>
    <path d="m21 21-4.35-4.35"></path>
    <path d="M11 1v2"></path>
    <path d="M11 19v2"></path>
    <path d="M1 11h2"></path>
    <path d="M19 11h2"></path>
  </svg>
);

interface FullscreenChatModalProps {
  onDeleteNode?: (nodeId: string) => void;
  onOpenImagePanel?: (nodeId: string) => void;
  onOpenVideoPanel?: (nodeId: string) => void;
  onOpenMapsPanel?: (nodeId: string, preloadedResults?: { text: string; mapSources: any[]; query?: string }) => void;
}

export const FullscreenChatModal: React.FC<FullscreenChatModalProps> = ({
  onDeleteNode,
  onOpenImagePanel,
  onOpenVideoPanel,
  onOpenMapsPanel
}) => {
  const {
    fullscreenChatNodeId,
    fullscreenChatAgent,
    fullscreenChatAgentInstance,
    setFullscreenChatNodeId,
    getNodeMessages,
    addNodeMessage,
    setNodeMessages,
    setNodeExecuting,
    isNodeExecuting
  } = useRuntimeStore();

  const { agents, agentInstances } = useDesignStore();
  const { t } = useLocalization();
  const { isAuthenticated, accessToken } = useAuth();

  const [userInput, setUserInput] = useState('');
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showThinking, setShowThinking] = useState(true);
  const [webFetchEnabled, setWebFetchEnabled] = useState(false);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [activeSidePanel, setActiveSidePanel] = useState<'none' | 'image' | 'video' | 'maps'>('none');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Read agentInstance from store (triggers re-render when config is updated)
  const agentInstance = fullscreenChatAgentInstance?.id
    ? agentInstances.find(inst => inst.id === fullscreenChatAgentInstance.id)
    : fullscreenChatAgentInstance;
  
  const messages = fullscreenChatNodeId ? getNodeMessages(fullscreenChatNodeId) : [];
  const isLoading = fullscreenChatNodeId ? isNodeExecuting(fullscreenChatNodeId) : false;

  const llmConfigs = useRuntimeStore(state => state.llmConfigs);

  // Read prototype from store to ensure it's fresh (not stale from Runtime prop)
  // This is critical: if user edits LLM capabilities, we need the latest prototype
  const agentPrototype = agentInstance?.prototypeId
    ? agents.find(a => a.id === agentInstance.prototypeId)
    : fullscreenChatAgent;

  // Build effective agent config from instance and prototype
  const agent: Agent | null = agentInstance && agentPrototype
    ? {
        ...agentPrototype,
        ...(agentInstance.configuration_json as any),
        historyConfig: agentInstance.configuration_json?.historyConfig 
          || agentPrototype.historyConfig
      }
    : agentPrototype || null;
  
  const instanceId = agentInstance?.id;

  const { handleSendMessage: sendMessageToLLM, loadingMessage } = useAgentChat({
    nodeId: fullscreenChatNodeId || '',
    agent,
    llmConfigs,
    t,
    nativeToolsConfig: { webFetch: webFetchEnabled, webSearch: webSearchEnabled },
    instanceId,
    isAuthenticated,
    accessToken
  });

  // Load chat history from backend when modal opens
  // This ensures history is available even if runtime store was cleared
  useEffect(() => {
    const loadChatHistoryFromBackend = async () => {
      if (!fullscreenChatAgentInstance?.id || !isAuthenticated || !accessToken || !fullscreenChatNodeId) {
        return; // Skip if not authenticated or missing instance
      }

      try {
        // Fetch instance with all its content
        const response = await fetch(
          `http://localhost:3001/api/agent-instances/${fullscreenChatAgentInstance.id}`,
          {
            headers: {
              'Authorization': `Bearer ${accessToken}`
            }
          }
        );

        if (!response.ok) {
          return;
        }

        const instance = await response.json();
        
        // Transform backend content array to ChatMessage format
        if (instance.content && Array.isArray(instance.content)) {
          const backendMessages = instance.content.map((item: any, idx: number) => {
            // Transform role to sender
            let sender: 'user' | 'agent' | 'tool' = 'agent';
            if (item.role === 'user') sender = 'user';
            else if (item.role === 'tool' || item.type === 'error') sender = 'tool';
            else sender = 'agent';

            return {
              id: item.metadata?.messageId || `msg-loaded-${idx}`,
              sender,
              text: item.message || '',
              image: item.metadata?.image || undefined,
              filename: item.metadata?.filename || undefined,
              isError: item.type === 'error',
              toolCalls: item.metadata?.toolCalls || undefined,
              timestamp: item.timestamp ? new Date(item.timestamp) : new Date()
            };
          });

          // Get existing messages from runtime store
          const existingMessages = getNodeMessages(fullscreenChatNodeId) || [];
          
          // Merge: keep existing (local) messages, prepend backend messages that aren't duplicates
          const existingIds = new Set(existingMessages.map(m => m.id));
          const newBackendMessages = backendMessages.filter(m => !existingIds.has(m.id));
          
          const mergedMessages = [...newBackendMessages, ...existingMessages];
          
          // Only update if we loaded messages from backend
          if (newBackendMessages.length > 0) {
            setNodeMessages(fullscreenChatNodeId, mergedMessages);
          }
        }
      } catch (err) {
        // Don't block UI - continue without history if load fails
      }
    };

    loadChatHistoryFromBackend();
  }, [fullscreenChatAgentInstance?.id, fullscreenChatNodeId, isAuthenticated, accessToken, getNodeMessages, setNodeMessages]);

  // Auto-scroll vers le bas quand de nouveaux messages arrivent
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Si pas de node sélectionné, ne pas afficher la modal (APRÈS tous les hooks)
  if (!fullscreenChatNodeId) return null;

  // ⭐ SOLID FIX B: Déterminer le nom et infos de l'agent correctement
  // Maintenant que on passe fullscreenChatAgent depuis V2AgentNode, on peut utiliser directement agent
  const agentName = agent?.name || 'Unknown Agent';

  // ⭐ FIX: Récupérer model et provider depuis l'agent passé
  const agentModel = agent?.model || 'Unknown Model';
  const agentProvider = agent?.llmProvider || 'Unknown Provider';
  
  const llmConfigForProvider = llmConfigs?.find(c => c.provider === agent?.llmProvider);
  const agentLLMVersion = llmConfigForProvider?.llmVersion || llmConfigForProvider?.model || '';
  
  const llmDisplayString = agentLLMVersion 
    ? `${agentProvider} v${agentLLMVersion}`
    : `${agentProvider} • ${agentModel}`;

  const handleClose = () => {
    const { setFullscreenChatAgent, setFullscreenChatAgentInstance } = useRuntimeStore.getState();
    setFullscreenChatNodeId(null);
    setFullscreenChatAgent(null);
    setFullscreenChatAgentInstance(null);
  };

  const handleDelete = () => {
    setShowDeleteConfirm(true);
  };

  const handleConfirmDelete = () => {
    if (fullscreenChatNodeId && onDeleteNode) {
      onDeleteNode(fullscreenChatNodeId);
    }
    setShowDeleteConfirm(false);
    handleClose(); // Fermer le modal après suppression
  };

  const handleCancelDelete = () => {
    setShowDeleteConfirm(false);
  };

  const handleOpenImagePanel = () => {
    setActiveSidePanel(activeSidePanel === 'image' ? 'none' : 'image');
  };

  const handleOpenVideoPanel = () => {
    setActiveSidePanel(activeSidePanel === 'video' ? 'none' : 'video');
  };

  const handleOpenMapsPanel = () => {
    setActiveSidePanel(activeSidePanel === 'maps' ? 'none' : 'maps');
  };

  const handleCloseSidePanel = () => {
    setActiveSidePanel('none');
  };

  // Créer un mockNode pour workflowNodes basé sur les données actuelles
  const mockWorkflowNode = fullscreenChatNodeId && agent ? {
    id: fullscreenChatNodeId,
    agent: agent,
    position: { x: 0, y: 0 },
    data: {},
    width: 300,
    height: 200
  } : null;

  const workflowNodesForPanels = mockWorkflowNode ? [mockWorkflowNode] : [];

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedInput = userInput.trim();
    if (!trimmedInput && !attachedFile) return;

    // Déléguer l'envoi au hook partagé (même logique que V2AgentNode)
    await sendMessageToLLM(trimmedInput, attachedFile);

    // Nettoyer l'input après envoi
    setUserInput('');
    setAttachedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setAttachedFile(file);
    }
  };

  const renderMessage = (message: ChatMessage) => {
    const isUser = message.sender === 'user';
    const isError = message.isError;

    return (
      <div key={message.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
        <div className={`max-w-3xl px-4 py-2 rounded-lg ${isUser
          ? 'bg-indigo-600 text-white ml-12'
          : isError
            ? 'bg-red-600/20 text-red-200 mr-12'
            : 'bg-gray-700 text-gray-100 mr-12'
          }`}>
          {/* Extended Thinking display (collapsible) */}
          {message.thinking && showThinking && (
            <details className="mb-2 p-2 bg-purple-900/20 border border-purple-500/30 rounded">
              <summary className="cursor-pointer text-xs font-semibold text-purple-400 hover:text-purple-300">
                💭 {t('extended_thinking') || 'Extended Thinking'}
              </summary>
              <div className="mt-2 text-xs text-purple-200 whitespace-pre-wrap">
                {message.thinking}
              </div>
            </details>
          )}

          <div className="whitespace-pre-wrap break-words">
            {message.text}
          </div>
          {message.image && (
            <div className="mt-2">
              <img
                src={`data:${message.mimeType};base64,${message.image}`}
                alt="Uploaded content"
                className="max-w-sm rounded cursor-pointer hover:opacity-80"
              />
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center">
      {/* Main container - Split-View Layout with Dynamic Expansion */}
      <div className={`flex flex-col bg-gray-800 rounded-lg shadow-2xl transition-all duration-500 ease-in-out ${
        activeSidePanel !== 'none' 
          ? 'w-[98vw] h-[98vh] max-w-none' 
          : 'w-full h-full max-w-6xl'
      }`}>

        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700 bg-gradient-to-r from-gray-900/80 via-gray-800/60 to-gray-900/80 rounded-t-lg backdrop-blur-sm">
          <div className="flex items-center space-x-3">
            <div className={`w-3 h-3 rounded-full shadow-lg transition-all duration-200 ${isLoading ? 'bg-yellow-400 animate-pulse shadow-yellow-400/60' : 'bg-green-400 shadow-green-400/60'}`}></div>
            <div>
              <h2 className="text-xl font-semibold text-white">
                {agentName}
              </h2>
              <span className="text-xs text-gray-400">
                {llmDisplayString}
              </span>
            </div>
          </div>

          {/* Header Control Buttons (Minimize, Delete only) */}
          <div className="flex items-center space-x-2">
            {/* Minimize/Restore button (ferme le fullscreen) */}
            <Button
              variant="ghost"
              className="p-2 h-8 w-8 text-gray-400 hover:text-blue-400 
                         hover:bg-blue-500/20 hover:shadow-lg hover:shadow-blue-500/40
                         transition-all duration-200 rounded-md
                         hover:scale-110 active:scale-95"
              onClick={handleClose}
              title={t('restore_size')}
            >
              <MinimizeIcon width={16} height={16} />
            </Button>

            {/* Delete button */}
            <Button
              variant="ghost"
              className="p-2 h-8 w-8 text-gray-400 hover:text-red-400 
                         hover:bg-red-500/20 hover:shadow-lg hover:shadow-red-500/40
                         transition-all duration-200 rounded-md
                         hover:scale-110 active:scale-95"
              onClick={handleDelete}
              title={t('sidebar_deleteAgent_aria', { agentName })}
            >
              <CloseIcon width={16} height={16} />
            </Button>
          </div>
        </div>

        {/* Main content area - Split-View (Chat + Side Panel) */}
        <div className={`flex flex-1 overflow-hidden`}>
          
          {/* Chat section - Takes full width or flex-1 if panel is open */}
          <div className={`flex flex-col ${activeSidePanel !== 'none' ? 'flex-1' : 'w-full'} border-r ${activeSidePanel !== 'none' ? 'border-cyan-500/30' : 'border-transparent'}`}>
            
            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {messages.length === 0 ? (
                <div className="flex items-center justify-center h-full text-gray-400">
                  <div className="text-center">
                    <div className="text-4xl mb-2">💬</div>
                    <p>Commencez une conversation avec {agentName}</p>
                  </div>
                </div>
              ) : (
                <>
                  {messages.map(renderMessage)}
                  <div ref={messagesEndRef} />
                </>
              )}

              {isLoading && (
                <div className="flex justify-start mb-4">
                  <div className="bg-gray-700 text-gray-100 mr-12 px-4 py-2 rounded-lg">
                    <div className="flex items-center space-x-2">
                      <div className="animate-spin w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full"></div>
                      <span>{loadingMessage || 'Agent en cours de réflexion...'}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Unified Features Toolbar - All functionality buttons above the input */}
            <div className="border-t border-gray-700 bg-gray-900/50 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                {/* Thinking capability */}
                {agent?.capabilities?.includes(LLMCapability.ExtendedThinking) && (
                  <Button
                    type="button"
                    variant="ghost"
                    className={`px-3 py-2 h-9 transition-all duration-200 rounded-md text-sm font-medium ${showThinking
                        ? 'text-purple-400 bg-purple-500/20 hover:text-purple-300 hover:bg-purple-500/30'
                        : 'text-gray-400 hover:text-purple-400 hover:bg-purple-500/20'
                      }`}
                    onClick={() => setShowThinking(!showThinking)}
                    disabled={isLoading}
                    title={showThinking ? 'Masquer la pensée' : 'Afficher la pensée'}
                  >
                    💭 {t('extended_thinking') || 'Pensée'}
                  </Button>
                )}

                {/* File upload */}
                {agent?.capabilities?.includes(LLMCapability.FileUpload) && (
                  <>
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleFileUpload}
                      accept={agent?.capabilities?.includes(LLMCapability.PDFSupport) ? "image/*,application/pdf" : "image/*"}
                      className="hidden"
                    />

                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => fileInputRef.current?.click()}
                      className="px-3 py-2 h-9 text-gray-400 hover:text-blue-400 hover:bg-blue-500/20 transition-all duration-200 rounded-md text-sm font-medium"
                      disabled={isLoading}
                      title="Joindre un fichier"
                    >
                      <UploadIcon width={16} height={16} className="mr-1" />
                      Fichier
                    </Button>
                  </>
                )}

                {/* Web Fetch Tool */}
                {agent?.capabilities?.includes(LLMCapability.WebFetchTool) && (
                  <Button
                    type="button"
                    variant="ghost"
                    className={`px-3 py-2 h-9 transition-all duration-200 rounded-md text-sm font-medium ${webFetchEnabled
                        ? 'text-teal-300 bg-teal-500/30 hover:text-teal-200 hover:bg-teal-500/40 shadow-lg shadow-teal-500/40'
                        : 'text-gray-400 hover:text-teal-400 hover:bg-teal-500/20'
                      }`}
                    onClick={() => setWebFetchEnabled(!webFetchEnabled)}
                    disabled={isLoading}
                    title={webFetchEnabled ? 'Web Fetch activé' : 'Web Fetch désactivé'}
                  >
                    🌐 Web Fetch
                  </Button>
                )}

                {/* Web Search Tool */}
                {agent?.capabilities?.includes(LLMCapability.WebSearchToolAnthropic) && (
                  <Button
                    type="button"
                    variant="ghost"
                    className={`px-3 py-2 h-9 transition-all duration-200 rounded-md text-sm font-medium ${webSearchEnabled
                        ? 'text-orange-300 bg-orange-500/30 hover:text-orange-200 hover:bg-orange-500/40 shadow-lg shadow-orange-500/40'
                        : 'text-gray-400 hover:text-orange-400 hover:bg-orange-500/20'
                      }`}
                    onClick={() => setWebSearchEnabled(!webSearchEnabled)}
                    disabled={isLoading}
                    title={webSearchEnabled ? 'Web Search activé' : 'Web Search désactivé'}
                  >
                    <WebSearchIcon width={16} height={16} className="mr-1" />
                    Web Search
                  </Button>
                )}

                {/* Image generation/modification button */}
                {(agent?.capabilities?.includes(LLMCapability.ImageGeneration) || agent?.capabilities?.includes(LLMCapability.ImageModification)) && (
                  <Button
                    variant="ghost"
                    className={`px-3 py-2 h-9 text-gray-400 
                               ${activeSidePanel === 'image' ? 'text-purple-400 bg-purple-500/30' : 'hover:text-purple-400 hover:bg-purple-500/20'} 
                               hover:shadow-lg hover:shadow-purple-500/40
                               transition-all duration-200 rounded-md text-sm font-medium`}
                    onClick={handleOpenImagePanel}
                    disabled={isLoading}
                    title={t('agentNode_aria_generateImage')}
                  >
                    <ImageIcon width={16} height={16} className="mr-1" />
                    Image
                  </Button>
                )}

                {/* Video generation button */}
                {agent?.capabilities?.includes(LLMCapability.VideoGeneration) && (
                  <Button
                    variant="ghost"
                    className={`px-3 py-2 h-9 text-gray-400 
                               ${activeSidePanel === 'video' ? 'text-pink-400 bg-pink-500/30' : 'hover:text-pink-400 hover:bg-pink-500/20'} 
                               hover:shadow-lg hover:shadow-pink-500/40
                               transition-all duration-200 rounded-md text-sm font-medium`}
                    onClick={handleOpenVideoPanel}
                    disabled={isLoading}
                    title="Générer une vidéo"
                  >
                    <VideoIcon width={16} height={16} className="mr-1" />
                    Vidéo
                  </Button>
                )}

                {/* Maps grounding button */}
                {agent?.capabilities?.includes(LLMCapability.MapsGrounding) && (
                  <Button
                    variant="ghost"
                    className={`px-3 py-2 h-9 text-gray-400 
                               ${activeSidePanel === 'maps' ? 'text-green-400 bg-green-500/30' : 'hover:text-green-400 hover:bg-green-500/20'} 
                               hover:shadow-lg hover:shadow-green-500/40
                               transition-all duration-200 rounded-md text-sm font-medium`}
                    onClick={handleOpenMapsPanel}
                    disabled={isLoading}
                    title="Recherche de lieux"
                  >
                    <MapIcon width={16} height={16} className="mr-1" />
                    Cartes
                  </Button>
                )}
              </div>
            </div>

            {/* Input Area - Simplified */}
            <div className="border-t border-gray-700 bg-gray-900/30 p-4">
              <form onSubmit={handleSendMessage} className="space-y-3">
                {attachedFile && (
                  <div className="flex items-center justify-between bg-gray-700/50 p-2 rounded">
                    <span className="text-sm text-gray-300">📎 {attachedFile.name}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setAttachedFile(null)}
                      className="p-1 h-6 w-6 text-gray-400 hover:text-red-400"
                    >
                      <CloseIcon width={12} height={12} />
                    </Button>
                  </div>
                )}

                <div className="flex space-x-2">
                  <input
                    type="text"
                    value={userInput}
                    onChange={(e) => setUserInput(e.target.value)}
                    placeholder="Tapez votre message..."
                    className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400 focus:outline-none focus:border-indigo-500"
                    disabled={isLoading}
                  />

                  <Button
                    type="submit"
                    disabled={(!userInput.trim() && !attachedFile) || isLoading}
                    className="p-2 h-10 w-10 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <SendIcon width={16} height={16} />
                  </Button>
                </div>
              </form>
            </div>
          </div>

          {/* Side Panel - Configuration (Image, Video, Maps) */}
          {activeSidePanel !== 'none' && (
            <div className={`w-96 flex flex-col border-l border-cyan-500 bg-gray-800/90 backdrop-blur-sm overflow-hidden transition-all duration-500 ease-in-out transform ${
              activeSidePanel !== 'none' ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'
            } shadow-[-10px_0_30px_-10px_rgba(6,182,212,0.3)]`}>
              
              {/* Side Panel Content - Scrollable (No Header - let child components manage it) */}
              <div className="flex-1 overflow-y-auto">
                {activeSidePanel === 'image' && agent?.capabilities?.includes(LLMCapability.ImageGeneration) && (
                  <ImageGenerationPanel
                    isOpen={true}
                    nodeId={fullscreenChatNodeId || null}
                    workflowNodes={workflowNodesForPanels as any}
                    llmConfigs={llmConfigs}
                    onClose={handleCloseSidePanel}
                    onImageGenerated={() => {}}
                    onOpenImageModificationPanel={() => {}}
                    hideSlideOver={true}
                  />
                )}

                {activeSidePanel === 'video' && agent?.capabilities?.includes(LLMCapability.VideoGeneration) && (
                  <VideoGenerationConfigPanel
                    isOpen={true}
                    nodeId={fullscreenChatNodeId || undefined}
                    llmConfigs={llmConfigs}
                    onClose={handleCloseSidePanel}
                    hideSlideOver={true}
                  />
                )}

                {activeSidePanel === 'maps' && agent?.capabilities?.includes(LLMCapability.MapsGrounding) && (
                  <MapsGroundingConfigPanel
                    isOpen={true}
                    nodeId={fullscreenChatNodeId || null}
                    workflowNodes={workflowNodesForPanels as any}
                    llmConfigs={llmConfigs}
                    onClose={handleCloseSidePanel}
                    hideSlideOver={true}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modal de confirmation de suppression */}
      <ConfirmationModal
        isOpen={showDeleteConfirm}
        title={t('confirm_delete_agent_title')}
        message={t('confirm_delete_agent_message', { agentName })}
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelDelete}
        confirmText={t('confirm_delete')}
        cancelText={t('cancel')}
        variant="danger"
      />
    </div>
  );
};