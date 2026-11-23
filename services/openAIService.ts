// services/openAIService.ts
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

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_IMAGE_API_URL = 'https://api.openai.com/v1/images/generations';

const getHeaders = (apiKey: string) => {
  if (!apiKey) throw new Error('API Key for OpenAI is missing.');
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
};

const formatMessages = (history?: ChatMessage[], systemInstruction?: string, model?: string) => {
  const messages: ProviderChatMessage[] = [];
  if (systemInstruction) messages.push({ role: 'system', content: systemInstruction });

  const visionModels = ['gpt-4o'];

  history?.forEach((msg) => {
    if (msg.sender === 'user') {
      const userContent: ProviderContentPart[] = [{ type: 'text', text: msg.text }];
      if (model && visionModels.includes(model) && msg.image && msg.mimeType) {
        userContent.push({ type: 'image_url', image_url: { url: `data:${msg.mimeType};base64,${msg.image}` } });
      }
      messages.push({ role: 'user', content: userContent.length === 1 ? msg.text : userContent });
    } else if (msg.sender === 'agent') {
      if (msg.toolCalls) {
        messages.push({
          role: 'assistant',
          content: null,
          tool_calls: msg.toolCalls.map((tc) => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.arguments } })),
        });
      } else {
        messages.push({ role: 'assistant', content: msg.text });
      }
    } else if (msg.sender === 'tool' || msg.sender === 'tool_result') {
      messages.push({ role: 'tool', tool_call_id: msg.toolCallId, content: msg.text });
    }
  });

  return messages;
};

const createApiError = async (response: Response): Promise<Error> => {
  const errorData = await response.json().catch(() => ({ error: { message: response.statusText } }));
  return new Error(`OpenAI API error: ${response.status} - ${errorData.error?.message || 'Unknown error'}`);
};

const fetchWithRetry = async (url: string, options: RequestInit, maxRetries = 3, initialDelay = 1000) => {
  for (let i = 0; i < maxRetries; i++) {
    const response = await fetch(url, options);
    if (response.status !== 429) return response;
    if (i < maxRetries - 1) await new Promise((res) => setTimeout(res, initialDelay * Math.pow(2, i)));
    else return response;
  }
  throw new Error('Request failed after multiple retries.');
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

  const messages = formatMessages(history, finalSystemInstruction, model);

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
    const response = await fetchWithRetry(OPENAI_API_URL, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!response.ok) throw await createApiError(response);

    const reader = response.body?.getReader();
    if (!reader) throw new Error('Could not get reader from response body.');

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
                if (tcIndex >= toolCalls.length) {
                  toolCalls.push({ id: '', name: '', arguments: '' });
                }
                if (tc.id) toolCalls[tcIndex].id = tc.id;
                if (tc.function?.name) toolCalls[tcIndex].name = tc.function.name;
                if (tc.function?.arguments) toolCalls[tcIndex].arguments += tc.function.arguments;
              });
            }
          } catch (e) {
            console.error('Failed to parse stream chunk:', jsonStr, e);
          }
        }
      }
    }
  } catch (error) {
    console.error('Error in OpenAI generateContentStream:', error);
    yield { error: `Error: Could not get a response from OpenAI. ${error instanceof Error ? error.message : ''}` };
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
  // ... Non-streaming implementation would be similar ...
  return { text: 'Non-streaming not implemented for this refactor.' };
};

export const generateContentWithSearch = async (
  apiKey: string,
  model: string,
  prompt: string,
  systemInstruction?: string,
): Promise<{ text: string; citations: { title: string; uri: string }[] }> => {
  return { text: `Error: Web Search is not supported by OpenAI in this application.`, citations: [] };
};

export const generateImage = async (
  apiKey: string,
  prompt: string,
): Promise<{ image: string; error?: undefined } | { error: string; image?: undefined }> => {
  const headers = getHeaders(apiKey);
  const body = JSON.stringify({ model: 'dall-e-3', prompt, n: 1, size: '1024x1024', response_format: 'b64_json' });
  try {
    const response = await fetch(OPENAI_IMAGE_API_URL, { method: 'POST', headers, body });
    if (!response.ok) throw await createApiError(response);
    const data = await response.json();
    const imageBase64 = data.data[0].b64_json;
    if (!imageBase64) return { error: 'Image generation failed: no image data received.' };
    return { image: imageBase64 };
  } catch (error) {
    console.error('Error generating image from OpenAI:', error);
    return { error: `Image generation failed: ${error instanceof Error ? error.message : String(error)}` };
  }
};

export const editImage = async (
  apiKey: string,
  prompt: string,
  image: { mimeType: string; data: string },
): Promise<{ image?: string; text?: string; error?: string }> => {
  return { error: 'Image modification is not supported by OpenAI in this application.' };
};
