import axios from 'axios';
import { API_BASE_URL } from '../config/api.config';
import type { StoredAuthData } from '../contexts/types/auth.types';
import { authSessionStorage } from './authSessionStorage';

export const AUTH_SESSION_REFRESHED_EVENT = 'auth:session-refreshed';
export const AUTH_SESSION_DEGRADED_EVENT = 'auth:session-degraded';

export type SessionDegradedReason = 'invalid_auth_data' | 'missing_refresh_token' | 'refresh_failed';

const REFRESH_ENDPOINT = '/api/auth/refresh';

let refreshStoredSessionPromise: Promise<string> | null = null;

export const emitAuthSessionRefreshed = (accessToken: string) => {
    window.dispatchEvent(new CustomEvent(AUTH_SESSION_REFRESHED_EVENT, {
        detail: { accessToken },
    }));
};

export const emitAuthSessionDegraded = (reason: SessionDegradedReason, message: string) => {
    window.dispatchEvent(new CustomEvent(AUTH_SESSION_DEGRADED_EVENT, {
        detail: { reason, message },
    }));
};

export const readStoredAuthDataForSession = (): StoredAuthData | null => {
    const storedAuth = authSessionStorage.read();

    if (storedAuth.status === 'missing') {
        return null;
    }

    if (storedAuth.status === 'invalid') {
        authSessionStorage.clear();
        emitAuthSessionDegraded('invalid_auth_data', 'Session locale invalide. Veuillez vous reconnecter.');
        return null;
    }

    return storedAuth.data;
};

export const requestAccessTokenRefresh = async (refreshToken: string): Promise<string> => {
    const { data } = await axios.post<{ accessToken: string }>(
        `${API_BASE_URL}${REFRESH_ENDPOINT}`,
        { refreshToken },
        {
            headers: {
                'Content-Type': 'application/json',
            },
            timeout: 10000,
        }
    );

    if (!data?.accessToken) {
        throw new Error('Refresh response is missing accessToken');
    }

    return data.accessToken;
};

export const refreshStoredSessionAccessToken = async (): Promise<string> => {
    if (refreshStoredSessionPromise) {
        return refreshStoredSessionPromise;
    }

    const storedAuthData = readStoredAuthDataForSession();

    if (!storedAuthData?.refreshToken) {
        authSessionStorage.clear();
        emitAuthSessionDegraded('missing_refresh_token', 'Session expirée. Veuillez vous reconnecter.');
        throw new Error('No refresh token available');
    }

    refreshStoredSessionPromise = requestAccessTokenRefresh(storedAuthData.refreshToken)
        .then((accessToken) => {
            authSessionStorage.write({
                ...storedAuthData,
                accessToken,
            });

            emitAuthSessionRefreshed(accessToken);
            return accessToken;
        })
        .catch((error) => {
            authSessionStorage.clear();
            emitAuthSessionDegraded('refresh_failed', 'Session expirée. Veuillez vous reconnecter.');
            throw error;
        })
        .finally(() => {
            refreshStoredSessionPromise = null;
        });

    return refreshStoredSessionPromise;
};