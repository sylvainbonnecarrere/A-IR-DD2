/**
 * @file SettingsStorage.ts
 * @description Storage abstraction layer for user PREFERENCES (J4.4 - Simplified)
 * @architecture SOLID - Dependency Inversion Pattern
 * 
 * PATTERN: Strategy Pattern with Adapter
 * - Guest Mode: localStorage (JSON)
 * - Authenticated Mode: /api/user-settings (MongoDB)
 * 
 * MIGRATION NOTE (J4.4):
 * - llmConfigs handling REMOVED from this module
 * - This storage handles ONLY preferences (language, theme)
 * - For LLM configs, use llmConfigService.ts with /api/llm-configs
 * 
 * INTERFACE: Single API for both storage backends
 * - getSettings(): Promise<UserSettingsData>
 * - saveSettings(data): Promise<UserSettingsData>
 */

import { AuthContextType } from '../contexts/AuthContext';
import { getBackendUrl } from '../config/api.config';

export interface UserSettingsData {
    llmConfigs?: Record<string, any>;
    preferences: {
        language: 'fr' | 'en' | 'de' | 'es' | 'pt';
        theme?: 'dark' | 'light';
    };
    lastSync?: Date;
    updatedAt?: Date;
}

export interface ISettingsStorage {
    getSettings(): Promise<UserSettingsData>;
    saveSettings(data: {
        llmConfigs?: Record<string, any>;
        preferences?: {
            language?: 'fr' | 'en' | 'de' | 'es' | 'pt';
            theme?: 'dark' | 'light';
        };
    }): Promise<UserSettingsData>;
}

/**
 * Guest Storage (localStorage)
 * Fallback for unauthenticated users
 */
class GuestSettingsStorage implements ISettingsStorage {
    private readonly STORAGE_KEY = 'user_settings_guest';

    async getSettings(): Promise<UserSettingsData> {
        try {
            const stored = localStorage.getItem(this.STORAGE_KEY);
            if (!stored) {
                return this.getDefaults();
            }

            const parsed = JSON.parse(stored);
            return {
                llmConfigs: parsed.llmConfigs && typeof parsed.llmConfigs === 'object' ? parsed.llmConfigs : {},
                preferences: {
                    language: parsed.preferences?.language || 'fr',
                    theme: parsed.preferences?.theme || 'dark'
                },
                updatedAt: parsed.updatedAt ? new Date(parsed.updatedAt) : new Date()
            };
        } catch (error) {
            console.error('[GuestSettingsStorage] Error reading settings:', error);
            return this.getDefaults();
        }
    }

    async saveSettings(data: Partial<UserSettingsData>): Promise<UserSettingsData> {
        try {
            const current = await this.getSettings();
            const updated: UserSettingsData = {
                llmConfigs: {
                    ...(current.llmConfigs || {}),
                    ...(data.llmConfigs || {})
                },
                preferences: {
                    ...current.preferences,
                    ...data.preferences
                },
                updatedAt: new Date()
            };

            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(updated));
            return updated;
        } catch (error) {
            console.error('[GuestSettingsStorage] Error saving settings:', error);
            throw error;
        }
    }

    private getDefaults(): UserSettingsData {
        return {
            llmConfigs: {},
            preferences: {
                language: 'fr',
                theme: 'dark'
            },
            updatedAt: new Date()
        };
    }
}

/**
 * Authenticated Storage (/api/user-settings)
 * MongoDB backend via REST API
 * NOTE (J4.4): Only handles preferences, not llmConfigs
 */
class AuthenticatedSettingsStorage implements ISettingsStorage {
    private accessToken: string;

    constructor(accessToken: string) {
        this.accessToken = accessToken;
    }

    async getSettings(): Promise<UserSettingsData> {
        try {
            const response = await fetch(`${getBackendUrl()}/api/user-settings`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            return {
                llmConfigs: data.llmConfigs && typeof data.llmConfigs === 'object' ? data.llmConfigs : {},
                preferences: {
                    language: data.preferences?.language || 'fr',
                    theme: data.preferences?.theme || 'dark'
                },
                lastSync: data.lastSync ? new Date(data.lastSync) : undefined,
                updatedAt: data.updatedAt ? new Date(data.updatedAt) : new Date()
            };
        } catch (error) {
            console.error('[AuthenticatedSettingsStorage] Error fetching settings:', error);
            throw error;
        }
    }

    async saveSettings(data: Partial<UserSettingsData>): Promise<UserSettingsData> {
        try {
            const response = await fetch(`${getBackendUrl()}/api/user-settings`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ preferences: data.preferences })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const saved = await response.json();
            return {
                llmConfigs: saved.llmConfigs && typeof saved.llmConfigs === 'object' ? saved.llmConfigs : (data.llmConfigs || {}),
                preferences: {
                    language: saved.preferences?.language || 'fr',
                    theme: saved.preferences?.theme || 'dark'
                },
                lastSync: saved.lastSync ? new Date(saved.lastSync) : undefined,
                updatedAt: saved.updatedAt ? new Date(saved.updatedAt) : new Date()
            };
        } catch (error) {
            console.error('[AuthenticatedSettingsStorage] Error saving settings:', error);
            throw error;
        }
    }
}

/**
 * Factory function: Get appropriate storage backend
 * @param auth - AuthContextType | null (determines storage mode)
 * @returns ISettingsStorage implementation
 */
export function getSettingsStorage(auth: AuthContextType | null): ISettingsStorage {
    if (auth?.isAuthenticated && auth?.accessToken) {
        return new AuthenticatedSettingsStorage(auth.accessToken);
    }

    return new GuestSettingsStorage();
}

/**
 * Mock Storage (for testing)
 */
export class MockSettingsStorage implements ISettingsStorage {
    private data: UserSettingsData;

    constructor(initialData?: UserSettingsData) {
        this.data = initialData || {
            llmConfigs: {},
            preferences: { language: 'fr', theme: 'dark' },
            updatedAt: new Date()
        };
    }

    async getSettings(): Promise<UserSettingsData> {
        return {
            ...this.data,
            llmConfigs: { ...(this.data.llmConfigs || {}) }
        };
    }

    async saveSettings(data: Partial<UserSettingsData>): Promise<UserSettingsData> {
        this.data = {
            llmConfigs: {
                ...(this.data.llmConfigs || {}),
                ...(data.llmConfigs || {})
            },
            preferences: {
                ...this.data.preferences,
                ...data.preferences
            },
            updatedAt: new Date()
        };
        return {
            ...this.data,
            llmConfigs: { ...(this.data.llmConfigs || {}) }
        };
    }
}

export default {
    getSettingsStorage,
    GuestSettingsStorage,
    AuthenticatedSettingsStorage,
    MockSettingsStorage
};
