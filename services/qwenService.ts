// services/qwenService.ts
import { ChatMessage, Tool, ToolCall, OutputConfig } from '../types';
import type { ProviderChatMessage, ProviderContentPart, RawProviderToolCall, ProviderCitation } from './llm/providerApi.types';

const QWEN_API_URL = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation';

const getHeaders = (apiKey: string, stream: boolean = false) => {
  if (!apiKey) throw new Error('API Key for Qwen is missing.');
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
  if (stream) headers['X-DashScope-SSE'] = 'enable';
  return headers;
};

const formatTools = (tools?: Tool[]) => {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((tool) => ({ type: 'function', function: tool }));
};

const buildMessages = (history?: ChatMessage[], systemInstruction?: string) => {
  const messages: ProviderChatMessage[] = [];
  if (systemInstruction) messages.push({ role: 'system', content: systemInstruction });

  history?.forEach((msg) => {
    if (msg.sender === 'user') {
      let userContent: string | ProviderContentPart[];
      if (msg.image && msg.mimeType) {
        userContent = [{ image: `data:${msg.mimeType};base64,${msg.image}` }, { text: msg.text }];
      } else {
        userContent = msg.text;
      }
      messages.push({ role: 'user', content: userContent });
    } else if (msg.sender === 'agent' && !msg.toolCalls) {
      messages.push({ role: 'assistant', content: msg.text });
    } else if (msg.sender === 'agent' && msg.toolCalls) {
      // Aligned with standard OpenAI tool call format. Fixes 422 errors.
      messages.push({
        role: 'assistant',
        content: null,
        tool_calls: msg.toolCalls.map((tc) => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.arguments } })),
      });
    } else if (msg.sender === 'tool_result' || msg.sender === 'tool') {
      // Aligned with standard OpenAI tool result format.
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
  const headers = getHeaders(apiKey, true);

  let finalSystemInstruction = systemInstruction;
  if (outputConfig?.enabled) {
    finalSystemInstruction =
      (systemInstruction || '') +
      `\n\nIMPORTANT: You MUST format your entire response as valid ${outputConfig.format}. Ensure the output is a single, valid code block without any extraneous text, explanations, or code fences.`;
  }

  const messages = buildMessages(history, finalSystemInstruction);
  const formattedTools = formatTools(tools);

  const body = JSON.stringify({
    model,
    input: { messages },
    parameters: {
      stream: true,
      result_format: 'message',
      ...(formattedTools && { tools: formattedTools, tool_choice: 'auto' }),
    },
  });

  try {
    const response = await fetch(QWEN_API_URL, { method: 'POST', headers, body });
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Qwen API error: ${response.status} - ${errorData.message || errorData.code}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('Could not get reader.');
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data:')) {
          const jsonStr = line.substring(5).trim();
          try {
            const chunk = JSON.parse(jsonStr);
            const message = chunk.output?.choices?.[0]?.message;
            if (message?.content) {
              yield { response: { text: message.content } };
            }
            if (message?.tool_calls) {
              const toolCalls: ToolCall[] = message.tool_calls.map((tc: RawProviderToolCall) => ({
                id: tc.id,
                name: tc.function.name,
                arguments: tc.function.arguments,
              }));
              yield { response: { toolCalls } };
            }
          } catch (e) {
            console.error('Failed to parse Qwen stream chunk:', jsonStr, e);
          }
        }
      }
    }
  } catch (error) {
    console.error('Error in Qwen generateContentStream:', error);
    yield { error: `Error from Qwen: ${error instanceof Error ? error.message : ''}` };
  }
};

export const generateContent = async (
  _apiKey: string,
  _model: string,
  _systemInstruction?: string,
  _history?: ChatMessage[],
  _tools?: Tool[],
  _outputConfig?: OutputConfig,
): Promise<{ text: string }> => ({ text: 'Not implemented' });
export const generateContentWithSearch = async (
  _apiKey: string,
  _model: string,
  _prompt: string,
): Promise<{ text: string; citations: ProviderCitation[] }> => ({ text: 'Not supported', citations: [] });
export const generateImage = async (
  _apiKey: string,
  _prompt: string,
): Promise<{ image: string; error?: undefined } | { error: string; image?: undefined }> => ({ error: 'Not supported' });
export const editImage = async (
  _apiKey: string,
  _prompt: string,
  _image: { mimeType: string; data: string },
): Promise<{ image?: string; text?: string; error?: string }> => {
  return { error: 'Image modification is not supported by Qwen.' };
};
