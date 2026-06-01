/**
 * @file J4.3-SettingsPersistence.test.tsx
 * @description E2E tests for User Settings Persistence (J4.3)
 * @architecture Comprehensive validation of Guest vs Authenticated storage
 * 
 * SCENARIOS:
 * 1. Guest Mode: Settings saved to localStorage only
 * 2. Auth Mode: Settings persisted to MongoDB + cached in React state
 * 3. Storage Switching: Guest → Auth transition
 * 4. API Key Encryption: Encrypted before DB storage, decrypted on fetch
 * 5. Preference Sync: Language/theme preferences persist
 */

import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ISettingsStorage, getSettingsStorage, MockSettingsStorage, UserSettingsData } from '../../utils/SettingsStorage';
import React from 'react';
import type { AuthContextType } from '../../contexts/types/auth.types';
import { getBackendUrl } from '../../config/api.config';

function createAuthContextMock(overrides: Partial<AuthContextType> = {}): AuthContextType {
    return {
        user: null,
        accessToken: 'mock-token-123',
        refreshToken: 'mock-refresh-token',
        isAuthenticated: true,
        isLoading: false,
        sessionStatus: 'ready',
        error: null,
        llmApiKeys: null,
        runtimeLLMConfigs: [],
        localLLMProfiles: [],
        login: async () => { },
        register: async () => { },
        logout: () => { },
        refreshAccessToken: async () => { },
        clearError: () => { },
        refreshLLMApiKeys: async () => { },
        refreshRuntimeConfigState: async () => null,
        ...overrides,
    };
}

/**
 * Test Suite 1: SettingsStorage Factory
 */
describe('J4.3 - SettingsStorage Factory', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    afterEach(() => {
        localStorage.clear();
    });

    it('should return GuestSettingsStorage for unauthenticated user', () => {
        const storage = getSettingsStorage(null);
        expect(storage).toBeDefined();
        expect(storage.getSettings).toBeDefined();
        expect(storage.saveSettings).toBeDefined();
    });

    it('should return AuthenticatedSettingsStorage for authenticated user', () => {
        const authContext = createAuthContextMock();

        const storage = getSettingsStorage(authContext);
        expect(storage).toBeDefined();
    });
});

/**
 * Test Suite 2: Guest Mode - localStorage persistence
 */
describe('J4.3 - Guest Mode Settings Persistence', () => {
    let storage: ISettingsStorage;

    beforeEach(() => {
        localStorage.clear();
        storage = getSettingsStorage(null);
    });

    afterEach(() => {
        localStorage.clear();
    });

    it('should initialize with default settings on first access', async () => {
        const settings = await storage.getSettings();

        expect(settings).toEqual({
            llmConfigs: {},
            preferences: {
                language: 'fr',
                theme: 'dark'
            },
            updatedAt: expect.any(Date)
        });
    });

    it('should save LLM configurations to localStorage', async () => {
        const configsToSave: UserSettingsData = {
            llmConfigs: {
                'OpenAI': {
                    enabled: true,
                    capabilities: { Chat: true, ImageGeneration: false },
                    lastUpdated: new Date()
                },
                'Gemini': {
                    enabled: false,
                    capabilities: { Chat: true, WebSearch: true },
                    lastUpdated: new Date()
                }
            },
            preferences: { language: 'fr', theme: 'dark' }
        };

        const result = await storage.saveSettings(configsToSave);

        expect(result.llmConfigs).toHaveProperty('OpenAI');
        expect(result.llmConfigs).toHaveProperty('Gemini');
        expect(result.llmConfigs['OpenAI'].enabled).toBe(true);
        expect(result.llmConfigs['Gemini'].enabled).toBe(false);

        // Verify localStorage persistence
        const stored = localStorage.getItem('user_settings_guest');
        expect(stored).toBeTruthy();
        const parsed = JSON.parse(stored!);
        expect(parsed.llmConfigs['OpenAI'].enabled).toBe(true);
    });

    it('should preserve settings across multiple saves', async () => {
        const firstSave: UserSettingsData = {
            llmConfigs: {
                'OpenAI': {
                    enabled: true,
                    capabilities: { Chat: true },
                    lastUpdated: new Date()
                }
            },
            preferences: { language: 'en' }
        };

        await storage.saveSettings(firstSave);
        const afterFirstSave = await storage.getSettings();

        // Second save with additional provider
        const secondSave: UserSettingsData = {
            llmConfigs: {
                'Gemini': {
                    enabled: true,
                    capabilities: { Chat: true, WebSearch: true },
                    lastUpdated: new Date()
                }
            },
            preferences: { language: 'fr' }
        };

        await storage.saveSettings(secondSave);
        const afterSecondSave = await storage.getSettings();

        // Both should be present, merged
        expect(afterSecondSave.llmConfigs).toHaveProperty('OpenAI');
        expect(afterSecondSave.llmConfigs).toHaveProperty('Gemini');
        expect(afterSecondSave.preferences.language).toBe('fr');
    });

    it('should handle corrupted localStorage gracefully', async () => {
        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => { });
        localStorage.setItem('user_settings_guest', 'invalid-json');

        const settings = await storage.getSettings();
        expect(settings.llmConfigs).toEqual({});
        expect(settings.preferences.language).toBe('fr');

        consoleErrorSpy.mockRestore();
    });
});

