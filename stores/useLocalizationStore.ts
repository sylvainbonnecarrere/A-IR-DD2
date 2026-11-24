/**
 * @file useLocalizationStore.ts
 * @description Store Zustand pour l'état global de localization (langue)
 * @domain Design Domain - Persistence Preferences
 *
 * ⭐ ÉTAPE 3 PLAN_DE_PERSISTENCE: Localization Configuration
 *
 * ARCHITECTURE:
 * - État GLOBAL partagé entre tous les composants
 * - Synchronisé avec localStorage (guest) ou API (auth)
 * - Default: 'fr' (français)
 * - Supporte: fr, en, de, es, pt
 *
 * POURQUOI ZUSTAND:
 * - LocalizationContext seul ne peut pas partager état avec composants externes
 * - Le SettingsModal a besoin d'un état centralisé et réactif
 * - Zustand garantit un état unique et synchro en temps réel
 */

import { create } from 'zustand';
import { Locale } from '../i18n/locales';

const GUEST_LOCALE_KEY = 'guest_app_locale';
const DEFAULT_LOCALE: Locale = 'fr';

interface LocalizationState {
  locale: Locale;
  isLoading: boolean;
  isInitialized: boolean;

  // Actions
  setLocale: (locale: Locale) => void;
  setLoading: (loading: boolean) => void;
  initialize: (locale: Locale) => void;
  resetAll: () => void; // ⭐ NEW: Reset on auth change (login/logout)
}

export const useLocalizationStore = create<LocalizationState>((set, _get) => ({
  locale: DEFAULT_LOCALE,
  isLoading: false,
  isInitialized: false,

  setLocale: (locale: Locale) => {
    set({ locale });
  },

  setLoading: (loading: boolean) => {
    set({ isLoading: loading });
  },

  initialize: (locale: Locale) => {
    set({ locale, isInitialized: true });
  },

  // ⭐ NEW: Reset store on auth change (login/logout)
  // Prevents data leak between guest and authenticated sessions
  resetAll: () => {
    set({
      locale: DEFAULT_LOCALE,
      isLoading: false,
      isInitialized: false,
    });
  },
}));

/**
 * Helper pour charger la locale depuis localStorage (mode invité)
 */
export function loadGuestLocale(): Locale {
  const stored = localStorage.getItem(GUEST_LOCALE_KEY);
  // Validation simple - check if it's a valid locale
  if (stored && ['fr', 'en', 'de', 'es', 'pt'].includes(stored)) {
    return stored as Locale;
  }
  return DEFAULT_LOCALE;
}

/**
 * Helper pour sauvegarder la locale dans localStorage (mode invité)
 */
export function saveGuestLocale(locale: Locale): void {
  localStorage.setItem(GUEST_LOCALE_KEY, locale);
}

export default useLocalizationStore;
