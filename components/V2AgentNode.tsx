import React, { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { Agent, ChatMessage, LLMCapability, LLMProvider, Tool, ToolCall, AgentInstance, ToolCallRecord, MapSource, MapsPanelPreloadedResults } from '../types';
import { Button } from './UI';
import { CloseIcon, EditIcon, SendIcon, UploadIcon, ImageIcon, ErrorIcon, ExpandIcon, HistorySynthesisIcon, MaximizeIcon } from './Icons';
import { ConfirmationModal } from './modals/ConfirmationModal';
import { WebSearchParamsModal } from './modals/WebSearchParamsModal';

import { WebSearchGroundingPanel } from './panels/WebSearchGroundingPanel';
import { useRuntimeStore } from '../stores/useRuntimeStore';
import { selectResolvedAgentExecutionSelectionContext, selectResolvedAgentHasToolNamed, useDesignStore } from '../stores/useDesignStore';
import { useFunctionStore } from '../stores/useFunctionStore';
import { useWorkflowCanvasContext } from '../contexts/WorkflowCanvasContext';
import * as llmService from '../services/llmService';
import { createAdapter } from '../services/adapters/AdapterFactory';
import { runAgentLoop } from '../services/llm/AgentLoop';
import { ToolCallBlock } from './workflow/ToolCallBlock';
import { fileToBase64, fileToText } from '../utils/fileUtils';
import { executeTool } from '../utils/toolExecutor';
import { getEffectiveCredential, isLLMConfigured, isLocalProvider } from '../utils/llmProviderUtils';
import { useLocalization } from '../hooks/useLocalization';
import { useAgentJournalPersistence } from '../hooks/useAgentJournalPersistence';
import { useAuth } from '../hooks/useAuth';
import { resolveAgentRuntimeConfig } from '../services/runtimeConfigResolver';
import { buildBosHydrationFingerprint, hydrateToolMessagesFromPersistedRuns } from '../services/bosRunProjectionService';
import { persistInstanceWebSearchParams } from '../services/webSearchParamsConfigService';
import type { ReactFlowAgentNodeData } from '../services/workflowNodeReactFlowAdapter';
import type { UserFunction } from '../types/function.types';
import { executeAgentToolCall, parseToolCallArguments } from '../services/agentToolExecution';
import { normalizePersistedToolTranscriptMessages } from '../services/persistedChatMessages';
import { shouldSuppressVisualToolResult } from '../utils/toolResultVisibility';
import { AGENT_NODE_HANDLES } from './workflow/connectionContracts';
import { prepareConversationHistoryForAPI } from '../services/historySynthesisService';

// ⭐ J4.5: Global counter to ensure unique message IDs even if Date.now() returns same value
let messageIdCounter = 0;
const generateMessageId = (suffix?: string): string => {
    const id = `msg-${Date.now()}-${++messageIdCounter}${suffix ? `-${suffix}` : ''}`;
    return id;
};

let pendingAttachmentCounter = 0;
const generatePendingAttachmentId = (): string => `draft-${Date.now()}-${++pendingAttachmentCounter}`;

const TEXT_LIKE_MIME_TYPES = new Set([
  'application/json',
  'application/xml',
  'application/javascript',
  'application/x-javascript',
  'application/x-yaml',
  'application/yaml',
]);

function isTextLikeFile(file: File): boolean {
  const mimeType = file.type?.toLowerCase() || '';
  if (mimeType.startsWith('text/')) {
    return true;
  }

  if (TEXT_LIKE_MIME_TYPES.has(mimeType)) {
    return true;
  }

  return /\.(txt|md|csv|json|ya?ml|xml|html?|js|jsx|ts|tsx)$/i.test(file.name);
}

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

export type V2AgentNodeData = ReactFlowAgentNodeData;

function toPlainObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function toObjectArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null && !Array.isArray(item))
    : [];
}

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function formatToolResultMessage(toolName: string, result: unknown, executionId?: string): string {
  const serializedResult = typeof result === 'string'
    ? result
    : JSON.stringify(result, null, 2);

  const resultObject = toPlainObject(result);
  if (toolName !== 'web_search_py' || !resultObject) {
    return executionId
      ? `[executionId=${executionId}] ${serializedResult}`
      : serializedResult;
  }

  const query = toNonEmptyString(resultObject.query);
  const normalizedQuery = toNonEmptyString(resultObject.normalized_query);
  const trace = toPlainObject(resultObject.trace);
  const traceQueries = toObjectArray(trace?.queries);
  const selectedSources = toObjectArray(trace?.selected_sources);
  const rerankedSources = toObjectArray(resultObject.reranked_sources);
  const verifiedFragments = toObjectArray(resultObject.verified_fragments);
  const llmContextBlock = toPlainObject(resultObject.llm_context_block);
  const contextSources = toObjectArray(llmContextBlock?.sources);
  const projectedResults = toObjectArray(resultObject.results);

  if (!query && !trace && projectedResults.length === 0 && selectedSources.length === 0 && rerankedSources.length === 0) {
    return executionId
      ? `[executionId=${executionId}] ${serializedResult}`
      : serializedResult;
  }

  const totalResults = typeof resultObject.total_results === 'number'
    ? resultObject.total_results
    : projectedResults.length;
  const primaryVerified = verifiedFragments[0] ?? rerankedSources[0] ?? null;
  const primarySource = primaryVerified ?? selectedSources[0] ?? projectedResults[0] ?? null;
  const primaryTitle = toNonEmptyString(primarySource?.title);
  const primaryUrl = toNonEmptyString(primarySource?.url);
  const primaryFragment = toNonEmptyString(primaryVerified?.critical_fragment);
  const primaryScore = typeof primaryVerified?.relevance_score === 'number' ? primaryVerified.relevance_score : null;
  const pageFetches = toObjectArray(trace?.page_fetches);
  const fetchedCount = pageFetches.filter((item) => item.fetched === true).length;

  const lines = [
    executionId ? `[executionId=${executionId}]` : null,
    query ? `query=${query}` : null,
    normalizedQuery && normalizedQuery !== query ? `normalized_query=${normalizedQuery}` : null,
    `planned_queries=${traceQueries.length}`,
    ...traceQueries.slice(0, 3).map((traceQuery, index) => {
      const label = toNonEmptyString(traceQuery.query) ?? JSON.stringify(traceQuery);
      const status = toNonEmptyString(traceQuery.status) ?? 'unknown';
      return `query_${index + 1}=[${status}] ${label}`;
    }),
    `selected_results=${totalResults}`,
    rerankedSources.length > 0 ? `reranked_sources=${rerankedSources.length}` : null,
    verifiedFragments.length > 0 ? `verified_fragments=${verifiedFragments.length}` : null,
    pageFetches.length > 0 ? `page_fetches=${pageFetches.length} (fetched=${fetchedCount})` : null,
    contextSources.length > 0 ? `llm_context_sources=${contextSources.length}` : null,
    primaryTitle ? `primary_title=${primaryTitle}` : null,
    primaryUrl ? `primary_source=${primaryUrl}` : null,
    primaryScore !== null ? `primary_relevance_score=${primaryScore}` : null,
    primaryFragment ? `primary_fragment=${primaryFragment}` : null,
  ].filter((line): line is string => Boolean(line));

  return lines.join('\n');
}

function isToolErrorResult(result: unknown): boolean {
  const resultObject = toPlainObject(result);
  if (!resultObject) {
    return false;
  }

  return typeof resultObject.error === 'string'
    || resultObject.success === false;
}

function buildToolInvocationText(toolName: string, args: Record<string, unknown> | string, executionId?: string): string {
  const serializedArguments = typeof args === 'string'
    ? args
    : JSON.stringify(args);

  return `${toolName}(${serializedArguments})${executionId ? ` [${executionId}]` : ''}`;
}

function buildToolCallMessage(record: ToolCallRecord): ChatMessage {
  return {
    id: record.id,
    sender: 'tool',
    text: buildToolInvocationText(record.functionName, record.arguments, record.executionId),
    toolName: record.functionName,
    timestamp: record.timestamp,
    isError: record.status === 'error',
    toolCallRecord: record,
  };
}

