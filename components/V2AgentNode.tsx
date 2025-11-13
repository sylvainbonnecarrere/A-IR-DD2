import React, { useState, useRef, useEffect } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { Agent, ChatMessage, LLMConfig, LLMCapability, LLMProvider, ToolCall, AgentInstance } from '../types';
import { Button } from './UI';
import { CloseIcon, EditIcon, SendIcon, UploadIcon, ImageIcon, ErrorIcon, ExpandIcon } from './Icons';
import { ConfirmationModal } from './modals/ConfirmationModal';
import { useRuntimeStore } from '../stores/useRuntimeStore';
import { useDesignStore } from '../stores/useDesignStore';
import { useWorkflowCanvasContext } from '../contexts/WorkflowCanvasContext';
import * as llmService from '../services/llmService';
import { fileToBase64, fileToText } from '../utils/fileUtils';
import { executeTool } from '../utils/toolExecutor';
import { countTokens, countWords, countSentences, countMessages } from '../utils/textUtils';
import { useLocalization } from '../hooks/useLocalization';

// Temporary minimize icon
const MinimizeIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
    <line x1="5" y1="12" x2="19" y2="12"></line>
  </svg>
);

// Tool icon for status messages
const ToolIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path>
  </svg>
);

export interface V2AgentNodeData {
  robotId: string;
  label: string;
  agent: Agent; // The prototype
  agentInstance?: AgentInstance; // The instance data
  isMinimized?: boolean;
}