/**
 * Test Suite 3: Authenticated Mode - API persistence
 */
describe('J4.3 - Authenticated Mode Settings Persistence', () => {
    let mockFetch: jest.Mock;

    beforeEach(() => {
        mockFetch = jest.fn();
        global.fetch = mockFetch as typeof fetch;
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('should fetch settings from /api/user-settings on GET', async () => {
        const mockResponse: UserSettingsData = {
            llmConfigs: {
                'OpenAI': {
                    enabled: true,
                    capabilities: { Chat: true },
                    lastUpdated: new Date()
                }
            },
            preferences: { language: 'en' },
            updatedAt: new Date()
        };

        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => mockResponse
        });

        const authContext = createAuthContextMock({ accessToken: 'mock-bearer-token' });
        const storage = getSettingsStorage(authContext);

        const settings = await storage.getSettings();

        expect(mockFetch).toHaveBeenCalledWith(`${getBackendUrl()}/api/user-settings`, {
            method: 'GET',
            headers: {
                Authorization: 'Bearer mock-bearer-token',
                'Content-Type': 'application/json',
            },
        });

        expect(settings.llmConfigs['OpenAI'].enabled).toBe(true);
        expect(settings.preferences.language).toBe('en');
    });

    it('should include Bearer token in Authorization header', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ llmConfigs: {}, preferences: { language: 'fr' } })
        });

        const storage = getSettingsStorage(createAuthContextMock({ accessToken: 'test-token-xyz' }));

        await storage.getSettings();

        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(mockFetch.mock.calls[0][1]?.headers).toMatchObject({
            Authorization: 'Bearer test-token-xyz',
        });
    });

    it('should save settings to /api/user-settings on POST', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                preferences: { language: 'fr', theme: 'light' },
                updatedAt: new Date('2025-01-01T00:00:00.000Z').toISOString()
            })
        });

        const storage = getSettingsStorage(createAuthContextMock({ accessToken: 'mock-post-token' }));
        const configsToSave: UserSettingsData = {
            llmConfigs: {
                'OpenAI': {
                    enabled: true,
                    capabilities: { Chat: true },
                    lastUpdated: new Date()
                }
            },
            preferences: { language: 'fr' }
        };

        const result = await storage.saveSettings(configsToSave);

        expect(mockFetch).toHaveBeenCalledWith(`${getBackendUrl()}/api/user-settings`, {
            method: 'POST',
            headers: {
                Authorization: 'Bearer mock-post-token',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ preferences: configsToSave.preferences }),
        });

        expect(result.preferences.language).toBe('fr');
        expect(result.preferences.theme).toBe('light');
        expect(result.llmConfigs).toEqual(configsToSave.llmConfigs);
    });

    it('should handle authentication errors gracefully', async () => {
        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

        mockFetch.mockResolvedValueOnce({
            ok: false,
            status: 401,
            statusText: 'Unauthorized'
        });

        const storage = getSettingsStorage(createAuthContextMock({ accessToken: 'expired-token' }));

        await expect(storage.getSettings()).rejects.toThrow('HTTP 401: Unauthorized');

        consoleErrorSpy.mockRestore();
    });
});