function needsBosRunHydration(messages: ChatMessage[]): boolean {
  return messages.some((message) => {
    const toolCallRecord = message.toolCallRecord;
    if (message.sender !== 'tool' || !toolCallRecord?.executionId || !(toolCallRecord.toolId || toolCallRecord.functionId)) {
      return false;
    }

    return !toolCallRecord.persistedRunStatus
      && !toolCallRecord.persistedRunUpdatedAt
      && (toolCallRecord.artifacts?.length ?? 0) === 0;
  });
}

function buildPendingToolCallMessage(messageId: string, toolName: string, args: Record<string, unknown> | string, timestamp: Date): ChatMessage {
  return {
    id: messageId,
    sender: 'tool',
    text: buildToolInvocationText(toolName, args),
    toolName,
    timestamp,
    status: 'executing_tool',
  };
}

const cornerHandleClassName = 'w-3 h-3 bg-cyan-400 border-2 border-cyan-300 shadow-lg shadow-cyan-400/50 hover:bg-cyan-300 hover:shadow-cyan-300/70 transition-all duration-200 z-20';

function buildToolResultChatMessage(record: ToolCallRecord): ChatMessage {
  return {
    id: generateMessageId('tool-result'),
    sender: 'tool_result',
    text: formatToolResultMessage(record.functionName, record.result, record.executionId),
    toolCallId: record.id,
    toolName: record.functionName,
    timestamp: record.timestamp,
    isError: record.status === 'error',
  };
}

function mapUserFunctionToProviderTool(fn: UserFunction): Tool {
  return {
    name: fn.name,
    description: fn.description,
    parameters: fn.inputSchema ?? { type: 'object' },
    outputSchema: fn.outputSchema,
  };
}

function isProviderToolCandidate(tool: unknown): tool is Tool {
  if (!tool || typeof tool !== 'object' || Array.isArray(tool)) {
    return false;
  }

  const candidate = tool as Partial<Tool>;
  return typeof candidate.name === 'string'
    && candidate.name.trim().length > 0
    && candidate.parameters !== undefined;
}

function mergeProviderTools(agentTools: Tool[] | undefined, selectedFunctions: UserFunction[]): Tool[] | undefined {
  const sanitizedAgentTools = (agentTools ?? []).filter(isProviderToolCandidate).map((tool) => ({
    ...tool,
    name: tool.name.trim(),
  }));

  if (selectedFunctions.length === 0) {
    return sanitizedAgentTools.length > 0 ? sanitizedAgentTools : undefined;
  }

  const mergedTools = new Map<string, Tool>();

  for (const tool of sanitizedAgentTools) {
    mergedTools.set(tool.name, tool);
  }

  for (const fn of selectedFunctions) {
    mergedTools.set(fn.name, mapUserFunctionToProviderTool(fn));
  }

  return Array.from(mergedTools.values());
}

