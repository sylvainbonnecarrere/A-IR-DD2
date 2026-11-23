// services/deepSeekService.ts
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

const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';

interface DeepSeekCacheConfig {
  enabled: boolean;
  cacheKey?: string;
}

interface DeepSeekRequestOptions {
  cache?: DeepSeekCacheConfig;
  reasoning?: boolean;
}

const getHeaders = (apiKey: string) => {
  if (!apiKey) throw new Error('API Key for DeepSeek is missing.');
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    'User-Agent': 'A-IR-DD2/1.0',
  };
};

const formatMessages = (history?: ChatMessage[], systemInstruction?: string, model?: string) => {
  const messages: ProviderChatMessage[] = [];
  if (systemInstruction) messages.push({ role: 'system', content: systemInstruction });

  history?.forEach((msg) => {
    if (msg.sender === 'user') {
      messages.push({ role: 'user', content: msg.text });
    } else if (msg.sender === 'agent') {
      if (msg.toolCalls) {
        messages.push({
          role: 'assistant',
          content: null,
          tool_calls: msg.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: tc.arguments },
          })),
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
  return new Error(`DeepSeek API error: ${response.status} - ${errorData.error?.message || 'Unknown error'}`);
};

const fetchWithRetry = async (url: string, options: RequestInit, maxRetries = 3, initialDelay = 1000) => {
  for (let i = 0; i < maxRetries; i++) {
    const response = await fetch(url, options);
    if (response.status !== 429) return response;
    if (i < maxRetries - 1) await new Promise((res) => setTimeout(res, initialDelay * Math.pow(2, i)));
    else return response;
  }
  throw new Error('DeepSeek request failed after multiple retries.');
};

const isReasoningModel = (model: string): boolean => {
  return model.includes('reasoner') || model.includes('reasoning');
};

export const generateContentStream = async function* (
  apiKey: string,
  model: string,
  systemInstruction?: string,
  history?: ChatMessage[],
  tools?: Tool[],
  outputConfig?: OutputConfig,
  options?: DeepSeekRequestOptions,
) {
  const headers = getHeaders(apiKey);
  let finalSystemInstruction = systemInstruction;

  if (outputConfig?.enabled && outputConfig.format !== 'json') {
    finalSystemInstruction =
      (systemInstruction || '') +
      `\n\nIMPORTANT: You MUST format your entire response as valid ${outputConfig.format}. Ensure the output is a single, valid code block without any extraneous text, explanations, or code fences.`;
  }

  const messages = formatMessages(history, finalSystemInstruction, model);

  // Select optimal model based on request type
  let selectedModel = model;
  if (options?.reasoning && !isReasoningModel(model)) {
    selectedModel = 'deepseek-reasoner'; // Use reasoning model for complex tasks
  } else if (!options?.reasoning && isReasoningModel(model)) {
    selectedModel = 'deepseek-chat'; // Use chat model for standard tasks
  }

  const body: ProviderRequestBody = {
    model: selectedModel,
    messages,
    stream: true,
    temperature: 0.1, // Optimized for quality
    max_tokens: isReasoningModel(selectedModel) ? 32000 : 4000,
  };

  // Add tools only for non-reasoning models (per DeepSeek documentation)
  if (tools && tools.length > 0 && !isReasoningModel(selectedModel)) {
    body.tools = tools.map((t) => ({ type: 'function', function: t }));
    body.tool_choice = 'auto';
  }

  if (outputConfig?.enabled && outputConfig.format === 'json') {
    body.response_format = { type: 'json_object' };
  }

  try {
    const response = await fetchWithRetry(DEEPSEEK_API_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) throw await createApiError(response);

    const reader = response.body?.getReader();
    if (!reader) throw new Error('Could not get reader from response body.');

    let text = '';
    let toolCalls: ToolCall[] = [];
    let currentToolCall: Partial<ToolCall> | null = null;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = new TextDecoder().decode(value);
        const lines = chunk.split('\n').filter((line) => line.trim());

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          if (line === 'data: [DONE]') break;

          try {
            const data = JSON.parse(line.slice(6));
            const delta = data.choices?.[0]?.delta;

            if (delta?.content) {
              text += delta.content;
              yield { text: delta.content, isComplete: false };
            }

            // Handle tool calls (only for non-reasoning models)
            if (delta?.tool_calls && !isReasoningModel(selectedModel)) {
              for (const toolCall of delta.tool_calls) {
                if (toolCall.index !== undefined) {
                  if (!toolCalls[toolCall.index]) {
                    toolCalls[toolCall.index] = {
                      id: toolCall.id || '',
                      name: '',
                      arguments: '',
                    };
                  }
                  currentToolCall = toolCalls[toolCall.index];
                }

                if (currentToolCall) {
                  if (toolCall.id) currentToolCall.id = toolCall.id;
                  if (toolCall.function?.name) currentToolCall.name += toolCall.function.name;
                  if (toolCall.function?.arguments) currentToolCall.arguments += toolCall.function.arguments;
                }
              }
            }

            if (data.choices?.[0]?.finish_reason) {
              yield { text: '', isComplete: true, toolCalls: toolCalls.length > 0 ? toolCalls : undefined };
              break;
            }
          } catch (parseError) {
            console.warn('DeepSeek parsing error:', parseError);
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  } catch (error) {
    console.error('DeepSeek Stream Error:', error);
    throw error;
  }
};

export const generateContent = async (
  apiKey: string,
  model: string,
  systemInstruction?: string,
  history?: ChatMessage[],
  tools?: Tool[],
  outputConfig?: OutputConfig,
  options?: DeepSeekRequestOptions,
): Promise<{ text: string; toolCalls?: ToolCall[] }> => {
  const headers = getHeaders(apiKey);
  let finalSystemInstruction = systemInstruction;

  if (outputConfig?.enabled && outputConfig.format !== 'json') {
    finalSystemInstruction =
      (systemInstruction || '') +
      `\n\nIMPORTANT: You MUST format your entire response as valid ${outputConfig.format}. Ensure the output is a single, valid code block without any extraneous text, explanations, or code fences.`;
  }

  const messages = formatMessages(history, finalSystemInstruction, model);

  // Select optimal model based on request type
  let selectedModel = model;
  if (options?.reasoning && !isReasoningModel(model)) {
    selectedModel = 'deepseek-reasoner';
  } else if (!options?.reasoning && isReasoningModel(model)) {
    selectedModel = 'deepseek-chat';
  }

  const body: ProviderRequestBody = {
    model: selectedModel,
    messages,
    stream: false,
    temperature: 0.1,
    max_tokens: isReasoningModel(selectedModel) ? 32000 : 4000,
  };

  // Add tools only for non-reasoning models
  if (tools && tools.length > 0 && !isReasoningModel(selectedModel)) {
    body.tools = tools.map((t) => ({ type: 'function', function: t }));
    body.tool_choice = 'auto';
  }

  if (outputConfig?.enabled && outputConfig.format === 'json') {
    body.response_format = { type: 'json_object' };
  }

  try {
    const response = await fetchWithRetry(DEEPSEEK_API_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) throw await createApiError(response);

    const data = await response.json();
    const choice = data.choices?.[0];

    if (!choice) throw new Error('No response choice from DeepSeek API');

    const result: { text: string; toolCalls?: ToolCall[] } = {
      text: choice.message?.content || '',
    };

    // Handle tool calls for non-reasoning models
    if (choice.message?.tool_calls && !isReasoningModel(selectedModel)) {
      result.toolCalls = choice.message.tool_calls.map((tc: RawProviderToolCall) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: tc.function.arguments,
      }));
    }

    return result;
  } catch (error) {
    console.error('DeepSeek API Error:', error);
    throw error;
  }
};

// Cache optimization utilities for cost reduction
export const createCacheKey = (messages: ProviderChatMessage[], model: string): string => {
  const content = JSON.stringify({ messages, model });
  return btoa(content).replace(/[/+=]/g, ''); // Safe base64 for cache key
};

export const estimateCost = (inputTokens: number, outputTokens: number, cacheHit: boolean = false): number => {
  const inputCost = cacheHit ? 0.028 : 0.28; // per 1M tokens
  const outputCost = 0.42; // per 1M tokens

  return (inputTokens * inputCost + outputTokens * outputCost) / 1000000;
};

// Model information for UI
export const getDeepSeekModels = () => [
  {
    id: 'deepseek-chat',
    name: 'DeepSeek V3.2-Exp (Chat)',
    description: 'Flagship model for general tasks with excellent performance/price ratio',
    maxTokens: 128000,
    contextWindow: 128000,
    pricing: { input: 0.28, output: 0.42, cacheHit: 0.028 },
  },
  {
    id: 'deepseek-reasoner',
    name: 'DeepSeek V3.2-Exp (Reasoner)',
    description: 'Reasoning model for complex problem solving (no function calling)',
    maxTokens: 64000,
    contextWindow: 128000,
    pricing: { input: 0.28, output: 0.42, cacheHit: 0.028 },
  },
];
