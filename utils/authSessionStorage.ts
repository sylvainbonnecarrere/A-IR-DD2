import type { StoredAuthData } from '../contexts/types/auth.types';

export const AUTH_STORAGE_KEY = 'auth_data_v1';

export type StoredAuthReadResult =
    | { status: 'ok'; data: StoredAuthData }
    | { status: 'missing' }
    | { status: 'invalid' };

export const authSessionStorage = {
    read(): StoredAuthReadResult {
        try {
            const rawValue = localStorage.getItem(AUTH_STORAGE_KEY);
            if (!rawValue) {
                return { status: 'missing' };
            }

            return {
                status: 'ok',
                data: JSON.parse(rawValue) as StoredAuthData,
            };
        } catch {
            return { status: 'invalid' };
        }
    },

    write(authData: StoredAuthData): void {
        localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(authData));
    },

    clear(): void {
        localStorage.removeItem(AUTH_STORAGE_KEY);
    },
};