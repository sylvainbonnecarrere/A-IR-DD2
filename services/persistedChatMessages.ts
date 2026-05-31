import type { ChatMessage, ToolCallRecord } from '../types';

const normalizeTimestamp = (value: Date | string | undefined): string => {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return value ? new Date(value).toISOString() : '';
};

const LEGACY_TOOL_INVOCATION_PATTERN = /^([^\s(][^(]*)\(([\s\S]*)\)(?:\s+\[([^\]]+)\])?$/;
const LEGACY_TOOL_RESULT_EXECUTION_ID_PATTERN = /^\[executionId=([^\]]+)\]\s*/;

function parseJsonValue(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return '';
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

function toToolArguments(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  if (Array.isArray(value)) {
    return { items: value };
  }

  if (value === '') {
    return {};
  }

  return { value };
}

function parseLegacyToolInvocation(text: string): {
  functionName: string;
  arguments: Record<string, unknown>;
  executionId?: string;
} | null {
  const match = text.trim().match(LEGACY_TOOL_INVOCATION_PATTERN);
  if (!match) {
    return null;
  }

  const functionName = match[1]?.trim();
  if (!functionName) {
    return null;
  }

  const parsedArguments = parseJsonValue(match[2] ?? '');
  const executionId = match[3]?.trim() || undefined;

  return {
    functionName,
    arguments: toToolArguments(parsedArguments),
    executionId,
  };
}

function parseLegacyToolResult(text: string): {
  executionId?: string;
  result: unknown;
} {
  const match = text.match(LEGACY_TOOL_RESULT_EXECUTION_ID_PATTERN);
  const executionId = match?.[1]?.trim() || undefined;
  const rawResult = match ? text.slice(match[0].length) : text;

  return {
    executionId,
    result: parseJsonValue(rawResult),
  };
}

function resolveLegacyToolStatus(
  toolMessage: ChatMessage,
  toolResultMessage: ChatMessage,
  result: unknown,
): 'success' | 'error' {
  if (toolMessage.isError || toolResultMessage.isError) {
    return 'error';
  }

  if (typeof result === 'object' && result !== null && !Array.isArray(result)) {
    const resultRecord = result as Record<string, unknown>;
    if (typeof resultRecord.error === 'string' || resultRecord.success === false) {
      return 'error';
    }
  }

  return 'success';
}

function normalizeLegacyToolMessages(messages: ChatMessage[]): ChatMessage[] {
  const normalizedMessages = [...messages];
  let hasChanges = false;
  const consumedToolResultIndexes = new Set<number>();

  for (let index = 0; index < normalizedMessages.length; index += 1) {
    const toolMessage = normalizedMessages[index];
    if (toolMessage.toolCallRecord) {
      continue;
    }

    const parsedInvocation = parseLegacyToolInvocation(toolMessage.text);
    const canNormalizeInvocation = parsedInvocation
      && (toolMessage.sender === 'tool' || (toolMessage.sender === 'agent' && !!parsedInvocation.executionId));

    if (!canNormalizeInvocation || !parsedInvocation) {
      continue;
    }

    let matchingToolResultIndex = -1;
    for (let resultIndex = index + 1; resultIndex < normalizedMessages.length; resultIndex += 1) {
      const candidate = normalizedMessages[resultIndex];
      if (consumedToolResultIndexes.has(resultIndex)) {
        continue;
      }

      if (candidate.sender !== 'tool_result' && candidate.sender !== 'agent') {
        continue;
      }

      const parsedResult = parseLegacyToolResult(candidate.text);
      const sameExecutionId = !!parsedInvocation.executionId && parsedResult.executionId === parsedInvocation.executionId;
      const sameToolName = candidate.sender === 'tool_result'
        && !!candidate.toolName
        && candidate.toolName === (toolMessage.toolName ?? parsedInvocation.functionName);

      if (sameExecutionId || sameToolName) {
        matchingToolResultIndex = resultIndex;
        break;
      }
    }

    if (matchingToolResultIndex < 0) {
      continue;
    }

    const toolResultMessage = normalizedMessages[matchingToolResultIndex];
    const parsedToolResult = parseLegacyToolResult(toolResultMessage.text);
    const toolCallId = toolResultMessage.toolCallId || `legacy-tool-call:${parsedInvocation.executionId ?? toolMessage.id}`;
    const functionName = toolMessage.toolName ?? toolResultMessage.toolName ?? parsedInvocation.functionName;
    const executionId = parsedInvocation.executionId ?? parsedToolResult.executionId;

    normalizedMessages[index] = {
      ...toolMessage,
      sender: 'tool',
      toolName: functionName,
      toolCallRecord: {
        id: toolCallId,
        functionName,
        arguments: parsedInvocation.arguments,
        result: parsedToolResult.result,
        status: resolveLegacyToolStatus(toolMessage, toolResultMessage, parsedToolResult.result),
        executionId,
        timestamp: toolMessage.timestamp,
      },
    };

    normalizedMessages[matchingToolResultIndex] = {
      ...toolResultMessage,
      sender: 'tool_result',
      toolCallId,
      toolName: functionName,
    };

    consumedToolResultIndexes.add(matchingToolResultIndex);
    hasChanges = true;
  }

  return hasChanges ? normalizedMessages : messages;
}

export function normalizePersistedToolTranscriptMessages(messages: ChatMessage[]): ChatMessage[] {
  return normalizeLegacyToolMessages(messages);
}

export const mapPersistedToolCallRecord = (record: any): ToolCallRecord | undefined => {
  if (!record) {
    return undefined;
  }

  return {
    ...record,
    timestamp: new Date(record.timestamp || Date.now())
  };
};

export const mapPersistedChatMessages = (messages: any[] = []): ChatMessage[] => normalizePersistedToolTranscriptMessages(messages.map((message: any, index: number) => ({
  id: message.id || `chat-${index}-${message.timestamp || Date.now()}`,
  sender: message.sender === 'user'
    ? 'user'
    : message.sender === 'tool'
      ? 'tool'
      : message.sender === 'tool_result'
        ? 'tool_result'
        : 'agent',
  text: message.text || '',
  timestamp: new Date(message.timestamp || Date.now()),
  image: message.image,
  mimeType: message.mimeType,
  filename: message.fileName || message.filename,
  fileContent: message.fileContent,
  citations: message.citations,
  toolCalls: message.toolCalls,
  toolCallId: message.toolCallId,
  toolName: message.toolName,
  status: message.status,
  isError: message.isError,
  mapsGrounding: message.mapsGrounding,
  webSearchGrounding: message.webSearchGrounding,
  videoGeneration: message.videoGeneration,
  thinking: message.thinking,
  document: message.document,
  documentType: message.documentType,
  toolCallRecord: mapPersistedToolCallRecord(message.toolCallRecord),
})));

export const buildPersistedMessageIdentity = (message: ChatMessage) => [
  (() => {
    if (message.toolCallRecord?.id) {
      return `tool-record::${message.toolCallRecord.id}`;
    }

    if (message.sender === 'tool_result' && message.toolCallId) {
      return `tool-result::${message.toolCallId}`;
    }

    if (message.id) {
      return `message::${message.id}`;
    }

    const toolCallIds = Array.isArray(message.toolCalls)
      ? message.toolCalls.map((toolCall) => toolCall.id).filter(Boolean).join('|')
      : '';

    return [
      message.sender,
      message.text,
      normalizeTimestamp(message.timestamp),
      message.status || '',
      message.toolCallId || '',
      message.toolName || '',
      toolCallIds,
    ].join('::');
  })(),
].join('');

export const mergePersistedAndRuntimeMessages = (persistedMessages: ChatMessage[], currentMessages: ChatMessage[]): ChatMessage[] => {
  if (persistedMessages.length === 0) {
    return currentMessages;
  }

  if (currentMessages.length === 0) {
    return persistedMessages;
  }

  const merged = [...persistedMessages];
  const seen = new Set(persistedMessages.map(buildPersistedMessageIdentity));

  for (const message of currentMessages) {
    const identity = buildPersistedMessageIdentity(message);
    if (!seen.has(identity)) {
      seen.add(identity);
      merged.push(message);
    }
  }

  return merged.sort((left, right) => {
    const leftTime = left.timestamp instanceof Date ? left.timestamp.getTime() : new Date(left.timestamp).getTime();
    const rightTime = right.timestamp instanceof Date ? right.timestamp.getTime() : new Date(right.timestamp).getTime();
    return leftTime - rightTime;
  });
};