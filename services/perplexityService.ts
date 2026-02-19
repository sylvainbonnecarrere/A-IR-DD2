// services/perplexityService.ts
import { ChatMessage, Tool, ToolCall, OutputConfig } from '../types';

const PERPLEXITY_API_URL = 'https://api.perplexity.ai/chat/completions';

const getHeaders = (apiKey: string) => {
    if (!apiKey) throw new Error("API Key for Perplexity is missing.");
    return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` };
};

const formatMessages = (history?: ChatMessage[], systemInstruction?: string) => {
    const messages: any[] = [];
    if (systemInstruction) messages.push({ role: 'system', content: systemInstruction });
    
    history?.forEach(msg => {
       if (msg.sender === 'user') messages.push({ role: 'user', content: msg.text });
       else if (msg.sender === 'agent' && !msg.toolCalls) messages.push({ role: 'assistant', content: msg.text });
       else if (msg.sender === 'agent' && msg.toolCalls) {
           const tool_calls = msg.toolCalls.map(tc => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.arguments } }));
           messages.push({ role: 'assistant', content: null, tool_calls });
       }
       else if (msg.sender === 'tool_result' || msg.sender === 'tool') {
            messages.push({ role: 'tool', tool_call_id: msg.toolCallId, content: msg.text });
       }
    });

    return messages;
};

const createApiError = async (response: Response): Promise<Error> => {
    const errorData = await response.json().catch(() => ({ error: { message: response.statusText } }));
    return new Error(`Perplexity API error: ${response.status} - ${errorData.error?.message || 'Unknown error'}`);
};

export const generateContentStream = async function* (
    apiKey: string, model: string,
    systemInstruction?: string, history?: ChatMessage[], tools?: Tool[], outputConfig?: OutputConfig
) {
    const headers = getHeaders(apiKey);
    
    let finalSystemInstruction = systemInstruction;
    // Perplexity doesn't have a dedicated JSON mode, so we rely on system prompts for formatting
    if (outputConfig?.enabled) {
        finalSystemInstruction = (systemInstruction || '') + `\n\nIMPORTANT: You MUST format your entire response as valid ${outputConfig.format}. Ensure the output is a single, valid code block without any extraneous text, explanations, or code fences.`;
    }

    const messages = formatMessages(history, finalSystemInstruction);
    
    const body: any = {
        model,
        messages,
        stream: true,
        ...(tools && tools.length > 0 && { tools: tools.map(t => ({ type: 'function', function: t })), tool_choice: 'auto' })
    };
    
    try {
        const response = await fetch(PERPLEXITY_API_URL, { method: 'POST', headers, body: JSON.stringify(body) });
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
                        if (delta?.content) {
                            yield { response: { text: delta.content } };
                        }
                        if (delta?.tool_calls) {
                             delta.tool_calls.forEach((tc: any) => {
                                if (tc.index >= toolCalls.length) {
                                    toolCalls.push({ id: '', name: '', arguments: '' });
                                }
                                if (tc.id) toolCalls[tc.index].id = tc.id;
                                if (tc.function?.name) toolCalls[tc.index].name = tc.function.name;
                                if (tc.function?.arguments) toolCalls[tc.index].arguments += tc.function.arguments;
                            });
                        }
                    } catch (e) { 
                        console.error("Failed to parse Perplexity stream chunk:", jsonStr, e); 
                    }
                }
            }
        }
    } catch (error) {
        console.error("Error in Perplexity generateContentStream:", error);
        yield { error: `Error from Perplexity: ${error instanceof Error ? error.message : ''}` };
    }
};

export const generateContent = async (
    apiKey: string, model: string,
    systemInstruction?: string, history?: ChatMessage[], tools?: Tool[], outputConfig?: OutputConfig
): Promise<{ text: string }> => {
    let fullText = '';
    const stream = generateContentStream(apiKey, model, systemInstruction, history, tools, outputConfig);
    for await (const chunk of stream) {
        if (chunk.response?.text) {
            fullText += chunk.response.text;
        } else if (chunk.error) {
            return { text: chunk.error };
        }
        // This function doesn't handle tool calls, only text responses.
    }
    return { text: fullText };
};

export const generateContentWithSearch = async (
    apiKey: string, model: string, prompt: string, systemInstruction?: string
): Promise<{ text: string; citations: { title: string; uri: string }[] }> => {
    // For Perplexity, web search is implicitly enabled by using an 'online' model.
    // The API does not return structured citation data like Gemini, so we return an empty array.
    const history: ChatMessage[] = [{ id: 'search-prompt', sender: 'user', text: prompt, timestamp: new Date() }];
    const result = await generateContent(apiKey, model, systemInstruction, history);
    return { text: result.text, citations: [] };
};

export const generateImage = async (
    apiKey: string, prompt: string
): Promise<{ image: string; error?: undefined } | { error: string; image?: undefined }> => {
    return { error: 'Image generation is not supported by Perplexity.' };
};

export const editImage = async (
    apiKey: string, prompt: string, image: { mimeType: string; data: string }
): Promise<{ image?: string; text?: string; error?: string }> => {
    return { error: 'Image modification is not supported by Perplexity.' };
};