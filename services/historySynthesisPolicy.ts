import { ChatMessage, HistoryConfig, HistoryLimitKey } from '../types';
import { countChars, countMessages, countSentences, countTokens, countWords } from '../utils/textUtils';

export interface HistoryLimitStats {
  char: number;
  word: number;
  token: number;
  sentence: number;
  message: number;
}

export const HISTORY_LIMIT_KEYS: HistoryLimitKey[] = ['char', 'word', 'token', 'sentence', 'message'];

export const computeHistoryLimitStats = (messages: ChatMessage[]): HistoryLimitStats => ({
  char: countChars(messages),
  word: countWords(messages),
  token: countTokens(messages),
  sentence: countSentences(messages),
  message: countMessages(messages),
});

const isLimitTriggerable = (historyConfig: Pick<HistoryConfig, 'limits' | 'enabledLimits'>, limitKey: HistoryLimitKey): boolean => {
  return historyConfig.enabledLimits[limitKey] && historyConfig.limits[limitKey] > 0;
};

export const getTriggeredHistoryLimits = (
  historyConfig: Pick<HistoryConfig, 'limits' | 'enabledLimits'>,
  stats: HistoryLimitStats
): HistoryLimitKey[] => {
  return HISTORY_LIMIT_KEYS.filter((limitKey) => {
    if (!isLimitTriggerable(historyConfig, limitKey)) {
      return false;
    }

    return stats[limitKey] >= historyConfig.limits[limitKey];
  });
};

export const shouldTriggerHistorySynthesis = (
  historyConfig: Pick<HistoryConfig, 'limits' | 'enabledLimits'>,
  stats: HistoryLimitStats
): boolean => {
  return getTriggeredHistoryLimits(historyConfig, stats).length > 0;
};