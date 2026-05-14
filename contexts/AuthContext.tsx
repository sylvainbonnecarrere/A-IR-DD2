/**
 * @file AuthContext.tsx
 * @description Authentication context provider with localStorage persistence
 * @domain Design Domain - Authentication
 *
 * ARCHITECTURE:
 * - Custom React Context for authentication state
 * - localStorage persistence (key: auth_data_v1)
 * - Safe hydration on app boot (no blocking)
 * - Guest mode fallback (isAuthenticated = false)
 *
 * NON-RÉGRESSION: Guest mode unchanged if user is null
 */

import React, {
    createContext,
    useContext,
    useState,
    useEffect,
    ReactNode,
    useCallback
} from 'react';
import { User, AuthContextType, StoredAuthData, AuthResponse, AuthLoadingState, LLMApiKey, AuthSessionStatus } from './types/auth.types';
import { LLMConfig, LocalLLMProfile } from '../types';
import { wipeGuestData, checkGuestDataExists } from '../utils/guestDataUtils';
import { useDesignStore } from '../stores/useDesignStore';
import { useWorkflowStore } from '../stores/useWorkflowStore';
import { useRuntimeStore } from '../stores/useRuntimeStore';
import { useLocalizationStore } from '../stores/useLocalizationStore';
import { useFunctionStore } from '../stores/useFunctionStore';
import {
    INITIAL_RUNTIME_LLM_CONFIGS,
} from '../services/runtimeConfigRepository';
import { authSessionStorage } from '../utils/authSessionStorage';
import {
    AUTH_SESSION_DEGRADED_EVENT,
    AUTH_SESSION_REFRESHED_EVENT,
    requestAccessTokenRefresh,
} from '../utils/authSessionService';
import {
    loadAuthenticatedRuntimeBootstrap,
    loadGuestRuntimeBootstrap,
    type RuntimeBootstrapState,
} from '../services/runtimeBootstrapService';

import { API_BASE_URL } from '../config/api.config';

/**
 * AuthContext - Singleton context for authentication state
 */
export const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
    children: ReactNode;
}

/**
 * AuthProvider component
 * Wraps application with authentication context
 *
 * Lifecycle:
 * 1. Mount: isLoading=true
 * 2. useEffect: Hydrate from localStorage
 * 3. Render: isLoading=false (or false from start if no stored auth)
 */