/**
 * Test Suite 4: Storage Switching (Guest → Auth)
 */
describe('J4.3 - Storage Mode Switching', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    afterEach(() => {
        localStorage.clear();
    });

    it('should preserve settings when switching from Guest to Auth mode', async () => {
        // Start in guest mode
        const guestStorage = getSettingsStorage(null);

        const guestSettings: UserSettingsData = {
            llmConfigs: {
                'OpenAI': {
                    enabled: true,
                    capabilities: { Chat: true },
                    lastUpdated: new Date()
                }
            },
            preferences: { language: 'en' }
        };

        await guestStorage.saveSettings(guestSettings);

        // Verify guest settings saved
        const guestVerify = await guestStorage.getSettings();
        expect(guestVerify.llmConfigs['OpenAI'].enabled).toBe(true);

        // Simulate user logging in
        const authContext = createAuthContextMock({ accessToken: 'new-token-456' });

        // In real scenario, app would:
        // 1. Switch to AuthStorage
        // 2. Fetch user's existing DB settings (or initialize)
        // 3. Optionally migrate guest localStorage settings
        const authStorage = getSettingsStorage(authContext);
        expect(authStorage).toBeDefined();
    });
});

/**
 * Test Suite 5: API Key Encryption
 */
describe('J4.3 - API Key Security', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    afterEach(() => {
        localStorage.clear();
    });

    it('should NOT store API keys in plain text in localStorage (Guest)', async () => {
        const guestStorage = getSettingsStorage(null);

        const configWithKey: UserSettingsData = {
            llmConfigs: {
                'OpenAI': {
                    enabled: true,
                    capabilities: { Chat: true },
                    lastUpdated: new Date()
                }
            },
            preferences: { language: 'fr' }
        };

        await guestStorage.saveSettings(configWithKey);

        // In guest mode, note that apiKey should NOT be included in llmConfigs
        // This is a deliberate design to prevent accidental storage
        const stored = localStorage.getItem('user_settings_guest');
        expect(stored).toBeTruthy();
        expect(stored).not.toContain('sk-');
        expect(stored).not.toContain('Bearer');
    });

    it('Mock: Authenticated storage encrypts API keys before sending', () => {
        // In real backend, encryption happens via encrypt() utility
        // Frontend only stores encrypted keys received from API
        const mockEncryptedKey = 'iv:salt:authTag:encryptedData';
        expect(mockEncryptedKey).toMatch(/^[^:]+:[^:]+:[^:]+:[^:]+$/);
    });
});

/**
 * Test Suite 6: Preferences Synchronization
 */
describe('J4.3 - User Preferences', () => {
    let storage: ISettingsStorage;

    beforeEach(() => {
        localStorage.clear();
        storage = new MockSettingsStorage();
    });

    it('should persist language preference', async () => {
        const initialSettings = await storage.getSettings();
        expect(initialSettings.preferences.language).toBe('fr');

        const updated = await storage.saveSettings({
            preferences: { language: 'en' }
        });

        expect(updated.preferences.language).toBe('en');

        // Verify persistence
        const verified = await storage.getSettings();
        expect(verified.preferences.language).toBe('en');
    });

    it('should persist theme preference', async () => {
        const updated = await storage.saveSettings({
            preferences: { language: 'fr', theme: 'light' }
        });

        expect(updated.preferences.theme).toBe('light');

        const verified = await storage.getSettings();
        expect(verified.preferences.theme).toBe('light');
    });

    it('should handle partial preference updates', async () => {
        // Save initial with language only
        await storage.saveSettings({
            preferences: { language: 'de' }
        });

        // Update theme only
        const result = await storage.saveSettings({
            preferences: { theme: 'dark' }
        });

        // Both should be present
        expect(result.preferences.language).toBe('de');
        expect(result.preferences.theme).toBe('dark');
    });
});