export const V2AgentNode: React.FC<NodeProps<V2AgentNodeData>> = ({ data, id, selected }) => {
  const { t } = useLocalization();
  const { agent, agentInstance, isMinimized = false } = data;

  // Protection critique : si agent est null, afficher un fallback
  if (!agent) {
    return (
      <div className="min-w-80 bg-red-900/50 border-2 border-red-500 rounded-lg p-4">
        return (
        <div className="text-red-300 font-medium">{t('agent_not_found')}</div>
        );
        <div className="text-red-400 text-sm mt-2">
          ID Node: {id}
        </div>
      </div>
    );
  }

  // Use instance name if available, otherwise use prototype name with null safety
  const displayName = agentInstance?.name || agent?.name || 'Unknown Agent';

  // Runtime store for messages and execution state
  const {
    getNodeMessages,
    addNodeMessage,
    setNodeMessages,
    isNodeExecuting,
    setNodeExecuting,
    setImagePanelOpen,
    setImageModificationPanelOpen,
    setFullscreenImage,
    setFullscreenChatNodeId,
    llmConfigs
  } = useRuntimeStore();

  // WorkflowCanvas context for navigation and node operations
  const {
    navigationHandler,
    onDeleteNode,
    onToggleNodeMinimize,
    onUpdateNodePosition,
    onOpenImagePanel,
    onOpenImageModificationPanel,
    onOpenFullscreen
  } = useWorkflowCanvasContext();

  // Design store for agent data (not node operations)
  const { selectAgent } = useDesignStore();

  // Local states
  const [userInput, setUserInput] = useState('');
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Get messages from store
  const messages = getNodeMessages(id);
  const isLoading = isNodeExecuting(id);

  // Auto-scroll to bottom
  useEffect(() => {
    if (!isMinimized) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isMinimized]);

  const handleToggleMinimize = () => {
    if (onToggleNodeMinimize) {
      onToggleNodeMinimize(id);
    }
  };

  const handleDelete = () => {
    // Libérer le focus avant d'ouvrir le modal
    (document.activeElement as HTMLElement)?.blur();
    setShowDeleteConfirm(true);
  };

  const handleConfirmDelete = () => {
    if (onDeleteNode) {
      onDeleteNode(id);
    }
    setShowDeleteConfirm(false);
  };

  const handleCancelDelete = () => {
    setShowDeleteConfirm(false);
    // Forcer le focus sur le canvas après annulation
    setTimeout(() => {
      (document.activeElement as HTMLElement)?.blur();
    }, 100);
  };

  const handleEdit = () => {
    // Navigate to ArchiPrototypingPage with the prototype selected
    if (navigationHandler && agent) {
      // Set the selected agent in the design store
      selectAgent(agent.id);
      // Navigate to Archi prototyping page
      navigationHandler('archi', '/prototyping');
    }
  };

  const handleFullscreen = () => {
    // Open fullscreen chat modal for this node
    setFullscreenChatNodeId(id);
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedInput = userInput.trim();
    if (!trimmedInput && !attachedFile) return;

    // Protection null safety pour agent
    if (!agent) {
      console.error('Agent is null, cannot send message');
      return;
    }

    setNodeExecuting(id, true);

    const userMessage: ChatMessage = {
      id: `msg-${Date.now()}`,
      sender: 'user',
      text: trimmedInput,
    };

    // Handle file attachment
    if (attachedFile) {
      userMessage.filename = attachedFile.name;
      userMessage.mimeType = attachedFile.type;

      if (agent.llmProvider === LLMProvider.Mistral) {
        try {
          userMessage.fileContent = await fileToText(attachedFile);
        } catch (err) {
          userMessage.image = await fileToBase64(attachedFile);
        }
      } else {
        userMessage.image = await fileToBase64(attachedFile);
      }
    }

    addNodeMessage(id, userMessage);
    setUserInput('');
    setAttachedFile(null);

    // Get LLM config
    // llmConfigs now from hook above
    const agentConfig = llmConfigs?.find(c => c.provider === agent.llmProvider);

    if (!agentConfig?.enabled || !agentConfig.apiKey) {
      const errorMessage: ChatMessage = {
        id: `msg-${Date.now()}`,
        sender: 'agent',
        text: `Erreur: ${agent.llmProvider} n'est pas configuré ou activé.`,
        isError: true
      };
      addNodeMessage(id, errorMessage);
      setNodeExecuting(id, false);
      return;
    }

    try {
      // Gestion de l'historique avec messages d'information
      let conversationHistoryForAPI: ChatMessage[];
      const historyConfig = agent.historyConfig;
      const currentFullHistory = [...messages, userMessage];

      if (historyConfig?.enabled && messages.length > 0) {
        const { limits } = historyConfig;
        const stats = {
          tokens: countTokens(currentFullHistory),
          words: countWords(currentFullHistory),
          sentences: countSentences(currentFullHistory),
          messages: countMessages(currentFullHistory),
        };

        const shouldSummarize = stats.tokens >= limits.token ||
          stats.words >= limits.word ||
          stats.sentences >= limits.sentence ||
          stats.messages >= limits.message;

        if (shouldSummarize) {
          setLoadingMessage(t('agentNode_history_summarizing'));
          const summarizationConfig = llmConfigs.find(c => c.provider === historyConfig.llmProvider);

          if (!summarizationConfig) {
            throw new Error(`Summarization LLM ${historyConfig.llmProvider} not configured.`);
          }

          const summarizationPrompt = `${t('conversation_to_summarize')}:\n\n${currentFullHistory.map(m => `${m.sender}: ${m.text}`).join('\n')}`;
          const summarizationHistory: ChatMessage[] = [{
            id: `msg-summary-prompt-${Date.now()}`,
            sender: 'user',
            text: summarizationPrompt
          }];

          const { text: summary } = await llmService.generateContent(
            summarizationConfig.provider,
            summarizationConfig.apiKey,
            historyConfig.model,
            historyConfig.systemPrompt,
            summarizationHistory
          );

          const summaryMessage: ChatMessage = {
            id: `msg-${Date.now()}-summary`,
            sender: 'agent',
            text: `(Résumé de l'historique): ${summary}`
          };

          conversationHistoryForAPI = [summaryMessage, userMessage];
          setNodeMessages(id, [summaryMessage, userMessage]);
          setLoadingMessage('');
        } else {
          conversationHistoryForAPI = currentFullHistory;
        }
      } else {
        conversationHistoryForAPI = historyConfig?.enabled ? currentFullHistory : [userMessage];
      }
      // Stream LLM response
      const stream = llmService.generateContentStream(
        agent.llmProvider,
        agentConfig.apiKey,
        agent.model,
        agent.systemPrompt,
        messages.concat(userMessage),
        agent.tools,
        agent.outputConfig
      );

      let currentResponse = '';
      let agentMessageId = `msg-${Date.now()}-agent`;
      let toolCalls: ToolCall[] = [];

      for await (const chunk of stream) {
        if (chunk.error) {
          const errorMessage: ChatMessage = {
            id: agentMessageId,
            sender: 'agent',
            text: chunk.error,
            isError: true
          };
          addNodeMessage(id, errorMessage);
          break;
        }

        // Handle text response
        if (chunk.response && 'text' in chunk.response && chunk.response.text) {
          currentResponse += chunk.response.text;
          // Update existing message or create new one
          const existingMessages = getNodeMessages(id);
          const existingAgentMessage = existingMessages.find(m => m.id === agentMessageId);

          if (existingAgentMessage) {
            setNodeMessages(id, existingMessages.map(m =>
              m.id === agentMessageId ? { ...m, text: currentResponse } : m
            ));
          } else {
            const newMessage: ChatMessage = {
              id: agentMessageId,
              sender: 'agent',
              text: currentResponse
            };
            addNodeMessage(id, newMessage);
          }
        }

        // Handle tool calls
        if (chunk.response && 'toolCalls' in chunk.response && chunk.response.toolCalls) {
          toolCalls = chunk.response.toolCalls;
          const toolMessage: ChatMessage = {
            id: agentMessageId,
            sender: 'agent',
            text: currentResponse,
            toolCalls,
            status: 'executing_tool'
          };

          const existingMessages = getNodeMessages(id);
          setNodeMessages(id, existingMessages.map(m =>
            m.id === agentMessageId ? toolMessage : m
          ));
        }
      }

      // Execute tools if any
      if (toolCalls.length > 0) {
        for (const toolCall of toolCalls) {
          try {
            const toolResult = await executeTool(toolCall);
            const toolResultMessage: ChatMessage = {
              id: `msg-${Date.now()}-tool-result`,
              sender: 'tool_result',
              text: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult),
              toolCallId: toolCall.id,
              toolName: toolCall.name
            };
            addNodeMessage(id, toolResultMessage);
          } catch (error) {
            const errorMessage: ChatMessage = {
              id: `msg-${Date.now()}-tool-error`,
              sender: 'tool_result',
              text: `Erreur: ${error instanceof Error ? error.message : String(error)}`,
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              isError: true
            };
            addNodeMessage(id, errorMessage);
          }
        }

        // Remove executing_tool status after all tools are executed
        const existingMessages = getNodeMessages(id);
        setNodeMessages(id, existingMessages.map(m =>
          m.status === 'executing_tool' ? { ...m, status: undefined } : m
        ));

        // If agent has Chat capability, continue generation with tool results
        if (agent?.capabilities?.includes(LLMCapability.Chat)) {
          setLoadingMessage(t('analyzing_results'));

          // Get updated message history including tool results
          const updatedMessages = getNodeMessages(id);

          // Filter out tool_result messages for the follow-up call and create a synthetic user message
          // that contains the tool results as context
          const messagesWithoutToolResults = updatedMessages.filter(m => m.sender !== 'tool_result');

          // Collect tool results for context
          const toolResults = updatedMessages.filter(m => m.sender === 'tool_result');

          if (toolResults.length > 0) {
            // Create a synthetic message that provides tool results as context
            const toolResultsSummary = toolResults.map(tr =>
              `${t('tool_result_from')} ${tr.toolName}: ${tr.text}`
            ).join('\n\n'); const contextMessage: ChatMessage = {
              id: `msg-${Date.now()}-tool-context`,
              sender: 'user',
              text: `${t('tool_results_context')}:\n\n${toolResultsSummary}\n\n${t('analyze_results_request')}`
            };

            messagesWithoutToolResults.push(contextMessage);
          }

          // Generate a follow-up response using the tool results as context
          const followUpStream = llmService.generateContentStream(
            agent.llmProvider,
            agentConfig.apiKey,
            agent.model,
            agent.systemPrompt,
            messagesWithoutToolResults,
            agent.tools,
            agent.outputConfig
          );

          let followUpResponse = '';
          let followUpMessageId = `msg-${Date.now()}-followup`;

          for await (const chunk of followUpStream) {
            if (chunk.error) {
              const errorMessage: ChatMessage = {
                id: followUpMessageId,
                sender: 'agent',
                text: chunk.error,
                isError: true
              };
              addNodeMessage(id, errorMessage);
              break;
            }

            if (chunk.response && 'text' in chunk.response && chunk.response.text) {
              followUpResponse += chunk.response.text;

              const existingFollowUpMessages = getNodeMessages(id);
              const existingFollowUpMessage = existingFollowUpMessages.find(m => m.id === followUpMessageId);

              if (existingFollowUpMessage) {
                setNodeMessages(id, existingFollowUpMessages.map(m =>
                  m.id === followUpMessageId ? { ...m, text: followUpResponse } : m
                ));
              } else {
                const newFollowUpMessage: ChatMessage = {
                  id: followUpMessageId,
                  sender: 'agent',
                  text: followUpResponse
                };
                addNodeMessage(id, newFollowUpMessage);
              }
            }
          }
        }
      }

    } catch (error) {
      const errorMessage: ChatMessage = {
        id: `msg-${Date.now()}`,
        sender: 'agent',
        text: `Erreur: ${error instanceof Error ? error.message : String(error)}`,
        isError: true
      };
      addNodeMessage(id, errorMessage);
    } finally {
      setNodeExecuting(id, false);
      setLoadingMessage('');
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setAttachedFile(file);
    }
  };

  const handleOpenImagePanel = () => {
    if (onOpenImagePanel) {
      onOpenImagePanel(id);
    }
  };

  const handleImageClick = (imageBase64: string, mimeType: string) => {
    // Cette fonction est maintenant utilisée pour le bouton fullscreen dans l'overlay
    // On ne fait rien ici car le fullscreen est géré par App.tsx via setFullscreenImage
    console.log('Image clicked - fullscreen handled by overlay button');
  };

  const handleOpenFullscreenImage = (imageBase64: string, mimeType: string) => {
    if (onOpenFullscreen) {
      onOpenFullscreen(imageBase64, mimeType);
    }
  };

  const handleEditImage = (imageBase64: string, mimeType: string) => {
    if (onOpenImageModificationPanel) {
      onOpenImageModificationPanel(id, imageBase64, mimeType);
    }
  };

  const renderMessage = (message: ChatMessage) => {
    const isUser = message.sender === 'user';
    const isError = message.isError;
    const isToolResult = message.sender === 'tool_result';

    return (
      <div key={message.id} className={`mb-3 ${isUser ? 'ml-4' : 'mr-4'}`}>
        {/* Tool result message */}
        {isToolResult && (
          <div className="mb-2 p-2 bg-gray-800 rounded-lg border border-gray-600">
            <div className="flex items-center mb-1">
              <ErrorIcon className={`w-4 h-4 mr-2 ${isError ? 'text-red-400' : 'text-green-400'}`} />
              <span className="text-xs font-semibold text-gray-300">
                {isError ? t('tool_error') : t('tool_result')}: {message.toolName}
              </span>
            </div>
            <div className="text-xs text-gray-400 font-mono bg-gray-900 p-2 rounded break-words overflow-wrap-anywhere">
              {message.text}
            </div>
          </div>
        )}

        {/* Regular message */}
        {!isToolResult && (
          <div className={`
            inline-block max-w-[90%] p-3 rounded-lg text-sm
            ${isUser
              ? 'bg-indigo-600 text-white ml-auto'
              : isError
                ? 'bg-red-900/50 text-red-200 border border-red-600'
                : 'bg-gray-700 text-gray-100'
            }
          `}>
            {/* Image preview with overlay buttons */}
            {message.image && (
              <div className="mb-2 relative group">
                <img
                  src={`data:${message.mimeType};base64,${message.image}`}
                  alt="Image"
                  className="max-w-full h-auto rounded"
                />

                {/* Overlay buttons - appear on hover with gaming style */}
                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 
                              transition-opacity duration-200 rounded flex items-center justify-center gap-3">
                  {/* Fullscreen button */}
                  <button
                    onClick={() => handleOpenFullscreenImage(message.image!, message.mimeType || 'image/png')}
                    className="p-3 bg-cyan-500/20 hover:bg-cyan-500/40 border-2 border-cyan-400/50 
                             hover:border-cyan-400 rounded-lg transition-all duration-200 
                             hover:scale-110 hover:shadow-lg hover:shadow-cyan-500/50
                             text-cyan-300 hover:text-cyan-100"
                    title={t('fullscreen')}
                  >
                    <ExpandIcon width={20} height={20} />
                  </button>

                  {/* Edit button - only if agent has ImageModification capability */}
                  {agent.capabilities?.includes(LLMCapability.ImageModification) && (
                    <button
                      onClick={() => handleEditImage(message.image!, message.mimeType || 'image/png')}
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

            {/* Text content */}
            <div className="whitespace-pre-wrap break-words">
              {message.text}
            </div>

            {/* Tool calls info */}
            {message.toolCalls && message.toolCalls.length > 0 && (
              <div className="mt-2 space-y-1">
                {message.toolCalls.map((call) => (
                  <div key={call.id} className="flex items-center">
                    <p className={`text-xs font-semibold text-gray-400 flex items-center ${message.status === 'executing_tool' ? 'animate-pulse' : ''
                      }`}>
                      <ToolIcon className={`w-3 h-3 mr-1 ${message.status === 'executing_tool' ? 'animate-spin' : ''
                        }`} />
                      {message.status === 'executing_tool'
                        ? `${t('executing_tool')} ${call.name}...`
                        : t('tool_called')
                      }
                    </p>
                    {message.status !== 'executing_tool' && (
                      <span className="ml-2 font-mono text-xs text-amber-300 bg-gray-800 px-1 rounded">
                        {call.name}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* File info */}
            {message.filename && (
              <div className="mt-1 text-xs text-gray-400">
                📎 {message.filename}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      className={`
      bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 
      border border-gray-600 rounded-lg shadow-lg 
      transition-all duration-300 ease-out
      relative overflow-hidden
      ${selected ?
          'border-cyan-400 shadow-cyan-400/40 shadow-2xl' :
          'border-gray-600 hover:border-gray-500'
        }
      ${isMinimized ? 'w-64' : 'w-96'}
      group
      hover:shadow-2xl hover:shadow-cyan-500/20
      before:absolute before:inset-0 before:bg-gradient-to-br 
      before:from-cyan-500/5 before:via-transparent before:to-blue-500/5 
      before:opacity-0 hover:before:opacity-100 before:transition-opacity before:duration-300
    `}
      onMouseDown={(e) => {
        // Permettre les clics sur boutons ET la navigation canvas
        const target = e.target as HTMLElement;
        // Ne stopper la propagation QUE pour textarea/input (pas les boutons)
        if (target.closest('textarea, input:not([type="file"])')) {
          e.stopPropagation();
        }
        // Les boutons et le reste du canvas fonctionnent normalement
      }}
    >
      {/* Laser border effect on hover */}
      <div className="absolute inset-0 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300">
        <div className="absolute inset-[1px] rounded-lg bg-gradient-to-r from-cyan-500/20 via-blue-500/20 to-purple-500/20 animate-pulse"></div>
      </div>

      {/* Input Handle with glow effect */}
      <Handle
        type="target"
        position={Position.Left}
        className="w-3 h-3 bg-cyan-400 border-2 border-cyan-300 
                   shadow-lg shadow-cyan-400/50
                   hover:bg-cyan-300 hover:shadow-cyan-300/70 
                   transition-all duration-200
                   relative z-10"
      />

      {/* Header - zone de titre draggable avec classe spéciale */}
      <div className="flex items-center justify-between p-3 border-b border-gray-700/80 
                      bg-gradient-to-r from-gray-900/80 via-gray-800/60 to-gray-900/80 
                      rounded-t-lg cursor-move drag-handle
                      backdrop-blur-sm relative z-10
                      hover:from-gray-800/90 hover:via-gray-700/70 hover:to-gray-800/90
                      transition-all duration-300">
        <div className="flex items-center space-x-2">
          <div className={`w-2 h-2 rounded-full shadow-lg transition-all duration-200 ${isLoading
            ? 'bg-yellow-400 animate-pulse shadow-yellow-400/60'
            : 'bg-green-400 shadow-green-400/60 group-hover:shadow-green-400/80'
            }`}></div>
          <h3 className="font-semibold text-white truncate 
                         group-hover:text-cyan-100 transition-colors duration-200">
            {displayName}
          </h3>
        </div>

        <div className="flex items-center space-x-1">
          <Button
            variant="ghost"
            className="p-1 h-6 w-6 text-gray-400 hover:text-blue-400 
                       hover:bg-blue-500/20 hover:shadow-lg hover:shadow-blue-500/40
                       transition-all duration-200 rounded-md
                       hover:scale-110 active:scale-95"
            onClick={handleToggleMinimize}
          >
            <MinimizeIcon width={12} height={12} />
          </Button>
          <Button
            variant="ghost"
            className="p-1 h-6 w-6 text-gray-400 hover:text-yellow-400 
                       hover:bg-yellow-500/20 hover:shadow-lg hover:shadow-yellow-500/40
                       transition-all duration-200 rounded-md
                       hover:scale-110 active:scale-95"
            onClick={handleEdit}
          >
            <EditIcon width={12} height={12} />
          </Button>
          <Button
            variant="ghost"
            className="p-1 h-6 w-6 text-gray-400 hover:text-green-400 
                       hover:bg-green-500/20 hover:shadow-lg hover:shadow-green-500/40
                       transition-all duration-200 rounded-md
                       hover:scale-110 active:scale-95"
            onClick={handleFullscreen}
            title={t('open_fullscreen')}
          >
            <ExpandIcon width={12} height={12} />
          </Button>
          <Button
            variant="ghost"
            className="p-1 h-6 w-6 text-gray-400 hover:text-red-400 
                       hover:bg-red-500/20 hover:shadow-lg hover:shadow-red-500/40
                       transition-all duration-200 rounded-md
                       hover:scale-110 active:scale-95"
            onClick={handleDelete}
          >
            <CloseIcon width={12} height={12} />
          </Button>
        </div>
      </div>

      {/* Content - Chat area without drag handle to allow text selection */}
      {!isMinimized && (
        <div className="flex flex-col h-96 relative z-10">
          {/* Agent Info - NOT draggable with enhanced styling */}
          <div className="p-3 border-b border-gray-700/50 
                          bg-gradient-to-r from-gray-900/40 via-gray-800/30 to-gray-900/40
                          backdrop-blur-sm">
            <div className="text-xs text-gray-400 mb-1 select-text 
                            group-hover:text-gray-300 transition-colors duration-200">
              {agent?.llmProvider || 'Unknown'} • {agent?.model || 'Unknown'}
            </div>
            <div className="text-sm text-cyan-400 font-medium select-text
                            group-hover:text-cyan-300 transition-colors duration-200
                            flex items-center space-x-2">
              <span>{agent?.role || 'Agent'}</span>
              <div className="w-1 h-1 bg-cyan-400 rounded-full animate-pulse"></div>
            </div>
          </div>

          {/* Messages - Text selectable avec nodrag pour empêcher complètement le drag */}
          <div
            className="flex-1 overflow-y-auto p-3 space-y-2 nodrag
                       scrollbar-thin scrollbar-track-gray-800/50 scrollbar-thumb-cyan-500/60 
                       hover:scrollbar-thumb-cyan-400/80 scrollbar-thumb-rounded-full
                       bg-gradient-to-b from-gray-900/20 to-gray-800/30"
            style={{ userSelect: 'text', cursor: 'text' }}
          >
            {messages.length === 0 && (
              <div className="text-center text-gray-500 text-sm" style={{ userSelect: 'text' }}>
                <div className="bg-gray-800/40 border border-gray-700/50 rounded-lg p-4
                                backdrop-blur-sm">
                  <p className="text-gray-400">{t('empty_conversation')}</p>
                  <p className="text-xs mt-1 text-gray-500">{t('type_message_start')}</p>
                  <div className="flex justify-center mt-2 space-x-1">
                    <div className="w-1 h-1 bg-cyan-400 rounded-full animate-pulse"></div>
                    <div className="w-1 h-1 bg-cyan-400 rounded-full animate-pulse delay-75"></div>
                    <div className="w-1 h-1 bg-cyan-400 rounded-full animate-pulse delay-150"></div>
                  </div>
                </div>
              </div>
            )}

            {messages.map(renderMessage)}

            {/* Loading message d'information système */}
            {isLoading && loadingMessage && (
              <div className="text-center text-xs text-gray-400 animate-pulse">
                {loadingMessage}
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input Area - nodrag pour empêcher le drag pendant la saisie */}
          <div className="p-3 border-t border-gray-700 nodrag">
            <form onSubmit={handleSendMessage} className="space-y-2">
              {/* File attachment preview */}
              {attachedFile && (
                <div className="flex items-center justify-between bg-gray-700 p-2 rounded text-xs">
                  <span>📎 {attachedFile.name}</span>
                  <button
                    type="button"
                    onClick={() => setAttachedFile(null)}
                    className="text-red-400 hover:text-red-300"
                  >
                    ×
                  </button>
                </div>
              )}

              {/* Input row */}
              <div className="flex items-end space-x-2">
                <div className="flex-1">
                  <textarea
                    value={userInput}
                    onChange={(e) => setUserInput(e.target.value)}
                    placeholder={t('type_message_placeholder')}
                    className="w-full bg-gray-800/80 border border-gray-600 rounded-lg p-3 text-sm text-white 
                               placeholder-gray-400 resize-none backdrop-blur-sm
                               focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/50 focus:outline-none
                               hover:border-gray-500 transition-all duration-200
                               focus:bg-gray-800/90 focus:shadow-lg focus:shadow-cyan-500/20"
                    rows={2}
                    disabled={isLoading}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendMessage(e);
                      }
                    }}
                  />
                </div>

                {/* Action buttons */}
                <div className="flex flex-col space-y-1">
                  {/* File upload */}
                  {agent?.capabilities?.includes(LLMCapability.FileUpload) && (
                    <Button
                      type="button"
                      variant="ghost"
                      className="p-2 h-8 w-8 text-gray-400 hover:text-blue-400 
                                 hover:bg-blue-500/20 hover:shadow-lg hover:shadow-blue-500/40
                                 transition-all duration-200 rounded-md
                                 hover:scale-110 active:scale-95"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isLoading}
                    >
                      <UploadIcon width={14} height={14} />
                    </Button>
                  )}

                  {/* Image generation/modification */}
                  {(agent?.capabilities?.includes(LLMCapability.ImageGeneration) ||
                    agent?.capabilities?.includes(LLMCapability.ImageModification)) && (
                      <Button
                        type="button"
                        variant="ghost"
                        className="p-2 h-8 w-8 text-gray-400 hover:text-purple-400 
                                 hover:bg-purple-500/20 hover:shadow-lg hover:shadow-purple-500/40
                                 transition-all duration-200 rounded-md
                                 hover:scale-110 active:scale-95"
                        onClick={handleOpenImagePanel}
                        disabled={isLoading}
                      >
                        <ImageIcon width={14} height={14} />
                      </Button>
                    )}

                  {/* Send - avec effet spécial quand actif */}
                  <Button
                    type="submit"
                    variant="ghost"
                    className={`p-2 h-8 w-8 transition-all duration-200 rounded-md
                                hover:scale-110 active:scale-95 ${isLoading || (!userInput.trim() && !attachedFile)
                        ? 'text-gray-500 cursor-not-allowed'
                        : 'text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/20 hover:shadow-lg hover:shadow-cyan-500/40 laser-glow'
                      }`}
                    disabled={isLoading || (!userInput.trim() && !attachedFile)}
                  >
                    <SendIcon width={14} height={14} />
                  </Button>
                </div>
              </div>
            </form>

            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              onChange={handleFileUpload}
              className="hidden"
              accept="image/*,text/*,.pdf,.doc,.docx"
            />
          </div>
        </div>
      )}

      {/* Output Handle with laser styling */}
      <Handle
        type="source"
        position={Position.Right}
        className="w-3 h-3 bg-cyan-400 border-2 border-cyan-300 
                   shadow-lg shadow-cyan-400/50
                   hover:bg-cyan-300 hover:shadow-cyan-300/70 
                   transition-all duration-200
                   relative z-10"
      />

      {/* Modal de confirmation de suppression - Sécurité : aucune info de configuration affichée */}
      <ConfirmationModal
        isOpen={showDeleteConfirm}
        title={t('confirm_delete_agent_title')}
        message={t('confirm_delete_agent_message', { agentName: displayName })}
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelDelete}
        confirmText={t('confirm_delete')}
        cancelText={t('cancel')}
        variant="danger"
      />
    </div>
  );
};