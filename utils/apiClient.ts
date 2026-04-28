/**
 * @file utils/apiClient.ts
 * @description Axios HTTP client with authentication interceptors
 * @domain Design Domain - API Communication
 *
 * ARCHITECTURE:
 * - Singleton axios instance with default config
 * - Request interceptor: Attach Authorization Bearer token
 * - Response interceptor: Handle 401 Unauthorized (token refresh/logout)
 * - Error handling: Structured error responses
 *
 * NON-RÉGRESSION:
 * - Guest mode (no token) = requests without Authorization header
 * - Authenticated mode = automatic header injection
 * - No blocking on network errors (UI handles gracefully)
 */

import axios, {
    AxiosInstance,
    AxiosError,
    InternalAxiosRequestConfig,
    AxiosResponse,
} from 'axios';
import { API_BASE_URL } from '../config/api.config';
import { useDesignStore } from '../stores/useDesignStore';
import {
    readStoredAuthDataForSession,
    refreshStoredSessionAccessToken,
} from './authSessionService';

const REFRESH_ENDPOINT = '/api/auth/refresh';

interface RetryableRequestConfig extends InternalAxiosRequestConfig {
    _retry?: boolean;
}

/**
 * Create axios instance with base URL
 */
const axiosInstance: AxiosInstance = axios.create({
    baseURL: API_BASE_URL,
    timeout: 10000, // 10 seconds
    headers: {
        'Content-Type': 'application/json',
    },
});

/**
 * Request Interceptor: Attach Authorization Bearer token if available
 */
axiosInstance.interceptors.request.use(
    (config: InternalAxiosRequestConfig) => {
        const authData = readStoredAuthDataForSession();
        if (authData?.accessToken && !config.headers.Authorization) {
            config.headers.Authorization = `Bearer ${authData.accessToken}`;
        }

        const currentRobotId = useDesignStore.getState().currentRobotId;
        if (currentRobotId && !config.headers['X-Robot-Id']) {
            config.headers['X-Robot-Id'] = currentRobotId;
        }

        return config;
    },
    (error: AxiosError) => {
        return Promise.reject(error);
    }
);

/**
 * Response Interceptor: Handle 401 Unauthorized
 */
axiosInstance.interceptors.response.use(
    (response: AxiosResponse) => {
        // Success - return as-is
        return response;
    },
    async (error: AxiosError) => {
        // Handle 401 Unauthorized — LOG ONLY, pas de destruction de session.
        // Le CdP a choisi la politique "Log, pas logout" pour éviter les wipe agressifs.
        if (error.response?.status === 401) {
            const originalRequest = error.config as RetryableRequestConfig | undefined;
            const storedAuthData = readStoredAuthDataForSession();

            if (
                originalRequest &&
                !originalRequest._retry &&
                originalRequest.url !== REFRESH_ENDPOINT &&
                storedAuthData?.refreshToken
            ) {
                originalRequest._retry = true;

                try {
                    const newAccessToken = await refreshStoredSessionAccessToken();
                    originalRequest.headers = originalRequest.headers ?? {};
                    originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
                    return axiosInstance(originalRequest);
                } catch (refreshError) {
                    console.warn('[apiClient] Refresh token flow failed.', {
                        url: originalRequest.url,
                        method: originalRequest.method,
                    });
                }
            }

            console.warn('[apiClient] 401 Unauthorized — le token est peut-être expiré.', {
                url: error.config?.url,
                method: error.config?.method,
            });
        }

        // Handle 403 Forbidden
        if (error.response?.status === 403) {
            console.warn('[apiClient] 403 Forbidden - insufficient permissions');
        }

        // Return error for caller to handle
        return Promise.reject(error);
    }
);

/**
 * API Client methods for common operations
 */
export const apiClient = {
    /**
     * GET request
     */
    get: <T = any>(url: string, config?: any) =>
        axiosInstance.get<T>(url, config),

    /**
     * POST request
     */
    post: <T = any>(url: string, data?: any, config?: any) =>
        axiosInstance.post<T>(url, data, config),

    /**
     * PUT request
     */
    put: <T = any>(url: string, data?: any, config?: any) =>
        axiosInstance.put<T>(url, data, config),

    /**
     * PATCH request
     */
    patch: <T = any>(url: string, data?: any, config?: any) =>
        axiosInstance.patch<T>(url, data, config),

    /**
     * DELETE request
     */
    delete: <T = any>(url: string, config?: any) =>
        axiosInstance.delete<T>(url, config),

    /**
     * Get raw axios instance for advanced usage
     */
    getInstance: () => axiosInstance,
};

export default apiClient;