export const V2AgentNode = memo(function V2AgentNode({ data, id, selected }: NodeProps<V2AgentNodeData>) {
  const { t } = useLocalization();
  const { agent: nodeAgent, agentInstance: agentInstanceProp } = data;
  
  // Read minimize state from store
  const isMinimized = useRuntimeStore((state) => state.getIsNodeMinimized(id));

  // Protection: if agent is null, show error state
  if (!nodeAgent) {
    return (
      <div className="min-w-80 bg-red-900/50 border-2 border-red-500 rounded-lg p-4">
        <div className="text-red-300 font-medium">{t('agent_not_found')}</div>
        <div className="text-red-400 text-sm mt-2">
          ID Node: {id}
        </div>
      </div>
    );
  }

  // Runtime store for messages and execution state
  const getNodeMessages = useRuntimeStore((state) => state.getNodeMessages);
  const addNodeMessage = useRuntimeStore((state) => state.addNodeMessage);
  const setNodeMessages = useRuntimeStore((state) => state.setNodeMessages);
  const isNodeExecuting = useRuntimeStore((state) => state.isNodeExecuting);
  const setNodeExecuting = useRuntimeStore((state) => state.setNodeExecuting);
  const llmConfigs = useRuntimeStore((state) => state.llmConfigs);
  const localLLMProfiles = useRuntimeStore((state) => state.localLLMProfiles);
  const getNodePendingAttachment = useRuntimeStore((state) => state.getNodePendingAttachment) ?? (() => null);
  const setNodePendingAttachment = useRuntimeStore((state) => state.setNodePendingAttachment) ?? (() => undefined);
  const clearNodePendingAttachment = useRuntimeStore((state) => state.clearNodePendingAttachment) ?? (() => undefined);
  const getNodeInvisibleHistorySummary = useRuntimeStore((state) => state.getNodeInvisibleHistorySummary) ?? (() => null);
  const setNodeInvisibleHistorySummary = useRuntimeStore((state) => state.setNodeInvisibleHistorySummary) ?? (() => undefined);
  const setFullscreenChatNodeId = useRuntimeStore((state) => state.setFullscreenChatNodeId) ?? (() => undefined);
  const setFullscreenChatAgent = useRuntimeStore((state) => state.setFullscreenChatAgent) ?? (() => undefined);
  const setFullscreenChatAgentInstance = useRuntimeStore((state) => state.setFullscreenChatAgentInstance) ?? (() => undefined);

  // WorkflowCanvas context for navigation and node operations
  const {
    navigationHandler,
    onDeleteNode,
    onToggleNodeMinimize,
    onUpdateNodePosition,
    onOpenImagePanel,
    onOpenImageModificationPanel,
    onOpenVideoPanel,
    onOpenMapsPanel,    onOpenFullscreen
  } = useWorkflowCanvasContext();

  // Design store for agent data (not node operations)
  const selectAgent = useDesignStore((state) => state.selectAgent);
  const updateInstanceConfig = useDesignStore((state) => state.updateInstanceConfig);
  const designAgents = useDesignStore((state) => state.agents);
  const designAgentInstances = useDesignStore((state) => state.agentInstances);

  // J8 — Functions available for AgentLoop (emulated FC for local LLMs)
  const allFunctions = useFunctionStore(state => state.functions);
  const loadFunctions = useFunctionStore(state => state.loadFunctions);
  const {
    storedPrototype,
    resolvedAgent,
    agentInstance,
    workflowId: resolvedWorkflowId,
    selectedToolIds: configuredToolIds,
    scopedFunctions,
  } = useMemo(
    () => selectResolvedAgentExecutionSelectionContext(
      {
        agents: designAgents,
        agentInstances: designAgentInstances,
      },
      nodeAgent,
      agentInstanceProp?.id,
      allFunctions
    ),
    [allFunctions, agentInstanceProp?.id, designAgentInstances, designAgents, nodeAgent]
  );
  const agent = resolvedAgent ?? nodeAgent;
  const effectiveWorkflowId = data.workflowId || resolvedWorkflowId;
  const hasWebSearchPyTool = useDesignStore((state) => selectResolvedAgentHasToolNamed(state, nodeAgent, agentInstanceProp?.id, allFunctions, 'web_search_py'));

  // Use instance name if available, otherwise use prototype name with null safety
  const displayName = agentInstance?.name || agent?.name || 'Unknown Agent';

  // Résoudre la configuration effective (instance > prototype)
  // Créer un "agent effectif" qui utilise la config de l'instance si disponible
  const effectiveAgent: Agent = agentInstance?.configuration_json ? ({
    ...agent,
    role: agentInstance.configuration_json.role,
    llmProvider: agentInstance.configuration_json.llmProvider,
    model: agentInstance.configuration_json.model,
    systemPrompt: agentInstance.configuration_json.systemPrompt,
    tools: agentInstance.configuration_json.tools,
    toolSelections: agentInstance.configuration_json.toolSelections || (agentInstance as any).toolSelections || agent.toolSelections,
    capabilities: agentInstance.configuration_json.capabilities ?? agent.capabilities ?? [],
    outputConfig: agentInstance.configuration_json.outputConfig,
    webSearchParams: agentInstance.configuration_json.webSearchParams || agent.webSearchParams,
    historyConfig: agentInstance.configuration_json.historyConfig,
    localLLMProfileId: (agentInstance.configuration_json as any)?.localLLMProfileId || agent.localLLMProfileId,
  }) as Agent : agent;

  const providerTools = useMemo(
    () => mergeProviderTools(effectiveAgent.tools, scopedFunctions),
    [effectiveAgent.tools, scopedFunctions]
  );

  useEffect(() => {
    if (hasWebSearchPyTool || configuredToolIds.length === 0 || allFunctions.length > 0) {
      return;
    }

    void loadFunctions(effectiveWorkflowId ?? undefined);
  }, [allFunctions.length, configuredToolIds.length, effectiveWorkflowId, hasWebSearchPyTool, loadFunctions]);

  // C1 FIX: Auth token pour les appels sandbox (requireAuth)
  const { accessToken } = useAuth();
  const pendingAttachment = getNodePendingAttachment(id);

  // Local states
  const [userInput, setUserInput] = useState('');
  const [loadingMessage, setLoadingMessage] = useState('');
  const [isHistorySynthesisActive, setIsHistorySynthesisActive] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showThinking, setShowThinking] = useState(true);
  const [webFetchEnabled, setWebFetchEnabled] = useState(false);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [isWebSearchParamsModalOpen, setIsWebSearchParamsModalOpen] = useState(false);
  const [isSavingWebSearchParams, setIsSavingWebSearchParams] = useState(false);

  // Arc-LLM states
  const [showWebSearchResults, setShowWebSearchResults] = useState(false);
  const [webSearchResults, setWebSearchResults] = useState<{ text: string; webSources: any[] }>({ text: '', webSources: [] });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const bosHydrationFingerprintRef = useRef<string>('');
  const hydrationControlsReadyRef = useRef(false);
  const pendingLocalToolMessageIdsRef = useRef<Record<string, string>>({});
  const journalWorkflowId = data.workflowId || agentInstance?.workflowId;
  const { persistJournalEntry, persistToolInvocation, resetToolInvocationDedup } = useAgentJournalPersistence({
    workflowId: journalWorkflowId,
    instanceId: agentInstance?.id,
  });

  // Get messages from store
  const messages = getNodeMessages(id);
  const isLoading = isNodeExecuting(id);
  const agentRuntime = resolveAgentRuntimeConfig(effectiveAgent, llmConfigs, localLLMProfiles);

  useEffect(() => {
    const normalizedMessages = normalizePersistedToolTranscriptMessages(messages);
    if (normalizedMessages !== messages) {
      setNodeMessages(id, normalizedMessages);
    }
  }, [id, messages, setNodeMessages]);

  useEffect(() => {
    if (hydrationControlsReadyRef.current) {
      return;
    }

    hydrationControlsReadyRef.current = true;

    try {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        try {
          window.dispatchEvent(new Event('hydration:components:ready'));
        } catch {
          // ignore readiness signal failures
        }
      }));
    } catch {
      // ignore readiness signal failures
    }
  }, [id]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (!isMinimized) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isMinimized]);

  useEffect(() => {
    let cancelled = false;
    const fingerprint = buildBosHydrationFingerprint(messages);

    if (!fingerprint) {
      return;
    }

    if (!needsBosRunHydration(messages)) {
      bosHydrationFingerprintRef.current = fingerprint;
      return;
    }

    if (bosHydrationFingerprintRef.current === fingerprint) {
      return;
    }

    bosHydrationFingerprintRef.current = fingerprint;

    const rehydrateToolMessages = async () => {
      const hydratedMessages = await hydrateToolMessagesFromPersistedRuns(messages);
      if (cancelled || hydratedMessages === messages) {
        return;
      }
      bosHydrationFingerprintRef.current = buildBosHydrationFingerprint(hydratedMessages);
      setNodeMessages(id, hydratedMessages);
    };

    void rehydrateToolMessages();

    return () => {
      cancelled = true;
    };
  }, [id, messages, setNodeMessages]);

  const handleToggleMinimize = () => {
    if (onToggleNodeMinimize) {
      onToggleNodeMinimize(id);
    }
  };

  const handleDelete = () => {
    // Ouvrir directement la modale de confirmation sans manipulation de focus
    setShowDeleteConfirm(true);
  };

  const upsertChatMessage = useCallback((message: ChatMessage) => {
    const existingMessages = getNodeMessages(id);
    if (existingMessages.some((candidate) => candidate.id === message.id)) {
      setNodeMessages(id, existingMessages.map((candidate) => candidate.id === message.id ? message : candidate));
      return;
    }

    addNodeMessage(id, message);
  }, [addNodeMessage, getNodeMessages, id, setNodeMessages]);

  const finalizeToolCallMessage = useCallback((toolMessage: ChatMessage, pendingMessageId?: string) => {
    const existingMessages = getNodeMessages(id);
    const finalToolCallId = toolMessage.toolCallRecord?.id;

    if (finalToolCallId && existingMessages.some((candidate) => candidate.sender === 'tool' && candidate.toolCallRecord?.id === finalToolCallId)) {
      setNodeMessages(id, existingMessages.map((candidate) => (
        candidate.sender === 'tool' && candidate.toolCallRecord?.id === finalToolCallId
          ? toolMessage
          : candidate
      )));
      return;
    }

    if (pendingMessageId && existingMessages.some((candidate) => candidate.id === pendingMessageId)) {
      setNodeMessages(id, existingMessages.map((candidate) => candidate.id === pendingMessageId ? toolMessage : candidate));
      return;
    }

    addNodeMessage(id, toolMessage);
  }, [addNodeMessage, getNodeMessages, id, setNodeMessages]);

  const ensureToolResultMessage = useCallback((toolResultMessage: ChatMessage) => {
    const existingMessages = getNodeMessages(id);
    if (existingMessages.some((candidate) => candidate.sender === 'tool_result' && candidate.toolCallId === toolResultMessage.toolCallId)) {
      return;
    }

    addNodeMessage(id, toolResultMessage);
  }, [addNodeMessage, getNodeMessages, id]);

  const handleSaveWebSearchParams = useCallback(async (webSearchParams: NonNullable<Agent['webSearchParams']>) => {
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
  }, [accessToken, agentInstance, updateInstanceConfig]);

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
    // Robust instance lookup with multiple fallback strategies
    const storeState = useDesignStore.getState();
    
    // First try: Direct agentInstance from props
    if (agentInstance && typeof agentInstance === 'object' && 'id' in agentInstance && agentInstance.id) {
      const { setConfigModalInstanceId } = useRuntimeStore.getState();
      setConfigModalInstanceId(agentInstance.id);
      return;
    }

    // Fallback 1: Try to find instance by node ID in store
    const nodeIdPattern = id.replace('node-', ''); // Extract ID from 'node-ABC' → 'ABC'
    const instanceByNodeId = storeState.agentInstances.find(inst => inst.id === nodeIdPattern);
    
    if (instanceByNodeId && instanceByNodeId.id) {
      const { setConfigModalInstanceId } = useRuntimeStore.getState();
      setConfigModalInstanceId(instanceByNodeId.id);
      return;
    }

    // Fallback 2: Try to find instance by agent name
    if (agent?.name) {
      const instanceByName = storeState.agentInstances.find(inst => inst.name === agent.name);
      if (instanceByName && instanceByName.id) {
        const { setConfigModalInstanceId } = useRuntimeStore.getState();
        setConfigModalInstanceId(instanceByName.id);
        return;
      }
    }

    // Fallback 3: Try to find instance by prototypeId
    if (agent?.id) {
      const instanceByPrototype = storeState.agentInstances.find(inst => inst.prototypeId === agent.id);
      if (instanceByPrototype && instanceByPrototype.id) {
        const { setConfigModalInstanceId } = useRuntimeStore.getState();
        setConfigModalInstanceId(instanceByPrototype.id);
        return;
      }
    }

    // ❌ All fallbacks failed - detailed error message for debugging
    console.error('[V2AgentNode] ❌ ÉTAPE 4: Instance lookup FAILED - no instance found', {
      nodeId: id,
      agentName: agent?.name,
      agentId: agent?.id,
      agentInstanceProp: agentInstance,
      nodeIdPattern: nodeIdPattern,
      availableInstances: storeState.agentInstances.map(i => ({ id: i.id, name: i.name, prototypeId: i.prototypeId }))
    });

    const errorDetails = [
      `Node ID: ${id}`,
      `Agent: ${agent?.name || 'N/A'} (ID: ${agent?.id || 'N/A'})`,
      `agentInstance prop: ${agentInstance ? JSON.stringify(agentInstance) : 'undefined'}`,
      `Available instances: ${storeState.agentInstances.length}`,
      storeState.agentInstances.length > 0 ? `Sample: ${JSON.stringify(storeState.agentInstances[0])}` : 'No instances in store'
    ].join('\n');

    alert(
      `❌ Instance non trouvée pour cet agent.\n\n` +
      `Cela signifie que:\n` +
      `1. L'agent n'a pas été ajouté au workflow correctement\n` +
      `2. Ou l'ID d'instance n'est pas synchronisé\n` +
      `3. Ou vous avez rechargé la page et perdu l'instance local\n\n` +
      `Debug Info:\n${errorDetails}`
    );
  };

  const handleFullscreen = () => {
    setFullscreenChatNodeId(id);
    setFullscreenChatAgent(agent);
    setFullscreenChatAgentInstance(agentInstance);
  };



  const handleWebSearchGrounding = async () => {
    if (!agent || !userInput.trim()) return;

    const agentConfig = resolveAgentRuntimeConfig(agent, llmConfigs, localLLMProfiles).config;
    // ⭐ SOLID: Use centralized validation function
    if (!isLLMConfigured(agentConfig, agent.llmProvider)) {
      console.error('LLM not configured for web search grounding');
      return;
    }

    setLoadingMessage('Recherche web...');

    try {
      const credential = getEffectiveCredential(agentConfig, agent.llmProvider);
      const result = await llmService.generateContentWithWebSearchGrounding(
        agent.llmProvider,
        credential,
        agent.model,
        userInput,
        agent.systemPrompt
      );

      setWebSearchResults(result);
      setShowWebSearchResults(true);
      setLoadingMessage('');
    } catch (error) {
      console.error('Web search grounding failed:', error);
      setLoadingMessage('');
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedInput = userInput.trim();
    const activeAttachment = getNodePendingAttachment(id);
    if (!trimmedInput && !activeAttachment) return;

    // Protection null safety pour agent
    if (!agent) {
      console.error('Agent is null, cannot send message');
      return;
    }

    resetToolInvocationDedup();
    setNodeExecuting(id, true);

    const userMessage: ChatMessage = {
      id: generateMessageId('user'),
      sender: 'user',
      text: trimmedInput,
      timestamp: new Date(),
    };

      // Handle file attachment
      if (activeAttachment) {
        userMessage.filename = activeAttachment.fileName;
        userMessage.mimeType = activeAttachment.mimeType;

        if (effectiveAgent.llmProvider === LLMProvider.Mistral && activeAttachment.textContent) {
          userMessage.fileContent = activeAttachment.textContent;
        } else {
          userMessage.image = activeAttachment.base64Content;
        }
      }

    addNodeMessage(id, userMessage);
    setUserInput('');
    clearNodePendingAttachment(id);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    pendingLocalToolMessageIdsRef.current = {};

    const shouldPersistInlineAttachment = !activeAttachment?.draftPersisted;

    // Persist user message to journal (non-blocking)
    // ⭐ FIX QA: Include image data for persistence if present
    persistJournalEntry('chat', {
      messageId: userMessage.id,
      role: 'user',
      content: trimmedInput,
      llmProvider: effectiveAgent.llmProvider,
      modelUsed: effectiveAgent.model,
      // ⭐ FIX QA: Persist image data for reload after login
      ...(shouldPersistInlineAttachment && userMessage.image && { imageBase64: userMessage.image }),
      ...(shouldPersistInlineAttachment && userMessage.fileContent && { fileContent: userMessage.fileContent }),
      ...(userMessage.mimeType && { mimeType: userMessage.mimeType }),
      ...(userMessage.filename && { fileName: userMessage.filename })
    });

    // Get LLM config
    const agentConfig = agentRuntime.config;

    // ⭐ SOLID: Use centralized validation function (works for both local and cloud)
    if (!isLLMConfigured(agentConfig, effectiveAgent.llmProvider)) {
      const isReconfigNeeded = agentConfig?.needsReconfig;
      const errorText = isReconfigNeeded
        ? `⚠️ ${effectiveAgent.llmProvider} nécessite une reconfiguration de sa clé API. Rendez-vous dans les paramètres LLM pour la re-saisir.`
        : `Erreur: ${effectiveAgent.llmProvider} n'est pas configuré ou activé. Veuillez configurer vos clés API dans les paramètres.`;
      const errorMessage: ChatMessage = {
        id: generateMessageId('error'),
        sender: 'agent',
        text: errorText,
        isError: true,
        timestamp: new Date()
      };
      addNodeMessage(id, errorMessage);
      setNodeExecuting(id, false);
      return;
    }

    try {
      const preparedConversation = await prepareConversationHistoryForAPI({
        visibleMessagesBeforeSend: messages,
        userMessage,
        historyConfig: effectiveAgent.historyConfig,
        invisibleSummaryState: getNodeInvisibleHistorySummary(id),
        llmConfigs,
        localLLMProfiles,
        inheritedLocalLLMProfileId: effectiveAgent.localLLMProfileId,
        t,
        accessToken,
        onSummarizingChange: (isSummarizing) => {
          if (isSummarizing) {
            setIsHistorySynthesisActive(true);
            setLoadingMessage(t('agentNode_history_summarizing'));
            return;
          }

          setLoadingMessage('');
        }
      });

      setNodeInvisibleHistorySummary(id, preparedConversation.invisibleSummaryState);
      const conversationHistoryForAPI = preparedConversation.conversationHistoryForAPI;
      // Stream LLM response
      // ⭐ NEW: Resolve local endpoint from profile if available, fallback to llm_configs
      const credential = agentRuntime.credential;

      // ─── J8: AgentLoop path for local LLMs (emulated function calling) ──────
      const adapter = createAdapter(
        effectiveAgent.llmProvider as LLMProvider,
        agentConfig,
        effectiveAgent.model,
        accessToken ?? undefined
      );

      if (adapter) {
        // Local LLM path: use AgentLoop with emulated FC via FunctionCallingPromptBuilder
        let enabledFunctions = scopedFunctions;

        if (enabledFunctions.length === 0 && configuredToolIds.length > 0) {
          const effectiveWorkflowId = data.workflowId || agentInstance?.workflowId;
          console.warn('[V2AgentNode] Empty local tool scope for a configured agent, attempting catalog reload', {
            nodeId: id,
            agentId: effectiveAgent.id,
            configuredToolIds,
            workflowId: effectiveWorkflowId,
            loadedFunctionCount: allFunctions.length,
          });

          await loadFunctions(effectiveWorkflowId ?? undefined);
          enabledFunctions = selectResolvedAgentExecutionSelectionContext(
            {
              agents: designAgents,
              agentInstances: designAgentInstances,
            },
            nodeAgent,
            agentInstanceProp?.id,
            useFunctionStore.getState().functions
          ).scopedFunctions;
        }

        console.info('[V2AgentNode] Local AgentLoop tool scope', {
          nodeId: id,
          agentId: effectiveAgent.id,
          agentName: effectiveAgent.name,
          configuredToolIds,
          loadedFunctionCount: allFunctions.length,
          selectedCount: enabledFunctions.length,
          selectedTools: enabledFunctions.map(fn => ({ id: fn.toolId ?? fn._id, name: fn.name }))
        });

        if (enabledFunctions.length === 0 && configuredToolIds.length > 0) {
          const configurationError = `[Erreur configuration outils] ${configuredToolIds.length} outil(s) sont configures pour cet agent, mais aucun n'a pu etre resolu dans le catalogue charge.`;
          const errorMessage: ChatMessage = {
            id: generateMessageId('tool-config-error'),
            sender: 'agent',
            text: configurationError,
            isError: true,
            timestamp: new Date(),
          };
          addNodeMessage(id, errorMessage);
          setNodeExecuting(id, false);
          return;
        }

        setLoadingMessage(t('loading'));

        const loopResult = await runAgentLoop(
          adapter,
          conversationHistoryForAPI,
          enabledFunctions,
          effectiveAgent.systemPrompt ?? '',
          {
            authToken: accessToken ?? undefined,  // C1 FIX: JWT pour requireAuth sandbox
            onEvent: (event) => {
              if (event.type === 'tool_call_start') {
                const startedToolCall = event.toolCall ?? null;
                if (!startedToolCall) {
                  return;
                }
                const pendingKey = `${event.iteration}:${startedToolCall.name}:${JSON.stringify(startedToolCall.arguments)}`;
                const pendingMessageId = pendingLocalToolMessageIdsRef.current[pendingKey] ?? generateMessageId('pending-tool');
                pendingLocalToolMessageIdsRef.current[pendingKey] = pendingMessageId;
                const matchedFunction = enabledFunctions.find((fn) => fn.name === startedToolCall.name);
                if (startedToolCall.id) {
                  persistToolInvocation({
                    toolCallId: startedToolCall.id,
                    toolName: startedToolCall.name,
                    phase: 'started',
                    toolId: matchedFunction?.toolId ?? matchedFunction?._id,
                    functionId: matchedFunction?._id,
                  });
                }
                upsertChatMessage(buildPendingToolCallMessage(
                  pendingMessageId,
                  startedToolCall.name,
                  startedToolCall.arguments,
                  new Date()
                ));
                setLoadingMessage(`🔧 ${startedToolCall.name}`);
              } else if (event.type === 'tool_call_done' && event.toolCall && event.toolCallRecord) {
                const completedToolCall = event.toolCall;
                const pendingKey = `${event.iteration}:${completedToolCall.name}:${JSON.stringify(completedToolCall.arguments)}`;
                const pendingMessageId = pendingLocalToolMessageIdsRef.current[pendingKey];
                persistToolInvocation({
                  toolCallId: event.toolCallRecord.id,
                  toolName: event.toolCallRecord.functionName,
                  phase: event.toolCallRecord.status === 'error' ? 'failed' : 'completed',
                  executionId: event.toolCallRecord.executionId,
                  toolId: event.toolCallRecord.toolId,
                  functionId: event.toolCallRecord.functionId,
                });
                finalizeToolCallMessage(buildToolCallMessage(event.toolCallRecord as ToolCallRecord), pendingMessageId);
                ensureToolResultMessage(buildToolResultChatMessage(event.toolCallRecord as ToolCallRecord));
                delete pendingLocalToolMessageIdsRef.current[pendingKey];
              } else if (event.type === 'tool_protocol_violation') {
                setLoadingMessage(t('tool_protocol_violation'));
              } else if (event.type === 'llm_start') {
                setLoadingMessage(t('loading'));
              }
            }
          }
        );

        // Add tool call messages for each executed function
        for (const record of loopResult.toolCallLog) {
          const toolRecord: ToolCallRecord = {
            id: record.id,
            toolId: record.toolId,
            functionId: record.functionId,
            functionName: record.functionName,
            arguments: record.arguments,
            result: record.result,
            status: record.status,
            durationMs: record.durationMs,
            executionId: record.executionId,
            runner: record.runner,
            exitCode: record.exitCode,
            failureKind: record.failureKind,
            artifacts: record.artifacts,
            timestamp: record.timestamp,
          };

          finalizeToolCallMessage(buildToolCallMessage(toolRecord));
          ensureToolResultMessage(buildToolResultChatMessage(toolRecord));
        }

        pendingLocalToolMessageIdsRef.current = {};

        // Add final agent response
        if (loopResult.finalResponse.trim() || loopResult.finishReason === 'error') {
          const agentMsg: ChatMessage = {
            id: generateMessageId('agent'),
            sender: 'agent',
            text: loopResult.finalResponse,
            isError: loopResult.finishReason === 'error',
            timestamp: new Date(),
          };
          addNodeMessage(id, agentMsg);
          if (loopResult.finalResponse.trim()) {
            persistJournalEntry('chat', {
              messageId: agentMsg.id,
              role: 'agent',
              content: loopResult.finalResponse,
              llmProvider: effectiveAgent.llmProvider,
              modelUsed: effectiveAgent.model,
            });
          }
        }
      } else {
      // ─── Standard streaming path (native providers — zero regression) ────────
      const stream = llmService.generateContentStream(
        effectiveAgent.llmProvider,
        credential, // Use getEffectiveCredential (works for both apiKey and localEndpoint)
        effectiveAgent.model,
        effectiveAgent.systemPrompt,
        conversationHistoryForAPI, // Use computed history based on config
        providerTools,
        effectiveAgent.outputConfig,
        credential, // For endpoints (will be used for LMStudio, ignored for cloud)
        { webFetch: webFetchEnabled, webSearch: webSearchEnabled }, // Native tools config
        accessToken ?? undefined
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
              text: currentResponse,
              timestamp: new Date()
            };
            addNodeMessage(id, newMessage);
          }
        }

        // Handle tool calls
        if (chunk.response && 'toolCalls' in chunk.response && chunk.response.toolCalls) {
          toolCalls = chunk.response.toolCalls;
          for (const toolCall of toolCalls) {
            const matchedFunction = scopedFunctions.find((fn) => fn.isEnabled && fn.name === toolCall.name);
            persistToolInvocation({
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              phase: 'started',
              toolId: matchedFunction?.toolId ?? matchedFunction?._id,
              functionId: matchedFunction?._id,
            });
            upsertChatMessage(buildPendingToolCallMessage(
              `pending-tool-${toolCall.id}`,
              toolCall.name,
              parseToolCallArguments(toolCall.arguments),
              new Date()
            ));
          }
        }
      }

      // Persist agent response if successful
      if (currentResponse.trim() && !toolCalls.length) {
        persistJournalEntry('chat', {
          messageId: agentMessageId,
          role: 'agent',
          content: currentResponse,
          llmProvider: effectiveAgent.llmProvider,
          modelUsed: effectiveAgent.model
        });
      }

      // Execute tools if any
      if (toolCalls.length > 0) {
        for (const toolCall of toolCalls) {
          const matchedFunction = scopedFunctions.find((fn) => fn.isEnabled && fn.name === toolCall.name);
          const toolTimestamp = new Date();
          const pendingToolMessageId = `pending-tool-${toolCall.id}`;

          try {
            const execution = await executeAgentToolCall({
              toolCall,
              agent: effectiveAgent,
              availableFunctions: scopedFunctions,
              authToken: accessToken ?? undefined,
            });
            const toolResult = execution.result;
            const toolRecord: ToolCallRecord = {
              id: toolCall.id,
              toolId: matchedFunction?.toolId ?? matchedFunction?._id,
              functionId: matchedFunction?._id,
              functionName: toolCall.name,
              arguments: execution.executedArguments,
              result: toolResult,
              status: isToolErrorResult(toolResult) ? 'error' : 'success',
              timestamp: toolTimestamp,
              executionId: execution.executionId,
              runner: execution.runner,
              exitCode: execution.exitCode,
              failureKind: execution.failureKind,
              artifacts: execution.artifacts,
            };

            persistToolInvocation({
              toolCallId: toolRecord.id,
              toolName: toolRecord.functionName,
              phase: toolRecord.status === 'error' ? 'failed' : 'completed',
              executionId: toolRecord.executionId,
              toolId: toolRecord.toolId,
              functionId: toolRecord.functionId,
            });
            finalizeToolCallMessage(buildToolCallMessage(toolRecord), pendingToolMessageId);
            ensureToolResultMessage(buildToolResultChatMessage(toolRecord));
          } catch (error) {
            const toolErrorText = `Erreur: ${error instanceof Error ? error.message : String(error)}`;
            const toolRecord: ToolCallRecord = {
              id: toolCall.id,
              toolId: matchedFunction?.toolId ?? matchedFunction?._id,
              functionId: matchedFunction?._id,
              functionName: toolCall.name,
              arguments: parseToolCallArguments(toolCall.arguments),
              result: { error: toolErrorText },
              status: 'error',
              timestamp: toolTimestamp,
            };

            persistToolInvocation({
              toolCallId: toolRecord.id,
              toolName: toolRecord.functionName,
              phase: 'failed',
              toolId: toolRecord.toolId,
              functionId: toolRecord.functionId,
            });
            finalizeToolCallMessage(buildToolCallMessage(toolRecord), pendingToolMessageId);
            ensureToolResultMessage(buildToolResultChatMessage(toolRecord));
          }
        }

        // Remove executing_tool status after all tools are executed
        const existingMessages = getNodeMessages(id);
        setNodeMessages(id, existingMessages.map(m =>
          m.status === 'executing_tool' ? { ...m, status: undefined } : m
        ));

        persistJournalEntry('chat', {
          messageId: agentMessageId,
          role: 'agent',
          content: currentResponse,
          llmProvider: effectiveAgent.llmProvider,
          modelUsed: effectiveAgent.model,
          toolCalls,
        });

        // A native provider that emitted a tool call must always receive the tool result back,
        // even if the prototype forgot to keep Chat explicitly enabled in capabilities.
        setLoadingMessage(t('analyzing_results'));

        // Get updated message history including tool results.
        const updatedMessages = getNodeMessages(id);

        // Filter out UI-only tool and tool_result messages for the follow-up call and create a synthetic user message
        // that contains the tool results as context.
        const messagesWithoutToolResults = updatedMessages.filter(m => m.sender !== 'tool_result' && m.sender !== 'tool');

        // Collect tool results for context.
        const toolResults = updatedMessages.filter(m => m.sender === 'tool_result');

        if (toolResults.length > 0) {
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

        // Generate a follow-up response using the tool results as context.
        // ⭐ FIX: Use `credential` (resolved from localLLMProfileId) — NOT agentConfig.apiKey.
        // agentConfig is a singleton find(provider===X) which returns the FIRST matching config,
        // causing endpoint cross-contamination when 2+ local LLM agents share the same provider type.
        // `credential` was already resolved above via resolveLocalEndpoint() for this specific agent.
        const followUpStream = llmService.generateContentStream(
          effectiveAgent.llmProvider,
          credential,
          effectiveAgent.model,
          effectiveAgent.systemPrompt,
          messagesWithoutToolResults,
          providerTools,
          effectiveAgent.outputConfig,
          credential // endpoint for LMStudio — same agent-specific credential
        );

        let followUpResponse = '';
        let followUpMessageId = generateMessageId('followup');
        let followUpErrored = false;

        for await (const chunk of followUpStream) {
          if (chunk.error) {
            followUpErrored = true;
            const errorMessage: ChatMessage = {
              id: followUpMessageId,
              sender: 'agent',
              text: chunk.error,
              isError: true,
              timestamp: new Date()
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
                text: followUpResponse,
                timestamp: new Date()
              };
              addNodeMessage(id, newFollowUpMessage);
            }
          }
        }

        if (!followUpErrored && !followUpResponse.trim()) {
          const emptyFollowUpMessage: ChatMessage = {
            id: followUpMessageId,
            sender: 'agent',
            text: 'Erreur: aucune reponse finale du modele apres execution de l\'outil.',
            isError: true,
            timestamp: new Date()
          };
          addNodeMessage(id, emptyFollowUpMessage);
        }

        // ⭐ Phase 3: Persister la réponse follow-up
        if (followUpResponse.trim()) {
          persistJournalEntry('chat', {
            messageId: followUpMessageId,
            role: 'agent',
            content: followUpResponse,
            llmProvider: effectiveAgent.llmProvider,
            modelUsed: effectiveAgent.model
          });
        }
      }
      } // end else (standard streaming path)

    } catch (error) {
      const errorMessage: ChatMessage = {
        id: generateMessageId('error'),
        sender: 'agent',
        text: `Erreur: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
        timestamp: new Date()
      };
      addNodeMessage(id, errorMessage);

      // Persist error to journal
      persistJournalEntry('error', {
        messageId: errorMessage.id,
        errorCode: 'AGENT_ERROR',
        message: error instanceof Error ? error.message : String(error),
        source: 'llm_service',
        retryable: true,
        attempts: 1
      });
    } finally {
      setNodeExecuting(id, false);
      setLoadingMessage('');
      setIsHistorySynthesisActive(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const base64Content = await fileToBase64(file);
      let textContent: string | undefined;

      if (isTextLikeFile(file)) {
        try {
          textContent = await fileToText(file);
        } catch (error) {
          console.warn(`[V2AgentNode ${id}] Failed to read text upload as UTF-8, keeping base64 only`, error);
        }
      }

      setNodePendingAttachment(id, {
        id: generatePendingAttachmentId(),
        file,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        base64Content,
        textContent,
        origin: 'llm_file_upload',
        createdAt: new Date(),
        draftPersisted: false,
      });
    } finally {
      e.target.value = '';
    }
  };

  const handleOpenImagePanel = () => {
    if (onOpenImagePanel && agent && agentInstance) {
      onOpenImagePanel(id, agent, agentInstance);
    } else {
      console.warn(`[V2AgentNode ${id}] Cannot open image panel - missing callback or agent/instance`);
    }
  };

  const handleOpenFullscreenImage = (imageBase64: string, mimeType: string) => {
    if (onOpenFullscreen) {
      onOpenFullscreen(imageBase64, mimeType);
    }
  };

  const handleEditImage = (imageBase64: string, mimeType: string) => {
    if (onOpenImageModificationPanel) {
      const imageAgent: Agent | undefined = agent ?? undefined;
      onOpenImageModificationPanel(id, imageBase64, imageAgent, data.agentInstance, mimeType);
    } else {
      console.warn(`[V2AgentNode ${id}] onOpenImageModificationPanel is not available from context`);
    }
  };

  const handleOpenVideoPanel = () => {
    if (onOpenVideoPanel && agent && agentInstance) {
      onOpenVideoPanel(id, agent, agentInstance);
    } else {
      console.warn(`[V2AgentNode ${id}] Cannot open video panel - missing callback or agent/instance`);
    }
  };

  const handleOpenMapsPanel = () => {
    if (onOpenMapsPanel) {
      onOpenMapsPanel(id);
    } else {
      console.warn(`[V2AgentNode ${id}] onOpenMapsPanel is not available from context`);
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
      <div key={message.id} className={`mb-3 ${isUser ? 'ml-4' : 'mr-4'}`}>
        {/* J9 — ToolCallBlock for Tools V2 function invocations */}
        {isToolCall && message.toolCallRecord && (
          <ToolCallBlock toolCall={message.toolCallRecord} defaultExpanded={false} />
        )}

        {isToolCall && !message.toolCallRecord && (
          <div className="mb-2 rounded bg-gray-800/70 border border-cyan-800/40 px-3 py-2">
            <div className="flex items-center gap-2 text-sm text-cyan-300">
              <span className="text-gray-400 shrink-0">🔧</span>
              <span className="font-mono font-bold truncate">{message.toolName ?? t('executing_tool')}</span>
              <span className="text-xs text-amber-300 animate-pulse shrink-0">{t('executing_tool')}...</span>
            </div>
            <div className="mt-2 text-xs text-gray-400 font-mono bg-gray-900/60 p-2 rounded break-words overflow-wrap-anywhere whitespace-pre-wrap">
              {message.text}
            </div>
          </div>
        )}

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
        {!isToolResult && !isToolCall && (
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
                  {effectiveAgent.capabilities?.includes(LLMCapability.ImageModification) && (
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

            {/* Maps Grounding Results */}
            {message.mapsGrounding && message.mapsGrounding.length > 0 && (() => {
              const mapSources: MapSource[] = message.mapsGrounding ? [...message.mapsGrounding] : [];
              const preloadedResults: MapsPanelPreloadedResults = {
                text: message.text,
                mapSources,
                query: message.text.substring(0, 100),
              };

              return <div className="mt-3 pt-3 border-t border-gray-600">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-semibold text-cyan-400">
                    🗺️ Lieux trouvés ({mapSources.length})
                  </div>
                  <button
                    onClick={() => onOpenMapsPanel && onOpenMapsPanel(id, preloadedResults)}
                    className="text-xs px-2 py-1 bg-cyan-600 hover:bg-cyan-700 text-white rounded transition-colors"
                  >
                    🗺️ Voir la carte
                  </button>
                </div>
                <div className="space-y-2">
                  {mapSources.slice(0, 3).map((place, index) => (
                    <div key={index} className="bg-gray-800/50 rounded p-2 text-xs">
                      <div className="font-semibold text-white mb-1">{place.placeTitle}</div>
                      {place.coordinates && (
                        <div className="text-gray-400 font-mono">
                          📍 {place.coordinates.latitude.toFixed(4)}, {place.coordinates.longitude.toFixed(4)}
                        </div>
                      )}
                      <a
                        href={place.uri}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-cyan-400 hover:text-cyan-300 text-xs mt-1 inline-block"
                      >
                        🔗 Voir sur Maps
                      </a>
                    </div>
                  ))}
                  {mapSources.length > 3 && (
                    <div className="text-xs text-gray-400 text-center py-1">
                      +{mapSources.length - 3} autres lieux (cliquez sur "Voir la carte")
                    </div>
                  )}
                </div>
              </div>;
            })()}

            {/* Web Search Grounding Results */}
            {message.webSearchGrounding && message.webSearchGrounding.length > 0 && (
              <div className="mt-3 pt-3 border-t border-gray-600">
                <div className="text-xs font-semibold text-cyan-400 mb-2">
                  🔍 Sources web ({message.webSearchGrounding.length})
                </div>
                <div className="space-y-1">
                  {message.webSearchGrounding.map((source, index) => (
                    <a
                      key={index}
                      href={source.uri}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block bg-gray-800/50 rounded p-2 text-xs hover:bg-gray-700/50 transition-colors"
                    >
                      <div className="text-white font-semibold">{source.webTitle}</div>
                      {source.snippet && (
                        <div className="text-gray-400 mt-1 line-clamp-2">{source.snippet}</div>
                      )}
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Video Generation Results */}
            {message.videoGeneration && (
              <div className="mt-3 pt-3 border-t border-gray-600">
                <div className="text-xs font-semibold text-pink-400 mb-2">
                  🎬 Vidéo générée
                </div>

                {message.videoGeneration.status === 'processing' && (
                  <div className="bg-gray-800/50 rounded p-3 text-xs">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="animate-spin h-4 w-4 border-2 border-pink-400 border-t-transparent rounded-full"></div>
                      <span className="text-white">Génération en cours...</span>
                    </div>
                    <div className="text-gray-400 italic line-clamp-2">
                      {message.videoGeneration.prompt}
                    </div>
                  </div>
                )}

                {message.videoGeneration.status === 'completed' && message.videoGeneration.videoUrl && (
                  <div className="bg-gray-800/50 rounded p-2 space-y-2">
                    <video
                      src={message.videoGeneration.videoUrl}
                      controls
                      className="w-full rounded border border-gray-600"
                      poster={message.videoGeneration.thumbnailUrl}
                    >
                      Your browser does not support the video tag.
                    </video>
                    <div className="flex gap-2">
                      <a
                        href={message.videoGeneration.videoUrl}
                        download
                        className="flex-1 bg-pink-600 hover:bg-pink-700 text-white text-xs font-semibold py-2 px-3 rounded transition-colors text-center"
                      >
                        📥 Télécharger
                      </a>
                      <button
                        onClick={() => {
                          // TODO: Implement video extension feature
                          alert('Extension vidéo: Fonctionnalité à venir');
                        }}
                        className="flex-1 bg-gray-700 hover:bg-gray-600 text-white text-xs font-semibold py-2 px-3 rounded transition-colors"
                      >
                        ➕ Prolonger (7s)
                      </button>
                    </div>
                    <div className="text-gray-400 text-xs italic line-clamp-2">
                      {message.videoGeneration.prompt}
                    </div>
                  </div>
                )}

                {message.videoGeneration.status === 'failed' && (
                  <div className="bg-red-900/30 rounded p-3 text-xs">
                    <div className="flex items-center gap-2 mb-2">
                      <ErrorIcon className="text-red-400" />
                      <span className="text-red-400 font-semibold">Échec de la génération</span>
                    </div>
                    {message.videoGeneration.error && (
                      <div className="text-gray-400">{message.videoGeneration.error}</div>
                    )}
                    <div className="text-gray-400 italic mt-2 line-clamp-2">
                      Prompt: {message.videoGeneration.prompt}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      data-arc-agent-node="shell"
      className={`
      bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 
      border border-gray-600 rounded-lg shadow-lg 
      transition-all duration-300 ease-out
      relative overflow-visible
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

      {AGENT_NODE_HANDLES.map((handle) => (
        <Handle
          key={handle.id}
          id={handle.id}
          type={handle.type}
          position={handle.position}
          className={cornerHandleClassName}
          style={handle.style}
        />
      ))}

      {/* Header - zone de titre draggable avec classe spéciale */}
      <div className="flex items-center justify-between p-3 border-b border-gray-700/80 
                      bg-gradient-to-r from-gray-900/80 via-gray-800/60 to-gray-900/80 
                      rounded-t-lg cursor-move drag-handle
                      backdrop-blur-sm relative z-10
                      hover:from-gray-800/90 hover:via-gray-700/70 hover:to-gray-800/90
                      transition-all duration-300">
        <div className="flex items-center space-x-2 min-w-0">
            <div className={`w-2 h-2 rounded-full shadow-lg transition-all duration-200 ${isLoading
              ? 'bg-yellow-400 animate-pulse shadow-yellow-400/60'
              : 'bg-green-400 shadow-green-400/60 group-hover:shadow-green-400/80'
              }`}></div>
            <div className="min-w-0">
              <h3 className="font-semibold text-white truncate min-w-0
                           group-hover:text-cyan-100 transition-colors duration-200">
                {displayName}
              </h3>
            </div>
          </div>

          <div data-arc-agent-node="header-controls" className="flex items-center space-x-1 flex-none">
          <Button
            variant="ghost"
            className="p-1 h-6 w-6 text-gray-400 hover:text-blue-400 
                       hover:bg-blue-500/20 hover:shadow-lg hover:shadow-blue-500/40
                       transition-all duration-200 rounded-md
                       hover:scale-110 active:scale-95"
            onClick={handleToggleMinimize}
            title={isMinimized ? t('restore_size') : t('minimize')}
          >
            {isMinimized ? <MaximizeIcon width={12} height={12} /> : <MinimizeIcon width={12} height={12} />}
          </Button>
          <Button
            variant="ghost"
            className="p-1 h-6 w-6 text-gray-400 hover:text-yellow-400 
                       hover:bg-yellow-500/20 hover:shadow-lg hover:shadow-yellow-500/40
                       transition-all duration-200 rounded-md
                       hover:scale-110 active:scale-95"
            onClick={handleEdit}
            title="Configurer l'instance"
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
            aria-label={t('confirm_delete')}
            title={t('confirm_delete')}
            onClick={(e) => {
              e.stopPropagation();
              handleDelete();
            }}
          >
            <CloseIcon width={12} height={12} />
          </Button>
        </div>
      </div>

      {/* Content - Chat area without drag handle to allow text selection */}
      <div className={`transition-all duration-300 ease-in-out overflow-hidden ${
        isMinimized ? 'max-h-0 opacity-0 pointer-events-none' : ''
      }`}>
        <div className="flex flex-col h-96 relative z-10">
          {/* Agent Info - NOT draggable with enhanced styling */}
          <div className="p-3 border-b border-gray-700/50 
                          bg-gradient-to-r from-gray-900/40 via-gray-800/30 to-gray-900/40
                          backdrop-blur-sm">
            <div className="text-xs text-gray-400 mb-1 select-text 
                            group-hover:text-gray-300 transition-colors duration-200">
              {effectiveAgent.llmProvider || 'Unknown'} • {effectiveAgent.model || 'Unknown'}
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
            {isLoading && (
              <div className="flex justify-start mb-2">
                <div className="inline-flex items-center gap-2 rounded-lg border border-gray-700/70 bg-gray-800/90 px-3 py-2 text-xs text-gray-200 shadow-lg shadow-cyan-900/10">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent"></div>
                  {isHistorySynthesisActive && (
                    <HistorySynthesisIcon data-testid="history-synthesis-icon" className="h-4 w-4 animate-pulse text-cyan-300" />
                  )}
                  <span className="whitespace-pre-wrap break-words">{loadingMessage || t('loading')}</span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input Area - nodrag pour empêcher le drag pendant la saisie */}
          <div className="p-3 border-t border-gray-700 nodrag">
            <form onSubmit={handleSendMessage} className="space-y-2">
              {/* File attachment preview */}
              {pendingAttachment && (
                <div className="flex items-center justify-between bg-gray-700 p-2 rounded text-xs">
                  <span>📎 {pendingAttachment.fileName}</span>
                  <button
                    type="button"
                    onClick={() => clearNodePendingAttachment(id)}
                    className="text-red-400 hover:text-red-300"
                  >
                    ×
                  </button>
                </div>
              )}

              {/* Input row */}
              <div className="flex items-end space-x-2">
                <div className="flex-1 space-y-2">
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

                  {hasWebSearchPyTool && (
                    <div className="flex justify-start">
                      <Button
                        type="button"
                        variant="ghost"
                        className="p-2 h-8 w-8 text-sky-300 border border-sky-400/30 bg-[linear-gradient(135deg,rgba(8,33,59,0.9),rgba(13,78,118,0.78)_58%,rgba(125,211,252,0.16))] hover:text-sky-100 hover:border-sky-200/55 hover:bg-[linear-gradient(135deg,rgba(10,41,71,0.95),rgba(14,116,144,0.82)_58%,rgba(186,230,253,0.24))] hover:shadow-[0_0_16px_rgba(56,189,248,0.28)] transition-all duration-200 rounded-md hover:scale-110 active:scale-95"
                        onClick={() => setIsWebSearchParamsModalOpen(true)}
                        disabled={isLoading}
                        title={t('agentNode_webSearchParams_buttonTitle', "Paramètres Web Search de l'agent")}
                      >
                        <WebSearchIcon width={14} height={14} />
                      </Button>
                    </div>
                  )}
                </div>

                {/* Action buttons */}
                <div className="flex flex-col space-y-1">
                  {/* Extended Thinking toggle */}
                  {effectiveAgent?.capabilities?.includes(LLMCapability.ExtendedThinking) && (
                    <Button
                      type="button"
                      variant="ghost"
                      className={`p-2 h-8 w-8 transition-all duration-200 rounded-md hover:scale-110 active:scale-95 ${showThinking
                          ? 'text-purple-400 bg-purple-500/20 hover:text-purple-300 hover:bg-purple-500/30'
                          : 'text-gray-400 hover:text-purple-400 hover:bg-purple-500/20'
                        }`}
                      onClick={() => setShowThinking(!showThinking)}
                      disabled={isLoading}
                      title={showThinking ? 'Masquer la pensée' : 'Afficher la pensée'}
                    >
                      💭
                    </Button>
                  )}

                  {/* File upload */}
                  {effectiveAgent?.capabilities?.includes(LLMCapability.FileUpload) && (
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
                  {(effectiveAgent?.capabilities?.includes(LLMCapability.ImageGeneration) ||
                    effectiveAgent?.capabilities?.includes(LLMCapability.ImageModification)) && (
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

                  {/* Arc-LLM Video Generation */}
                  {effectiveAgent?.capabilities?.includes(LLMCapability.VideoGeneration) && (
                    <Button
                      type="button"
                      variant="ghost"
                      className="p-2 h-8 w-8 text-gray-400 hover:text-pink-400 
                               hover:bg-pink-500/20 hover:shadow-lg hover:shadow-pink-500/40
                               transition-all duration-200 rounded-md
                               hover:scale-110 active:scale-95"
                      onClick={handleOpenVideoPanel}
                      disabled={isLoading}
                      title="Générer une vidéo"
                    >
                      <VideoIcon />
                    </Button>
                  )}

                  {/* Arc-LLM Maps Grounding */}
                  {effectiveAgent?.capabilities?.includes(LLMCapability.MapsGrounding) && (
                    <Button
                      type="button"
                      variant="ghost"
                      className="p-2 h-8 w-8 text-gray-400 hover:text-green-400 
                               hover:bg-green-500/20 hover:shadow-lg hover:shadow-green-500/40
                               transition-all duration-200 rounded-md
                               hover:scale-110 active:scale-95"
                      onClick={handleOpenMapsPanel}
                      disabled={isLoading}
                      title="Recherche de lieux"
                    >
                      <MapIcon />
                    </Button>
                  )}

                  {/* Arc-LLM Web Search Grounding */}
                  {effectiveAgent?.capabilities?.includes(LLMCapability.WebSearchGrounding) && (
                    <Button
                      type="button"
                      variant="ghost"
                      className="p-2 h-8 w-8 text-gray-400 hover:text-blue-400 
                               hover:bg-blue-500/20 hover:shadow-lg hover:shadow-blue-500/40
                               transition-all duration-200 rounded-md
                               hover:scale-110 active:scale-95"
                      onClick={handleWebSearchGrounding}
                      disabled={isLoading || !userInput.trim()}
                      title="Recherche web"
                    >
                      <WebSearchIcon />
                    </Button>
                  )}

                  {/* Anthropic Web Fetch Tool */}
                  {effectiveAgent?.capabilities?.includes(LLMCapability.WebFetchTool) && (
                    <Button
                      type="button"
                      variant="ghost"
                      className={`p-2 h-8 w-8 transition-all duration-200 rounded-md hover:scale-110 active:scale-95 ${webFetchEnabled
                          ? 'text-teal-300 bg-teal-500/30 hover:text-teal-200 hover:bg-teal-500/40 shadow-lg shadow-teal-500/40'
                          : 'text-gray-400 hover:text-teal-400 hover:bg-teal-500/20'
                        }`}
                      onClick={() => setWebFetchEnabled(!webFetchEnabled)}
                      disabled={isLoading}
                      title={webFetchEnabled ? 'Web Fetch activé' : 'Web Fetch désactivé'}
                    >
                      🌐
                    </Button>
                  )}

                  {/* Anthropic Web Search Tool */}
                  {effectiveAgent?.capabilities?.includes(LLMCapability.WebSearchToolAnthropic) && (
                    <Button
                      type="button"
                      variant="ghost"
                      className={`p-2 h-8 w-8 transition-all duration-200 rounded-md hover:scale-110 active:scale-95 ${webSearchEnabled
                          ? 'text-orange-300 bg-orange-500/30 hover:text-orange-200 hover:bg-orange-500/40 shadow-lg shadow-orange-500/40'
                          : 'text-gray-400 hover:text-orange-400 hover:bg-orange-500/20'
                        }`}
                      onClick={() => setWebSearchEnabled(!webSearchEnabled)}
                      disabled={isLoading}
                      title={webSearchEnabled
                        ? t('agentNode_webSearchEnabled', 'Web Search activé')
                        : t('agentNode_webSearchDisabled', 'Web Search désactivé')}
                    >
                      🔍
                    </Button>
                  )}

                  {/* Send - avec effet spécial quand actif */}
                  <Button
                    type="submit"
                    variant="ghost"
                    className={`p-2 h-8 w-8 transition-all duration-200 rounded-md
                                hover:scale-110 active:scale-95 ${isLoading || (!userInput.trim() && !pendingAttachment)
                        ? 'text-gray-500 cursor-not-allowed'
                        : 'text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/20 hover:shadow-lg hover:shadow-cyan-500/40 laser-glow'
                      }`}
                    disabled={isLoading || (!userInput.trim() && !pendingAttachment)}
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
              accept={effectiveAgent?.capabilities?.includes(LLMCapability.PDFSupport) ? "image/*,application/pdf" : "image/*,text/*,.pdf,.doc,.docx"}
            />

            <WebSearchParamsModal
              isOpen={isWebSearchParamsModalOpen}
              agentName={displayName}
              initialParams={agentInstance?.configuration_json?.webSearchParams || effectiveAgent?.webSearchParams}
              isSaving={isSavingWebSearchParams}
              onClose={() => setIsWebSearchParamsModalOpen(false)}
              onSave={handleSaveWebSearchParams}
            />
          </div>
        </div>
      </div>
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

      {/* Arc-LLM Web Search Grounding Panel */}
      {showWebSearchResults && webSearchResults.webSources.length > 0 && (
        <WebSearchGroundingPanel
          isOpen={showWebSearchResults}
          onClose={() => setShowWebSearchResults(false)}
          responseText={webSearchResults.text}
          webSources={webSearchResults.webSources}
        />
      )}
    </div>
  );
});

V2AgentNode.displayName = 'V2AgentNode';