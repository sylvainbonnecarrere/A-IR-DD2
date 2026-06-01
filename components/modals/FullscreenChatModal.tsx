import React, { useState, useRef, useEffect } from 'react';
import { Button } from '../UI';
import { CloseIcon, UploadIcon, SendIcon, ImageIcon, EditIcon, ExpandIcon, ErrorIcon, HistorySynthesisIcon } from '../Icons';
import { ToolCallBlock } from '../workflow/ToolCallBlock';
import { useRuntimeStore } from '../../stores/useRuntimeStore';
import { selectResolvedAgentHasToolNamed, useDesignStore } from '../../stores/useDesignStore';
import { useFunctionStore } from '../../stores/useFunctionStore';
import { useAgentChat } from '../../hooks/useAgentChat';
import { useLocalization } from '../../hooks/useLocalization';
import { useAuth } from '../../contexts/AuthContext';
import { ChatMessage, Agent, LLMCapability, WorkflowNode, AgentInstance, MapsPanelPreloadedResults } from '../../types';
import { ConfirmationModal } from './ConfirmationModal';
import { WebSearchParamsModal } from './WebSearchParamsModal';
import { ImageGenerationPanel } from '../panels/ImageGenerationPanel';
import { VideoGenerationConfigPanel } from '../panels/VideoGenerationConfigPanel';
import { MapsGroundingConfigPanel } from '../panels/MapsGroundingConfigPanel';
import { mapPersistedChatMessages, mergePersistedAndRuntimeMessages } from '../../services/persistedChatMessages';
import { persistInstanceWebSearchParams } from '../../services/webSearchParamsConfigService';
import apiClient from '../../utils/apiClient';
import { shouldSuppressVisualToolResult } from '../../utils/toolResultVisibility';
import { generateRuntimeMessageId } from '../../utils/runtimeMessageId';

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
  onOpenMapsPanel?: (nodeId: string, preloadedResults?: MapsPanelPreloadedResults) => void;
  onOpenFullscreen?: (imageBase64: string, mimeType: string) => void;
  onOpenImageModificationPanel?: (nodeId: string, sourceImage: string, agent?: Agent, agentInstance?: AgentInstance, mimeType?: string) => void;
  onImageGenerated?: (nodeId: string, imageBase64: string) => void;
}