export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
    // Estado
    const [user, setUser] = useState<User | null>(null);
    const [accessToken, setAccessToken] = useState<string | null>(null);
    const [refreshToken, setRefreshToken] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true); // Start true to avoid FOUC
    const [sessionStatus, setSessionStatus] = useState<AuthSessionStatus>('loading');
    const [error, setError] = useState<string | null>(null);
    const [llmApiKeys, setLlmApiKeys] = useState<LLMApiKey[] | null>(null); // J4.2: Session-only storage
    const [runtimeLLMConfigs, setRuntimeLLMConfigs] = useState<LLMConfig[]>(INITIAL_RUNTIME_LLM_CONFIGS);
    const [localLLMProfiles, setLocalLLMProfiles] = useState<LocalLLMProfile[]>([]);
    const [isMounted, setIsMounted] = useState(false); // ⭐ J4.4: Prevent async cleanup errors

    /**
     * ⭐ J4.4: Track mount state to prevent async state updates after unmount
     * This prevents the "message channel closed before response" error
     */
    useEffect(() => {
        setIsMounted(true);
        return () => {
            setIsMounted(false);
        };
    }, []);

    const resetStores = useCallback(() => {
        try {
            useDesignStore.getState().resetAll();
            useWorkflowStore.getState().resetAll();
            useRuntimeStore.getState().resetAll();
            useLocalizationStore.getState().resetAll();
            useFunctionStore.getState().resetStore();
        } catch (err) {
            // Silent fail - stores may not be initialized
        }
    }, []);

    const clearAuthState = useCallback((options?: {
        sessionStatus?: AuthSessionStatus;
        error?: string | null;
        resetStores?: boolean;
        clearStorage?: boolean;
    }) => {
        const {
            sessionStatus: nextSessionStatus = 'ready',
            error: nextError = null,
            resetStores: shouldResetStores = true,
            clearStorage = true,
        } = options ?? {};

        setUser(null);
        setAccessToken(null);
        setRefreshToken(null);
        setLlmApiKeys(null);
        setRuntimeLLMConfigs(INITIAL_RUNTIME_LLM_CONFIGS);
        setLocalLLMProfiles([]);
        setError(nextError);
        setSessionStatus(nextSessionStatus);

        if (clearStorage) {
            authSessionStorage.clear();
        }

        if (shouldResetStores) {
            resetStores();
        }
    }, [resetStores]);

    /**
     * Hydrate auth from localStorage on mount
     * SAFE: Try-catch prevents app crash if localStorage corrupted
     */
    useEffect(() => {
        const hydrateFromStorage = () => {
            let nextSessionStatus: AuthSessionStatus = 'ready';
            let nextError: string | null = null;

            try {
                const storedAuth = authSessionStorage.read();
                if (storedAuth.status === 'ok') {
                    const { user, accessToken, refreshToken }: StoredAuthData = storedAuth.data;

                    // Validate structure
                    if (user && user.id && user.email && accessToken && refreshToken) {
                        nextSessionStatus = 'restoring-session';
                        if (isMounted) {
                            setUser(user);
                            setAccessToken(accessToken);
                            setRefreshToken(refreshToken);
                            // ⭐ J4.5: Fetch LLM keys on session restore (was missing!)
                            // Note: fetchLLMApiKeys is called via effect below
                        }
                    } else {
                        // Malformed data - clear
                        authSessionStorage.clear();
                        nextSessionStatus = 'degraded';
                        nextError = 'Session locale invalide. Veuillez vous reconnecter.';
                    }
                } else if (storedAuth.status === 'invalid') {
                    authSessionStorage.clear();
                    nextSessionStatus = 'degraded';
                    nextError = 'Session locale invalide. Veuillez vous reconnecter.';
                }
            } catch (err) {
                authSessionStorage.clear();
                nextSessionStatus = 'degraded';
                nextError = 'Session locale invalide. Veuillez vous reconnecter.';
            } finally {
                // Always finish loading (fallback to guest mode)
                if (isMounted) {
                    setSessionStatus(nextSessionStatus);
                    setError(nextError);
                    setIsLoading(false);
                }
            }
        };

        hydrateFromStorage();
    }, [isMounted]);

    /**
     * Listen for logout event from API interceptor (e.g., 401 response)
     */
    useEffect(() => {
        const handleLogoutEvent = (event: Event) => {
            const customEvent = event as CustomEvent;
            const isExpiredSession = customEvent.detail?.reason !== 'manual_logout';
            clearAuthState({
                sessionStatus: isExpiredSession ? 'degraded' : 'ready',
                error: isExpiredSession
                    ? customEvent.detail?.message || 'Session expirée. Veuillez vous reconnecter.'
                    : null,
            });
        };

        const handleSessionRefreshedEvent = (event: Event) => {
            const customEvent = event as CustomEvent<{ accessToken?: string }>;
            const refreshedToken = customEvent.detail?.accessToken;
            if (!refreshedToken) {
                return;
            }

            setAccessToken(refreshedToken);
            setSessionStatus('ready');
            setError(null);
        };

        const handleSessionDegradedEvent = (event: Event) => {
            const customEvent = event as CustomEvent<{ message?: string }>;
            clearAuthState({
                sessionStatus: 'degraded',
                error: customEvent.detail?.message || 'Session expirée. Veuillez vous reconnecter.',
            });
        };

        window.addEventListener('auth:logout', handleLogoutEvent);
        window.addEventListener(AUTH_SESSION_REFRESHED_EVENT, handleSessionRefreshedEvent);
        window.addEventListener(AUTH_SESSION_DEGRADED_EVENT, handleSessionDegradedEvent);

        return () => {
            window.removeEventListener('auth:logout', handleLogoutEvent);
            window.removeEventListener(AUTH_SESSION_REFRESHED_EVENT, handleSessionRefreshedEvent);
            window.removeEventListener(AUTH_SESSION_DEGRADED_EVENT, handleSessionDegradedEvent);
        };
    }, [clearAuthState]);

    /**
     * Save auth data to localStorage and state
     */
    const saveAuthData = useCallback((userData: User, accessToken: string, refreshToken: string) => {
        const authData: StoredAuthData = { user: userData, accessToken, refreshToken };
        authSessionStorage.write(authData);
        setUser(userData);
        setAccessToken(accessToken);
        setRefreshToken(refreshToken);
        setSessionStatus('ready');
        setError(null);
    }, []);

    const refreshRuntimeConfigState = useCallback(async (tokenOverride?: string): Promise<RuntimeBootstrapState | null> => {
        if (!isMounted) return null;

        const effectiveToken = tokenOverride ?? accessToken ?? undefined;
        const shouldUseApi = !!effectiveToken;

        if (shouldUseApi) {
            const runtimeState = await loadAuthenticatedRuntimeBootstrap(effectiveToken);

            if (!isMounted) return runtimeState;

            setLlmApiKeys(runtimeState.llmApiKeys);
            setRuntimeLLMConfigs(runtimeState.runtimeLLMConfigs);
            setLocalLLMProfiles(runtimeState.localLLMProfiles);
            setSessionStatus('ready');
            return runtimeState;
        }

        const runtimeState = await loadGuestRuntimeBootstrap();

        if (!isMounted) return runtimeState;

        setLlmApiKeys(runtimeState.llmApiKeys);
        setRuntimeLLMConfigs(runtimeState.runtimeLLMConfigs);
        setLocalLLMProfiles(runtimeState.localLLMProfiles);

        if (sessionStatus !== 'degraded') {
            setSessionStatus('ready');
        }
        return runtimeState;
    }, [accessToken, isMounted, sessionStatus]);

    /**     * ⭐ J4.5 FIX: Fetch LLM API keys when accessToken becomes available
     * This handles both:
     * - Fresh login (fetchLLMApiKeys already called in login(), but this is a safety net)
     * - Session restore from localStorage (hydrateFromStorage doesn't call fetchLLMApiKeys)
     */
    useEffect(() => {
        if (!isMounted || isLoading) return;
        void refreshRuntimeConfigState();
    }, [accessToken, isMounted, isLoading, refreshRuntimeConfigState, user]);

    /**     * Login with email & password
     * POST /api/auth/login
     * 
     * CRITICAL: Wipes guest data before setting auth state
     * This prevents data leak from guest session to authenticated session
     */
    const login = useCallback(async (email: string, password: string) => {
        setError(null);
        setIsLoading(true);
        setSessionStatus('loading');

        try {
            const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password }),
                credentials: 'omit' // No cookies for now
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Login failed');
            }

            const { user: userData, accessToken, refreshToken }: AuthResponse = await response.json();

            // ⭐ CRITICAL: Wipe guest data BEFORE setting auth state
            // This prevents guest session data from bleeding into auth session
            const guestCheck = checkGuestDataExists();
            if (guestCheck.totalKeys > 0) {
                const wipeResult = wipeGuestData();
            }
            
            // ⭐ NEW: Reset localization store on login to prevent data leak
            const localizationStore = useLocalizationStore.getState();
            localizationStore.resetAll();

            saveAuthData(userData, accessToken, refreshToken);

            // J4.2: Fetch LLM API keys after successful login
            await refreshRuntimeConfigState(accessToken);
        } catch (err: any) {
            const errorMsg = err.message || 'Connection error';
            setError(errorMsg);
            throw err; // Re-throw for modal/UI handling
        } finally {
            setIsLoading(false);
        }
    }, [refreshRuntimeConfigState, saveAuthData]);

    /**
     * Register with email & password
     * POST /api/auth/register
     * 
     * CRITICAL: Wipes guest data before setting auth state
     */
    const register = useCallback(async (email: string, password: string) => {
        setError(null);
        setIsLoading(true);
        setSessionStatus('loading');

        try {
            const response = await fetch(`${API_BASE_URL}/api/auth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Registration failed');
            }

            const { user: userData, accessToken, refreshToken }: AuthResponse = await response.json();

            // ⭐ CRITICAL: Wipe guest data BEFORE setting auth state
            const guestCheck = checkGuestDataExists();
            if (guestCheck.totalKeys > 0) {
                const wipeResult = wipeGuestData();
            }

            saveAuthData(userData, accessToken, refreshToken);

            // J4.2: Fetch LLM API keys after successful registration
            await refreshRuntimeConfigState(accessToken);
        } catch (err: any) {
            const errorMsg = err.message || 'Connection error';
            setError(errorMsg);
            throw err;
        } finally {
            setIsLoading(false);
        }
    }, [refreshRuntimeConfigState, saveAuthData]);

    /**
     * Logout - Clear all auth data and RESET ALL STORES
     * ⚠️ CRITICAL SECURITY FIX J4.4:
     * - Clears authenticated user state
     * - Wipes ALL stores (prevents auth data leak to guest session)
     * - Does NOT wipe guest localStorage (user may want to continue as guest)
     * 
     * ANTI-REGRESSION: This must ALWAYS reset stores, not wipe guest data!
     * Auth data must NOT persist into guest mode.
     */
    const logout = useCallback(() => {
        clearAuthState({ sessionStatus: 'ready', error: null });
    }, [clearAuthState]);

    /**
     * Refresh access token using refresh token
     * POST /api/auth/refresh
     * (Backend endpoint will be added in Phase 2)
     */
    const refreshAccessToken = useCallback(async () => {
        if (!refreshToken) {
            throw new Error('No refresh token available');
        }

        setSessionStatus('restoring-session');

        try {
            const newAccessToken = await requestAccessTokenRefresh(refreshToken);
            const authData: StoredAuthData = {
                user: user as User,
                accessToken: newAccessToken,
                refreshToken,
            };
            authSessionStorage.write(authData);
            setAccessToken(newAccessToken);
            setSessionStatus('ready');
            setError(null);
        } catch (err: any) {
            clearAuthState({
                sessionStatus: 'degraded',
                error: 'Session expirée. Veuillez vous reconnecter.'
            });
            throw err;
        }
    }, [clearAuthState, refreshToken, user]);

    /**
     * Clear error message
     */
    const clearError = useCallback(() => {
        setError(null);
    }, []);

    /**
     * ⭐ J4.6 FIX: Wrapper function to refresh LLM API keys
     * Uses the current accessToken from context (not passed as parameter)
     * This ensures we always use the most up-to-date token
     * 
     * NOTE: Do NOT include llmApiKeys in dependencies!
     * Including it creates a circular dependency and causes cascade updates
     */
    const refreshLLMApiKeysWrapper = useCallback(async () => {
        if (!accessToken) {
            console.warn('[AuthContext] Cannot refresh LLM API keys: no access token');
            return;
        }
        console.log('[AuthContext] 🔄 Refreshing LLM API keys...');
        await refreshRuntimeConfigState(accessToken);
    }, [accessToken, refreshRuntimeConfigState]);

    // Context value
    const value: AuthContextType = {
        user,
        accessToken,
        refreshToken,
        isAuthenticated: !!user && !!accessToken,
        isLoading,
        sessionStatus,
        error,
        llmApiKeys, // J4.2: Expose LLM API keys to components
        runtimeLLMConfigs,
        localLLMProfiles,
        login,
        register,
        logout,
        refreshAccessToken,
        clearError,
        refreshLLMApiKeys: refreshLLMApiKeysWrapper, // ⭐ J4.6: Use wrapper that captures current accessToken
        refreshRuntimeConfigState,
    };

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

/**
 * Hook: useAuth
 * Access authentication context
 *
 * USAGE:
 * ```tsx
 * const { user, isAuthenticated, login } = useAuth();
 * ```
 *
 * ERROR:
 * Will throw if used outside AuthProvider
 */
export const useAuth = (): AuthContextType => {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within AuthProvider');
    }
    return context;
};

// Re-export types for consumers
export type { AuthContextType } from './types/auth.types';

export default AuthContext;
