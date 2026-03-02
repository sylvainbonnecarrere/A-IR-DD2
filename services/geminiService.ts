// services/geminiService.ts
import { GoogleGenAI, Modality, Content } from "@google/genai";
import { ChatMessage, Tool, OutputConfig } from "../types";

const formatTools = (tools?: Tool[]) => {
    if (!tools || tools.length === 0) return undefined;
    return {
        functionDeclarations: tools.map(tool => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
        }))
    };
};

const formatHistory = (history?: ChatMessage[]): Content[] => {
    if (!history) return [];
    const geminiHistory: Content[] = [];

    for (const msg of history) {
        if (msg.sender === 'user') {
            const parts: any[] = [{ text: msg.text }];
            if (msg.image && msg.mimeType) {
                parts.push({ inlineData: { mimeType: msg.mimeType, data: msg.image } });
            }
            geminiHistory.push({ role: 'user', parts });
        } else if (msg.sender === 'agent') {
            if (msg.toolCalls && msg.toolCalls.length > 0) {
                geminiHistory.push({
                    role: 'model',
                    parts: msg.toolCalls.map(tc => ({
                        functionCall: {
                            name: tc.name,
                            args: JSON.parse(tc.arguments)
                        }
                    }))
                });
            } else if (msg.text) {
                geminiHistory.push({ role: 'model', parts: [{ text: msg.text }] });
            }
        } else if (msg.sender === 'tool_result' && msg.toolName) {
            geminiHistory.push({
                role: 'function',
                parts: [{
                    functionResponse: {
                        name: msg.toolName,
                        response: JSON.parse(msg.text)
                    }
                }]
            });
        }
    }
    return geminiHistory;
};


export const generateContentStream = async function* (
    apiKey: string,
    model: string,
    systemInstruction?: string, history?: ChatMessage[], tools?: Tool[], outputConfig?: OutputConfig
) {
    if (!apiKey) {
        throw new Error('API key is required for Gemini service');
    }

    const ai = new GoogleGenAI({ apiKey });
    const formattedTools = formatTools(tools);
    const formattedHistory = formatHistory(history);

    const config: any = {};

    let finalSystemInstruction = systemInstruction;
    if (outputConfig?.enabled && outputConfig.format !== 'json') {
        finalSystemInstruction = (systemInstruction || '') + `\n\nIMPORTANT: You MUST format your entire response as valid ${outputConfig.format}. Do not include any text, code fences, or explanations before or after the content.`;
    }

    if (finalSystemInstruction) config.systemInstruction = finalSystemInstruction;
    if (outputConfig?.enabled && outputConfig.format === 'json') {
        config.responseMimeType = 'application/json';
    }
    if (formattedTools) {
        config.tools = [formattedTools];
    }

    // Gemini 3 specific: thinking_level for reasoning models
    if (model.includes('gemini-3')) {
        config.thinkingLevel = 'high'; // Default to high for best reasoning
    }

    try {
        const responseStream = await ai.models.generateContentStream({
            model,
            contents: formattedHistory,
            ...(Object.keys(config).length > 0 && { config }),
        });

        for await (const chunk of responseStream) {
            if (chunk.functionCalls && chunk.functionCalls.length > 0) {
                const toolCalls = chunk.functionCalls.map(fc => ({
                    id: `tool-call-${Date.now()}-${Math.random()}`, // Gemini SDK does not provide an ID for streaming tool calls yet.
                    name: fc.name,
                    arguments: JSON.stringify(fc.args),
                }));

                yield {
                    response: {
                        toolCalls: toolCalls,
                    },
                };
                return;
            }
            yield { response: chunk };
        }
    } catch (error) {
        console.error("Error generating content stream:", error);
        yield { error: `Error: Could not get a response from Gemini. ${error instanceof Error ? error.message : ''}` };
    }
};

