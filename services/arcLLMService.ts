// services/arcLLMService.ts
/**
 * Arc-LLM Service Adapter
 * 
 * Fonctionnalités :
 * - Génération de vidéo (Prompt-to-Video, Extension, Images de référence)
 * - Maps Grounding (Recherche géolocalisée)
 * - Web Search Grounding (Recherche web actualisée)
 * 
 * Contraintes critiques :
 * - Maps/Web Grounding INCOMPATIBLES avec outputConfig custom ou tools customs
 * - Maps et Web Search peuvent coexister ensemble
 * 
 * Pattern : Adapter (similaire à geminiService.ts)
 */

import {
    VideoGenerationOptions,
    VideoGenerationStatus,
    MapSource,
    WebSearchSource,
    MapsGroundingResponse,
    WebSearchGroundingResponse,
    Tool,
    OutputConfig
} from '../types';

// ===========================
// VALIDATOR - Prévention Régression
// ===========================

/**
 * Validator pour garantir 0 régression et respect contraintes Arc-LLM
 */
class ArcLLMValidator {
    /**
     * Valide une requête de grounding (Maps ou Web Search)
     * 
     * @param groundingType Type de grounding demandé
     * @param tools Tools customs fournis
     * @param outputConfig Configuration de formatage de sortie
     * @returns Résultat de validation avec erreur si invalide
     */
    static validateGroundingRequest(
        groundingType: 'maps' | 'web',
        tools?: Tool[],
        outputConfig?: OutputConfig
    ): { valid: boolean; error?: string } {
        // RÈGLE 1 : Pas de outputConfig custom avec grounding
        if (outputConfig?.enabled && outputConfig.format !== 'json') {
            return {
                valid: false,
                error: `Arc-LLM ${groundingType} grounding incompatible with custom output formatting (${outputConfig.format})`
            };
        }

        // RÈGLE 2 : Pas de responseSchema custom (format JSON signifie responseSchema)
        if (outputConfig?.enabled && outputConfig.format === 'json') {
            return {
                valid: false,
                error: `Arc-LLM ${groundingType} grounding incompatible with responseSchema (JSON formatting)`
            };
        }

        // RÈGLE 3 : Pas de tools customs (sauf Maps ↔ Web Search mutuels)
        if (tools && tools.length > 0) {
            const allowedToolsForMaps = ['webSearch', 'googleWebSearch'];
            const allowedToolsForWeb = ['mapsSearch', 'googleMaps'];
            const allowedTools = groundingType === 'maps' ? allowedToolsForMaps : allowedToolsForWeb;

            const hasInvalidTool = tools.some(t => !allowedTools.includes(t.name));
            if (hasInvalidTool) {
                const invalidTool = tools.find(t => !allowedTools.includes(t.name));
                return {
                    valid: false,
                    error: `Arc-LLM ${groundingType} grounding cannot coexist with custom tool: ${invalidTool?.name}`
                };
            }
        }

        return { valid: true };
    }

    /**
     * Valide une requête de génération vidéo
     */
    static validateVideoRequest(options: VideoGenerationOptions): { valid: boolean; error?: string } {
        if (!options.prompt || options.prompt.trim().length === 0) {
            return { valid: false, error: 'Video prompt is required' };
        }

        if (options.referenceImages && options.referenceImages.length > 3) {
            return { valid: false, error: 'Maximum 3 reference images allowed' };
        }

        if (options.referenceImages) {
            for (const img of options.referenceImages) {
                if (!img.mimeType || !img.data) {
                    return { valid: false, error: 'Invalid image format (missing mimeType or data)' };
                }
            }
        }

        return { valid: true };
    }
}

// ===========================
// MOCK API KEY MANAGER
// ===========================

/**
 * Gestionnaire de clé API (Mock pour démo)
 * TODO: [Arc-LLM] Intégrer avec vrai système d'authentification
 */
class MockApiKeyManager {
    static hasSelectedApiKey(): boolean {
        // Simuler window.aistudio.hasSelectedApiKey()
        // TODO: [Arc-LLM] Remplacer par vérification réelle
        const apiKey = localStorage.getItem('arc_llm_api_key');
        return apiKey !== null && apiKey.length > 0;
    }

    static openSelectKey(): void {
        // Simuler window.aistudio.openSelectKey()
        // TODO: [Arc-LLM] Ouvrir modal Settings avec onglet Arc-LLM
        console.warn('[Arc-LLM] API Key required. Please configure in Settings.');
        alert('Please configure Arc-LLM API key in Settings.');
    }

