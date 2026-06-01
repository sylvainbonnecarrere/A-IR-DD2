// services/mistralService.ts
import { ChatMessage, Tool, ToolCall, OutputConfig } from '../types';
import { fileToBase64 } from '../utils/fileUtils';

const MISTRAL_API_BASE_URL = 'https://api.mistral.ai/v1';

const getHeaders = (apiKey: string) => {
    if (!apiKey) throw new Error("API Key for Mistral is missing.");
    return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` };
};

const createApiError = async (response: Response): Promise<Error> => {
    const errorBody = await response.text();
    let message = 'Unknown Error';
    try {
        const errorData = JSON.parse(errorBody);
        if (typeof errorData === 'object' && errorData !== null && errorData.message) {
            message = errorData.message;
        } else if (typeof errorData === 'object' && errorData !== null) {
            message = JSON.stringify(errorData);
        } else if (typeof errorData === 'string' && errorData.length > 0) {
            message = errorData;
        }
    } catch (e) {
        if (errorBody.length > 0) {
            message = errorBody;
        }
    }
    return new Error(`Mistral API error: ${response.status} - ${message}`);
};

const fetchWithRetry = async (url: string, options: RequestInit, maxRetries = 5, initialDelay = 1500) => {
    for (let i = 0; i < maxRetries; i++) {
        const response = await fetch(url, options);
        if (response.status !== 429) return response;
        if (i < maxRetries - 1) await new Promise(res => setTimeout(res, initialDelay * Math.pow(2, i)));
        else return response;
    }
    throw new Error("Request failed after multiple retries.");
};

const formatEmulatedToolResultMessage = (msg: ChatMessage) => {
    const toolLabel = msg.toolName || msg.toolCallId || 'tool';
    return `[TOOL RESULT: ${toolLabel}]\n${msg.text}`;
};

const formatMessages = (history?: ChatMessage[], systemInstruction?: string) => {
    const messages: any[] = [];
    const pendingToolCallIds = new Set<string>();

    if (systemInstruction) messages.push({ role: 'system', content: systemInstruction });
    
    history?.forEach(msg => {
       if (msg.sender === 'user') {
            pendingToolCallIds.clear();
           let content = msg.text || '';
            if (msg.fileContent && msg.filename) {
                const formattedFilePreamble = `Voici le contenu du fichier \`${msg.filename}\` pour analyse :\n\n\`\`\`\n${msg.fileContent}\n\`\`\`\n\n`;
                content = formattedFilePreamble + content;
            }
            messages.push({ role: 'user', content });
       }
       else if (msg.sender === 'agent' && !msg.toolCalls) {
            pendingToolCallIds.clear();
            messages.push({ role: 'assistant', content: msg.text });
       }
       else if (msg.sender === 'agent' && msg.toolCalls) {
            // Added content: null as it's required for tool calls in OpenAI-compatible APIs. Fixes 422 error.
            pendingToolCallIds.clear();
            messages.push({ role: 'assistant', content: null, tool_calls: msg.toolCalls.map(tc => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.arguments } })) });
            msg.toolCalls.forEach((toolCall) => {
                if (toolCall.id) {
                    pendingToolCallIds.add(toolCall.id);
                }
            });
       }
       else if (msg.sender === 'tool_result') {
            if (msg.toolCallId && pendingToolCallIds.has(msg.toolCallId)) {
                messages.push({ role: 'tool', tool_call_id: msg.toolCallId, name: msg.toolName, content: msg.text });
                pendingToolCallIds.delete(msg.toolCallId);
            } else {
                pendingToolCallIds.clear();
                messages.push({ role: 'user', content: formatEmulatedToolResultMessage(msg) });
            }
       }
       else if (msg.sender === 'tool') {
            // UI tool trace blocks are not valid native `tool` messages for Mistral.
            // Only persisted tool_result messages that directly answer an assistant tool_call
            // should use the native tool role.
       }
    });
    
    return messages;
};

