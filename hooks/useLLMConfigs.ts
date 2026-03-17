/**
 * 🪝 CUSTOM HOOK: useLLMConfigs
 * 
 * Pattern: Abstraction layer pour les composants React
 * Responsabilité: 
 *   - Consommer AuthContext pour connaître l'état d'authentification
 *   - Appeler llmConfigService avec les options appropriées
 *   - Gérer l'état local (loading, error)
 *   - Fournir une API simple aux composants
 * 
 * Principe Dependency Inversion:
 *   Les composants dépendent de cette interface abstraite (le hook)
 *   Pas de dépendance directe sur fetch, localStorage, ou llmConfigService
 * 
 * Usage:
 *   const { configs, updateConfig, loading } = useLLMConfigs();
 *   await updateConfig('OpenAI', { apiKey: '...', enabled: true });
 */

import { useState, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import type { ILLMConfigUI } from '../types';
import * as llmConfigService from '../services/llmConfigService';
import { mapRuntimeConfigsToUiConfigs } from '../services/runtimeConfigRepository';

interface UseLLMConfigsReturn {
  // Data
  configs: ILLMConfigUI[];
  
  // State
  loading: boolean;
  error: string | null;
  
  // Actions (all async)
  loadConfigs: () => Promise<void>;
  getConfig: (provider: string) => Promise<ILLMConfigUI | null>;
  updateConfig: (
    provider: string,
    data: {
      apiKey?: string; // For cloud providers (encrypted server-side)
      localEndpoint?: string; // For local providers (plaintext URL)
      enabled: boolean;
      capabilities?: Record<string, boolean>;
    },
    syncAfterWrite?: boolean
  ) => Promise<ILLMConfigUI>;
  deleteConfig: (provider: string, syncAfterWrite?: boolean) => Promise<void>;
  validateProvider: (provider: string) => Promise<{
    valid: boolean;
    enabled: boolean;
    hasApiKey: boolean;
    hasLocalEndpoint?: boolean; // Flag for local endpoint existence
    capabilities: Record<string, boolean>;
  }>;
  
  // Clear error
  clearError: () => void;
}

export function useLLMConfigs(): UseLLMConfigsReturn {
  const auth = useAuth();
  const { isAuthenticated, accessToken, runtimeLLMConfigs, refreshRuntimeConfigState } = auth;
  
  // State
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const configs = mapRuntimeConfigsToUiConfigs(runtimeLLMConfigs);

  // Options para le service
  const serviceOptions = {
    useApi: isAuthenticated,
    token: accessToken || undefined
  };

  // Monitor auth state changes
  /**
   * Charge toutes les configs LLM
   */
  const loadConfigs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await refreshRuntimeConfigState();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Erreur inconnue';
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  }, [refreshRuntimeConfigState]);

  /**
   * Récupère une config spécifique
   */
  const getConfig = useCallback(
    async (provider: string): Promise<ILLMConfigUI | null> => {
      try {
        return configs.find(c => c.provider === provider) || null;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Erreur inconnue';
        setError(errorMsg);
        return null;
      }
    },
    [configs]
  );

  /**
   * Crée ou met à jour une config
   */
  const updateConfig = useCallback(
    async (
      provider: string,
      data: {
        apiKey?: string; // For cloud providers (encrypted server-side)
        localEndpoint?: string; // For local providers (plaintext URL)
        enabled: boolean;
        capabilities?: Record<string, boolean>;
      },
      syncAfterWrite = true
    ): Promise<ILLMConfigUI> => {
      setLoading(true);
      setError(null);
      
      try {
        const result = await llmConfigService.upsertLLMConfig(
          provider,
          data,
          serviceOptions
        );

        if (syncAfterWrite) {
          await refreshRuntimeConfigState();
        }

        return result;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Erreur inconnue';
        setError(errorMsg);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [refreshRuntimeConfigState, serviceOptions]
  );

  /**
   * Supprime une config
   */
  const deleteConfig = useCallback(
    async (provider: string, syncAfterWrite = true): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        await llmConfigService.deleteLLMConfig(provider, serviceOptions);
        if (syncAfterWrite) {
          await refreshRuntimeConfigState();
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Erreur inconnue';
        setError(errorMsg);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [refreshRuntimeConfigState, serviceOptions]
  );

  /**
   * Valide un provider
   */
  const validateProvider = useCallback(
    async (provider: string) => {
      try {
        return await llmConfigService.validateProvider(provider, serviceOptions);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Erreur inconnue';
        setError(errorMsg);
        throw err;
      }
    },
    [isAuthenticated, accessToken]
  );

  /**
   * Efface le message d'erreur
   */
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    configs,
    loading,
    error,
    loadConfigs,
    getConfig,
    updateConfig,
    deleteConfig,
    validateProvider,
    clearError
  };
}