    static getApiKey(): string | null {
        return localStorage.getItem('arc_llm_api_key');
    }
}

// ===========================
// VIDEO POLLING STRATEGY
// ===========================

/**
 * Stratégie de polling avec exponential backoff
 * Pattern : Strategy pour gérer l'asynchronisme vidéo
 */
class VideoPollingStrategy {
    private static INITIAL_INTERVAL = 3000; // 3s
    private static MAX_INTERVAL = 10000; // 10s
    private static MAX_ATTEMPTS = 100; // ~5min max (10s * 100 = 16min théorique)

    /**
     * Calcule l'intervalle de polling avec exponential backoff
     */
    static calculateInterval(attemptNumber: number): number {
        const interval = this.INITIAL_INTERVAL * Math.pow(1.5, attemptNumber);
        return Math.min(interval, this.MAX_INTERVAL);
    }

    /**
     * Vérifie si le polling doit continuer
     */
    static shouldContinue(attemptNumber: number, status: VideoGenerationStatus): boolean {
        if (attemptNumber >= this.MAX_ATTEMPTS) {
            return false; // Timeout
        }
        return status.status === 'PROCESSING';
    }
}

// ===========================
// VIDEO GENERATION
// ===========================

/**
 * Génère une vidéo à partir d'un prompt (avec options)
 * Pattern similaire à geminiService.generateImage()
 * 
 * @param apiKey Clé API Arc-LLM
 * @param options Options de génération (prompt, images, résolution, ratio)
 * @returns Statut d'opération (PROCESSING avec operationId pour polling)
 */
export const generateVideo = async (
    apiKey: string,
    options: VideoGenerationOptions
): Promise<VideoGenerationStatus> => {
    console.log('[Arc-LLM] generateVideo called', { options });

    // Validation
    const validation = ArcLLMValidator.validateVideoRequest(options);
    if (!validation.valid) {
        return {
            operationId: '',
            status: 'FAILED',
            error: validation.error
        };
    }

    // Vérification clé API
    if (!MockApiKeyManager.hasSelectedApiKey()) {
        MockApiKeyManager.openSelectKey();
        return {
            operationId: '',
            status: 'FAILED',
            error: 'Arc-LLM API key required'
        };
    }

    try {
        // TODO: [Arc-LLM] Implémenter appel réel API Arc-LLM Video
        // const response = await fetch('https://arc-llm-api.com/v1/video/generate', {
        //   method: 'POST',
        //   headers: {
        //     'Authorization': `Bearer ${apiKey}`,
        //     'Content-Type': 'application/json'
        //   },
        //   body: JSON.stringify(options)
        // });
        // const data = await response.json();

        // MOCK : Simuler démarrage opération asynchrone
        const operationId = `arc-video-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        console.log('[Arc-LLM] Video generation started:', operationId);

        return {
            operationId,
            status: 'PROCESSING',
            progress: 0,
        };
    } catch (error) {
        console.error('[Arc-LLM] Error starting video generation:', error);
        return {
            operationId: '',
            status: 'FAILED',
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
};

/**
 * Polle le statut d'une génération vidéo en cours
 * Utilise VideoPollingStrategy pour exponential backoff
 * 
 * @param apiKey Clé API Arc-LLM
 * @param operationId ID de l'opération retourné par generateVideo()
 * @returns Statut actuel (PROCESSING, COMPLETED, FAILED)
 */
export const pollVideoStatus = async (
    apiKey: string,
    operationId: string
): Promise<VideoGenerationStatus> => {
    console.log('[Arc-LLM] pollVideoStatus called:', operationId);

    try {
        // TODO: [Arc-LLM] Implémenter appel réel API polling
        // const response = await fetch(`https://arc-llm-api.com/v1/video/status/${operationId}`, {
        //   headers: { 'Authorization': `Bearer ${apiKey}` }
        // });
        // const data = await response.json();

        // MOCK : Simuler progression (10% de chance de complétion à chaque poll)
        const mockProgress = Math.min(100, Math.random() * 100);
        const isCompleted = mockProgress >= 90;

        if (isCompleted) {
            console.log('[Arc-LLM] Video generation completed:', operationId);
            return {
                operationId,
                status: 'COMPLETED',
                videoUrl: `https://mock-arc-llm.com/videos/${operationId}.mp4`,
                progress: 100,
            };
        }

        console.log('[Arc-LLM] Video generation in progress:', { operationId, progress: mockProgress });
        return {
            operationId,
            status: 'PROCESSING',
            progress: Math.floor(mockProgress),
        };
    } catch (error) {
        console.error('[Arc-LLM] Error polling video status:', error);
        return {
            operationId,
            status: 'FAILED',
            error: error instanceof Error ? error.message : 'Polling error'
        };
    }
};

