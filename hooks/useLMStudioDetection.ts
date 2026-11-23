// hooks/useLMStudioDetection.ts
// Jalon 3: Hook personnalisé pour détection LMStudio avec auto-refresh

import { useState, useEffect } from 'react';
import { LMStudioModelDetection, LLMCapability } from '../types';
import { detectLMStudioModel } from '../services/routeDetectionService';

interface UseLMStudioDetectionOptions {
  endpoint?: string;
  autoDetect?: boolean; // Lancer détection automatiquement au mount
  onSuccess?: (
    detection: LMStudioModelDetection,
    // Ajout d'une fonction pour sauvegarder la config associée
    saveConfig: (config: { apiKey: string; enabled: boolean; capabilities: Record<string, boolean> }) => Promise<void>,
  ) => void;
  onError?: (error: string) => void;
}

interface UseLMStudioDetectionReturn {
  detection: LMStudioModelDetection | null;
  isDetecting: boolean;
  error: string | null;
  redetect: () => Promise<void>;
  clearDetection: () => void;
}

/**
 * Hook personnalisé pour gérer la détection dynamique LMStudio
 * Auto-détecte quand l'endpoint change (si autoDetect=true)
 */
export const useLMStudioDetection = (options: UseLMStudioDetectionOptions = {}): UseLMStudioDetectionReturn => {
  const { endpoint, autoDetect = true, onSuccess, onError } = options;

  const [detection, setDetection] = useState<LMStudioModelDetection | null>(null);
  const [isDetecting, setIsDetecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fonction de détection réutilisable
  const performDetection = async (isManualTrigger: boolean = false) => {
    if (!endpoint) {
      const msg = 'Endpoint LMStudio non configuré';
      if (isManualTrigger) setError(msg); // N'afficher l'erreur que si l'utilisateur a cliqué
      onError?.(msg);
      return;
    }

    setDetection(null); // Reset previous detection
    setIsDetecting(true);
    setError(null);

    try {
      const result = await detectLMStudioModel(endpoint);

      if (!result || !result.healthy) {
        const errorMsg = result?.error || 'Endpoint non accessible ou aucun modèle chargé.';
        setError(errorMsg);
        setDetection(null);
        onError?.(errorMsg);
        return;
      }

      // Convertir DetectionResult en LMStudioModelDetection
      // result.capabilities est string[], on doit le convertir en LLMCapability[]
      const detectionCapabilities: LLMCapability[] = (result.capabilities as string[])
        .filter((cap) => cap)
        .map((cap) => {
          // Chercher la valeur d'enum correspondante
          const enumValue = Object.values(LLMCapability).find((v) => v === cap);
          return enumValue as LLMCapability;
        })
        .filter((cap): cap is LLMCapability => cap !== undefined);

      const detection: LMStudioModelDetection = {
        modelId: result.modelId || 'unknown',
        routes: {
          models: true,
          chatCompletions: true,
          completions: false,
          embeddings: false,
          images: false,
          audio: false,
        },
        capabilities: detectionCapabilities,
        detectedAt: result.detectedAt,
      };

      setDetection(detection);
      // Appeler onSuccess avec la fonction de sauvegarde pré-configurée
      if (onSuccess) {
        const saveThisConfig = (config: { apiKey: string; enabled: boolean; capabilities: Record<string, boolean> }) => {
          // Ici, on pourrait appeler un hook de persistance comme useLLMConfigs
          console.debug('Sauvegarde de la configuration LMStudio...', config);
          // Exemple: updateConfig('LMStudio', { ...config, model: detection.modelId });
          return Promise.resolve();
        };
        onSuccess(detection, saveThisConfig);
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error && err.message ? err.message : 'Erreur lors de la détection LMStudio';
      setError(errorMessage);
      onError?.(errorMessage);
    } finally {
      setIsDetecting(false);
    }
  };

  // Auto-détection quand endpoint change (si autoDetect activé)
  useEffect(() => {
    if (autoDetect) {
      void performDetection(false);
    }
  }, [endpoint, autoDetect]); // Dépendances simplifiées pour re-déclencher

  // Fonction manuelle de re-détection
  const redetect = async () => {
    await performDetection(true);
  };

  // Clear detection (utile pour reset)
  const clearDetection = () => {
    setDetection(null);
    setError(null);
  };

  return {
    detection,
    isDetecting,
    error,
    redetect,
    clearDetection,
  };
};
