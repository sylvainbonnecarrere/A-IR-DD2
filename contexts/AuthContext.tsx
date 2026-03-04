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
import { User, AuthContextType, StoredAuthData, AuthResponse, AuthLoadingState, LLMApiKey } from './types/auth.types';
import { wipeGuestData, checkGuestDataExists } from '../utils/guestDataUtils';
import { useDesignStore } from '../stores/useDesignStore';
import { useWorkflowStore } from '../stores/useWorkflowStore';
import { useRuntimeStore } from '../stores/useRuntimeStore';
import { useLocalizationStore } from '../stores/useLocalizationStore';
import apiClient from '../utils/apiClient';

import { API_BASE_URL } from '../config/api.config';

const AUTH_STORAGE_KEY = 'auth_data_v1';

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
    const [error, setError] = useState<string | null>(null);
    const [llmApiKeys, setLlmApiKeys] = useState<LLMApiKey[] | null>(null); // J4.2: Session-only storage
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

    /**
     * Hydrate auth from localStorage on mount
     * SAFE: Try-catch prevents app crash if localStorage corrupted
     */
    useEffect(() => {
        const hydrateFromStorage = () => {
            try {
                const stored = localStorage.getItem(AUTH_STORAGE_KEY);
                if (stored) {
                    const { user, accessToken, refreshToken }: StoredAuthData = JSON.parse(stored);

                    // Validate structure
                    if (user && user.id && user.email && accessToken && refreshToken) {
                        if (isMounted) {
                            setUser(user);
                            setAccessToken(accessToken);
                            setRefreshToken(refreshToken);
                            // ⭐ J4.5: Fetch LLM keys on session restore (was missing!)
                            // Note: fetchLLMApiKeys is called via effect below
                        }
                    } else {
                        // Malformed data - clear
                        localStorage.removeItem(AUTH_STORAGE_KEY);
                    }
                }
            } catch (err) {
                localStorage.removeItem(AUTH_STORAGE_KEY);
            } finally {
                // Always finish loading (fallback to guest mode)
                if (isMounted) {
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
            // Logout event received

            // Clear auth state
            setUser(null);
            setAccessToken(null);
            setRefreshToken(null);
            localStorage.removeItem(AUTH_STORAGE_KEY);
            setError('Session expirée. Veuillez vous reconnecter.');
        };

        window.addEventListener('auth:logout', handleLogoutEvent);

        return () => {
            window.removeEventListener('auth:logout', handleLogoutEvent);
        };
    }, []);

    /**
     * Save auth data to localStorage and state
     */
    const saveAuthData = useCallback((userData: User, accessToken: string, refreshToken: string) => {
        const authData: StoredAuthData = { user: userData, accessToken, refreshToken };
        localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(authData));
        setUser(userData);
        setAccessToken(accessToken);
        setRefreshToken(refreshToken);
        setError(null);
    }, []);

    /**
     * J4.2: Fetch decrypted LLM API keys from server
     * POST /api/llm/get-all-api-keys
     * Called after successful login/register
     * Keys stored ONLY in memory (session), NOT in localStorage
     * 
     * ⭐ J4.4: Added timeout & mount check to prevent async errors
     */
    const fetchLLMApiKeys = useCallback(async (token: string, retryCount = 0) => {
        if (!isMounted) return;

        // Timeout 5s pour éviter un hang
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        try {
            // ⭐ FIX: Pass token DIRECTLY in headers — don't rely solely on interceptor
            const { data: keys } = await apiClient.post<LLMApiKey[]>(
                '/api/llm/get-all-api-keys',
                {},
                {
                    signal: controller.signal,
                    headers: { Authorization: `Bearer ${token}` }
                }
            );

            if (isMounted) {
                setLlmApiKeys(keys);
            }
        } catch (err: any) {
            if (err.name === 'AbortError' || err.code === 'ERR_CANCELED') {
                console.warn('[AuthContext] Fetch timeout');
            } else if (err.response?.status === 401 && retryCount < 2) {
                // ⭐ FIX: Auth may not be fully propagated yet — retry after delay
                clearTimeout(timeoutId);
                await new Promise(resolve => setTimeout(resolve, 500));
                if (isMounted) {
                    return fetchLLMApiKeys(token, retryCount + 1);
                }
                return;
            } else {
                console.error('[AuthContext] Fetch error:', err.message);
            }
            if (isMounted) {
                setLlmApiKeys([]);
            }
        } finally {
            clearTimeout(timeoutId);
        }
    }, [isMounted]);

    /**     * ⭐ J4.5 FIX: Fetch LLM API keys when accessToken becomes available
     * This handles both:
     * - Fresh login (fetchLLMApiKeys already called in login(), but this is a safety net)
     * - Session restore from localStorage (hydrateFromStorage doesn't call fetchLLMApiKeys)
     */
    useEffect(() => {
        if (accessToken && llmApiKeys === null && isMounted) {
            fetchLLMApiKeys(accessToken);
        }
    }, [accessToken, llmApiKeys, isMounted, fetchLLMApiKeys]);

    /**     * Login with email & password
     * POST /api/auth/login
     * 
     * CRITICAL: Wipes guest data before setting auth state
     * This prevents data leak from guest session to authenticated session
     */
    const login = useCallback(async (email: string, password: string) => {
        setError(null);
        setIsLoading(true);

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
            await fetchLLMApiKeys(accessToken);
        } catch (err: any) {
            const errorMsg = err.message || 'Connection error';
            setError(errorMsg);
            throw err; // Re-throw for modal/UI handling
        } finally {
            setIsLoading(false);
        }
    }, [saveAuthData, fetchLLMApiKeys]);

    /**
     * Register with email & password
     * POST /api/auth/register
     * 
     * CRITICAL: Wipes guest data before setting auth state
     */
    const register = useCallback(async (email: string, password: string) => {
        setError(null);
        setIsLoading(true);

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
            await fetchLLMApiKeys(accessToken);
        } catch (err: any) {
            const errorMsg = err.message || 'Connection error';
            setError(errorMsg);
            throw err;
        } finally {
            setIsLoading(false);
        }
    }, [saveAuthData, fetchLLMApiKeys]);

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
        // 1. Clear auth state
        setUser(null);
        setAccessToken(null);
        setRefreshToken(null);
        setError(null);
        setLlmApiKeys(null);
        localStorage.removeItem(AUTH_STORAGE_KEY);
        
        // 2. ⭐ CRITICAL J4.4: Wipe ALL stores to prevent auth data leak to guest
        try {
            useDesignStore.getState().resetAll();
            useWorkflowStore.getState().resetAll();
            useRuntimeStore.getState().resetAll();
            useLocalizationStore.getState().resetAll(); // ⭐ NEW: Reset localization too
        } catch (err) {
            // Silent fail - stores may not be initialized
        }
    }, []);

    /**
     * Refresh access token using refresh token
     * POST /api/auth/refresh
     * (Backend endpoint will be added in Phase 2)
     */
    const refreshAccessToken = useCallback(async () => {
        if (!refreshToken) {
            throw new Error('No refresh token available');
        }

        try {
            const response = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refreshToken })
            });

            if (!response.ok) {
                logout(); // Token expired, logout user
                throw new Error('Token refresh failed');
            }

            const { accessToken: newAccessToken }: { accessToken: string } = await response.json();
            setAccessToken(newAccessToken);
        } catch (err: any) {
            logout();
            throw err;
        }
    }, [refreshToken, logout]);

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
        await fetchLLMApiKeys(accessToken);
    }, [accessToken, fetchLLMApiKeys]);

    // Context value
    const value: AuthContextType = {
        user,
        accessToken,
        refreshToken,
        isAuthenticated: !!user && !!accessToken,
        isLoading,
        error,
        llmApiKeys, // J4.2: Expose LLM API keys to components
        login,
        register,
        logout,
        refreshAccessToken,
        clearError,
        refreshLLMApiKeys: refreshLLMApiKeysWrapper // ⭐ J4.6: Use wrapper that captures current accessToken
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
