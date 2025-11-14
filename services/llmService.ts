// services/llmService.ts
// This service acts as a dispatcher to the correct LLM provider service.

import { LLMProvider, Tool, ChatMessage, OutputConfig } from '../types';
import * as geminiService from './geminiService';
import * as openAIService from './openAIService';
import * as mistralService from './mistralService';
import * as anthropicService from './anthropicService';
import * as grokService from './grokService';
import * as qwenService from './qwenService';
import * as perplexityService from './perplexityService';
import * as kimiService from './kimiService';
import * as deepSeekService from './deepSeekService';
import * as lmStudioService from './lmStudioService';
import * as arcLLMService from './arcLLMService';
import type { VideoGenerationOptions, VideoGenerationStatus, MapsGroundingResponse, WebSearchGroundingResponse } from '../types';


const getServiceProvider = (provider: LLMProvider) => {
    switch (provider) {
        case LLMProvider.Gemini: return geminiService;
        case LLMProvider.OpenAI: return openAIService;
        case LLMProvider.Mistral: return mistralService;
        case LLMProvider.Anthropic: return anthropicService;
        case LLMProvider.Grok: return grokService;
        case LLMProvider.Qwen: return qwenService;
        case LLMProvider.Perplexity: return perplexityService;
        case LLMProvider.Kimi: return kimiService;
        case LLMProvider.DeepSeek: return deepSeekService;
        case LLMProvider.LMStudio: return lmStudioService;
        case LLMProvider.ArcLLM: return arcLLMService;
        default: return geminiService;
    }
};

export const generateContentStream = async function* (
    provider: LLMProvider, apiKey: string, model: string,
    systemInstruction?: string, history?: ChatMessage[], tools?: Tool[], outputConfig?: OutputConfig,
    endpoint?: string // For LMStudio local endpoint
) {
    const service = getServiceProvider(provider);

    // Handle LMStudio special case with endpoint parameter
    if (provider === LLMProvider.LMStudio) {
        yield* (service as any).generateContentStream(endpoint || 'http://localhost:3928', model, systemInstruction, history, tools, outputConfig, apiKey);
    } else {
        yield* service.generateContentStream(apiKey, model, systemInstruction, history, tools, outputConfig);
    }
};

export const generateContent = (
    provider: LLMProvider, apiKey: string, model: string,
    systemInstruction?: string, history?: ChatMessage[], tools?: Tool[], outputConfig?: OutputConfig,
    endpoint?: string // For LMStudio local endpoint
): Promise<{ text: string }> => {
    const service = getServiceProvider(provider);

    // Handle LMStudio special case with endpoint parameter  
    if (provider === LLMProvider.LMStudio) {
        return (service as any).generateContent(endpoint || 'http://localhost:3928', model, systemInstruction, history, tools, outputConfig, apiKey);
    } else {
        return service.generateContent(apiKey, model, systemInstruction, history, tools, outputConfig);
    }
};

export const generateContentWithSearch = (
    provider: LLMProvider, apiKey: string, model: string, prompt: string, systemInstruction?: string
): Promise<{ text: string; citations: { title: string; uri: string }[] }> => {
    const service = getServiceProvider(provider);
    if (!(service as any).generateContentWithSearch) {
        return Promise.resolve({ text: `Error: ${provider} does not support Web Search.`, citations: [] });
    }
    return (service as any).generateContentWithSearch(apiKey, model, prompt, systemInstruction);
};

export const generateImage = (
    provider: LLMProvider, apiKey: string, prompt: string
): Promise<{ image: string; error?: undefined } | { error: string; image?: undefined }> => {
    const service = getServiceProvider(provider);
    if (!(service as any).generateImage) {
        return Promise.resolve({ error: `Image generation is not supported by ${provider}.` });
    }
    return (service as any).generateImage(apiKey, prompt);
};

// ===========================
// ARC-LLM SPECIFIC FUNCTIONS
// ===========================

/**
 * Génère une vidéo avec Gemini Veo 3.1 ou Arc-LLM
 * @param provider LLM Provider (Gemini ou ArcLLM)
 * @param apiKey Clé API (ignored for Gemini, uses process.env.API_KEY)
 * @param options Options de génération vidéo
 * @returns Statut d'opération avec operationId pour polling
 */
export const generateVideo = (
    provider: LLMProvider,
    apiKey: string,
    options: VideoGenerationOptions
): Promise<VideoGenerationStatus> => {
    const service = getServiceProvider(provider);
    if (!(service as any).generateVideo) {
        return Promise.resolve({
            operationId: '',
            status: 'FAILED',
            error: `Video generation is not supported by ${provider}.`
        });
    }
    return (service as any).generateVideo(apiKey, options);
};

/**
 * Polle le statut d'une génération vidéo
 * @param provider LLM Provider (Gemini ou ArcLLM)
 * @param apiKey Clé API (ignored for Gemini, uses process.env.API_KEY)
 * @param operationId ID de l'opération retourné par generateVideo
 * @returns Statut actuel de la génération
 */
