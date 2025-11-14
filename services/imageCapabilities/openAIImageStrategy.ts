// services/imageCapabilities/openAIImageStrategy.ts
/**
 * IMPLEMENTATION: OpenAI Image Strategy
 * 
 * Implémente le pattern OpenAI REST API pour:
 * - DALL-E 3 (génération)
 * - Modification non supportée (retour erreur explicite)
 */

import {
    ImageServiceStrategy,
    ImageGenerationOptions,
    ImageModificationOptions,
    ImageOperationResult,
    ImageAPIPattern,
} from './imageServiceAdapter';

// Import du service OpenAI existant
import * as openAIService from '../openAIService';

export class OpenAIImageStrategy implements ImageServiceStrategy {
    getAPIPattern(): ImageAPIPattern {
        return ImageAPIPattern.OPENAI_REST;
    }

    supportsGeneration(): boolean {
        return true;
    }

    supportsModification(): boolean {
        return false; // OpenAI ne supporte pas editImage dans cette app
    }

    async generateImage(
        apiKey: string,
        options: ImageGenerationOptions
    ): Promise<ImageOperationResult> {
        try {
            // Délègue à l'implémentation existante
            const result = await openAIService.generateImage(apiKey, options.prompt);

            if (result.error) {
                return { error: result.error };
            }

            return {
                image: result.image,
                metadata: {
                    model: 'dall-e-3',
                    dimensions: this._parseSizeOption(options.size || '1024x1024'),
                    // OpenAI peut modifier le prompt pour safety
                    revised_prompt: undefined, // Pourrait être extrait si disponible
                },
            };
        } catch (error) {
            return {
                error: `OpenAI image generation failed: ${error instanceof Error ? error.message : String(error)}`,
            };
        }
    }

    async modifyImage(
        apiKey: string,
        options: ImageModificationOptions
    ): Promise<ImageOperationResult> {
        return {
            error: 'Image modification is not supported by OpenAI in this application.',
        };
    }

    /**
     * Helper: Parse size option
     */
    private _parseSizeOption(size: string): { width: number; height: number } {
        const [width, height] = size.split('x').map(Number);
        return { width, height };
    }
}
