/**
 * 🪝 CUSTOM HOOK: useLocalLLMProfiles
 *
 * Pattern: mirrors useLLMConfigs.ts
 * Responsibility:
 *   - Consume AuthContext for authentication state
 *   - Call localLLMProfileService with appropriate options
 *   - Manage local state (loading, error)
 *   - Provide simple API to components
 */

import { useState, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import type { LocalLLMProfile } from '../types';
import * as localLLMProfileService from '../services/localLLMProfileService';

interface UseLocalLLMProfilesReturn {
    profiles: LocalLLMProfile[];
    loading: boolean;
    error: string | null;
    loadProfiles: () => Promise<void>;
    createProfile: (data: { name: string; endpoint: string; capabilities?: Record<string, boolean>; enabled?: boolean; detectedModel?: string | null }, syncAfterWrite?: boolean) => Promise<LocalLLMProfile>;
    updateProfile: (id: string, data: { name: string; endpoint: string; capabilities?: Record<string, boolean>; enabled?: boolean; detectedModel?: string | null }, syncAfterWrite?: boolean) => Promise<LocalLLMProfile>;
    deleteProfile: (id: string, syncAfterWrite?: boolean) => Promise<void>;
    clearError: () => void;
}

export function useLocalLLMProfiles(): UseLocalLLMProfilesReturn {
    const auth = useAuth();
    const { isAuthenticated, accessToken, localLLMProfiles, refreshRuntimeConfigState } = auth;

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const profiles = localLLMProfiles;

    const serviceOptions = {
        useApi: isAuthenticated,
        token: accessToken || undefined
    };

    const loadProfiles = useCallback(async () => {
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

    const createProfile = useCallback(
        async (data: { name: string; endpoint: string; capabilities?: Record<string, boolean>; enabled?: boolean; detectedModel?: string | null }, syncAfterWrite = true): Promise<LocalLLMProfile> => {
            setLoading(true);
            setError(null);
            try {
                const result = await localLLMProfileService.createProfile(data, serviceOptions);
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

    const updateProfile = useCallback(
        async (id: string, data: { name: string; endpoint: string; capabilities?: Record<string, boolean>; enabled?: boolean; detectedModel?: string | null }, syncAfterWrite = true): Promise<LocalLLMProfile> => {
            setLoading(true);
            setError(null);
            try {
                const result = await localLLMProfileService.updateProfile(id, data, serviceOptions);
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

    const deleteProfile = useCallback(
        async (id: string, syncAfterWrite = true): Promise<void> => {
            setLoading(true);
            setError(null);
            try {
                await localLLMProfileService.deleteProfile(id, serviceOptions);
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

    const clearError = useCallback(() => {
        setError(null);
    }, []);

    return {
        profiles,
        loading,
        error,
        loadProfiles,
        createProfile,
        updateProfile,
        deleteProfile,
        clearError
    };
}
