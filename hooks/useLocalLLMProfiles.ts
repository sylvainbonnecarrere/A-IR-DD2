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

import { useState, useCallback, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import type { LocalLLMProfile } from '../types';
import * as localLLMProfileService from '../services/localLLMProfileService';

interface UseLocalLLMProfilesReturn {
    profiles: LocalLLMProfile[];
    loading: boolean;
    error: string | null;
    loadProfiles: () => Promise<void>;
    createProfile: (data: { name: string; endpoint: string; capabilities?: Record<string, boolean>; enabled?: boolean }) => Promise<LocalLLMProfile>;
    updateProfile: (id: string, data: { name: string; endpoint: string; capabilities?: Record<string, boolean>; enabled?: boolean }) => Promise<LocalLLMProfile>;
    deleteProfile: (id: string) => Promise<void>;
    clearError: () => void;
}

export function useLocalLLMProfiles(): UseLocalLLMProfilesReturn {
    const auth = useAuth();
    const { isAuthenticated, accessToken } = auth;

    const [profiles, setProfiles] = useState<LocalLLMProfile[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const serviceOptions = {
        useApi: isAuthenticated,
        token: accessToken || undefined
    };

    // Clear profiles from memory when logout happens to prevent data bleeding
    useEffect(() => {
        if (!isAuthenticated && profiles.length > 0) {
            setProfiles([]);
        }
    }, [isAuthenticated]);

    // Load profiles when auth state changes
    useEffect(() => {
        void loadProfiles();
    }, [isAuthenticated, accessToken]);

    const loadProfiles = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await localLLMProfileService.getAllProfiles(serviceOptions);
            setProfiles(data);
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : 'Erreur inconnue';
            setError(errorMsg);
        } finally {
            setLoading(false);
        }
    }, [isAuthenticated, accessToken]);

    const createProfile = useCallback(
        async (data: { name: string; endpoint: string; capabilities?: Record<string, boolean>; enabled?: boolean }): Promise<LocalLLMProfile> => {
            setLoading(true);
            setError(null);
            try {
                const result = await localLLMProfileService.createProfile(data, serviceOptions);
                setProfiles(prev => [...prev, result].sort((a, b) => a.name.localeCompare(b.name)));
                return result;
            } catch (err) {
                const errorMsg = err instanceof Error ? err.message : 'Erreur inconnue';
                setError(errorMsg);
                throw err;
            } finally {
                setLoading(false);
            }
        },
        [isAuthenticated, accessToken]
    );

    const updateProfile = useCallback(
        async (id: string, data: { name: string; endpoint: string; capabilities?: Record<string, boolean>; enabled?: boolean }): Promise<LocalLLMProfile> => {
            setLoading(true);
            setError(null);
            try {
                const result = await localLLMProfileService.updateProfile(id, data, serviceOptions);
                setProfiles(prev => prev.map(p => p.id === id ? result : p).sort((a, b) => a.name.localeCompare(b.name)));
                return result;
            } catch (err) {
                const errorMsg = err instanceof Error ? err.message : 'Erreur inconnue';
                setError(errorMsg);
                throw err;
            } finally {
                setLoading(false);
            }
        },
        [isAuthenticated, accessToken]
    );

    const deleteProfile = useCallback(
        async (id: string): Promise<void> => {
            setLoading(true);
            setError(null);
            try {
                await localLLMProfileService.deleteProfile(id, serviceOptions);
                setProfiles(prev => prev.filter(p => p.id !== id));
            } catch (err) {
                const errorMsg = err instanceof Error ? err.message : 'Erreur inconnue';
                setError(errorMsg);
                throw err;
            } finally {
                setLoading(false);
            }
        },
        [isAuthenticated, accessToken]
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