export const generateContentStream = async function* (
    apiKey: string, model: string,
    systemInstruction?: string, history?: ChatMessage[], tools?: Tool[], outputConfig?: OutputConfig
) {
    const headers = getHeaders(apiKey);
    let finalSystemInstruction = systemInstruction;
    
    const body: any = { model, stream: true };

    if (outputConfig?.useCodestralCompletion) {
        body.tool_choice = 'tool_code_completion';
        body.tools = [{
            type: "function",
            function: { name: "code_completion", description: "Code completion tool", parameters: {} }
        }];
    } else {
        if (outputConfig?.enabled && outputConfig.format !== 'json') {
            finalSystemInstruction = (systemInstruction || '') + `\n\nIMPORTANT: You MUST format your entire response as valid ${outputConfig.format}. Ensure the output is a single, valid code block without any extraneous text, explanations, or code fences.`;
        }
        if (tools && tools.length > 0) {
            body.tools = tools.map(t => ({
                type: 'function',
                function: {
                    name: t.name,
                    description: t.description,
                    parameters: t.parameters,
                }
            }));
            body.tool_choice = 'auto';
        }
        if (outputConfig?.enabled && outputConfig.format === 'json') {
            body.response_format = { type: 'json_object' };
        }
    }
    
    body.messages = formatMessages(history, finalSystemInstruction);
    
    try {
        const response = await fetchWithRetry(`${MISTRAL_API_BASE_URL}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body) });
        if (!response.ok) throw await createApiError(response);

        const reader = response.body?.getReader();
        if (!reader) throw new Error("Could not get reader from response body.");
        
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
                             delta.tool_calls.forEach((tc: any) => {
                                if (tc.index >= toolCalls.length) toolCalls.push({ id: '', name: '', arguments: '' });
                                if (tc.id) toolCalls[tc.index].id = tc.id;
                                if (tc.function?.name) toolCalls[tc.index].name = tc.function.name;
                                if (tc.function?.arguments) toolCalls[tc.index].arguments += tc.function.arguments;
                            });
                        }
                    } catch (e) { console.error("Failed to parse stream chunk:", jsonStr, e); }
                }
            }
        }
    } catch (error) {
        console.error("Error in Mistral generateContentStream:", error);
        yield { error: `Error from Mistral: ${error instanceof Error ? error.message : ''}` };
    }
};

export const generateContent = async (apiKey: string, model: string, systemInstruction?: string, history?: ChatMessage[], tools?: Tool[], outputConfig?: OutputConfig): Promise<{ text: string }> => {
    return { text: "Non-streaming not implemented for Mistral in this refactor." };
};

export const createEmbedding = async (apiKey: string, text: string): Promise<{ embedding: number[]; error?: undefined } | { error: string; embedding?: undefined }> => {
    const headers = getHeaders(apiKey);
    try {
        const response = await fetchWithRetry(`${MISTRAL_API_BASE_URL}/embeddings`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ model: 'mistral-embed', input: [text] }),
        });
        if (!response.ok) throw await createApiError(response);
        const data = await response.json();
        const embedding = data.data?.[0]?.embedding;
        if (!embedding) return { error: 'No embedding data received.' };
        return { embedding };
    } catch (error) {
        console.error("Error creating Mistral embedding:", error);
        return { error: error instanceof Error ? error.message : String(error) };
    }
};

export const performOcr = async (apiKey: string, source: { file: File } | { url: string }): Promise<{ text: string; error?: undefined } | { error: string; text?: undefined }> => {
    const headers = getHeaders(apiKey);
    
    let finalHeaders = { 'Authorization': `Bearer ${apiKey}` };
    let body: any;

    try {
        if ('file' in source) {
            // Using multipart/form-data for file uploads
            const formData = new FormData();
            formData.append('model', 'CX-9');
            formData.append('file', source.file);
            body = formData;
            // For FormData, the browser sets the Content-Type header automatically with the boundary.
        } else { // 'url' in source
            finalHeaders['Content-Type'] = 'application/json';
            body = JSON.stringify({
                model: 'CX-9',
                url: source.url,
            });
        }
        
        const response = await fetchWithRetry(`${MISTRAL_API_BASE_URL}/ocr`, {
            method: 'POST',
            headers: finalHeaders,
            body,
        });

        if (!response.ok) throw await createApiError(response);
        
        const data = await response.json();
        const extractedText = data.text;
        
        if (typeof extractedText !== 'string') return { error: 'No text extracted from OCR response.' };
        
        return { text: extractedText };

    } catch (error) {
        console.error("Error performing Mistral OCR:", error);
        return { error: error instanceof Error ? error.message : String(error) };
    }
};


export const generateContentWithSearch = async (
    apiKey: string, model: string, prompt: string, systemInstruction?: string
): Promise<{ text: string; citations: { title: string; uri: string }[] }> => {
    return { text: `Error: Web Search is not supported by Mistral.`, citations: [] };
};

export const generateImage = async (apiKey: string, prompt: string): Promise<{ image: string; error?: undefined } | { error: string; image?: undefined }> => {
    return { error: 'Image generation is not supported by Mistral.' };
};

export const editImage = async (apiKey: string, prompt: string, image: { mimeType: string; data: string }): Promise<{ image?: string; text?: string; error?: string }> => {
    return { error: 'Image modification is not supported by Mistral.' };
};