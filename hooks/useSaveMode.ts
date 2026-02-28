/**
 * @file useSaveMode.ts
 * @description Hook pour gérer le mode de sauvegarde (auto/manuel)
 * @domain Design Domain - Persistence Preferences
 * 
 * ⭐ ÉTAPE 2 PLAN_DE_PERSISTENCE: Save Mode Configuration
 * 
 * ARCHITECTURE:
 * - Utilise useSaveModeStore (Zustand) pour état GLOBAL
 * - Mode Guest: stocké en localStorage
 * - Mode Auth: stocké via API dans user preferences
 * - Default: 'manual' (sauvegarde manuelle)
 * 
 * USAGE:
 *   const { saveMode, setSaveMode, isManualSave } = useSaveMode();
 */

import { useEffect, useCallback } from 'react';
import { useAuth } from './useAuth';
import { API_BASE_URL } from '../config/api.config';
import { 
    useSaveModeStore, 
    SaveMode, 
    loadGuestSaveMode, 
    saveGuestSaveMode 
} from '../stores/useSaveModeStore';

const DEFAULT_SAVE_MODE: SaveMode = 'manual';

interface UseSaveModeReturn {
    saveMode: SaveMode;
    setSaveMode: (mode: SaveMode) => Promise<void>;
    isManualSave: boolean;
    isAutoSave: boolean;
    isLoading: boolean;
}

export function useSaveMode(): UseSaveModeReturn {
    const { isAuthenticated, accessToken } = useAuth();
    
    // Zustand store (état GLOBAL partagé)
    const { 
        saveMode, 
        isLoading, 
        isInitialized,
        setSaveMode: setStoreSaveMode, 
        setLoading,
        initialize 
    } = useSaveModeStore();

    // Load save mode on mount and auth change
    useEffect(() => {
        // Ne pas recharger si déjà initialisé avec le même état auth
        const loadSaveMode = async () => {
            if (isAuthenticated && accessToken) {
                // Mode authentifié: charger depuis API
                setLoading(true);
                try {
                    const response = await fetch(
                        `${API_BASE_URL}/api/user-settings`,
                        {
                            headers: {
                                'Authorization': `Bearer ${accessToken}`,
                                'Content-Type': 'application/json'
                            }
                        }
                    );
                    
                    if (response.ok) {
                        const data = await response.json();
                        const mode = data.preferences?.saveMode || DEFAULT_SAVE_MODE;
                        initialize(mode);
                    } else {
                        initialize(DEFAULT_SAVE_MODE);
                    }
                } catch (err) {
                    console.error('[useSaveMode] Failed to load from API:', err);
                    initialize(DEFAULT_SAVE_MODE);
                } finally {
                    setLoading(false);
                }
            } else {
                // Mode invité: charger depuis localStorage
                const mode = loadGuestSaveMode();
                initialize(mode);
            }
        };

        loadSaveMode();
    }, [isAuthenticated, accessToken, initialize, setLoading]);

    // Set save mode (with API/localStorage persistence)
    const setSaveMode = useCallback(async (mode: SaveMode) => {
        if (isAuthenticated && accessToken) {
            // Mode authentifié: sauvegarder via API
            setLoading(true);
            try {
                const response = await fetch(
                    `${API_BASE_URL}/api/user-settings`,
                    {
                        method: 'PUT',
                        headers: {
                            'Authorization': `Bearer ${accessToken}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            preferences: { saveMode: mode }
                        })
                    }
                );

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                // ⭐ IMPORTANT: Met à jour le store GLOBAL
                setStoreSaveMode(mode);
            } catch (err) {
                console.error('[useSaveMode] Failed to save to API:', err);
                throw err;
            } finally {
                setLoading(false);
            }
        } else {
            // Mode invité: sauvegarder dans localStorage
            saveGuestSaveMode(mode);
            setStoreSaveMode(mode);
        }
    }, [isAuthenticated, accessToken, setStoreSaveMode, setLoading]);

    return {
        saveMode,
        setSaveMode,
        isManualSave: saveMode === 'manual',
        isAutoSave: saveMode === 'auto',
        isLoading
    };
}

export type { SaveMode };
export default useSaveMode;
