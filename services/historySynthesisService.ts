import * as llmService from './llmService';
import { resolveHistoryRuntimeConfig } from './runtimeConfigResolver';
import { computeHistoryLimitStats, getTriggeredHistoryLimits, type HistoryLimitStats } from './historySynthesisPolicy';
import { ChatMessage, HistoryConfig, HistoryLimitKey, InvisibleHistorySummaryState, LLMConfig, LLMProvider, LocalLLMProfile } from '../types';
import { validateAndRepairHistoryConfig } from '../utils/historyConfigDefaults';

const HIDDEN_HISTORY_SUMMARY_MESSAGE_ID = '__hidden-history-summary__';

interface SummaryResolution {
  activeSummaryState: InvisibleHistorySummaryState | null;
  unsummarizedMessages: ChatMessage[];
}

export interface PrepareConversationHistoryOptions {
  visibleMessagesBeforeSend: ChatMessage[];
  userMessage: ChatMessage;
  historyConfig: HistoryConfig | null | undefined;
  invisibleSummaryState?: InvisibleHistorySummaryState | null;
  llmConfigs: LLMConfig[];
  localLLMProfiles?: LocalLLMProfile[];
  inheritedLocalLLMProfileId?: string;
  t: (key: string) => string;
  accessToken?: string | null;
  onSummarizingChange?: (isSummarizing: boolean) => void;
}

export interface PreparedConversationHistory {
  conversationHistoryForAPI: ChatMessage[];
  invisibleSummaryState: InvisibleHistorySummaryState | null;
  triggeredLimitKeys: HistoryLimitKey[];
  historyStats: HistoryLimitStats;
}

function buildHiddenSummaryMessage(summary: string): ChatMessage {
  return {
    id: HIDDEN_HISTORY_SUMMARY_MESSAGE_ID,
    sender: 'agent',
    text: summary,
    timestamp: new Date(),
  };
}

function resolveSummaryBaseline(
  visibleMessagesBeforeSend: ChatMessage[],
  invisibleSummaryState: InvisibleHistorySummaryState | null | undefined,
): SummaryResolution {
  if (!invisibleSummaryState) {
    return {
      activeSummaryState: null,
      unsummarizedMessages: visibleMessagesBeforeSend,
    };
  }

  const coveredIndex = visibleMessagesBeforeSend.findIndex(
    (message) => message.id === invisibleSummaryState.coveredThroughMessageId,
  );

  if (coveredIndex === -1) {
    return {
      activeSummaryState: null,
      unsummarizedMessages: visibleMessagesBeforeSend,
    };
  }

  return {
    activeSummaryState: invisibleSummaryState,
    unsummarizedMessages: visibleMessagesBeforeSend.slice(coveredIndex + 1),
  };
}

function toConversationLines(messages: ChatMessage[]): string {
  return messages.map((message) => `${message.sender}: ${message.text}`).join('\n');
}

function resolveAvailableHistoryProviders(
  historyConfig: HistoryConfig | null | undefined,
  llmConfigs: LLMConfig[],
): LLMProvider[] {
  return Array.from(new Set([
    historyConfig?.llmProvider,
    ...llmConfigs.filter((config) => config.enabled).map((config) => config.provider),
    LLMProvider.Gemini,
  ].filter((provider): provider is LLMProvider => Boolean(provider))));
}

export async function prepareConversationHistoryForAPI({
  visibleMessagesBeforeSend,
  userMessage,
  historyConfig,
  invisibleSummaryState = null,
  llmConfigs,
  localLLMProfiles = [],
  inheritedLocalLLMProfileId,
  t,
  accessToken = null,
  onSummarizingChange,
}: PrepareConversationHistoryOptions): Promise<PreparedConversationHistory> {
  const effectiveHistoryConfig = historyConfig
    ? validateAndRepairHistoryConfig(historyConfig, resolveAvailableHistoryProviders(historyConfig, llmConfigs))
    : null;

  if (!effectiveHistoryConfig?.enabled) {
    return {
      conversationHistoryForAPI: [userMessage],
      invisibleSummaryState,
      triggeredLimitKeys: [],
      historyStats: computeHistoryLimitStats([userMessage]),
    };
  }

  const { activeSummaryState, unsummarizedMessages } = resolveSummaryBaseline(
    visibleMessagesBeforeSend,
    invisibleSummaryState,
  );

  const conversationBase = activeSummaryState
    ? [buildHiddenSummaryMessage(activeSummaryState.summary), ...unsummarizedMessages]
    : visibleMessagesBeforeSend;

  const candidateConversation = [...conversationBase, userMessage];
  const historyStats = computeHistoryLimitStats(candidateConversation);
  const triggeredLimitKeys = getTriggeredHistoryLimits(effectiveHistoryConfig, historyStats);
  const hasHistoryToSummarize = visibleMessagesBeforeSend.length > 0 && (!activeSummaryState || unsummarizedMessages.length > 0);

  if (triggeredLimitKeys.length === 0 || !hasHistoryToSummarize) {
    return {
      conversationHistoryForAPI: candidateConversation,
      invisibleSummaryState: activeSummaryState,
      triggeredLimitKeys,
      historyStats,
    };
  }

  onSummarizingChange?.(true);

  try {
    const summarizationRuntime = resolveHistoryRuntimeConfig(
      effectiveHistoryConfig,
      llmConfigs,
      localLLMProfiles,
      inheritedLocalLLMProfileId,
    );
    const summarizationConfig = summarizationRuntime.config;

    if (!summarizationConfig) {
      throw new Error(`Summarization LLM ${effectiveHistoryConfig.llmProvider} not configured.`);
    }

    const summarizationSource = activeSummaryState
      ? [buildHiddenSummaryMessage(activeSummaryState.summary), ...unsummarizedMessages]
      : visibleMessagesBeforeSend;

    const summarizationPrompt = `${t('conversation_to_summarize')}:\n\n${toConversationLines(summarizationSource)}`;
    const summarizationHistory: ChatMessage[] = [{
      id: `${HIDDEN_HISTORY_SUMMARY_MESSAGE_ID}-prompt`,
      sender: 'user',
      text: summarizationPrompt,
      timestamp: new Date(),
    }];

    const { text: summaryText } = await llmService.generateContent(
      summarizationConfig.provider,
      summarizationRuntime.credential,
      effectiveHistoryConfig.model,
      effectiveHistoryConfig.systemPrompt,
      summarizationHistory,
      undefined,
      undefined,
      summarizationRuntime.credential,
      accessToken ?? undefined,
    );

    const nextInvisibleSummaryState: InvisibleHistorySummaryState = {
      summary: summaryText.trim(),
      coveredThroughMessageId: visibleMessagesBeforeSend[visibleMessagesBeforeSend.length - 1].id,
      updatedAt: new Date().toISOString(),
    };

    return {
      conversationHistoryForAPI: [buildHiddenSummaryMessage(nextInvisibleSummaryState.summary), userMessage],
      invisibleSummaryState: nextInvisibleSummaryState,
      triggeredLimitKeys,
      historyStats,
    };
  } finally {
    onSummarizingChange?.(false);
  }
}