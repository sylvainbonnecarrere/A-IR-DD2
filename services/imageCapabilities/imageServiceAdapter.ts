// services/imageCapabilities/imageServiceAdapter.ts
/**
 * DESIGN PATTERN: Strategy + Adapter
 * 
 * Ce module définit l'architecture extensible pour les capacités d'image des LLMs.
 * Il prépare l'intégration future des nouveaux fournisseurs avec leurs patterns spécifiques.
 * 
 * OBJECTIF: Isoler les variations d'implémentation (Gemini, OpenAI, future LLMs) 
 * tout en offrant une interface uniforme pour l'application.
 */

import { LLMProvider } from '../../types';

// ===========================
// TYPES GÉNÉRIQUES D'IMAGE
// ===========================

/**
 * Format d'image standardisé pour l'application
 */
export interface ImageData {
    mimeType: string;
    data: string; // Base64
}

/**
 * Options de génération d'image (extensible pour futurs LLMs)
 */
export interface ImageGenerationOptions {
    prompt: string;
    size?: '256x256' | '512x512' | '1024x1024' | '1792x1024' | '1024x1792'; // OpenAI, DALL-E
    numberOfImages?: number; // Gemini Imagen
    aspectRatio?: '1:1' | '16:9' | '9:16' | '4:3'; // Future LLMs
    style?: 'realistic' | 'artistic' | 'anime' | 'sketch'; // Future Midjourney-like
    quality?: 'standard' | 'hd' | 'ultra'; // Quality tiers
    negativePrompt?: string; // Stable Diffusion pattern
    seed?: number; // Reproducibility
    guidanceScale?: number; // Diffusion models
}

/**
 * Options de modification d'image (extensible)
 */
export interface ImageModificationOptions {
    prompt: string;
    sourceImage: ImageData;
    mask?: ImageData; // For inpainting (future capability)
    strength?: number; // Modification intensity (0.0 - 1.0)
    preserveAreas?: Array<{ x: number; y: number; width: number; height: number }>; // Region preservation
}

/**
 * Résultat unifié de génération/modification
 */
export interface ImageOperationResult {
    image?: string; // Base64
    text?: string; // Description optionnelle (Gemini)
    metadata?: {
        model?: string;
        revised_prompt?: string; // OpenAI safety rewrite
        seed?: number;
        dimensions?: { width: number; height: number };
    };
    error?: string;
}

// ===========================
// PATTERNS D'API IDENTIFIÉS
// ===========================

/**
 * Pattern 1: GEMINI - Google Generative AI
 * - API: ai.models.generateImages() avec config.outputMimeType
 * - Format retour: response.generatedImages[0].image.imageBytes
 * - Modification: ai.models.generateContent() avec responseModalities: [IMAGE, TEXT]
 */
export enum ImageAPIPattern {
    GEMINI_GENERATIVE = 'gemini_generative', // Google AI SDK
    OPENAI_REST = 'openai_rest', // REST API avec DALL-E
    ANTHROPIC_MULTIMODAL = 'anthropic_multimodal', // Vision API (pas génération native)
    STABILITY_DIFFUSION = 'stability_diffusion', // Future Stability AI
    MIDJOURNEY_STYLE = 'midjourney_style', // Future Midjourney-like
    FLUX_SCHNELL = 'flux_schnell', // Future Flux
    IDEOGRAM_API = 'ideogram_api', // Future Ideogram
    RECRAFT_V3 = 'recraft_v3', // Future Recraft
}

/**
 * Mapping Provider → Pattern API
 */
export const PROVIDER_IMAGE_PATTERN: Record<LLMProvider, ImageAPIPattern | null> = {
    [LLMProvider.Gemini]: ImageAPIPattern.GEMINI_GENERATIVE,
    [LLMProvider.OpenAI]: ImageAPIPattern.OPENAI_REST,
    [LLMProvider.Mistral]: null, // Pas encore d'image generation native
    [LLMProvider.Anthropic]: ImageAPIPattern.ANTHROPIC_MULTIMODAL, // Vision only (input)
    [LLMProvider.Grok]: null,
    [LLMProvider.Qwen]: null,
    [LLMProvider.Perplexity]: null,
    [LLMProvider.Kimi]: null,
    [LLMProvider.DeepSeek]: null,
    [LLMProvider.LMStudio]: null, // Dépend du modèle local
    [LLMProvider.ArcLLM]: null, // Mock/future
};