// ===========================
// MAPS GROUNDING
// ===========================

/**
 * Génère du contenu avec Maps Grounding
 * Pattern similaire à geminiService.generateContentWithSearch()
 * Structure : tools: [{ googleMaps: {} }] + extraction groundingMetadata
 * 
 * @param apiKey Clé API Arc-LLM
 * @param model Modèle Arc-LLM (arc-grounding-v1)
 * @param prompt Requête utilisateur (ex: "Restaurants japonais à Paris")
 * @param systemInstruction Instruction système optionnelle
 * @param userLocation Géolocalisation utilisateur (optionnel)
 * @returns Texte de réponse + sources cartographiques
 */
export const generateContentWithMaps = async (
    apiKey: string,
    model: string,
    prompt: string,
    systemInstruction?: string,
    userLocation?: { lat: number; lng: number }
): Promise<MapsGroundingResponse> => {
    console.log('[Arc-LLM] generateContentWithMaps called', { prompt, userLocation });

    // Validation (aucun tool/outputConfig passé ici, exclusion mutuelle appliquée upstream)
    const validation = ArcLLMValidator.validateGroundingRequest('maps');
    if (!validation.valid) {
        return {
            text: `Error: ${validation.error}`,
            mapSources: []
        };
    }

    try {
        // TODO: [Arc-LLM] Implémenter appel réel API Maps Grounding
        // const response = await fetch('https://arc-llm-api.com/v1/grounding/maps', {
        //   method: 'POST',
        //   headers: {
        //     'Authorization': `Bearer ${apiKey}`,
        //     'Content-Type': 'application/json'
        //   },
        //   body: JSON.stringify({
        //     model,
        //     contents: prompt,
        //     config: {
        //       tools: [{ googleMaps: {} }],
        //       ...(systemInstruction && { systemInstruction }),
        //       ...(userLocation && { userLocation })
        //     }
        //   })
        // });
        // const data = await response.json();
        // const text = data.text;
        // const groundingChunks = data.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
        // const mapSources = groundingChunks
        //   .filter(chunk => chunk.maps)
        //   .map(chunk => ({
        //     uri: chunk.maps.uri,
        //     placeTitle: chunk.maps.placeTitle,
        //     placeId: chunk.maps.placeId,
        //     coordinates: chunk.maps.coordinates,
        //     reviewExcerpts: chunk.maps.reviewExcerpts
        //   }));

        // MOCK : Simuler résultats Maps Grounding
        const mockText = `Based on your location${userLocation ? ` (${userLocation.lat}, ${userLocation.lng})` : ''}, I found 3 highly-rated Japanese restaurants in Paris matching your query: "${prompt}".`;

        const mockMapSources: MapSource[] = [
            {
                uri: 'https://maps.google.com/?q=Sushi+Shop+Paris',
                placeTitle: 'Sushi Shop - Champs-Élysées',
                placeId: 'ChIJMock123',
                coordinates: { latitude: 48.8698, longitude: 2.3079 },
                reviewExcerpts: [
                    'Excellent sushi, fresh fish!',
                    'Very nice ambiance and professional service.'
                ]
            },
            {
                uri: 'https://maps.google.com/?q=Yoshi+Paris',
                placeTitle: 'Yoshi - Teppanyaki Restaurant',
                placeId: 'ChIJMock456',
                coordinates: { latitude: 48.8566, longitude: 2.3522 },
                reviewExcerpts: [
                    'Amazing teppanyaki show!',
                    'Authentic Japanese cuisine.'
                ]
            },
            {
                uri: 'https://maps.google.com/?q=Zen+Paris',
                placeTitle: 'Zen - Modern Japanese Fusion',
                placeId: 'ChIJMock789',
                coordinates: { latitude: 48.8584, longitude: 2.2945 },
                reviewExcerpts: [
                    'Creative fusion dishes.',
                    'Highly recommend the omakase menu.'
                ]
            }
        ];

        console.log('[Arc-LLM] Maps Grounding completed:', { sources: mockMapSources.length });

        return {
            text: mockText,
            mapSources: mockMapSources
        };
    } catch (error) {
        console.error('[Arc-LLM] Error in Maps Grounding:', error);
        return {
            text: `Error: Could not get Maps Grounding response. ${error instanceof Error ? error.message : ''}`,
            mapSources: []
        };
    }
};

