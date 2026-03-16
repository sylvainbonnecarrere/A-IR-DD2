// services/lmStudioService.ts
// OPTION C HYBRID ARCHITECTURE: Local LLM Runtime Integration
// 
// Responsibility: Unified interface for local LLM communication (Ollama, LMStudio, Jan, etc.)
// 
// Architecture:
// - Configuration Phase: Backend proxy validates endpoint + probes capabilities
// - Runtime Phase: Frontend calls directly to local LLM endpoint (zero-latency)
//
// Why this architecture?
// - Performance: Direct calls eliminate proxy latency for frequent chat operations
// - Robustness: Backend validates config once during setup
// - SOLID: Single Responsibility - Backend validates, Frontend executes
// - OpenAI Compatible: All local LLMs use /v1/chat/completions interface
import { ChatMessage, Tool, ToolCall, OutputConfig } from '../types';
import { buildLMStudioProxyUrl } from '../config/api.config';

interface LMStudioConfig {
    endpoint: string;
    apiKey?: string;
    timeout: number;
}

interface LMStudioModelInfo {
    id: string;
    name: string;
    type: 'coding' | 'general' | 'efficient';
    description: string;
    parameters: string;
    quantization?: string;
    contextWindow: number;
    available: boolean;
    capabilities: {
        functionCalling: boolean;
        reasoning: boolean;
        codeSpecialization: boolean;
        multimodal: boolean;
        jsonMode: boolean;
    };
}

// Default configuration for local LLM deployment
const DEFAULT_CONFIG: LMStudioConfig = {
    endpoint: 'http://localhost:3928', // LMStudio default port
    timeout: 30000
};

const getHeaders = (config: LMStudioConfig) => {
    return {
        'Content-Type': 'application/json',
        'User-Agent': 'A-IR-DD2/1.0'
    };
};

