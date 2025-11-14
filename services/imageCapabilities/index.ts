// services/imageCapabilities/index.ts
/**
 * POINT D'ENTRÉE: Image Capabilities Module
 * 
 * Ce module centralise l'architecture extensible pour les capacités d'image.
 * Il initialise les stratégies actives et fournit l'API unifiée.
 */

import { LLMProvider } from '../../types';
import {
    ImageServiceFactory,
    ImageGenerationOptions,
    ImageModificationOptions,
    ImageOperationResult,
    convertFromSimplePrompt,
    ImageData,
    ImageAPIPattern,
} from './imageServiceAdapter';

// Import des stratégies actives
import { GeminiImageStrategy } from './geminiImageStrategy';
import { OpenAIImageStrategy } from './openAIImageStrategy';

// Import des futures stratégies (commentées pour l'instant)
// import { StabilityImageStrategy, FluxImageStrategy } from './futureImageStrategies';

// ===========================
// INITIALISATION DES STRATÉGIES
// ===========================

/**
 * Enregistre toutes les stratégies actives au démarrage
 */
export function initializeImageStrategies(): void {
    // Stratégies actives (production)
    ImageServiceFactory.registerStrategy(LLMProvider.Gemini, new GeminiImageStrategy());
    ImageServiceFactory.registerStrategy(LLMProvider.OpenAI, new OpenAIImageStrategy());

    // Futures stratégies (décommenter lors de l'implémentation)
    // ImageServiceFactory.registerStrategy(LLMProvider.StabilityAI, new StabilityImageStrategy());
    // ImageServiceFactory.registerStrategy(LLMProvider.Flux, new FluxImageStrategy());

    console.log('[ImageCapabilities] Initialized strategies:',
        ImageServiceFactory.getImageGenerationProviders().join(', '));
}

// ===========================
// API UNIFIÉE (Facade Pattern)
// ===========================

/**
 * API unifiée pour générer une image
 * Supporte à la fois le format simple (backward compat) et le format avancé
 */
export async function generateImageUnified(
    provider: LLMProvider,
    apiKey: string,
    promptOrOptions: string | ImageGenerationOptions
): Promise<ImageOperationResult> {
    const strategy = ImageServiceFactory.getStrategy(provider);

    if (!strategy) {
        return {
            error: `Provider ${provider} does not have an image generation strategy registered.`,
        };
    }

    if (!strategy.supportsGeneration()) {
        return {
            error: `Provider ${provider} does not support image generation.`,
        };
    }

    // Conversion format simple → avancé (backward compatibility)
    const options: ImageGenerationOptions =
        typeof promptOrOptions === 'string'
            ? convertFromSimplePrompt(promptOrOptions)
            : promptOrOptions;

    return strategy.generateImage(apiKey, options);
}

/**
 * API unifiée pour modifier une image
 */
export async function modifyImageUnified(
    provider: LLMProvider,
    apiKey: string,
    options: ImageModificationOptions
): Promise<ImageOperationResult> {
    const strategy = ImageServiceFactory.getStrategy(provider);

    if (!strategy) {
        return {
            error: `Provider ${provider} does not have an image modification strategy registered.`,
        };
    }

    if (!strategy.supportsModification()) {
        return {
            error: `Provider ${provider} does not support image modification.`,
        };
    }

    return strategy.modifyImage(apiKey, options);
}

/**
 * Vérifie si un provider supporte la génération d'image
 */
export function supportsImageGeneration(provider: LLMProvider): boolean {
    const strategy = ImageServiceFactory.getStrategy(provider);
    return strategy ? strategy.supportsGeneration() : false;
}

/**
 * Vérifie si un provider supporte la modification d'image
 */
export function supportsImageModification(provider: LLMProvider): boolean {
    const strategy = ImageServiceFactory.getStrategy(provider);
    return strategy ? strategy.supportsModification() : false;
}

/**
 * Retourne le pattern API utilisé par un provider
 */
export function getImageAPIPattern(provider: LLMProvider): ImageAPIPattern | null {
    const strategy = ImageServiceFactory.getStrategy(provider);
    return strategy ? strategy.getAPIPattern() : null;
}

/**
 * Liste tous les providers avec génération d'image
 */
export function getImageGenerationProviders(): LLMProvider[] {
    return ImageServiceFactory.getImageGenerationProviders();
}

/**
 * Liste tous les providers avec modification d'image
 */
export function getImageModificationProviders(): LLMProvider[] {
    return ImageServiceFactory.getImageModificationProviders();
}

// ===========================
// RE-EXPORTS
// ===========================

export type {
    ImageGenerationOptions,
    ImageModificationOptions,
    ImageOperationResult,
    ImageData,
} from './imageServiceAdapter';

export {
    ImageAPIPattern,
    ImageServiceFactory
} from './imageServiceAdapter';
