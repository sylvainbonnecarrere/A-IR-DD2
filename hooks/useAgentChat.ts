import { useState } from 'react';
import { Agent, ChatMessage, LLMConfig, LLMCapability, LLMProvider, ToolCall, ToolCallRecord } from '../types';
import { useRuntimeStore } from '../stores/useRuntimeStore';
import * as llmService from '../services/llmService';
import { fileToBase64, fileToText } from '../utils/fileUtils';
import { executeTool } from '../utils/toolExecutor';
import { countTokens, countWords, countSentences, countMessages } from '../utils/textUtils';
import { isLLMConfigured } from '../utils/llmProviderUtils';
import { resolveAgentRuntimeConfig, resolveHistoryRuntimeConfig } from '../services/runtimeConfigResolver';
// ⭐ AUTO-SAVE: Import persistence service for chat content
import { PersistenceService } from '../services/persistenceService';

// ⭐ J4.5: Global counter to ensure unique message IDs even if Date.now() returns same value
let messageIdCounter = 0;
const generateMessageId = (suffix?: string): string => {
    const id = `msg-${Date.now()}-${++messageIdCounter}${suffix ? `-${suffix}` : ''}`;
    return id;
};

interface UseAgentChatOptions {
    nodeId: string;
    agent: Agent | null;
    llmConfigs: LLMConfig[];
    t: (key: string) => string;
    nativeToolsConfig?: { webFetch?: boolean; webSearch?: boolean };
    // ⭐ AUTO-SAVE: Authentication context for persistent chat history
    instanceId?: string;
    isAuthenticated?: boolean;
    accessToken?: string | null;
}

interface UseAgentChatReturn {
    handleSendMessage: (userInput: string, attachedFile: File | null) => Promise<void>;
    loadingMessage: string;
}

/**
 * Hook réutilisable pour gérer l'envoi de messages et l'interaction avec le LLM
 * Principe SOLID : Single Responsibility - Ce hook gère UNIQUEMENT la logique de chat
 * Utilisé par V2AgentNode et FullscreenChatModal pour garantir un comportement identique
 * 
 * ⭐ AUTO-SAVE: Chat messages are automatically persisted to backend when authenticated
 */
