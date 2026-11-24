// services/anthropicService.ts
import { ChatMessage, Tool, ToolCall, OutputConfig } from '../types';
import type { ProviderChatMessage, ProviderContentPart, ProviderToolDefinition, ProviderResponseFormat } from './llm/providerApi.types';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

// Native Anthropic tools (executed by Anthropic API, not client)
const ANTHROPIC_NATIVE_TOOLS = {
  web_fetch: {
    type: 'computer_2025_01' as const,
    name: 'web_fetch',
    description: 'Fetches content from a URL and returns the text content',
  },
  web_search: {
    type: 'computer_2025_01' as const,
    name: 'web_search',
    description: 'Searches the web and returns relevant results',
  },
};

const getHeaders = (apiKey: string) => {
  if (!apiKey) throw new Error('API Key for Anthropic is missing.');
  return {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'anthropic-beta': 'tool-use,extended-thinking-2025-01-31,web-fetch-2025-01-31,web-search-2025-01-31',
  };
};

const formatTools = (tools?: Tool[], includeWebFetch?: boolean, includeWebSearch?: boolean) => {
  const formattedTools: ProviderToolDefinition[] = [];

  // Add user-defined tools
  if (tools && tools.length > 0) {
    formattedTools.push(
      ...tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters,
      })),
    );
  }

  // Add native Anthropic Web Fetch tool if requested
  if (includeWebFetch) {
    formattedTools.push(ANTHROPIC_NATIVE_TOOLS.web_fetch);
  }

  // Add native Anthropic Web Search tool if requested
  if (includeWebSearch) {
    formattedTools.push(ANTHROPIC_NATIVE_TOOLS.web_search);
  }

  return formattedTools.length > 0 ? formattedTools : undefined;
};

const formatMessages = (history?: ChatMessage[]) => {
  const messages: ProviderChatMessage[] = [];
  history?.forEach((msg) => {
    if (msg.sender === 'user') {
      const userContent: ProviderContentPart[] = [{ type: 'text', text: msg.text }];

      // Handle PDF documents
      if (msg.document && msg.documentType === 'pdf') {
        userContent.unshift({
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: msg.document,
          },
        });
      }
      // Handle images (existing behavior)
      else if (msg.image && msg.mimeType) {
        userContent.unshift({ type: 'image', source: { type: 'base64', media_type: msg.mimeType, data: msg.image } });
      }

      messages.push({ role: 'user', content: userContent });
    } else if (msg.sender === 'agent') {
      if (msg.toolCalls) {
        const toolUseContent = msg.toolCalls.map((tc) => ({ type: 'tool_use', id: tc.id, name: tc.name, input: JSON.parse(tc.arguments) }));
        messages.push({ role: 'assistant', content: toolUseContent });
      } else {
        messages.push({ role: 'assistant', content: msg.text });
      }
    } else if (msg.sender === 'tool' || msg.sender === 'tool_result') {
      messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: msg.toolCallId, content: msg.text }] });
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
  nativeToolsConfig?: { webFetch?: boolean; webSearch?: boolean },
) {
  const headers = getHeaders(apiKey);
  // Check if we need to include native tools based on user toggles
  const includeWebFetch = nativeToolsConfig?.webFetch || false;
  const includeWebSearch = nativeToolsConfig?.webSearch || false;
  const formattedTools = formatTools(tools, includeWebFetch, includeWebSearch);
  const messages = formatMessages(history);

  let finalSystemInstruction = systemInstruction;

  // Structured Outputs: Use native JSON schema validation if outputConfig is enabled
  let responseFormat: ProviderResponseFormat | undefined = undefined;
  if (outputConfig?.enabled && outputConfig.schema) {
    // Use Anthropic's native response_format for JSON schema validation
    responseFormat = {
      type: 'json_schema',
      json_schema: outputConfig.schema,
    };
  } else if (outputConfig?.enabled) {
    // Fallback to legacy XML tag wrapping for backward compatibility
    const format = outputConfig.format;
    finalSystemInstruction =
      (systemInstruction || '') +
      `\n\nIMPORTANT: You MUST wrap your entire response in <${format}>...</${format}> tags. Do not add any text, explanations, or code fences before or after these tags.`;
  }

  const body = JSON.stringify({
    model,
    system: finalSystemInstruction,
    messages,
    max_tokens: 4096,
    stream: true,
    ...(formattedTools && { tools: formattedTools }),
    ...(responseFormat && { response_format: responseFormat }),
  });

  try {
    const response = await fetch(ANTHROPIC_API_URL, { method: 'POST', headers, body });
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Anthropic API error: ${response.status} - ${errorData.error?.message || 'Unknown error'}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('Could not get reader from response body.');
    const decoder = new TextDecoder();
    let buffer = '';
    const currentToolCalls: ToolCall[] = [];
    let currentToolInput = '';
    let thinkingContent = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const jsonStr = line.substring(6);
          try {
            const chunk = JSON.parse(jsonStr);
            if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
              yield { response: { text: chunk.delta.text } };
            }
            if (chunk.type === 'content_block_delta' && chunk.delta.type === 'thinking_delta') {
              thinkingContent += chunk.delta.thinking;
            }
            if (chunk.type === 'content_block_stop' && thinkingContent) {
              yield { response: { thinking: thinkingContent } };
              thinkingContent = '';
            }
            if (chunk.type === 'content_block_start' && chunk.content_block.type === 'tool_use') {
              currentToolCalls.push({ id: chunk.content_block.id, name: chunk.content_block.name, arguments: '' });
            }
            if (chunk.type === 'content_block_delta' && chunk.delta.type === 'input_json_delta') {
              currentToolInput += chunk.delta.partial_json;
            }
            if (chunk.type === 'content_block_stop') {
              if (currentToolCalls.length > 0) {
                const lastTool = currentToolCalls[currentToolCalls.length - 1];
                if (lastTool && lastTool.arguments === '') {
                  lastTool.arguments = currentToolInput;
                  currentToolInput = '';
                }
              }
            }
            if (chunk.type === 'message_stop') {
              if (currentToolCalls.length > 0) {
                yield { response: { toolCalls: currentToolCalls } };
              }
            }
          } catch (e) {
            console.error('Failed to parse Anthropic stream chunk:', jsonStr, e);
          }
        }
      }
    }
  } catch (error) {
    console.error('Error in Anthropic generateContentStream:', error);
    yield { error: `Error from Anthropic: ${error instanceof Error ? error.message : ''}` };
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
  _systemInstruction?: string,
): Promise<{ text: string; citations: { title: string; uri: string }[] }> => {
  return { text: `Error: Web Search is not supported by Anthropic.`, citations: [] };
};

export const generateImage = async (
  _apiKey: string,
  _prompt: string,
): Promise<{ image: string; error?: undefined } | { error: string; image?: undefined }> => ({ error: 'Not supported' });
export const editImage = async (
  _apiKey: string,
  _prompt: string,
  _image: { mimeType: string; data: string },
): Promise<{ image?: string; text?: string; error?: string }> => {
  return { error: 'Image modification is not supported by Anthropic.' };
};
