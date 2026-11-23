/**
 * @file hooks/useUserSettingsAPI.ts
 * @description User Settings API hook for authenticated users (J4.4 - Simplified)
 * @domain Design Domain - Settings Management / Persistence
 *
 * PURPOSE: Fetch and save user PREFERENCES from/to API endpoint
 * REQUIRES: User must be authenticated (JWT token)
 * 
 * MIGRATION NOTE (J4.4):
 * - llmConfigs handling REMOVED from this hook
 * - This hook now handles ONLY preferences (language, theme)
 * - For LLM configs, use useLLMConfigs hook with /api/llm-configs
 * 
 * USAGE in Auth mode:
 *   const { settings, isLoading, error, saveSettings } = useUserSettingsAPI();
 * 
 * USAGE in Guest mode:
 *   Don't use this hook - use localStorage directly instead
 */

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './useAuth';

interface UserPreferences {
  language: string;
  theme: string;
}

interface UserSettings {
  preferences: UserPreferences;
  lastSync?: string;
  updatedAt: string;
}

interface UseUserSettingsAPIResult {
  settings: UserSettings | null;
  isLoading: boolean;
  error: string | null;
  savePreferences: (preferences: Partial<UserPreferences>) => Promise<void>;
  refresh: () => Promise<void>;
}

export const useUserSettingsAPI = (): UseUserSettingsAPIResult => {
  const { isAuthenticated, accessToken } = useAuth();
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Fetch user settings from API
   */
  const fetchSettings = useCallback(async () => {
    if (!isAuthenticated) {
      console.debug('[useUserSettingsAPI] User not authenticated - skipping API fetch');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/user-settings', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      setSettings(data);
      console.debug('[useUserSettingsAPI] Settings fetched successfully:', data);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch settings';
      setError(errorMessage);
      console.error('[useUserSettingsAPI] Fetch error:', errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, accessToken]);

  /**
   * Save preferences to API (J4.4: only preferences, not llmConfigs)
   */
  const savePreferences = useCallback(
    async (preferences: Partial<UserPreferences>) => {
      if (!isAuthenticated) {
        throw new Error('User must be authenticated to save settings to API');
      }

      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch('/api/user-settings', {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            preferences
          })
        });

        if (!response.ok) {
          throw new Error(`API Error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        setSettings(data);
        console.debug('[useUserSettingsAPI] Settings saved successfully:', data);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to save settings';
        setError(errorMessage);
        console.error('[useUserSettingsAPI] Save error:', errorMessage);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [isAuthenticated, accessToken]
  );

  /**
   * Refresh settings from API
   */
  const refresh = useCallback(async () => {
    await fetchSettings();
  }, [fetchSettings]);

  /**
   * Auto-fetch settings when user authenticates
   */
  useEffect(() => {
    if (isAuthenticated && accessToken) {
      fetchSettings();
    }
  }, [isAuthenticated, accessToken, fetchSettings]);

  return {
    settings,
    isLoading,
    error,
    savePreferences,
    refresh
  };
};