const formatMessages = (history?: ChatMessage[], systemInstruction?: string) => {
    const messages: any[] = [];

    // MISTRAL FIX: Convert system instruction to first user message
    // Mistral models only support 'user' and 'assistant' roles
    if (systemInstruction) {
        messages.push({
            role: 'user',
            content: `[SYSTEM INSTRUCTION]\n${systemInstruction}\n\nPlease follow these instructions for all subsequent messages.`
        });
        // Add assistant acknowledgment
        messages.push({
            role: 'assistant',
            content: 'Understood. I will follow these instructions.'
        });
    }

    history?.forEach(msg => {
        if (msg.sender === 'user') {
            messages.push({ role: 'user', content: msg.text });
        } else if (msg.sender === 'agent') {
            if (msg.toolCalls) {
                messages.push({
                    role: 'assistant',
                    content: null,
                    tool_calls: msg.toolCalls.map(tc => ({
                        id: tc.id,
                        type: 'function',
                        function: { name: tc.name, arguments: tc.arguments }
                    }))
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

const detectLocalEndpoint = async (): Promise<string> => {
    // Fallback to default endpoint if not configured
    // Actual detection happens during configuration via backend proxy
    return DEFAULT_CONFIG.endpoint;
};

const createApiError = async (response: Response, endpoint: string): Promise<Error> => {
    const errorData = await response.json().catch(() => ({ error: { message: response.statusText } }));
    return new Error(`LMStudio API error (${endpoint}): ${response.status} - ${errorData.error?.message || 'Unknown error'}`);
};

const fetchWithTimeout = async (url: string, options: RequestInit, timeout: number = 30000) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        return response;
    } catch (error) {
        clearTimeout(timeoutId);
        throw error;
    }
};

export const detectAvailableModels = async (config?: Partial<LMStudioConfig>): Promise<LMStudioModelInfo[]> => {
    const fullConfig = { ...DEFAULT_CONFIG, ...config };

    try {
        const endpoint = config?.endpoint || DEFAULT_CONFIG.endpoint;

        // Configuration Phase: Use backend proxy to list available models
        // Keeps model detection logic centralized on backend
        const proxyUrl = buildLMStudioProxyUrl('models', endpoint);
        const response = await fetchWithTimeout(proxyUrl, {
            method: 'GET'
        }, 5000);

        if (!response.ok) throw await createApiError(response, endpoint);

        const data = await response.json();

        return data.data?.map((model: any) => {
            const modelInfo: LMStudioModelInfo = {
                id: model.id,
                name: model.id,
                type: getModelType(model.id),
                description: getModelDescription(model.id),
                parameters: getModelParameters(model.id),
                contextWindow: model.context_length || 32768,
                available: true,
                capabilities: getModelCapabilities(model.id)
            };

            return modelInfo;
        }) || [];
    } catch (error) {
        console.warn('Could not detect local models:', error);
        return getDefaultModels();
    }
};

const getModelCapabilities = (modelId: string): LMStudioModelInfo['capabilities'] => {
    const id = modelId.toLowerCase();

    // Function calling support - mainly modern models with specific training
    const functionCalling = id.includes('qwen2.5') ||
        id.includes('llama-3.1') ||
        id.includes('llama-3.2') ||
        (id.includes('mistral') && (id.includes('instruct') || id.includes('v0.3'))) ||
        id.includes('hermes') ||
        id.includes('functionary');

    // Reasoning capabilities - specific models trained for step-by-step reasoning
    const reasoning = id.includes('qwen2.5-coder') ||
        id.includes('deepseek') ||
        id.includes('o1') ||
        id.includes('reasoning') ||
        id.includes('cot'); // Chain of Thought models

    // Code specialization - models specifically trained for coding
    const codeSpecialization = id.includes('coder') ||
        id.includes('code') ||
        id.includes('starcoder') ||
        id.includes('codestral') ||
        id.includes('programming');

    // Multimodal support - vision-enabled models  
    const multimodal = id.includes('vision') ||
        id.includes('llava') ||
        id.includes('qwen2-vl') ||
        id.includes('llama-3.2') && (id.includes('11b') || id.includes('90b'));

    // JSON mode support - most modern instruction-tuned models
    const jsonMode = id.includes('instruct') ||
        id.includes('chat') ||
        id.includes('qwen2.5') ||
        id.includes('llama-3') ||
        id.includes('mistral') ||
        id.includes('gemma') ||
        !id.includes('base'); // Exclude base models

    return {
        functionCalling,
        reasoning,
        codeSpecialization,
        multimodal,
        jsonMode
    };
};

const getModelType = (modelId: string): 'coding' | 'general' | 'efficient' => {
    const id = modelId.toLowerCase();
    if (id.includes('coder') || id.includes('code')) return 'coding';
    if (id.includes('2b') || id.includes('mini') || id.includes('small')) return 'efficient';
    return 'general';
};

const getModelDescription = (modelId: string): string => {
    const id = modelId.toLowerCase();
    if (id.includes('qwen') && id.includes('coder')) return 'Alibaba Qwen2.5 Coder - Specialized for programming tasks';
    if (id.includes('gemma')) return 'Google Gemma 3 - Efficient instruction-tuned model';
    if (id.includes('llama')) return 'Meta Llama - General purpose language model';
    if (id.includes('mistral')) return 'Mistral - European excellence in AI';
    return 'Local language model optimized for various tasks';
};

const getModelParameters = (modelId: string): string => {
    const id = modelId.toLowerCase();
    if (id.includes('7b')) return '7B';
    if (id.includes('8b')) return '8B';
    if (id.includes('14b')) return '14B';
    if (id.includes('2b')) return '2B';
    if (id.includes('1.5b')) return '1.5B';
    return 'Unknown';
};

const getDefaultModels = (): LMStudioModelInfo[] => [
    {
        id: 'qwen2.5-coder-7b',
        name: 'Qwen2.5 Coder 7B',
        type: 'coding',
        description: 'Alibaba Qwen2.5 Coder - Specialized programming assistant',
        parameters: '7B',
        contextWindow: 32768,
        available: false,
        capabilities: {
            functionCalling: true,
            reasoning: true,
            codeSpecialization: true,
            multimodal: false,
            jsonMode: true
        }
    },
    {
        id: 'gemma3-8b-instruct',
        name: 'Gemma 3 8B Instruct',
        type: 'general',
        description: 'Google Gemma 3 - General purpose instruction-tuned model',
        parameters: '8B',
        contextWindow: 8192,
        available: false,
        capabilities: {
            functionCalling: false,
            reasoning: false,
            codeSpecialization: false,
            multimodal: false,
            jsonMode: true
        }
    },
    {
        id: 'gemma3-2b-instruct',
        name: 'Gemma 3 2B Instruct',
        type: 'efficient',
        description: 'Google Gemma 3 - Efficient model for edge deployment',
        parameters: '2B',
        contextWindow: 8192,
        available: false,
        capabilities: {
            functionCalling: false,
            reasoning: false,
            codeSpecialization: false,
            multimodal: false,
            jsonMode: true
        }
    }
];

export const generateContentStream = async function* (
    endpoint: string,
    model: string,
    systemInstruction?: string,
    history?: ChatMessage[],
    tools?: Tool[],
    outputConfig?: OutputConfig,
    apiKey?: string
) {
    const config: LMStudioConfig = {
        endpoint: endpoint || DEFAULT_CONFIG.endpoint,
        apiKey,
        timeout: 120000  // ⭐ 120s — local models (Ollama/LMStudio) can be slow to load
    };

    console.log(`[LMStudio] generateContentStream - endpoint: ${config.endpoint}, model: ${model}`);

    // Detect model capabilities from static model data (no API call)
    // NOTE: Removed detectAvailableModels() call here to avoid unnecessary /models requests
    const currentModel = getDefaultModels().find(m => m.id === model);
    const modelCapabilities = currentModel?.capabilities || getModelCapabilities(model);

    const headers = getHeaders(config);
    let finalSystemInstruction = systemInstruction;

    // Only apply output formatting if model supports JSON mode
    if (outputConfig?.enabled && outputConfig.format !== 'json') {
        finalSystemInstruction = (systemInstruction || '') +
            `\n\nIMPORTANT: You MUST format your entire response as valid ${outputConfig.format}. Ensure the output is a single, valid code block without any extraneous text, explanations, or code fences.`;
    }

    const messages = formatMessages(history, finalSystemInstruction);

    const body: any = {
        model,
        messages,
        stream: true,
        temperature: 0.7,
        max_tokens: 4000
    };

    // Only add tools if the model supports function calling
    if (tools && tools.length > 0 && modelCapabilities.functionCalling) {
        body.tools = tools.map(t => ({ type: 'function', function: t }));
        body.tool_choice = 'auto';
    } else if (tools && tools.length > 0) {
        console.warn(`[LMStudio] Model ${model} does not support function calling, tools ignored`);
    }

    // Only set JSON mode if model supports it
    if (outputConfig?.enabled && outputConfig.format === 'json' && modelCapabilities.jsonMode) {
        body.response_format = { type: 'json_object' };
    } else if (outputConfig?.enabled && outputConfig.format === 'json') {
        console.warn(`[LMStudio] Model ${model} does not support JSON mode, falling back to prompt instruction`);
        finalSystemInstruction = (finalSystemInstruction || '') +
            '\n\nIMPORTANT: You MUST respond with valid JSON only, no other text.';
        body.messages = formatMessages(history, finalSystemInstruction);
    }

    try {
        // OPTION C HYBRID: Runtime Phase - Direct call to local LLM endpoint (not via backend proxy)
        // Configuration was validated by backend during setup, now frontend calls directly
        const directUrl = `${config.endpoint}/v1/chat/completions`;
        const response = await fetchWithTimeout(directUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        }, config.timeout);

        if (!response.ok) throw await createApiError(response, config.endpoint);

        const reader = response.body?.getReader();
        if (!reader) throw new Error("Could not get reader from response body.");

        let text = '';
        let toolCalls: ToolCall[] = [];
        let currentToolCall: Partial<ToolCall> | null = null;
        let buffer = ''; // Buffer for incomplete lines

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = new TextDecoder().decode(value);
                buffer += chunk;

                // Split by newlines but keep the last incomplete line in buffer
                const lines = buffer.split('\n');
                buffer = lines.pop() || ''; // Keep incomplete line in buffer

                for (const line of lines) {
                    if (!line.trim()) continue;
                    if (!line.startsWith('data: ')) continue;
                    if (line === 'data: [DONE]') break;

                    try {
                        const data = JSON.parse(line.slice(6));
                        const delta = data.choices?.[0]?.delta;

                        if (delta?.content) {
                            text += delta.content;
                            // V2AgentNode expects: { response: { text: string } }
                            yield { response: { text: delta.content }, isComplete: false };
                        }

                        // Handle tool calls if supported
                        if (delta?.tool_calls) {
                            for (const toolCall of delta.tool_calls) {
                                if (toolCall.index !== undefined) {
                                    if (!toolCalls[toolCall.index]) {
                                        toolCalls[toolCall.index] = {
                                            id: toolCall.id || '',
                                            name: '',
                                            arguments: ''
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
                            if (toolCalls.length > 0) {
                                console.log('[LMStudio] Completing with tool calls:', toolCalls);
                            } else if (tools && tools.length > 0) {
                                console.warn(`[LMStudio] Model "${model}" did not return tool_calls. Function calling may not be supported by this model.`);
                            }
                            yield {
                                response: { text: '' },
                                isComplete: true,
                                toolCalls: toolCalls.length > 0 ? toolCalls : undefined
                            };
                            break;
                        }
                    } catch (parseError) {
                        console.warn('LMStudio parsing error:', parseError);
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }
    } catch (error) {
        console.error('LMStudio Stream Error:', error);
        throw error;
    }
};

export const generateContent = async (
    endpoint: string,
    model: string,
    systemInstruction?: string,
    history?: ChatMessage[],
    tools?: Tool[],
    outputConfig?: OutputConfig,
    apiKey?: string
): Promise<{ text: string; toolCalls?: ToolCall[] }> => {
    const config: LMStudioConfig = {
        endpoint: endpoint || DEFAULT_CONFIG.endpoint,
        apiKey,
        timeout: 30000
    };

    console.log(`[LMStudio] generateContent - endpoint: ${config.endpoint}, model: ${model}`);

    // Detect model capabilities from static model data (no API call)
    // NOTE: Removed detectAvailableModels() call here to avoid unnecessary /models requests
    const currentModel = getDefaultModels().find(m => m.id === model);
    const modelCapabilities = currentModel?.capabilities || getModelCapabilities(model);

    const headers = getHeaders(config);
    let finalSystemInstruction = systemInstruction;

    // Only apply output formatting if model supports it
    if (outputConfig?.enabled && outputConfig.format !== 'json') {
        finalSystemInstruction = (systemInstruction || '') +
            `\n\nIMPORTANT: You MUST format your entire response as valid ${outputConfig.format}. Ensure the output is a single, valid code block without any extraneous text, explanations, or code fences.`;
    }

    const messages = formatMessages(history, finalSystemInstruction);

    const body: any = {
        model,
        messages,
        stream: false,
        temperature: 0.1,
        max_tokens: 4000
    };

    // Only add tools if the model supports function calling
    if (tools && tools.length > 0 && modelCapabilities.functionCalling) {
        body.tools = tools.map(t => ({ type: 'function', function: t }));
        body.tool_choice = 'auto';
    } else if (tools && tools.length > 0) {
        console.warn(`[LMStudio] Model ${model} does not support function calling, tools ignored`);
    }

    // Only set JSON mode if model supports it
    if (outputConfig?.enabled && outputConfig.format === 'json' && modelCapabilities.jsonMode) {
        body.response_format = { type: 'json_object' };
    } else if (outputConfig?.enabled && outputConfig.format === 'json') {
        console.warn(`[LMStudio] Model ${model} does not support JSON mode, falling back to prompt instruction`);
        finalSystemInstruction = (finalSystemInstruction || '') +
            '\n\nIMPORTANT: You MUST respond with valid JSON only, no other text.';
        body.messages = formatMessages(history, finalSystemInstruction);
    }

    try {
        // OPTION C HYBRID: Runtime Phase - Direct call to local LLM endpoint (not via backend proxy)
        // Configuration was validated by backend during setup, now frontend calls directly
        const directUrl = `${config.endpoint}/v1/chat/completions`;
        const response = await fetchWithTimeout(directUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        }, config.timeout);

        if (!response.ok) throw await createApiError(response, config.endpoint);

        const data = await response.json();
        const choice = data.choices?.[0];

        if (!choice) throw new Error("No response choice from LMStudio API");

        const result: { text: string; toolCalls?: ToolCall[] } = {
            text: choice.message?.content || ''
        };

        if (choice.message?.tool_calls) {
            result.toolCalls = choice.message.tool_calls.map((tc: any) => ({
                id: tc.id,
                name: tc.function.name,
                arguments: tc.function.arguments
            }));
        }

        return result;
    } catch (error) {
        console.error('LMStudio API Error:', error);
        throw error;
    }
};

// Health check for local server
export const checkServerHealth = async (endpoint?: string): Promise<{ healthy: boolean; endpoint?: string; models?: number }> => {
    try {
        const detectedEndpoint = endpoint || DEFAULT_CONFIG.endpoint;
        const models = await detectAvailableModels({ endpoint: detectedEndpoint });

        return {
            healthy: true,
            endpoint: detectedEndpoint,
            models: models.length
        };
    } catch (error) {
        return {
            healthy: false
        };
    }
};

export type { LMStudioConfig, LMStudioModelInfo };