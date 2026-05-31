import type { ChatMessage, ToolCallRecord } from '../types';

const normalizeTimestamp = (value: Date | string | undefined): string => {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return value ? new Date(value).toISOString() : '';
};

export const mapPersistedToolCallRecord = (record: any): ToolCallRecord | undefined => {
  if (!record) {
    return undefined;
  }

  return {
    ...record,
    timestamp: new Date(record.timestamp || Date.now())
  };
};

export const mapPersistedChatMessages = (messages: any[] = []): ChatMessage[] => messages.map((message: any, index: number) => ({
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
}));

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