export const useAgentChat = ({
    nodeId,
    agent,
    llmConfigs,
    t,
    nativeToolsConfig,
    instanceId,
    isAuthenticated = false,
    accessToken = null
}: UseAgentChatOptions): UseAgentChatReturn => {
    const {
        getNodeMessages,
        addNodeMessage,
        setNodeMessages,
        setNodeExecuting,
        localLLMProfiles,
    } = useRuntimeStore();

    const [loadingMessage, setLoadingMessage] = useState('');

    /**
     * ⭐ AUTO-SAVE: Persist chat message to backend immediately
     * Called after each addNodeMessage for authenticated users
     */
    const persistChatMessage = async (message: ChatMessage) => {
        if (!instanceId || !isAuthenticated || !accessToken) {
            return; // Skip for guest mode or missing instanceId
        }

        try {
            await PersistenceService.addAgentInstanceContent(
                instanceId,
                {
                    type: message.isError ? 'error' : 'chat',
                    role: message.sender,
                    message: message.text,
                    timestamp: new Date(),
                    metadata: {
                        messageId: message.id,
                        hasImage: !!message.image,
                        hasFile: !!message.filename,
                        toolCalls: message.toolCalls,
                        toolCallId: message.toolCallId,
                        toolName: message.toolName,
                        toolCallRecord: message.toolCallRecord,
                        isError: message.isError ?? false,
                    }
                },
                { isAuthenticated, accessToken }
            );
            console.log('[useAgentChat] ✅ Message persisted:', message.id);
        } catch (err) {
            console.warn('[useAgentChat] ⚠️ Failed to persist message:', err);
            // Don't block UI - message is in runtime state
        }
    };

    /**
     * Wrapper: Add message to runtime store AND persist to backend
     */
    const addAndPersistMessage = async (nodeId: string, message: ChatMessage) => {
        addNodeMessage(nodeId, message);
        await persistChatMessage(message);
    };

    const parseToolArguments = (rawArguments: string): Record<string, unknown> => {
        try {
            const parsed = JSON.parse(rawArguments);
            return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
        } catch {
            return {};
        }
    };

    const extractToolExecutionMetadata = (toolResult: unknown): Pick<ToolCallRecord, 'executionId' | 'runner' | 'exitCode' | 'failureKind' | 'artifacts'> => {
        if (!toolResult || typeof toolResult !== 'object') {
            return {};
        }

        const payload = toolResult as Record<string, unknown>;
        const executionId = typeof payload.executionId === 'string' ? payload.executionId : undefined;
        const runner = typeof payload.runner === 'string' ? payload.runner : undefined;
        const exitCode = typeof payload.exitCode === 'number' ? payload.exitCode : undefined;
        const failureKind = typeof payload.failureKind === 'string' ? payload.failureKind : undefined;
        const artifacts = Array.isArray(payload.artifacts)
            ? payload.artifacts.filter((artifact): artifact is { path: string; kind: 'file' | 'json' | 'log' } => {
                return !!artifact
                    && typeof artifact === 'object'
                    && typeof (artifact as Record<string, unknown>).path === 'string'
                    && ((artifact as Record<string, unknown>).kind === 'file'
                        || (artifact as Record<string, unknown>).kind === 'json'
                        || (artifact as Record<string, unknown>).kind === 'log');
            })
            : undefined;

        return { executionId, runner, exitCode, failureKind, artifacts };
    };

    const isToolErrorResult = (toolResult: unknown): boolean => {
        return !!toolResult
            && typeof toolResult === 'object'
            && 'error' in (toolResult as Record<string, unknown>);
    };

    const handleSendMessage = async (userInput: string, attachedFile: File | null) => {
        const trimmedInput = userInput.trim();
        if (!trimmedInput && !attachedFile) return;

        // Protection null safety pour agent
        if (!agent) {
            console.error('Agent is null, cannot send message');
            return;
        }

        setNodeExecuting(nodeId, true);

        const userMessage: ChatMessage = {
            id: generateMessageId('user'),
            sender: 'user',
            text: trimmedInput,
            timestamp: new Date(),
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

        await addAndPersistMessage(nodeId, userMessage);

        const agentRuntime = resolveAgentRuntimeConfig(agent, llmConfigs, localLLMProfiles);
        const agentConfig = agentRuntime.config;

        if (!isLLMConfigured(agentConfig, agent.llmProvider)) {
            const errorMessage: ChatMessage = {
                id: generateMessageId('error'),
                sender: 'agent',
                text: `Erreur: ${agent.llmProvider} n'est pas configuré ou activé.`,
                isError: true,
                timestamp: new Date()
            };
            await addAndPersistMessage(nodeId, errorMessage);
            setNodeExecuting(nodeId, false);
            return;
        }

        try {
            const messages = getNodeMessages(nodeId);

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
                    const summarizationRuntime = resolveHistoryRuntimeConfig(
                        historyConfig,
                        llmConfigs,
                        localLLMProfiles,
                        agent.localLLMProfileId
                    );
                    const summarizationConfig = summarizationRuntime.config;

                    if (!summarizationConfig) {
                        throw new Error(`Summarization LLM ${historyConfig.llmProvider} not configured.`);
                    }

                    const summarizationPrompt = `${t('conversation_to_summarize')}:\n\n${currentFullHistory.map(m => `${m.sender}: ${m.text}`).join('\n')}`;
                    const summarizationHistory: ChatMessage[] = [{
                        id: generateMessageId('summary-prompt'),
                        sender: 'user',
                        text: summarizationPrompt,
                        timestamp: new Date()
                    }];

                    const { text: summary } = await llmService.generateContent(
                        summarizationConfig.provider,
                        summarizationRuntime.credential,
                        historyConfig.model,
                        historyConfig.systemPrompt,
                        summarizationHistory,
                        undefined,
                        undefined,
                        summarizationRuntime.credential
                    );

                    const summaryMessage: ChatMessage = {
                        id: generateMessageId('summary'),
                        sender: 'agent',
                        text: `(Résumé de l'historique): ${summary}`,
                        timestamp: new Date()
                    };

                    conversationHistoryForAPI = [summaryMessage, userMessage];
                    setNodeMessages(nodeId, [summaryMessage, userMessage]);
                    setLoadingMessage('');
                } else {
                    conversationHistoryForAPI = currentFullHistory;
                }
            } else {
                conversationHistoryForAPI = historyConfig?.enabled ? currentFullHistory : [userMessage];
            }

            // Stream LLM response
            const credential = agentRuntime.credential;
            const stream = llmService.generateContentStream(
                agent.llmProvider,
                credential,
                agent.model,
                agent.systemPrompt,
                conversationHistoryForAPI,
                agent.tools,
                agent.outputConfig,
                credential,
                nativeToolsConfig
            );

            let currentResponse = '';
            let agentMessageId = generateMessageId('agent');
            let toolCalls: ToolCall[] = [];

            for await (const chunk of stream) {
                if (chunk.error) {
                    const errorMessage: ChatMessage = {
                        id: agentMessageId,
                        sender: 'agent',
                        text: chunk.error,
                        isError: true,
                        timestamp: new Date()
                    };
                    addNodeMessage(nodeId, errorMessage);
                    break;
                }

                // Handle text response
                if (chunk.response && 'text' in chunk.response && chunk.response.text) {
                    currentResponse += chunk.response.text;
                    // Update existing message or create new one
                    const existingMessages = getNodeMessages(nodeId);
                    const existingAgentMessage = existingMessages.find(m => m.id === agentMessageId);

                    if (existingAgentMessage) {
                        setNodeMessages(nodeId, existingMessages.map(m =>
                            m.id === agentMessageId ? { ...m, text: currentResponse } : m
                        ));
                    } else {
                        const newMessage: ChatMessage = {
                            id: agentMessageId,
                            sender: 'agent',
                            text: currentResponse,
                            timestamp: new Date()
                        };
                        addNodeMessage(nodeId, newMessage);
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
                        status: 'executing_tool',
                        timestamp: new Date()
                    };

                    const existingMessages = getNodeMessages(nodeId);
                    setNodeMessages(nodeId, existingMessages.map(m =>
                        m.id === agentMessageId ? toolMessage : m
                    ));
                }
            }

            // Execute tools if any
            if (toolCalls.length > 0) {
                for (const toolCall of toolCalls) {
                    const toolTimestamp = new Date();
                    const parsedArguments = parseToolArguments(toolCall.arguments);

                    try {
                        const toolResult = await executeTool(toolCall);
                        const toolExecutionError = isToolErrorResult(toolResult);
                        const executionMetadata = extractToolExecutionMetadata(toolResult);
                        const toolMessage: ChatMessage = {
                            id: generateMessageId('tool-call'),
                            sender: 'tool',
                            text: `${toolCall.name}(${toolCall.arguments})${executionMetadata.executionId ? ` [${executionMetadata.executionId}]` : ''}`,
                            toolName: toolCall.name,
                            timestamp: toolTimestamp,
                            isError: toolExecutionError,
                            toolCallRecord: {
                                id: toolCall.id,
                                functionName: toolCall.name,
                                arguments: parsedArguments,
                                result: toolResult,
                                status: toolExecutionError ? 'error' : 'success',
                                timestamp: toolTimestamp,
                                ...executionMetadata,
                            },
                        };
                        await addAndPersistMessage(nodeId, toolMessage);

                        const serializedToolResult = typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult, null, 2);
                        const toolResultMessage: ChatMessage = {
                            id: generateMessageId('tool-result'),
                            sender: 'tool_result',
                            text: executionMetadata.executionId
                                ? `[executionId=${executionMetadata.executionId}] ${serializedToolResult}`
                                : serializedToolResult,
                            toolCallId: toolCall.id,
                            toolName: toolCall.name,
                            timestamp: toolTimestamp,
                            isError: toolExecutionError,
                        };
                        await addAndPersistMessage(nodeId, toolResultMessage);
                    } catch (error) {
                        const toolErrorText = `Erreur: ${error instanceof Error ? error.message : String(error)}`;
                        const toolMessage: ChatMessage = {
                            id: generateMessageId('tool-call'),
                            sender: 'tool',
                            text: `${toolCall.name}(${toolCall.arguments})`,
                            toolName: toolCall.name,
                            timestamp: toolTimestamp,
                            isError: true,
                            toolCallRecord: {
                                id: toolCall.id,
                                functionName: toolCall.name,
                                arguments: parsedArguments,
                                result: { error: toolErrorText },
                                status: 'error',
                                timestamp: toolTimestamp,
                            },
                        };
                        await addAndPersistMessage(nodeId, toolMessage);

                        const errorMessage: ChatMessage = {
                            id: generateMessageId('tool-error'),
                            sender: 'tool_result',
                            text: toolErrorText,
                            toolCallId: toolCall.id,
                            toolName: toolCall.name,
                            isError: true,
                            timestamp: toolTimestamp,
                        };
                        await addAndPersistMessage(nodeId, errorMessage);
                    }
                }

                // Remove executing_tool status after all tools are executed
                const existingMessages = getNodeMessages(nodeId);
                setNodeMessages(nodeId, existingMessages.map(m =>
                    m.status === 'executing_tool' ? { ...m, status: undefined } : m
                ));

                // If agent has Chat capability, continue generation with tool results
                if (agent?.capabilities?.includes(LLMCapability.Chat)) {
                    setLoadingMessage(t('analyzing_results'));

                    // Get updated message history including tool results
                    const updatedMessages = getNodeMessages(nodeId);

                    // Filter out tool_result messages for the follow-up call and create a synthetic user message
                    const messagesWithoutToolResults = updatedMessages.filter(m => m.sender !== 'tool_result');

                    // Collect tool results for context
                    const toolResults = updatedMessages.filter(m => m.sender === 'tool_result');

                    if (toolResults.length > 0) {
                        // Create a synthetic message that provides tool results as context
                        const toolResultsSummary = toolResults.map(tr =>
                            `${t('tool_result_from')} ${tr.toolName}: ${tr.text}`
                        ).join('\n\n');

                        const contextMessage: ChatMessage = {
                            id: generateMessageId('tool-context'),
                            sender: 'user',
                            text: `${t('tool_results_context')}:\n\n${toolResultsSummary}\n\n${t('analyze_results_request')}`,
                            timestamp: new Date()
                        };

                        messagesWithoutToolResults.push(contextMessage);
                    }

                    // Generate a follow-up response using the tool results as context
                    const credential = agentRuntime.credential;
                    const followUpStream = llmService.generateContentStream(
                        agent.llmProvider,
                        credential,
                        agent.model,
                        agent.systemPrompt,
                        messagesWithoutToolResults,
                        agent.tools,
                        agent.outputConfig,
                        credential,
                        nativeToolsConfig
                    );

                    let followUpResponse = '';
                    let followUpMessageId = generateMessageId('followup');

                    for await (const chunk of followUpStream) {
                        if (chunk.error) {
                            const errorMessage: ChatMessage = {
                                id: followUpMessageId,
                                sender: 'agent',
                                text: chunk.error,
                                isError: true,
                                timestamp: new Date()
                            };
                            addNodeMessage(nodeId, errorMessage);
                            break;
                        }

                        if (chunk.response && 'text' in chunk.response && chunk.response.text) {
                            followUpResponse += chunk.response.text;

                            const existingFollowUpMessages = getNodeMessages(nodeId);
                            const existingFollowUpMessage = existingFollowUpMessages.find(m => m.id === followUpMessageId);

                            if (existingFollowUpMessage) {
                                setNodeMessages(nodeId, existingFollowUpMessages.map(m =>
                                    m.id === followUpMessageId ? { ...m, text: followUpResponse } : m
                                ));
                            } else {
                                const newFollowUpMessage: ChatMessage = {
                                    id: followUpMessageId,
                                    sender: 'agent',
                                    text: followUpResponse,
                                    timestamp: new Date()
                                };
                                addNodeMessage(nodeId, newFollowUpMessage);
                            }
                        }
                    }
                }
            }

        } catch (error) {
            const errorMessage: ChatMessage = {
                id: generateMessageId('error'),
                sender: 'agent',
                text: `Erreur: ${error instanceof Error ? error.message : String(error)}`,
                isError: true,
                timestamp: new Date()
            };
            // ⭐ AUTO-SAVE: Persist error message
            await addAndPersistMessage(nodeId, errorMessage);
        } finally {
            setNodeExecuting(nodeId, false);
            setLoadingMessage('');
            
            // ⭐ AUTO-SAVE: After streaming is complete, persist the final agent response
            if (instanceId && isAuthenticated && accessToken) {
                const finalMessages = getNodeMessages(nodeId);
                // Find the latest agent message that was added during this interaction
                const latestAgentMessage = [...finalMessages].reverse().find(m => m.sender === 'agent');
                if (latestAgentMessage && !latestAgentMessage.isError) {
                    await persistChatMessage(latestAgentMessage);
                }
            }
        }
    };

    return {
        handleSendMessage,
        loadingMessage,
    };
};
