import type { ChatMessage } from '../types';

export function shouldSuppressVisualToolResult(message: ChatMessage, messages: ChatMessage[]): boolean {
  if (message.sender !== 'tool_result' || !message.toolCallId) {
    return false;
  }

  return messages.some((candidate) => (
    candidate.sender === 'tool'
    && candidate.toolCallRecord?.id === message.toolCallId
  ));
}