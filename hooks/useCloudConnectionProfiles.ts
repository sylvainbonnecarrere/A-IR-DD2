import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import type { CloudConnectionProfile } from '../types';
import * as cloudConnectionProfileService from '../services/cloudConnectionProfileService';
import type {
    CloudConnectionProfileTestResponse,
    CloudConnectionProfileUpsertData,
} from '../services/cloudConnectionProfileService';

interface UseCloudConnectionProfilesReturn {
    profiles: CloudConnectionProfile[];
    loading: boolean;
    error: string | null;
    loadProfiles: () => Promise<void>;
    createProfile: (data: CloudConnectionProfileUpsertData, syncAfterWrite?: boolean) => Promise<CloudConnectionProfile>;
    updateProfile: (id: string, data: CloudConnectionProfileUpsertData, syncAfterWrite?: boolean) => Promise<CloudConnectionProfile>;
    deleteProfile: (id: string, syncAfterWrite?: boolean) => Promise<void>;
    testProfile: (id: string, syncAfterWrite?: boolean) => Promise<CloudConnectionProfileTestResponse>;
    clearError: () => void;
}

export function useCloudConnectionProfiles(): UseCloudConnectionProfilesReturn {
    const { isAuthenticated, accessToken } = useAuth();
    const [profiles, setProfiles] = useState<CloudConnectionProfile[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const serviceOptions = useMemo(
        () => ({
            useApi: isAuthenticated,
            token: accessToken || undefined,
        }),
        [accessToken, isAuthenticated],
    );

    const loadProfiles = useCallback(async () => {
        if (!isAuthenticated || !accessToken) {
            setProfiles([]);
            setError(null);
            return;
        }

        setLoading(true);
        setError(null);
        try {
            const result = await cloudConnectionProfileService.getAllProfiles(serviceOptions);
            setProfiles(result);
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : 'Erreur inconnue';
            setError(errorMsg);
        } finally {
            setLoading(false);
        }
    }, [accessToken, isAuthenticated, serviceOptions]);

    useEffect(() => {
        void loadProfiles();
    }, [loadProfiles]);

    const createProfile = useCallback(async (data: CloudConnectionProfileUpsertData, syncAfterWrite = true) => {
        setLoading(true);
        setError(null);
        try {
            const result = await cloudConnectionProfileService.createProfile(data, serviceOptions);
            if (syncAfterWrite) {
                await loadProfiles();
            } else {
                setProfiles(prev => [...prev, result]);
            }
            return result;
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : 'Erreur inconnue';
            setError(errorMsg);
            throw err;
        } finally {
            setLoading(false);
        }
    }, [loadProfiles, serviceOptions]);

    const updateProfile = useCallback(async (id: string, data: CloudConnectionProfileUpsertData, syncAfterWrite = true) => {
        setLoading(true);
        setError(null);
        try {
            const result = await cloudConnectionProfileService.updateProfile(id, data, serviceOptions);
            if (syncAfterWrite) {
                await loadProfiles();
            } else {
                setProfiles(prev => prev.map(profile => profile.id === id ? result : profile));
            }
            return result;
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : 'Erreur inconnue';
            setError(errorMsg);
            throw err;
        } finally {
            setLoading(false);
        }
    }, [loadProfiles, serviceOptions]);

    const deleteProfile = useCallback(async (id: string, syncAfterWrite = true) => {
        setLoading(true);
        setError(null);
        try {
            await cloudConnectionProfileService.deleteProfile(id, serviceOptions);
            if (syncAfterWrite) {
                await loadProfiles();
            } else {
                setProfiles(prev => prev.filter(profile => profile.id !== id));
            }
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : 'Erreur inconnue';
            setError(errorMsg);
            throw err;
        } finally {
            setLoading(false);
        }
    }, [loadProfiles, serviceOptions]);

    const testProfile = useCallback(async (id: string, syncAfterWrite = true) => {
        setLoading(true);
        setError(null);
        try {
            const result = await cloudConnectionProfileService.testProfile(id, serviceOptions);
            if (result.profile) {
                setProfiles(prev => prev.map(profile => profile.id === id ? result.profile as CloudConnectionProfile : profile));
            }
            if (syncAfterWrite) {
                await loadProfiles();
            }
            return result;
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : 'Erreur inconnue';
            setError(errorMsg);
            throw err;
        } finally {
            setLoading(false);
        }
    }, [loadProfiles, serviceOptions]);

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
        testProfile,
        clearError,
    };
}