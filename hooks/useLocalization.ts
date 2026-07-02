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

let inFlightLocalizationLoad: {
  signature: string;
  promise: Promise<Locale>;
} | null = null;
let appliedLocalizationSignature: string | null = null;

function getLocalizationLoadSignature(
  options: localizationService.LocalizationServiceOptions,
): string {
  return options.useApi ? `auth:${options.token ?? 'missing-token'}` : 'guest';
}

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
  const { isAuthenticated, accessToken, isLoading: authLoading, sessionStatus } = auth;
  
  // Zustand store (état GLOBAL partagé)
  const locale = useLocalizationStore((state) => state.locale);
  const isLoading = useLocalizationStore((state) => state.isLoading);
  const isInitialized = useLocalizationStore((state) => state.isInitialized);
  const setStoreLocale = useLocalizationStore((state) => state.setLocale);
  const setLoading = useLocalizationStore((state) => state.setLoading);
  const initialize = useLocalizationStore((state) => state.initialize);
  
  // Local error state
  const [error, setError] = useState<string | null>(null);

  // Options for the service (memoized to prevent infinite loops)
  const serviceOptions = useMemo(() => ({
    useApi: isAuthenticated,
    token: accessToken || undefined
  }), [isAuthenticated, accessToken]);

  const canLoadLocalization = !authLoading && (
    !isAuthenticated || (sessionStatus === 'ready' && Boolean(accessToken))
  );

  // Load locale on mount and auth change
  useEffect(() => {
    let cancelled = false;

    const loadLocale = async () => {
      if (isInitialized) {
        return;
      }

      if (!canLoadLocalization) {
        return;
      }

      setError(null);
      const loadSignature = getLocalizationLoadSignature(serviceOptions);
      let ownsLoad = false;
      
      try {
        if (!inFlightLocalizationLoad || inFlightLocalizationLoad.signature !== loadSignature) {
          ownsLoad = true;
          setLoading(true);

          const promise = localizationService.getLocalization(serviceOptions)
            .finally(() => {
              if (inFlightLocalizationLoad?.promise === promise) {
                inFlightLocalizationLoad = null;
              }
            });

          inFlightLocalizationLoad = {
            signature: loadSignature,
            promise,
          };
        }

        const loadedLocale = await inFlightLocalizationLoad.promise;

        if (cancelled) {
          return;
        }

        const storeState = useLocalizationStore.getState();
        const shouldApplyLocalization =
          appliedLocalizationSignature !== loadSignature ||
          !storeState.isInitialized ||
          storeState.locale !== loadedLocale;

        if (shouldApplyLocalization) {
          if (!storeState.isInitialized || storeState.locale !== loadedLocale) {
            storeState.initialize(loadedLocale);
          }

          if (contextValue.locale !== loadedLocale) {
            contextValue.setLocale(loadedLocale);
          }

          appliedLocalizationSignature = loadSignature;
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Failed to load locale';
        if (!cancelled) {
          console.error('[useLocalization] Load failed:', errorMsg);
          setError(errorMsg);
        }
        
        // Fallback: load from guest storage or use default
        const fallbackLocale = loadGuestLocale();
        const storeState = useLocalizationStore.getState();
        if (!storeState.isInitialized || storeState.locale !== fallbackLocale) {
          storeState.initialize(fallbackLocale);
        }
        if (!cancelled && contextValue.locale !== fallbackLocale) {
          contextValue.setLocale(fallbackLocale);
        }
        appliedLocalizationSignature = loadSignature;
      } finally {
        if (ownsLoad) {
          setLoading(false);
        }
      }
    };

    loadLocale();

    return () => {
      cancelled = true;
    };
  }, [canLoadLocalization, contextValue, isInitialized, serviceOptions, setLoading]);

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

