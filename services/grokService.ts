// services/grokService.ts
import { ChatMessage, Tool, ToolCall, OutputConfig } from '../types';
import type {
  ProviderChatMessage,
  ProviderContentPart,
  ProviderRequestBody,
  RawProviderToolCall,
  ProviderCitation,
} from './llm/providerApi.types';

const GROK_API_URL = 'https://api.x.ai/v1/chat/completions';

const getHeaders = (apiKey: string) => {
  if (!apiKey) throw new Error('API Key for Grok is missing.');
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
};

const createApiError = async (response: Response): Promise<Error> => {
  const errorBody = await response.text();
  try {
    const errorData = JSON.parse(errorBody);
    const message = errorData.error?.message || errorData.message || JSON.stringify(errorData);
    return new Error(`xAI Grok API error: ${response.status} - ${message}`);
  } catch {
    return new Error(`xAI Grok API error: ${response.status} - ${errorBody}`);
  }
};

const buildMessages = (history?: ChatMessage[], systemInstruction?: string) => {
  const messages: ProviderChatMessage[] = [];
  if (systemInstruction) messages.push({ role: 'system', content: systemInstruction });

  history?.forEach((msg) => {
    if (msg.sender === 'user') {
      const userContent: ProviderContentPart[] = [{ type: 'text', text: msg.text }];
      if (msg.image && msg.mimeType) {
        userContent.push({ type: 'image_url', image_url: { url: `data:${msg.mimeType};base64,${msg.image}` } });
      }
      messages.push({ role: 'user', content: userContent.length === 1 ? msg.text : userContent });
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
  const messages = buildMessages(history, finalSystemInstruction);

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
    const response = await fetch(GROK_API_URL, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!response.ok) throw await createApiError(response);

    const reader = response.body?.getReader();
    if (!reader) throw new Error('Could not get reader from response body.');
    const decoder = new TextDecoder();
    let buffer = '';
    const toolCalls: ToolCall[] = [];

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
            console.error('Failed to parse Grok stream chunk:', jsonStr, e);
          }
        }
      }
    }
  } catch (error) {
    console.error('Error in Grok generateContentStream:', error);
    yield { error: `Error from xAI (Grok): ${error instanceof Error ? error.message : ''}` };
  }
};

export const generateContent = async (
  _apiKey: string,
  _model: string,
  _systemInstruction?: string,
  _history?: ChatMessage[],
  _tools?: Tool[],
  _outputConfig?: OutputConfig,
): Promise<{ text: string }> => {
  return { text: 'Non-streaming not implemented for Grok.' };
};
export const generateContentWithSearch = async (
  _apiKey: string,
  _model: string,
  _prompt: string,
): Promise<{ text: string; citations: ProviderCitation[] }> => {
  return { text: `Error: Web Search not supported.`, citations: [] };
};
export const generateImage = async (
  _apiKey: string,
  _prompt: string,
): Promise<{ image: string; error?: undefined } | { error: string; image?: undefined }> => {
  return { error: 'Image generation is not supported.' };
};
export const editImage = async (
  _apiKey: string,
  _prompt: string,
  _image: { mimeType: string; data: string },
): Promise<{ image?: string; text?: string; error?: string }> => {
  return { error: 'Image modification is not supported by Grok.' };
};
