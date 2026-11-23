/**
 * 🎯 SERVICE LAYER: Localization Persistence
 *
 * Pattern: Strategy Pattern + Dependency Inversion
 * Responsabilité: Router les appels de persistance Localization
 *   - Si utilisateur authentifié → API backend
 *   - Si utilisateur invité → localStorage
 *
 * Usage: Jamais appelé directement par les composants
 * Les composants utilisent le hook useLocalization à la place
 *
 * Modèle sur: llmConfigService.ts et useSaveMode.ts
 */

import { Locale } from '../i18n/locales';

// ⭐ J4.5: Runtime BACKEND_URL using process.env to avoid import.meta.env issues in Jest tests
// Vite handles process.env.VITE_* replacement in browser builds
const getBackendUrl = (): string => {
  return process.env.VITE_BACKEND_URL || 'http://localhost:3001';
};

export interface LocalizationServiceOptions {
  useApi?: boolean; // true = backend, false = localStorage
  token?: string; // JWT token si useApi=true
}

// ============================================================================
// PARTIE 1: STOCKAGE LOCALSTORAGE (Guest)
// ============================================================================

const GUEST_LOCALE_KEY = 'guest_app_locale';
const DEFAULT_LOCALE: Locale = 'fr';

function getLocalLocale(): Locale {
  try {
    const stored = localStorage.getItem(GUEST_LOCALE_KEY);
    if (stored && ['fr', 'en', 'de', 'es', 'pt'].includes(stored)) {
      return stored as Locale;
    }
    return DEFAULT_LOCALE;
  } catch (error) {
    console.error('[LocalizationService] localStorage.getItem failed:', error);
    return DEFAULT_LOCALE;
  }
}

function saveLocalLocale(locale: Locale): void {
  try {
    localStorage.setItem(GUEST_LOCALE_KEY, locale);
  } catch (error) {
    console.error('[LocalizationService] localStorage.setItem failed:', error);
    throw new Error('Impossible de sauvegarder la langue localement');
  }
}

// ============================================================================
// PARTIE 2: API BACKEND (Authenticated)
// ============================================================================

async function apiRequest(endpoint: string, method: 'GET' | 'PUT', token: string, body?: any): Promise<any> {
  const options: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`${getBackendUrl()}${endpoint}`, options);

  if (!response.ok) {
    throw new Error(`API ${method} ${endpoint} failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function getApiLocale(token: string): Promise<Locale> {
  try {
    const data = await apiRequest('/api/user-settings', 'GET', token);
    const locale = data.preferences?.language || DEFAULT_LOCALE;

    if (['fr', 'en', 'de', 'es', 'pt'].includes(locale)) {
      return locale as Locale;
    }
    return DEFAULT_LOCALE;
  } catch (error) {
    console.error('[LocalizationService] getApiLocale failed:', error);
    throw error;
  }
}

async function saveApiLocale(locale: Locale, token: string): Promise<void> {
  try {
    await apiRequest('/api/user-settings', 'PUT', token, { preferences: { language: locale } });
  } catch (error) {
    console.error('[LocalizationService] saveApiLocale failed:', error);
    throw error;
  }
}

// ============================================================================
// PARTIE 3: PUBLIC API (Appelé par le hook useLocalization)
// ============================================================================

/**
 * Charge la locale actuelle (depuis localStorage ou API selon auth)
 */
export async function getLocalization(options: LocalizationServiceOptions): Promise<Locale> {
  if (options.useApi && options.token) {
    return getApiLocale(options.token);
  } else {
    return getLocalLocale();
  }
}

/**
 * Sauvegarde la locale (dans localStorage ou API selon auth)
 */
export async function updateLocalization(locale: Locale, options: LocalizationServiceOptions): Promise<Locale> {
  if (options.useApi && options.token) {
    await saveApiLocale(locale, options.token);
    return locale;
  } else {
    saveLocalLocale(locale);
    return locale;
  }
}

/**
 * Valide si une locale est supportée
 */
export function isValidLocale(locale: unknown): locale is Locale {
  return ['fr', 'en', 'de', 'es', 'pt'].includes(locale as string);
}

export default {
  getLocalization,
  updateLocalization,
  isValidLocale,
};