export const pollVideoOperation = (
    provider: LLMProvider,
    apiKey: string,
    operationId: string
): Promise<VideoGenerationStatus> => {
    const service = getServiceProvider(provider);
    if (!(service as any).pollVideoOperation) {
        return Promise.resolve({
            operationId,
            status: 'FAILED',
            error: `Video polling not supported by ${provider}.`
        });
    }
    return (service as any).pollVideoOperation(apiKey, operationId);
};

/**
 * Génère du contenu avec Maps Grounding
 * Pour Gemini : utilise googleSearch tools
 * Pour Arc-LLM : utilise Maps Grounding API (mock)
 * 
 * @param provider LLM Provider
 * @param apiKey Clé API
 * @param model Modèle LLM
 * @param prompt Requête utilisateur
 * @param systemInstruction Instruction système optionnelle
 * @param userLocation Géolocalisation utilisateur optionnelle
 * @returns Texte de réponse + sources cartographiques
 */
export const generateContentWithMaps = async (
    provider: LLMProvider,
    apiKey: string,
    model: string,
    prompt: string,
    systemInstruction?: string,
    userLocation?: { lat: number; lng: number }
): Promise<MapsGroundingResponse> => {
    // Gemini supporte googleSearch
    if (provider === LLMProvider.Gemini) {
        try {
            const result = await geminiService.generateContentWithSearch(apiKey, model, prompt, systemInstruction);

            // Mapper citations vers mapSources
            const mapSources: any[] = result.citations.slice(0, 5).map((citation, index) => ({
                uri: citation.uri,
                placeTitle: citation.title,
                placeId: `place-${index}`,
                coordinates: {
                    latitude: 48.8566 + (Math.random() - 0.5) * 0.1,
                    longitude: 2.3522 + (Math.random() - 0.5) * 0.1
                },
                reviewExcerpts: []
            }));

            return { text: result.text, mapSources };
        } catch (error) {
            return {
                text: `Error: ${error instanceof Error ? error.message : 'Maps search failed'}`,
                mapSources: []
            };
        }
    }

    // Arc-LLM (mock)
    if (provider === LLMProvider.ArcLLM) {
        return arcLLMService.generateContentWithMaps(apiKey, model, prompt, systemInstruction, userLocation);
    }

    return Promise.resolve({
        text: `Error: Maps Grounding not supported by ${provider}`,
        mapSources: []
    });
};

/**
 * Génère du contenu avec Web Search Grounding
 * Pour Gemini : utilise googleSearch tools
 * Pour Arc-LLM : utilise Web Search Grounding API (mock)
 * Distinct de generateContentWithSearch basique
 * 
 * @param provider LLM Provider
 * @param apiKey Clé API
 * @param model Modèle LLM
 * @param prompt Requête utilisateur
 * @param systemInstruction Instruction système optionnelle
 * @returns Texte de réponse + sources web
 */
export const generateContentWithWebSearchGrounding = async (
    provider: LLMProvider,
    apiKey: string,
    model: string,
    prompt: string,
    systemInstruction?: string
): Promise<WebSearchGroundingResponse> => {
    // Gemini supporte googleSearch nativement
    if (provider === LLMProvider.Gemini) {
        try {
            const result = await geminiService.generateContentWithSearch(apiKey, model, prompt, systemInstruction);

            // Mapper citations vers webSources
            const webSources: any[] = result.citations.map(citation => ({
                uri: citation.uri,
                webTitle: citation.title,
                snippet: '' // Gemini ne retourne pas de snippet dans citations
            }));

            return {
                text: result.text,
                webSources
            };
        } catch (error) {
            console.error('Gemini Web Search Grounding failed:', error);
            return {
                text: `Error: ${error instanceof Error ? error.message : 'Web search failed'}`,
                webSources: []
            };
        }
    }

    // Arc-LLM (mock)
    if (provider === LLMProvider.ArcLLM) {
        return arcLLMService.generateContentWithWebSearch(apiKey, model, prompt, systemInstruction);
    }

    return Promise.resolve({
        text: `Error: Web Search Grounding not supported by ${provider}`,
        webSources: []
    });
};

/**
 * Obtient la géolocalisation de l'utilisateur
 * Helper pour Maps Grounding
 */
export const getUserLocation = (): Promise<{ lat: number; lng: number }> => {
    return arcLLMService.getUserLocation();
};

export const editImage = (
    provider: LLMProvider, apiKey: string, prompt: string, image: { mimeType: string; data: string }
): Promise<{ image?: string; text?: string; error?: string }> => {
    const service = getServiceProvider(provider);
    if (!(service as any).editImage) {
        return Promise.resolve({ error: `Image modification is not supported by ${provider}.` });
    }
    return (service as any).editImage(apiKey, prompt, image);
};