/**
 * @file tests/unitaires/AuthContext.test.tsx
 * @description Unit tests for AuthContext
 * @coverage:
 * - Hydration from localStorage
 * - Guest mode (no auth)
 * - Login/Register flow
 * - Logout flow
 * - 401 logout event handling
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { act } from 'react';
import { AuthProvider, useAuth } from '../../contexts/AuthContext';
import React from 'react';
import apiClient from '../../utils/apiClient';
import * as llmConfigService from '../../services/llmConfigService';
import * as localLLMProfileService from '../../services/localLLMProfileService';
import { getQueryClient } from '../../providers/QueryProvider';

const TEST_ONLY_PASSWORD = 'test-only-password-123';

jest.mock('../../utils/apiClient', () => ({
    __esModule: true,
    default: {
        post: jest.fn().mockResolvedValue({ data: [] }),
    },
}));

jest.mock('../../services/localLLMProfileService', () => ({
    __esModule: true,
    getAllProfiles: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../services/llmConfigService', () => ({
    __esModule: true,
    getAllLLMConfigs: jest.fn().mockResolvedValue([]),
}));

// Mock localStorage
const localStorageMock = (() => {
    let store: Record<string, string> = {};
    return {
        getItem: (key: string) => store[key] || null,
        setItem: (key: string, value: string) => {
            store[key] = value.toString();
        },
        removeItem: (key: string) => {
            delete store[key];
        },
        clear: () => {
            store = {};
        },
    };
})();

Object.defineProperty(window, 'localStorage', {
    value: localStorageMock,
});

// Mock fetch
global.fetch = jest.fn();

// Test component to access context
const TestComponent = () => {
    const { user, isAuthenticated, isLoading, sessionStatus, login, logout, runtimeLLMConfigs, localLLMProfiles, llmApiKeys } = useAuth();
    return (
        <div>
            <div data-testid="loading">{isLoading ? 'loading' : 'ready'}</div>
            <div data-testid="session-status">{sessionStatus}</div>
            <div data-testid="auth-status">{isAuthenticated ? 'authenticated' : 'guest'}</div>
            <div data-testid="user-email">{user?.email || 'no-user'}</div>
            <div data-testid="llm-api-key-count">{llmApiKeys?.length ?? 0}</div>
            <div data-testid="runtime-config-count">{runtimeLLMConfigs.length}</div>
            <div data-testid="local-profile-count">{localLLMProfiles.length}</div>
            <button onClick={() => login('test@example.com', TEST_ONLY_PASSWORD)}>
                Login
            </button>
            <button onClick={logout}>Logout</button>
        </div>
    );
};

describe('AuthContext', () => {
    beforeEach(() => {
        localStorage.clear();
        jest.clearAllMocks();
        getQueryClient().clear();
    });

    describe('Initialization', () => {
        test('should transition to guest mode when no auth data stored', async () => {
            render(
                <AuthProvider>
                    <TestComponent />
                </AuthProvider>
            );

            await waitFor(() => {
                expect(screen.getByTestId('auth-status')).toHaveTextContent('guest');
                expect(screen.getByTestId('user-email')).toHaveTextContent('no-user');
                expect(screen.getByTestId('session-status')).toHaveTextContent('ready');
            });
        });

        test('should hydrate from localStorage if auth data exists', async () => {
            const mockAuthData = {
                user: { id: '123', email: 'test@example.com', role: 'user' },
                accessToken: 'mock-access-token',
                refreshToken: 'mock-refresh-token',
            };

            localStorage.setItem('auth_data_v1', JSON.stringify(mockAuthData));

            render(
                <AuthProvider>
                    <TestComponent />
                </AuthProvider>
            );

            expect(screen.getByTestId('session-status')).toHaveTextContent('restoring-session');

            await waitFor(() => {
                expect(screen.getByTestId('auth-status')).toHaveTextContent('authenticated');
                expect(screen.getByTestId('user-email')).toHaveTextContent('test@example.com');
                expect(screen.getByTestId('session-status')).toHaveTextContent('ready');
            });
        });
    });

    describe('Guest Mode (Non-Régression)', () => {
        test('should allow guest users to navigate without login', async () => {
            render(
                <AuthProvider>
                    <TestComponent />
                </AuthProvider>
            );

            await waitFor(() => {
                expect(screen.getByTestId('auth-status')).toHaveTextContent('guest');
                expect(screen.getByTestId('user-email')).toHaveTextContent('no-user');
            });

            // Verify Guest mode is fully functional (no errors)
            expect(screen.getByTestId('loading')).toBeInTheDocument();
        });

        test('should clear localStorage with malformed data', async () => {
            localStorage.setItem('auth_data_v1', 'invalid-json');

            render(
                <AuthProvider>
                    <TestComponent />
                </AuthProvider>
            );

            await waitFor(() => {
                expect(localStorage.getItem('auth_data_v1')).toBeNull();
                expect(screen.getByTestId('auth-status')).toHaveTextContent('guest');
            });
        });
    });

    describe('Logout', () => {
        test('should clear auth data on logout', async () => {
            const mockAuthData = {
                user: { id: '123', email: 'test@example.com', role: 'user' },
                accessToken: 'mock-access-token',
                refreshToken: 'mock-refresh-token',
            };

            localStorage.setItem('auth_data_v1', JSON.stringify(mockAuthData));
            localStorage.setItem('custom_agent_templates', JSON.stringify([{ id: 'template-1' }]));
            localStorage.setItem('workflow-editor-data', JSON.stringify({ workflows: [{ id: 'workflow-1' }] }));
            localStorage.setItem('guest_save_mode', 'local');

            const queryClient = getQueryClient();
            queryClient.setQueryData(['secure-workspace'], { workflowId: 'workflow-1' });

            render(
                <AuthProvider>
                    <TestComponent />
                </AuthProvider>
            );

            await waitFor(() => {
                expect(screen.getByTestId('auth-status')).toHaveTextContent('authenticated');
            });

            // Click logout
            fireEvent.click(screen.getByText('Logout'));

            await waitFor(() => {
                expect(screen.getByTestId('auth-status')).toHaveTextContent('guest');
                expect(localStorage.getItem('auth_data_v1')).toBeNull();
                expect(localStorage.getItem('custom_agent_templates')).toBeNull();
                expect(localStorage.getItem('workflow-editor-data')).toBeNull();
                expect(localStorage.getItem('guest_save_mode')).toBeNull();
                expect(queryClient.getQueryData(['secure-workspace'])).toBeUndefined();
            });
        });

        test('should ignore in-flight runtime bootstrap results that resolve after logout', async () => {
            let resolveKeys: ((value: { data: Array<{ provider: string; enabled: boolean; apiKey: string }> }) => void) | null = null;
            let resolveProfiles: ((value: Array<{ id: string; name: string; provider: string; endpoint: string }>) => void) | null = null;

            const keysPromise = new Promise<{ data: Array<{ provider: string; enabled: boolean; apiKey: string }> }>((resolve) => {
                resolveKeys = resolve;
            });
            const profilesPromise = new Promise<Array<{ id: string; name: string; provider: string; endpoint: string }>>((resolve) => {
                resolveProfiles = resolve;
            });

            jest.spyOn(apiClient, 'post').mockImplementationOnce(() => keysPromise as any);
            jest.spyOn(localLLMProfileService, 'getAllProfiles').mockImplementationOnce(() => profilesPromise as any);

            localStorage.setItem('auth_data_v1', JSON.stringify({
                user: { id: '123', email: 'test@example.com', role: 'user' },
                accessToken: 'stale-access-token',
                refreshToken: 'mock-refresh-token',
            }));

            render(
                <AuthProvider>
                    <TestComponent />
                </AuthProvider>
            );

            await waitFor(() => {
                expect(screen.getByTestId('auth-status')).toHaveTextContent('authenticated');
                expect(screen.getByTestId('session-status')).toHaveTextContent('restoring-session');
            });

            fireEvent.click(screen.getByText('Logout'));

            await waitFor(() => {
                expect(screen.getByTestId('auth-status')).toHaveTextContent('guest');
                expect(screen.getByTestId('llm-api-key-count')).toHaveTextContent('0');
                expect(screen.getByTestId('local-profile-count')).toHaveTextContent('0');
            });

            await act(async () => {
                resolveKeys?.({
                    data: [{ provider: 'openai', enabled: true, apiKey: 'secret' }],
                });
                resolveProfiles?.([
                    { id: 'profile-1', name: 'Local profile', provider: 'ollama', endpoint: 'http://127.0.0.1:11434' },
                ]);
                await Promise.resolve();
            });

            await waitFor(() => {
                expect(screen.getByTestId('auth-status')).toHaveTextContent('guest');
                expect(screen.getByTestId('llm-api-key-count')).toHaveTextContent('0');
                expect(screen.getByTestId('local-profile-count')).toHaveTextContent('0');
                expect(screen.getByTestId('session-status')).toHaveTextContent('ready');
            });
        });
    });

    describe('401 Logout Event', () => {
        test('should logout when auth:logout event is dispatched', async () => {
            const mockAuthData = {
                user: { id: '123', email: 'test@example.com', role: 'user' },
                accessToken: 'mock-access-token',
                refreshToken: 'mock-refresh-token',
            };

            localStorage.setItem('auth_data_v1', JSON.stringify(mockAuthData));

            render(
                <AuthProvider>
                    <TestComponent />
                </AuthProvider>
            );

            await waitFor(() => {
                expect(screen.getByTestId('auth-status')).toHaveTextContent('authenticated');
            });

            // Dispatch logout event (simulating API 401)
            act(() => {
                const event = new CustomEvent('auth:logout', { detail: { reason: 'token_expired' } });
                window.dispatchEvent(event);
            });

            await waitFor(() => {
                expect(screen.getByTestId('auth-status')).toHaveTextContent('guest');
                expect(localStorage.getItem('auth_data_v1')).toBeNull();
                expect(screen.getByTestId('session-status')).toHaveTextContent('degraded');
            });
        });

        test('should mark session as degraded when auth:session-degraded event is dispatched', async () => {
            const mockAuthData = {
                user: { id: '123', email: 'test@example.com', role: 'user' },
                accessToken: 'mock-access-token',
                refreshToken: 'mock-refresh-token',
            };

            localStorage.setItem('auth_data_v1', JSON.stringify(mockAuthData));

            render(
                <AuthProvider>
                    <TestComponent />
                </AuthProvider>
            );

            await waitFor(() => {
                expect(screen.getByTestId('auth-status')).toHaveTextContent('authenticated');
            });

            act(() => {
                const event = new CustomEvent('auth:session-degraded', {
                    detail: { message: 'Session expirée. Veuillez vous reconnecter.' }
                });
                window.dispatchEvent(event);
            });

            await waitFor(() => {
                expect(screen.getByTestId('auth-status')).toHaveTextContent('guest');
                expect(screen.getByTestId('session-status')).toHaveTextContent('degraded');
            });
        });
    });

    describe('Error Handling', () => {
        test('should handle localStorage read errors gracefully', async () => {
            const getItemSpy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
                throw new Error('Storage read error');
            });

            render(
                <AuthProvider>
                    <TestComponent />
                </AuthProvider>
            );

            await waitFor(() => {
                expect(screen.getByTestId('loading')).toHaveTextContent('ready');
                expect(screen.getByTestId('auth-status')).toHaveTextContent('guest');
            });

            getItemSpy.mockRestore();
        });

        test('should keep guest mode operational when guest runtime bootstrap fails', async () => {
            jest.spyOn(llmConfigService, 'getAllLLMConfigs').mockRejectedValueOnce(new Error('Guest config load failed'));
            jest.spyOn(localLLMProfileService, 'getAllProfiles').mockRejectedValueOnce(new Error('Guest profile load failed'));
            const protectedApiSpy = jest.spyOn(apiClient, 'post');
            const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

            render(
                <AuthProvider>
                    <TestComponent />
                </AuthProvider>
            );

            await waitFor(() => {
                expect(screen.getByTestId('auth-status')).toHaveTextContent('guest');
                expect(screen.getByTestId('session-status')).toHaveTextContent('ready');
                expect(screen.getByTestId('local-profile-count')).toHaveTextContent('0');
            });

            expect(protectedApiSpy).not.toHaveBeenCalled();
            consoleErrorSpy.mockRestore();
        });
    });
});