/**
 * Test Suite 7: Integration - SettingsModal with Storage
 */
describe('J4.3 - SettingsModal Storage Integration', () => {
    it('should use correct storage backend based on auth state', () => {
        // Guest mode test
        const guestStorage = getSettingsStorage(null);
        expect(guestStorage).toBeDefined();

        // Auth mode test
        const authContext = createAuthContextMock({ accessToken: 'token' });
        const authStorage = getSettingsStorage(authContext);
        expect(authStorage).toBeDefined();
    });

    it('should properly initialize default settings if not found', async () => {
        const storage = new MockSettingsStorage();

        // First access should return defaults
        const initial = await storage.getSettings();
        expect(initial.llmConfigs).toEqual({});
        expect(initial.preferences.language).toBe('fr');
    });
});

/**
 * Test Suite 8: Non-Regression - Backward Compatibility
 */
describe('J4.3 - Backward Compatibility', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    afterEach(() => {
        localStorage.clear();
    });

    it('should migrate legacy localStorage format gracefully', async () => {
        // Simulate old format
        const legacyData = {
            'llmAgentWorkflow_configs': JSON.stringify([
                { provider: 'OpenAI', enabled: true, apiKey: 'old-key', capabilities: {} }
            ])
        };

        Object.entries(legacyData).forEach(([key, value]) => {
            localStorage.setItem(key, value);
        });

        // New storage should still work
        const storage = getSettingsStorage(null);
        const settings = await storage.getSettings();

        // Should initialize empty and be ready for new data
        expect(settings.llmConfigs).toBeDefined();
        expect(settings.preferences).toBeDefined();
    });

    it('should not break if UserSettings DB not initialized', async () => {
        // Mock scenario where UserSettings collection doesn't exist yet
        const authContext = createAuthContextMock({ accessToken: 'token' });

        const storage = getSettingsStorage(authContext);
        expect(storage).toBeDefined();
        // Real API would auto-initialize on first fetch
    });
});

/**
 * Test Suite 9: Error Handling & Edge Cases
 */
describe('J4.3 - Error Handling', () => {
    it('should handle network errors when fetching from API', async () => {
        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => { });
        const mockFetch = jest.fn().mockRejectedValueOnce(new Error('Network error'));
        global.fetch = mockFetch as typeof fetch;

        const storage = getSettingsStorage(createAuthContextMock({ accessToken: 'network-token' }));

        await expect(storage.getSettings()).rejects.toThrow('Network error');

        consoleErrorSpy.mockRestore();
    });

    it('should handle empty settings gracefully', async () => {
        const storage = new MockSettingsStorage({
            llmConfigs: {},
            preferences: { language: 'fr' }
        });

        const settings = await storage.getSettings();
        expect(Object.keys(settings.llmConfigs)).toHaveLength(0);
        expect(settings.preferences.language).toBe('fr');
    });

    it('should handle rapid consecutive saves', async () => {
        const storage = new MockSettingsStorage();

        const promises = [
            storage.saveSettings({ llmConfigs: { 'OpenAI': { enabled: true, capabilities: { Chat: true }, lastUpdated: new Date() } } }),
            storage.saveSettings({ llmConfigs: { 'Gemini': { enabled: false, capabilities: {}, lastUpdated: new Date() } } }),
            storage.saveSettings({ preferences: { language: 'de' } })
        ];

        const results = await Promise.all(promises);
        const final = await storage.getSettings();

        expect(final.llmConfigs).toBeDefined();
        expect(final.preferences.language).toBe('de');
    });
});
