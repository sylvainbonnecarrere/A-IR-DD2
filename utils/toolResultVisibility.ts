import type { ChatMessage } from '../types';

export function shouldSuppressVisualToolResult(message: ChatMessage, messages: ChatMessage[]): boolean {
  if (message.sender !== 'tool_result' || message.toolName !== 'web_search_py' || !message.toolCallId) {
    return false;
  }

  return messages.some((candidate) => (
    candidate.sender === 'tool'
    && candidate.toolName === message.toolName
    && candidate.toolCallRecord?.id === message.toolCallId
  ));
}