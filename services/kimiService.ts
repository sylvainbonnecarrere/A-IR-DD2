// services/kimiService.ts
import { ChatMessage, Tool, ToolCall, OutputConfig } from '../types';
import type {
  ProviderChatMessage,
  ProviderContentPart,
  ProviderRequestBody,
  RawProviderToolCall,
  ProviderCitation,
  RawLMStudioModel,
  ProviderToolDefinition,
  ProviderResponseFormat,
} from './llm/providerApi.types';

const KIMI_API_URL = 'https://kimi-k2.ai/api/v1/chat/completions';

const getHeaders = (apiKey: string) => {
  if (!apiKey) throw new Error('API Key for Kimi K2 is missing.');
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
};

const formatMessages = (history?: ChatMessage[], systemInstruction?: string) => {
  const messages: ProviderChatMessage[] = [];
  if (systemInstruction) messages.push({ role: 'system', content: systemInstruction });
  history?.forEach((msg) => {
    if (msg.sender === 'user') {
      messages.push({ role: 'user', content: msg.text });
    } else if (msg.sender === 'agent' && !msg.toolCalls) {
      messages.push({ role: 'assistant', content: msg.text });
    } else if (msg.sender === 'agent' && msg.toolCalls) {
      messages.push({
        role: 'assistant',
        content: null,
        tool_calls: msg.toolCalls.map((tc) => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.arguments } })),
      });
    } else if (msg.sender === 'tool_result' || msg.sender === 'tool') {
      messages.push({ role: 'tool', tool_call_id: msg.toolCallId, content: msg.text });
    }
  });
  return messages;
};

export const generateContentStream = async function* (
  apiKey: string,
  model: string,
  systemInstruction?: string,
  history?: ChatMessage[],
  tools?: Tool[],
  outputConfig?: OutputConfig,
) {
  const headers = getHeaders(apiKey);

  let finalSystemInstruction = systemInstruction;
  if (outputConfig?.enabled && outputConfig.format !== 'json') {
    finalSystemInstruction =
      (systemInstruction || '') +
      `\n\nIMPORTANT: You MUST format your entire response as valid ${outputConfig.format}. Ensure the output is a single, valid code block without any extraneous text, explanations, or code fences.`;
  }
  const messages = formatMessages(history, finalSystemInstruction);

  const body: ProviderRequestBody = {
    model,
    messages,
    stream: true,
    ...(tools && tools.length > 0 && { tools: tools.map((t) => ({ type: 'function', function: t })), tool_choice: 'auto' }),
  };
  if (outputConfig?.enabled && outputConfig.format === 'json') {
    body.response_format = { type: 'json_object' };
  }

  try {
    const response = await fetch(KIMI_API_URL, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Kimi API error: ${response.status} - ${errorData.error?.message || JSON.stringify(errorData)}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('Could not get reader.');
    const decoder = new TextDecoder();
    let buffer = '';
    let toolCalls: ToolCall[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const jsonStr = line.substring(6);
          if (jsonStr.trim() === '[DONE]') {
            if (toolCalls.length > 0) yield { response: { toolCalls } };
            return;
          }
          try {
            const chunk = JSON.parse(jsonStr);
            const delta = chunk.choices?.[0]?.delta;
            if (delta?.content) yield { response: { text: delta.content } };
            if (delta?.tool_calls) {
              delta.tool_calls.forEach((tc: RawProviderToolCall) => {
                const tcIndex = tc.index ?? toolCalls.length;
                if (tcIndex >= toolCalls.length) toolCalls.push({ id: '', name: '', arguments: '' });
                if (tc.id) toolCalls[tcIndex].id = tc.id;
                if (tc.function?.name) toolCalls[tcIndex].name = tc.function.name;
                if (tc.function?.arguments) toolCalls[tcIndex].arguments += tc.function.arguments;
              });
            }
          } catch (e) {
            console.error('Failed to parse Kimi stream chunk:', jsonStr, e);
          }
        }
      }
    }
  } catch (error) {
    console.error('Error in Kimi generateContentStream:', error);
    yield { error: `Error from Kimi: ${error instanceof Error ? error.message : ''}` };
  }
};

export const generateContent = async (
  apiKey: string,
  model: string,
  systemInstruction?: string,
  history?: ChatMessage[],
  tools?: Tool[],
  outputConfig?: OutputConfig,
): Promise<{ text: string }> => {
  return { text: 'Non-streaming not implemented.' };
};
export const generateContentWithSearch = async (
  apiKey: string,
  model: string,
  prompt: string,
): Promise<{ text: string; citations: ProviderCitation[] }> => {
  return { text: `Error: Kimi does not support web search.`, citations: [] };
};
export const generateImage = async (
  apiKey: string,
  prompt: string,
): Promise<{ image: string; error?: undefined } | { error: string; image?: undefined }> => {
  return { error: 'Image generation is not supported.' };
};
export const editImage = async (
  apiKey: string,
  prompt: string,
  image: { mimeType: string; data: string },
): Promise<{ image?: string; text?: string; error?: string }> => {
  return { error: 'Image modification is not supported by Kimi.' };
};