export const generateContent = async (
    apiKey: string,
    model: string,
    systemInstruction?: string, history?: ChatMessage[], tools?: Tool[], outputConfig?: OutputConfig
): Promise<{ text: string }> => {
    if (!apiKey) {
        throw new Error('API key is required for Gemini service');
    }

    const ai = new GoogleGenAI({ apiKey });
    const formattedTools = formatTools(tools);
    const formattedHistory = formatHistory(history);

    const config: any = {};

    let finalSystemInstruction = systemInstruction;
    if (outputConfig?.enabled && outputConfig.format !== 'json') {
        finalSystemInstruction = (systemInstruction || '') + `\n\nIMPORTANT: You MUST format your entire response as valid ${outputConfig.format}. Do not include any text, code fences, or explanations before or after the content.`;
    }

    if (finalSystemInstruction) config.systemInstruction = finalSystemInstruction;
    if (outputConfig?.enabled && outputConfig.format === 'json') {
        config.responseMimeType = 'application/json';
    }
    if (formattedTools) {
        config.tools = [formattedTools];
    }

    // Gemini 3 specific: thinking_level for reasoning models
    if (model.includes('gemini-3')) {
        config.thinkingLevel = 'high'; // Default to high for best reasoning
    }

    try {
        const response = await ai.models.generateContent({
            model,
            contents: formattedHistory,
            ...(Object.keys(config).length > 0 && { config }),
        });
        return { text: response.text };
    } catch (error) {
        console.error("Error generating content:", error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        return { text: `Error: Could not get a response from Gemini. ${errorMessage}` };
    }
};

export const generateContentWithSearch = async (
    apiKey: string,
    model: string,
    prompt: string,
    systemInstruction?: string
): Promise<{ text: string; citations: { title: string; uri: string }[] }> => {
    if (!apiKey) {
        throw new Error('API key is required for Gemini service');
    }

    const ai = new GoogleGenAI({ apiKey });
    try {
        const config: any = {
            tools: [{ googleSearch: {} }],
            ...(systemInstruction && { systemInstruction }),
        };

        // Gemini 3 specific: thinking_level for reasoning models
        if (model.includes('gemini-3')) {
            config.thinkingLevel = 'high';
        }

        const response = await ai.models.generateContent({
            model,
            contents: prompt,
            config,
        });

        const text = response.text;
        const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
        const citations = groundingChunks
            .map((chunk: any) => ({ title: chunk.web?.title || 'Source', uri: chunk.web?.uri || '#' }))
            .filter((c: any) => c.uri !== '#');

        return { text, citations };
    } catch (error) {
        console.error("Error generating content with search:", error);
        return { text: `Error: Could not get a response from Gemini. ${error instanceof Error ? error.message : String(error)}`, citations: [] };
    }
};

export const generateImage = async (
    apiKey: string,
    prompt: string,
    model?: string // Optional model parameter (defaults to imagen-3.0)
): Promise<{ image: string; error?: undefined } | { error: string; image?: undefined }> => {
    if (!apiKey) {
        throw new Error('API key is required for Gemini service');
    }

    const ai = new GoogleGenAI({ apiKey });
    try {
        const imageModel = model || 'imagen-3.0-generate-001';
        const response = await ai.models.generateImages({
            model: imageModel, prompt,
            config: { numberOfImages: 1, outputMimeType: 'image/png' },
        });
        const base64ImageBytes = response.generatedImages[0].image.imageBytes;
        if (!base64ImageBytes) return { error: 'Image generation failed: no image data received.' };
        return { image: base64ImageBytes };
    } catch (error) {
        console.error("Error generating image:", error);
        return { error: `Image generation failed: ${error instanceof Error ? error.message : String(error)}` };
    }
};

export const editImage = async (
    apiKey: string,
    prompt: string,
    image: { mimeType: string; data: string }
): Promise<{ image?: string; text?: string; error?: string }> => {
    if (!apiKey) {
        throw new Error('API key is required for Gemini service');
    }

    const ai = new GoogleGenAI({ apiKey });
    try {
        const imagePart = { inlineData: { mimeType: image.mimeType, data: image.data } };
        const textPart = { text: prompt };

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image-preview',
            contents: { parts: [imagePart, textPart] },
            config: {
                responseModalities: [Modality.IMAGE, Modality.TEXT],
            },
        });

        let modifiedImage: string | undefined;
        let responseText: string | undefined;

        for (const part of response.candidates[0].content.parts) {
            if (part.text) {
                responseText = part.text;
            } else if (part.inlineData) {
                modifiedImage = part.inlineData.data;
            }
        }

        if (!modifiedImage) {
            return { error: 'Image modification failed: no image data received.' };
        }

        return { image: modifiedImage, text: responseText };

    } catch (error) {
        console.error("Error editing image with Gemini:", error);
        return { error: `Image modification failed: ${error instanceof Error ? error.message : String(error)}` };
    }
};

