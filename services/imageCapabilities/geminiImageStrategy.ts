// services/imageCapabilities/geminiImageStrategy.ts
/**
 * IMPLEMENTATION: Gemini Image Strategy
 * 
 * Implémente le pattern Google Generative AI pour:
 * - Imagen 4.0 (génération)
 * - Gemini 2.5 Flash Image Preview (modification)
 */

import {
    ImageServiceStrategy,
    ImageGenerationOptions,
    ImageModificationOptions,
    ImageOperationResult,
    ImageAPIPattern,
} from './imageServiceAdapter';

// Import du service Gemini existant (pour réutiliser l'instance ai)
import * as geminiService from '../geminiService';

export class GeminiImageStrategy implements ImageServiceStrategy {
    getAPIPattern(): ImageAPIPattern {
        return ImageAPIPattern.GEMINI_GENERATIVE;
    }

    supportsGeneration(): boolean {
        return true;
    }

    supportsModification(): boolean {
        return true;
    }

    async generateImage(
        apiKey: string,
        options: ImageGenerationOptions
    ): Promise<ImageOperationResult> {
        const startTime = Date.now();

        try {
            // Délègue à l'implémentation existante (réutilisation)
            const result = await geminiService.generateImage(apiKey, options.prompt);

            if (result.error) {
                return {
                    error: result.error,
                };
            }

            return {
                image: result.image,
                metadata: {
                    model: 'imagen-4.0-generate-001',
                    dimensions: this._parseSizeOption(options.size),
                },
            };
        } catch (error) {
            return {
                error: `Gemini image generation failed: ${error instanceof Error ? error.message : String(error)}`,
            };
        }
    }

    async modifyImage(
        apiKey: string,
        options: ImageModificationOptions
    ): Promise<ImageOperationResult> {
        const startTime = Date.now();

        try {
            // Délègue à l'implémentation existante
            const result = await geminiService.editImage(
                apiKey,
                options.prompt,
                options.sourceImage
            );

            if (result.error) {
                return { error: result.error };
            }

            return {
                image: result.image,
                text: result.text, // Gemini peut retourner du texte explicatif
                metadata: {
                    model: 'gemini-2.5-flash-image-preview',
                },
            };
        } catch (error) {
            return {
                error: `Gemini image modification failed: ${error instanceof Error ? error.message : String(error)}`,
            };
        }
    }

    /**
     * Helper: Parse size option pour metadata
     */
    private _parseSizeOption(size?: string): { width: number; height: number } | undefined {
        if (!size) return undefined;
        const [width, height] = size.split('x').map(Number);
        return { width, height };
    }
}