// ===========================
// INTERFACE STRATEGY
// ===========================

/**
 * Strategy Pattern: Chaque LLM implémente cette interface selon son pattern API
 */
export interface ImageServiceStrategy {
    /**
     * Génère une image à partir d'un prompt
     */
    generateImage(
        apiKey: string,
        options: ImageGenerationOptions
    ): Promise<ImageOperationResult>;

    /**
     * Modifie une image existante avec un prompt
     */
    modifyImage(
        apiKey: string,
        options: ImageModificationOptions
    ): Promise<ImageOperationResult>;

    /**
     * Vérifie si ce provider supporte la génération d'image
     */
    supportsGeneration(): boolean;

    /**
     * Vérifie si ce provider supporte la modification d'image
     */
    supportsModification(): boolean;

    /**
     * Retourne le pattern API utilisé
     */
    getAPIPattern(): ImageAPIPattern;
}

// ===========================
// FACTORY PATTERN
// ===========================

/**
 * Factory pour créer l'adapteur approprié selon le LLM
 */
export class ImageServiceFactory {
    private static strategies: Map<LLMProvider, ImageServiceStrategy> = new Map();

    /**
     * Enregistre une stratégie pour un provider
     */
    static registerStrategy(provider: LLMProvider, strategy: ImageServiceStrategy): void {
        this.strategies.set(provider, strategy);
    }

    /**
     * Obtient la stratégie pour un provider
     */
    static getStrategy(provider: LLMProvider): ImageServiceStrategy | null {
        return this.strategies.get(provider) || null;
    }

    /**
     * Liste tous les providers supportant la génération d'image
     */
    static getImageGenerationProviders(): LLMProvider[] {
        return Array.from(this.strategies.entries())
            .filter(([_, strategy]) => strategy.supportsGeneration())
            .map(([provider, _]) => provider);
    }

    /**
     * Liste tous les providers supportant la modification d'image
     */
    static getImageModificationProviders(): LLMProvider[] {
        return Array.from(this.strategies.entries())
            .filter(([_, strategy]) => strategy.supportsModification())
            .map(([provider, _]) => provider);
    }
}

// ===========================
// HELPER: CONVERSION D'OPTIONS
// ===========================

/**
 * Convertit ImageGenerationOptions en format simple (backward compatibility)
 */
export function convertToSimpleImageOptions(options: ImageGenerationOptions): {
    prompt: string;
} {
    return { prompt: options.prompt };
}

/**
 * Convertit format simple en ImageGenerationOptions (forward compatibility)
 */
export function convertFromSimplePrompt(prompt: string): ImageGenerationOptions {
    return { prompt };
}

// ===========================
// FUTURE EXTENSIONS
// ===========================

/**
 * Placeholder pour futures capacités avancées
 */
export interface AdvancedImageCapabilities {
    // Inpainting (modifier zone spécifique)
    supportsInpainting?: boolean;
    // Outpainting (étendre l'image)
    supportsOutpainting?: boolean;
    // Upscaling (augmenter résolution)
    supportsUpscaling?: boolean;
    // Style transfer
    supportsStyleTransfer?: boolean;
    // Background removal
    supportsBackgroundRemoval?: boolean;
    // Object removal
    supportsObjectRemoval?: boolean;
}

/**
 * Metadata pour traçabilité et debugging
 */
export interface ImageOperationMetadata {
    provider: LLMProvider;
    model: string;
    timestamp: Date;
    executionTimeMs: number;
    tokenUsage?: {
        input?: number;
        output?: number;
    };
    apiVersion?: string;
}