// ===========================
// WEB SEARCH GROUNDING
// ===========================

/**
 * Génère du contenu avec Web Search Grounding
 * Pattern similaire à geminiService.generateContentWithSearch()
 * Structure : tools: [{ googleSearch: {} }] + extraction groundingMetadata
 * 
 * @param apiKey Clé API Arc-LLM
 * @param model Modèle Arc-LLM (arc-grounding-v1)
 * @param prompt Requête utilisateur (ex: "Latest AI news 2025")
 * @param systemInstruction Instruction système optionnelle
 * @returns Texte de réponse + sources web
 */
export const generateContentWithWebSearch = async (
    apiKey: string,
    model: string,
    prompt: string,
    systemInstruction?: string
): Promise<WebSearchGroundingResponse> => {
    console.log('[Arc-LLM] generateContentWithWebSearch called', { prompt });

    // Validation
    const validation = ArcLLMValidator.validateGroundingRequest('web');
    if (!validation.valid) {
        return {
            text: `Error: ${validation.error}`,
            webSources: []
        };
    }

    try {
        // TODO: [Arc-LLM] Implémenter appel réel API Web Search Grounding
        // const response = await fetch('https://arc-llm-api.com/v1/grounding/web', {
        //   method: 'POST',
        //   headers: {
        //     'Authorization': `Bearer ${apiKey}`,
        //     'Content-Type': 'application/json'
        //   },
        //   body: JSON.stringify({
        //     model,
        //     contents: prompt,
        //     config: {
        //       tools: [{ googleSearch: {} }],
        //       ...(systemInstruction && { systemInstruction })
        //     }
        //   })
        // });
        // const data = await response.json();
        // const text = data.text;
        // const groundingChunks = data.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
        // const webSources = groundingChunks
        //   .filter(chunk => chunk.web)
        //   .map(chunk => ({
        //     uri: chunk.web.uri,
        //     webTitle: chunk.web.title,
        //     snippet: chunk.web.snippet
        //   }));

        // MOCK : Simuler résultats Web Search Grounding
        const mockText = `Here are the latest developments in AI as of November 2025, based on recent web sources for: "${prompt}".`;

        const mockWebSources: WebSearchSource[] = [
            {
                uri: 'https://techcrunch.com/2025/11/ai-latest',
                webTitle: 'AI Breakthroughs November 2025 - TechCrunch',
                snippet: 'Major advancements in multimodal AI models, with Arc-LLM leading in video generation capabilities...'
            },
            {
                uri: 'https://theverge.com/2025/11/arc-llm-launch',
                webTitle: 'Arc-LLM Launches Video and Grounding Features - The Verge',
                snippet: 'Arc-LLM announces groundbreaking video generation and real-time grounding capabilities for maps and web search...'
            },
            {
                uri: 'https://example.com/ai-news-2025',
                webTitle: 'AI Industry Report November 2025',
                snippet: 'Enterprise adoption of AI continues to grow, with new regulatory frameworks emerging in EU and US...'
            }
        ];

        console.log('[Arc-LLM] Web Search Grounding completed:', { sources: mockWebSources.length });

        return {
            text: mockText,
            webSources: mockWebSources
        };
    } catch (error) {
        console.error('[Arc-LLM] Error in Web Search Grounding:', error);
        return {
            text: `Error: Could not get Web Search Grounding response. ${error instanceof Error ? error.message : ''}`,
            webSources: []
        };
    }
};

// ===========================
// GEOLOCATION HELPER (Mock)
// ===========================

/**
 * Obtient la géolocalisation de l'utilisateur
 * TODO: [Arc-LLM] Remplacer par vrai navigator.geolocation.getCurrentPosition()
 */
export const getUserLocation = (): Promise<{ lat: number; lng: number }> => {
    return new Promise((resolve, reject) => {
        // Mock : Retourner coordonnées Paris par défaut
        console.log('[Arc-LLM] Getting user location (mock: Paris)');
        resolve({ lat: 48.8566, lng: 2.3522 });

        // TODO: [Arc-LLM] Implémenter géolocalisation réelle
        // if (navigator.geolocation) {
        //   navigator.geolocation.getCurrentPosition(
        //     (position) => {
        //       resolve({
        //         lat: position.coords.latitude,
        //         lng: position.coords.longitude
        //       });
        //     },
        //     (error) => {
        //       console.error('[Arc-LLM] Geolocation error:', error);
        //       reject(error);
        //     }
        //   );
        // } else {
        //   reject(new Error('Geolocation not supported'));
        // }
    });
};