/**
 * Generate video using Gemini Veo 3.1
 * @returns VideoGenerationStatus with operationId for polling
 */
export const generateVideo = async (
    apiKey: string,
    options: import("../types").VideoGenerationOptions,
    model?: string // Optional model parameter (defaults to veo-001)
): Promise<import("../types").VideoGenerationStatus> => {
    if (!apiKey) {
        throw new Error('API key is required for Gemini service');
    }

    const ai = new GoogleGenAI({ apiKey });
    try {
        // Build config
        const config: any = {
            aspectRatio: options.aspectRatio || '16:9',
            resolution: options.resolution || '720p',
            durationSeconds: options.durationSeconds || 8,
            personGeneration: options.personGeneration || 'allow_all',
        };

        if (options.negativePrompt) {
            config.negativePrompt = options.negativePrompt;
        }

        if (options.seed !== undefined) {
            config.seed = options.seed;
        }

        // Reference images
        if (options.referenceImages && options.referenceImages.length > 0) {
            config.referenceImages = options.referenceImages.map(ref => ({
                image: { mimeType: ref.image.mimeType, data: ref.image.data },
                referenceType: ref.referenceType,
            }));
        }

        // Last frame (for interpolation)
        if (options.lastFrame) {
            config.lastFrame = options.lastFrame;
        }

        // Build request
        const videoModel = model || 'veo-001';
        const request: any = {
            model: videoModel,
            prompt: options.prompt,
            config,
        };

        // First frame (for image-to-video or interpolation)
        if (options.firstFrame) {
            request.image = options.firstFrame;
        }

        // Extension mode (continue existing video)
        if (options.mode === 'extension' && options.existingVideo) {
            request.video = options.existingVideo;
        }

        // Call API
        const operation = await ai.models.generateVideos(request);

        return {
            operationId: operation.name,
            status: 'PROCESSING',
            progress: 0,
        };
    } catch (error) {
        console.error("Error generating video with Gemini:", error);
        return {
            operationId: '',
            status: 'FAILED',
            error: error instanceof Error ? error.message : String(error),
        };
    }
};

/**
 * Poll video operation status
 * @returns Updated VideoGenerationStatus with videoUrl when completed
 */
export const pollVideoOperation = async (
    apiKey: string,
    operationId: string
): Promise<import("../types").VideoGenerationStatus> => {
    if (!apiKey) {
        throw new Error('API key is required for Gemini service');
    }

    const ai = new GoogleGenAI({ apiKey });
    try {
        // Cast to any because Google GenAI SDK types may not match runtime behavior
        const operation = await (ai.operations as any).get({ name: operationId }) as any;

        if (operation.done) {
            if (operation.response?.generatedVideos?.[0]) {
                const video = operation.response.generatedVideos[0];

                // Note: files.download API has changed - we may need to handle differently
                // For now, use video URL directly if available
                const videoUrl = video.uri || video.video?.uri || video.url;
                
                return {
                    operationId,
                    status: 'COMPLETED',
                    progress: 100,
                    videoUrl: videoUrl || '',
                };
            } else {
                return {
                    operationId,
                    status: 'FAILED',
                    error: 'No video generated in response',
                };
            }
        } else {
            // Still processing - estimate progress based on typical generation time (~60s)
            // This is a rough estimate since Gemini doesn't provide progress percentage
            return {
                operationId,
                status: 'PROCESSING',
                progress: Math.min(50, 100), // Cap at 50% while processing
            };
        }
    } catch (error) {
        console.error("Error polling video operation:", error);
        return {
            operationId,
            status: 'FAILED',
            error: error instanceof Error ? error.message : String(error),
        };
    }
};