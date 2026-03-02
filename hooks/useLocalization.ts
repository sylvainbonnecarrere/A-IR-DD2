/**
 * 🪝 CUSTOM HOOK: useLocalization
 * 
 * Pattern: Abstraction layer pour les composants React
 * Responsabilité: 
 *   - Consommer AuthContext pour connaître l'état d'authentification
 *   - Appeler localizationService avec les options appropriées
 *   - Gérer l'état local (loading, error)
 *   - Fournir une API simple aux composants (+ persistance)
 * 
 * Principe Dependency Inversion:
 *   Les composants dépendent de cette interface abstraite (le hook)
 *   Pas de dépendance directe sur fetch, localStorage, ou localizationService
 * 
 * Usage:
 *   const { locale, setLocale, loading } = useLocalization();
 *   await setLocale('en');
 */

import { useEffect, useCallback, useContext, useState, useMemo } from 'react';
import { LocalizationContext } from '../contexts/LocalizationContext';
import { useAuth } from '../contexts/AuthContext';
import { useLocalizationStore, loadGuestLocale } from '../stores/useLocalizationStore';
import * as localizationService from '../services/localizationService';
import type { Locale } from '../i18n/locales';

interface UseLocalizationReturn {
  locale: Locale;
  setLocale: (locale: Locale) => Promise<void>;
  loading: boolean;
  error: string | null;
  clearError: () => void;
  t: (key: string, fallbackOrParams?: string | Record<string, string | number>, params?: Record<string, string | number>) => string;
}

export function useLocalization(): UseLocalizationReturn {
  const contextValue = useContext(LocalizationContext);
  
  if (!contextValue) {
    throw new Error('useLocalization must be used within LocalizationProvider');
  }

  const auth = useAuth();
  const { isAuthenticated, accessToken } = auth;
  
  // Zustand store (état GLOBAL partagé)
  const { 
    locale, 
    isLoading, 
    isInitialized,
    setLocale: setStoreLocale, 
    setLoading,
    initialize 
  } = useLocalizationStore();
  
  // Local error state
  const [error, setError] = useState<string | null>(null);

  // Options for the service (memoized to prevent infinite loops)
  const serviceOptions = useMemo(() => ({
    useApi: isAuthenticated,
    token: accessToken || undefined
  }), [isAuthenticated, accessToken]);

  // Load locale on mount and auth change
  useEffect(() => {
    const loadLocale = async () => {
      if (isInitialized) {
        return;
      }

      setLoading(true);
      setError(null);
      
      try {
        const loadedLocale = await localizationService.getLocalization(serviceOptions);
        initialize(loadedLocale);
        
        // Synchronize context setLocale
        contextValue.setLocale(loadedLocale);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Failed to load locale';
        console.error('[useLocalization] Load failed:', errorMsg);
        setError(errorMsg);
        
        // Fallback: load from guest storage or use default
        const fallbackLocale = loadGuestLocale();
        initialize(fallbackLocale);
      } finally {
        setLoading(false);
      }
    };

    loadLocale();
    // FIXED: Only depend on primitives (isAuthenticated, isInitialized) not objects/functions
  }, [isAuthenticated, isInitialized]);

  // Set locale (with API/localStorage persistence)
  const setLocale = useCallback(async (newLocale: Locale) => {
    setLoading(true);
    setError(null);

    try {
      const savedLocale = await localizationService.updateLocalization(newLocale, serviceOptions);
      
      // ⭐ IMPORTANT: Met à jour le store GLOBAL
      setStoreLocale(savedLocale);
      
      // ⭐ Synchronize context
      contextValue.setLocale(savedLocale);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to save locale';
      console.error('[useLocalization] Save failed:', errorMsg);
      setError(errorMsg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [serviceOptions, setStoreLocale, setLoading, contextValue]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    locale,
    setLocale,
    loading: isLoading,
    error,
    clearError,
    t: contextValue.t
  };
}

export default useLocalization;

