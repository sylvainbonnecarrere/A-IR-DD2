// services/routeDetectionService.ts
// JALON 5: Détection Simplifiée des Capacités LLM Locaux
// Architecture: Option C Hybride - appel unique au backend proxy
// SOLID: SRP - ce service délègue toute la détection au backend

import { LLMCapability } from '../types';
import { getBackendUrl } from '../config/api.config';

interface DetectionResult {
    healthy: boolean;
    endpoint: string;
    modelId?: string;
    modelName?: string;
    capabilities: LLMCapability[];
    detectedAt: string;
    error?: string;
}

interface CacheEntry {
    data: DetectionResult;
    timestamp: number;
}

/**
 * Cache simple (TTL 5 minutes)
 */
class DetectionCache {
    private cache = new Map<string, CacheEntry>();
    private TTL = 5 * 60 * 1000; // 5 minutes

    get(endpoint: string): DetectionResult | null {
        const entry = this.cache.get(endpoint);
        if (!entry || Date.now() - entry.timestamp > this.TTL) {
            this.cache.delete(endpoint);
            return null;
        }
        return entry.data;
    }

    set(endpoint: string, data: DetectionResult): void {
        this.cache.set(endpoint, { data, timestamp: Date.now() });
    }

    invalidate(endpoint?: string): void {
        if (endpoint) {
            this.cache.delete(endpoint);
        } else {
            this.cache.clear();
        }
    }

    size(): number {
        return this.cache.size;
    }
}

const detectionCache = new DetectionCache();

/**
 * Point d'entrée unique pour la détection de capacités LLM locaux
 * 
 * Flux:
 * 1. Vérifier le cache local (TTL 5 min)
 * 2. Appeler le backend proxy /api/local-llm/detect-capabilities
 * 3. Mettre en cache le résultat
 * 4. Retourner
 * 
 * Architecture SOLID: SRP
 * - Backend: teste réellement les capacités (logic complexe)
 * - Frontend: stocke config et appelle directement LLM local à runtime
 */
export async function detectLocalLLMCapabilities(endpoint: string): Promise<DetectionResult> {
    try {
        // Étape 1: Vérifier cache
        const cached = detectionCache.get(endpoint);
        if (cached) {
            console.debug(`[LocalLLMDetection] Cache hit for ${endpoint}`);
            return cached;
        }

        console.debug(`[LocalLLMDetection] Starting detection for endpoint: ${endpoint}`);

        // Étape 2: Appeler le backend proxy unique
        const proxyUrl = `${getBackendUrl()}/api/local-llm/detect-capabilities?endpoint=${encodeURIComponent(endpoint)}`;
        console.debug(`[LocalLLMDetection] Calling backend proxy: ${proxyUrl}`);

        const response = await fetch(proxyUrl, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            },
            signal: AbortSignal.timeout(15000) // 15s timeout pour tous les tests
        });

        if (!response.ok) {
            const errorText = await response.text().catch(() => response.statusText);
            console.error(`[LocalLLMDetection] Backend returned ${response.status}: ${errorText}`);
            
            // Même en cas d'erreur, retourner un résultat structuré
            return {
                healthy: false,
                endpoint,
                capabilities: [],
                detectedAt: new Date().toISOString(),
                error: `Backend error: ${response.status}`
            };
        }

        const result: DetectionResult = await response.json();

        // Étape 3: Mettre en cache
        detectionCache.set(endpoint, result);

        console.debug(`[LocalLLMDetection] Detection complete for ${endpoint}:`, {
            healthy: result.healthy,
            modelId: result.modelId,
            capabilitiesCount: result.capabilities.length
        });

        return result;

    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`[LocalLLMDetection] Detection failed for ${endpoint}:`, errorMsg);

        // Retourner un résultat structuré même en cas d'erreur réseau
        return {
            healthy: false,
            endpoint,
            capabilities: [],
            detectedAt: new Date().toISOString(),
            error: errorMsg
        };
    }
}

/**
 * Alias pour compatibilité avec routeDetectionService existant
 */
export async function detectLMStudioModel(endpoint: string): Promise<DetectionResult | null> {
    const result = await detectLocalLLMCapabilities(endpoint);
    return result;
}

/**
 * Invalide le cache
 */
export function invalidateCache(endpoint?: string): void {
    detectionCache.invalidate(endpoint);
    console.debug(`[LocalLLMDetection] Cache invalidated${endpoint ? ` for ${endpoint}` : ' (all)'}`);
}

/**
 * Taille du cache
 */
export function getCacheSize(): number {
    return detectionCache.size();
}

export type { DetectionResult };