export const FullscreenChatModal: React.FC<FullscreenChatModalProps> = ({
  onDeleteNode,
  onOpenImagePanel,
  onOpenVideoPanel,
  onOpenMapsPanel,
  onOpenFullscreen,
  onOpenImageModificationPanel,
  onImageGenerated
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

  const { agents, agentInstances, updateInstanceConfig } = useDesignStore();
  const functions = useFunctionStore((state) => state.functions);
  const { t } = useLocalization();
  const { isAuthenticated, accessToken } = useAuth();

  const [userInput, setUserInput] = useState('');
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showThinking, setShowThinking] = useState(true);
  const [webFetchEnabled, setWebFetchEnabled] = useState(false);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [activeSidePanel, setActiveSidePanel] = useState<'none' | 'image' | 'video' | 'maps'>('none');
  const [isWebSearchParamsModalOpen, setIsWebSearchParamsModalOpen] = useState(false);
  const [isSavingWebSearchParams, setIsSavingWebSearchParams] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const inferredInstanceId = React.useMemo(() => {
    if (fullscreenChatAgentInstance?.id) {
      return fullscreenChatAgentInstance.id;
    }

    if (!fullscreenChatNodeId) {
      return null;
    }

    const exactMatch = agentInstances.find(inst => inst.id === fullscreenChatNodeId);
    if (exactMatch) {
      return exactMatch.id;
    }

    const normalizedNodeId = fullscreenChatNodeId.replace(/^node-/, '');
    const prefixedMatch = agentInstances.find(inst => inst.id === normalizedNodeId);
    return prefixedMatch?.id ?? null;
  }, [fullscreenChatAgentInstance, fullscreenChatNodeId, agentInstances]);

  // Read agentInstance from store (triggers re-render when config is updated)
  const agentInstance = inferredInstanceId
    ? agentInstances.find(inst => inst.id === inferredInstanceId) || fullscreenChatAgentInstance
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
        ...(agentInstance.configuration_json ?? {}),
        webSearchParams: agentInstance.configuration_json?.webSearchParams || agentPrototype.webSearchParams,
        historyConfig: agentInstance.configuration_json?.historyConfig 
          || agentPrototype.historyConfig
      }
    : agentPrototype || null;

  const hasWebSearchPyTool = useDesignStore((state) => selectResolvedAgentHasToolNamed(
    state,
    agentPrototype ?? fullscreenChatAgent,
    inferredInstanceId ?? undefined,
    functions,
    'web_search_py'
  ));

  const handleSaveWebSearchParams = async (webSearchParams: NonNullable<Agent['webSearchParams']>) => {
    if (!agentInstance?.id || !agentInstance.configuration_json) {
      return;
    }

    setIsSavingWebSearchParams(true);

    try {
      const updatedConfig = {
        ...agentInstance.configuration_json,
        webSearchParams,
      };

      await persistInstanceWebSearchParams(
        { ...agentInstance, configuration_json: updatedConfig },
        webSearchParams,
        accessToken
      );

      updateInstanceConfig(agentInstance.id, updatedConfig);
      setIsWebSearchParamsModalOpen(false);
    } finally {
      setIsSavingWebSearchParams(false);
    }
  };
  
  const instanceId = agentInstance?.id;

  const { handleSendMessage: sendMessageToLLM, loadingMessage, isHistorySynthesisActive } = useAgentChat({
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
      if (!instanceId || !isAuthenticated || !fullscreenChatNodeId) {
        return;
      }

      try {
        const response = await apiClient.get<{ chatMessages?: any[] }>(`/api/agent-instances/${instanceId}`);
        const persistedMessages = mapPersistedChatMessages(response.data?.chatMessages || []);

        if (persistedMessages.length > 0) {
          const existingMessages = getNodeMessages(fullscreenChatNodeId) || [];
          const mergedMessages = mergePersistedAndRuntimeMessages(persistedMessages, existingMessages);
          setNodeMessages(fullscreenChatNodeId, mergedMessages);
        }
      } catch {
        // Don't block UI - continue without history if load fails.
      }
    };

    loadChatHistoryFromBackend();
  }, [instanceId, fullscreenChatNodeId, isAuthenticated, getNodeMessages, setNodeMessages]);

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
  
  const llmDisplayString = `${agentProvider} • ${agentModel}`;

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
    const isToolResult = message.sender === 'tool_result';
    const isToolCall = message.sender === 'tool';
    const suppressToolResult = shouldSuppressVisualToolResult(message, messages);

    if (suppressToolResult) {
      return null;
    }

    return (
      <div key={message.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
        {isToolCall && message.toolCallRecord && (
          <div className="w-full mr-12">
            <ToolCallBlock toolCall={message.toolCallRecord} defaultExpanded={false} />
          </div>
        )}

        {isToolResult && (
          <div className="max-w-3xl mr-12 w-full">
            <div className="mb-2 p-2 bg-gray-800 rounded-lg border border-gray-600">
              <div className="flex items-center mb-1">
                <ErrorIcon className={`w-4 h-4 mr-2 ${isError ? 'text-red-400' : 'text-green-400'}`} />
                <span className="text-xs font-semibold text-gray-300">
                  {isError ? t('tool_error') : t('tool_result')}: {message.toolName}
                </span>
              </div>
              <div className="text-xs text-gray-400 font-mono bg-gray-900 p-2 rounded break-words overflow-wrap-anywhere whitespace-pre-wrap">
                {message.text}
              </div>
            </div>
          </div>
        )}

        {!isToolResult && !isToolCall && (
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
            <div className="mt-2 relative group">
              <img
                src={`data:${message.mimeType};base64,${message.image}`}
                alt="Uploaded content"
                className="max-w-sm rounded cursor-pointer"
              />
              
              {/* Overlay buttons - appear on hover with gaming style */}
              <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 
                            transition-opacity duration-200 rounded flex items-center justify-center gap-3">
                {/* Fullscreen button */}
                <button
                  onClick={() => onOpenFullscreen?.(message.image!, message.mimeType || 'image/png')}
                  className="p-3 bg-cyan-500/20 hover:bg-cyan-500/40 border-2 border-cyan-400/50 
                           hover:border-cyan-400 rounded-lg transition-all duration-200 
                           hover:scale-110 hover:shadow-lg hover:shadow-cyan-500/50
                           text-cyan-300 hover:text-cyan-100"
                  title={t('fullscreen')}
                >
                  <ExpandIcon width={20} height={20} />
                </button>

                {/* Edit button - only if agent has ImageModification capability */}
                {agent?.capabilities?.includes(LLMCapability.ImageModification) && (
                  <button
                    onClick={() => {
                      if (fullscreenChatNodeId && onOpenImageModificationPanel) {
                        onOpenImageModificationPanel(fullscreenChatNodeId, message.image!, fullscreenChatAgent, fullscreenChatAgentInstance, message.mimeType || 'image/png');
                      } else {
                        console.warn('[FullscreenChatModal] Cannot call onOpenImageModificationPanel:', { 
                          hasNodeId: !!fullscreenChatNodeId, 
                          hasCallback: !!onOpenImageModificationPanel 
                        });
                      }
                    }}
                    className="p-3 bg-purple-500/20 hover:bg-purple-500/40 border-2 border-purple-400/50 
                             hover:border-purple-400 rounded-lg transition-all duration-200 
                             hover:scale-110 hover:shadow-lg hover:shadow-purple-500/50
                             text-purple-300 hover:text-purple-100"
                    title={t('edit_image')}
                  >
                    <EditIcon width={20} height={20} />
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
        )}
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
                      {isHistorySynthesisActive && (
                        <HistorySynthesisIcon data-testid="history-synthesis-icon" className="w-4 h-4 text-cyan-300 animate-pulse" />
                      )}
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

                {hasWebSearchPyTool && (
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-9 rounded-lg border border-sky-300/35 bg-[linear-gradient(135deg,rgba(10,37,64,0.96),rgba(17,94,145,0.88)_52%,rgba(148,210,255,0.2))] px-3 text-sky-50 hover:border-sky-200/60 hover:bg-[linear-gradient(135deg,rgba(12,48,79,0.98),rgba(14,116,144,0.92)_56%,rgba(186,230,253,0.28))] hover:text-white hover:shadow-[0_0_18px_rgba(125,211,252,0.35)] transition-all duration-200 text-sm font-medium"
                    onClick={() => setIsWebSearchParamsModalOpen(true)}
                    disabled={isLoading}
                    title="Paramètres Web Search de l'agent"
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
            <div className="w-96 flex flex-col border-l border-cyan-500 bg-gray-800/90 backdrop-blur-sm overflow-hidden transition-all duration-500 ease-in-out transform translate-x-0 opacity-100 shadow-[-10px_0_30px_-10px_rgba(6,182,212,0.3)]">
              
              {/* Side Panel Content - Scrollable (No Header - let child components manage it) */}
              <div className="flex-1 overflow-y-auto">
                {activeSidePanel === 'image' && agent?.capabilities?.includes(LLMCapability.ImageGeneration) && (
                  <ImageGenerationPanel
                    isOpen={true}
                    nodeId={fullscreenChatNodeId || null}
                    agent={agent}
                    agentInstance={agentInstance}
                    llmConfigs={llmConfigs}
                    onClose={handleCloseSidePanel}
                    onImageGenerated={(nodeId: string, imageBase64: string) => {
                      if (onImageGenerated) {
                        onImageGenerated(nodeId, imageBase64);
                        return;
                      }

                      const imageMessage: ChatMessage = {
                        id: generateRuntimeMessageId('image'),
                        sender: 'agent',
                        text: t('app_generatedImageText'),
                        image: imageBase64,
                        mimeType: 'image/png',
                        timestamp: new Date()
                      };

                      addNodeMessage(nodeId, imageMessage);
                    }}
                    onOpenImageModificationPanel={(nodeId: string, sourceImage: string, agent?: Agent, agentInstance?: AgentInstance, mimeType?: string) => {
                      onOpenImageModificationPanel?.(nodeId, sourceImage, agent, agentInstance, mimeType);
                    }}
                    hideSlideOver={true}
                  />
                )}

                {activeSidePanel === 'video' && agent?.capabilities?.includes(LLMCapability.VideoGeneration) && (
                  <VideoGenerationConfigPanel
                    isOpen={true}
                    onClose={handleCloseSidePanel}
                    hideSlideOver={true}
                  />
                )}

                {activeSidePanel === 'maps' && agent?.capabilities?.includes(LLMCapability.MapsGrounding) && (
                  <MapsGroundingConfigPanel
                    isOpen={true}
                    nodeId={fullscreenChatNodeId || null}
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

      <WebSearchParamsModal
        isOpen={isWebSearchParamsModalOpen}
        agentName={agentName}
        initialParams={agentInstance?.configuration_json?.webSearchParams || agent?.webSearchParams}
        isSaving={isSavingWebSearchParams}
        onClose={() => setIsWebSearchParamsModalOpen(false)}
        onSave={handleSaveWebSearchParams}
      />

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