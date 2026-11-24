// services/mockLLMService.ts
// MOCK SERVICE: This is a placeholder for actual LLM API calls for non-Gemini providers.

import { LLMProvider } from '../types';

// Helper to simulate streaming
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const createMockStream = async function* (provider: LLMProvider, model: string, prompt: string, systemInstruction?: string) {
  const mockResponse = `[Réponse MOCK de ${provider} (${model})]: Je suis une simulation. Vous avez demandé : "${prompt}". Instruction système: "${systemInstruction || 'Aucune'}".`;
  const words = mockResponse.split(' ');
  try {
    for (const word of words) {
      yield { response: { text: `${word} ` } };
      await sleep(50);
    }
  } catch (error) {
    yield { error: `[Mock ${provider}] Error: ${error instanceof Error ? error.message : ''}` };
  }
};

export const generateContentStream = (provider: LLMProvider) =>
  async function* (apiKey: string, model: string, prompt: string, systemInstruction?: string) {
    yield* createMockStream(provider, model, prompt, systemInstruction);
  };

export const generateContent =
  (provider: LLMProvider) =>
  async (apiKey: string, model: string, _prompt: string, _systemInstruction?: string): Promise<{ text: string }> => {
    await sleep(500);
    return { text: `[Réponse MOCK de ${provider} (${model})]: Ceci est un résumé simulé de votre conversation.` };
  };

export const generateMultiModalContentStream = (provider: LLMProvider) =>
  async function* (apiKey: string, model: string, prompt: string, file: { mimeType: string; data: string }, _systemInstruction?: string) {
    const mockResponse = `[Réponse MOCK de ${provider} (${model})]: J'ai reçu un fichier (${file.mimeType}) et le prompt : "${prompt}".`;
    const words = mockResponse.split(' ');
    try {
      for (const word of words) {
        yield { response: { text: `${word} ` } };
        await sleep(50);
      }
    } catch (error) {
      yield { error: `[Mock ${provider}] Error: ${error instanceof Error ? error.message : ''}` };
    }
  };

export const generateContentWithSearch =
  (provider: LLMProvider) =>
  async (
    apiKey: string,
    model: string,
    prompt: string,
    _systemInstruction?: string,
  ): Promise<{ text: string; citations: { title: string; uri: string }[] }> => {
    await sleep(1000);
    return {
      text: `[Réponse MOCK de ${provider} (${model})]: La recherche web n'est pas implémentée pour ce mock. Voici une réponse générique à "${prompt}".`,
      citations: [],
    };
  };

export const generateImage =
  (provider: LLMProvider) =>
  async (_apiKey: string, _prompt: string): Promise<{ image: string; error?: undefined } | { error: string; image?: undefined }> => {
    await sleep(1500);
    return { error: `La génération d'image n'est pas implémentée pour le mock ${provider}.` };
  };

export const editImage =
  (provider: LLMProvider) =>
  async (
    _apiKey: string,
    _prompt: string,
    _image: { mimeType: string; data: string },
  ): Promise<{ image?: string; text?: string; error?: string }> => {
    await sleep(1500);
    return { error: `La modification d'image n'est pas implémentée pour le mock ${provider}.` };
  };
