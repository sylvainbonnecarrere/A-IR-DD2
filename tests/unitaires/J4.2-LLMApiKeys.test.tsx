/**
 * @file tests/unitaires/J4.2-LLMApiKeys.test.tsx
 * @description Tests for J4.2 - LLM API Keys fetch at login
 * @domain Design Domain - Authentication & LLM Configuration
 *
 * SCOPE:
 * - API keys fetched from /api/llm/get-all-api-keys after successful login
 * - API keys stored ONLY in memory (React state), NOT in localStorage
 * - API keys cleared on logout
 * - Non-blocking: fetch failure doesn't prevent login success
 */

import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { AuthProvider, useAuth } from '../../contexts';

const mockApiPost = jest.fn();

jest.mock('../../utils/apiClient', () => ({
    __esModule: true,
    default: {
        post: (...args: any[]) => mockApiPost(...args),
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

/**
 * Test component to access useAuth hook
 */
const TestComponent = ({ onInit }: { onInit?: (auth: any) => void }) => {
    const auth = useAuth();

    React.useEffect(() => {
        onInit?.(auth);
    }, [auth, onInit]);

    return (
        <div>
            <div data-testid="user">{auth.user?.email || 'Guest'}</div>
            <div data-testid="authenticated">{auth.isAuthenticated ? 'Yes' : 'No'}</div>
            <div data-testid="loading">{auth.isLoading ? 'Loading' : 'Ready'}</div>
            <div data-testid="api-keys-count">{auth.llmApiKeys?.length ?? 'null'}</div>
            <div data-testid="api-keys">
                {auth.llmApiKeys?.map(key => (
                    <span key={key.provider}>{key.provider}:***</span>
                ))}
            </div>
        </div>
    );
};

describe('J4.2: LLM API Keys Fetch at Login', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        localStorage.clear();
        mockApiPost.mockResolvedValue({ data: [] });
    });

    describe('API Key Fetch on Login', () => {
        test('should fetch LLM API keys after successful login', async () => {
            const mockLoginResponse = {
                user: { id: '123', email: 'user@test.com', role: 'user' },
                accessToken: 'access-token-123',
                refreshToken: 'refresh-token-123'
            };

            const mockApiKeysResponse = [
                {
                    provider: 'OpenAI',
                    apiKey: 'sk-proj-xxxxx',
                    enabled: true,
                    capabilities: { Chat: true }
                },
                {
                    provider: 'Anthropic',
                    apiKey: 'sk-ant-xxxxx',
                    enabled: true,
                    capabilities: { Chat: true }
                }
            ];

            let authState: any = null;

            global.fetch = jest.fn().mockResolvedValueOnce({
                ok: true,
                json: async () => mockLoginResponse
            });
            mockApiPost.mockResolvedValue({ data: mockApiKeysResponse });

            const { getByTestId } = render(
                <AuthProvider>
                    <TestComponent onInit={(auth) => { authState = auth; }} />
                </AuthProvider>
            );

            // Initially guest mode
            expect(getByTestId('authenticated')).toHaveTextContent('No');
            expect(getByTestId('api-keys-count')).toHaveTextContent('null');

            // Call login
            await act(async () => {
                await authState.login('user@test.com', 'password123');
            });

            // Wait for API key fetch
            await waitFor(() => {
                expect(getByTestId('api-keys-count')).toHaveTextContent('2');
            });

            // Verify keys are set
            expect(getByTestId('authenticated')).toHaveTextContent('Yes');
            expect(getByTestId('user')).toHaveTextContent('user@test.com');
        });

        test('should handle API key fetch failure gracefully (non-blocking)', async () => {
            const mockLoginResponse = {
                user: { id: '123', email: 'user@test.com', role: 'user' },
                accessToken: 'access-token-123',
                refreshToken: 'refresh-token-123'
            };

            let authState: any = null;

            global.fetch = jest.fn().mockResolvedValueOnce({
                ok: true,
                json: async () => mockLoginResponse
            });
            mockApiPost.mockRejectedValueOnce(new Error('Network Error'));

            const { getByTestId } = render(
                <AuthProvider>
                    <TestComponent onInit={(auth) => { authState = auth; }} />
                </AuthProvider>
            );

            await act(async () => {
                await authState.login('user@test.com', 'password123');
            });

            // Login should succeed even if key fetch fails
            await waitFor(() => {
                expect(getByTestId('authenticated')).toHaveTextContent('Yes');
            });

            // API keys should be empty array (not null)
            expect(getByTestId('api-keys-count')).toHaveTextContent('0');
        });
    });

    describe('Session-Only Storage (Security)', () => {
        test('should NOT store API keys in localStorage', async () => {
            const mockLoginResponse = {
                user: { id: '123', email: 'user@test.com', role: 'user' },
                accessToken: 'access-token-123',
                refreshToken: 'refresh-token-123'
            };

            const mockApiKeysResponse = [
                {
                    provider: 'OpenAI',
                    apiKey: 'sk-proj-xxxxx',
                    enabled: true
                }
            ];

            let authState: any = null;

            global.fetch = jest.fn().mockResolvedValueOnce({
                ok: true,
                json: async () => mockLoginResponse
            });
            mockApiPost.mockResolvedValue({ data: mockApiKeysResponse });

            render(
                <AuthProvider>
                    <TestComponent onInit={(auth) => { authState = auth; }} />
                </AuthProvider>
            );

            await act(async () => {
                await authState.login('user@test.com', 'password123');
            });

            // Check localStorage
            const authData = localStorage.getItem('auth_data_v1');
            expect(authData).toBeTruthy();

            const parsed = JSON.parse(authData || '{}');
            expect(parsed.llmApiKeys).toBeUndefined();
            expect(JSON.stringify(parsed)).not.toContain('sk-proj');
        });

        test('should clear API keys on logout', async () => {
            const mockLoginResponse = {
                user: { id: '123', email: 'user@test.com', role: 'user' },
                accessToken: 'access-token-123',
                refreshToken: 'refresh-token-123'
            };

            const mockApiKeysResponse = [
                {
                    provider: 'OpenAI',
                    apiKey: 'sk-proj-xxxxx',
                    enabled: true
                }
            ];

            let authState: any = null;

            global.fetch = jest.fn().mockResolvedValueOnce({
                ok: true,
                json: async () => mockLoginResponse
            });
            mockApiPost.mockResolvedValue({ data: mockApiKeysResponse });

            const { getByTestId } = render(
                <AuthProvider>
                    <TestComponent onInit={(auth) => { authState = auth; }} />
                </AuthProvider>
            );

            // Login and get keys
            await act(async () => {
                await authState.login('user@test.com', 'password123');
            });

            await waitFor(() => {
                expect(getByTestId('api-keys-count')).toHaveTextContent('1');
            });

            // Logout
            act(() => {
                authState.logout();
            });

            // API keys should be cleared
            await waitFor(() => {
                expect(getByTestId('api-keys-count')).toHaveTextContent('null');
            });
        });
    });

    describe('Bearer Token in API Key Request', () => {
        test('should include Authorization header with Bearer token', async () => {
            const mockLoginResponse = {
                user: { id: '123', email: 'user@test.com', role: 'user' },
                accessToken: 'secret-access-token-xyz',
                refreshToken: 'refresh-token-123'
            };

            const mockApiKeysResponse = [];

            let authState: any = null;

            global.fetch = jest.fn()
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => mockLoginResponse
                })
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => mockApiKeysResponse
                });

            render(
                <AuthProvider>
                    <TestComponent onInit={(auth) => { authState = auth; }} />
                </AuthProvider>
            );

            await act(async () => {
                await authState.login('user@test.com', 'password123');
            });

            await waitFor(() => {
                expect(mockApiPost).toHaveBeenCalledWith(
                    '/api/llm/get-all-api-keys',
                    {},
                    expect.objectContaining({
                        headers: expect.objectContaining({
                            Authorization: 'Bearer secret-access-token-xyz'
                        })
                    })
                );
            });

            expect(mockApiPost).toHaveBeenCalledWith(
                '/api/llm/get-all-api-keys',
                {},
                expect.objectContaining({
                    headers: expect.objectContaining({
                        Authorization: 'Bearer secret-access-token-xyz'
                    })
                })
            );
        });
    });

    describe('Register + API Key Fetch', () => {
        test('should fetch API keys after successful registration', async () => {
            const mockRegisterResponse = {
                user: { id: '456', email: 'newuser@test.com', role: 'user' },
                accessToken: 'access-token-456',
                refreshToken: 'refresh-token-456'
            };

            const mockApiKeysResponse = [];

            let authState: any = null;

            global.fetch = jest.fn().mockResolvedValueOnce({
                ok: true,
                json: async () => mockRegisterResponse
            });
            mockApiPost.mockResolvedValue({ data: mockApiKeysResponse });

            const { getByTestId } = render(
                <AuthProvider>
                    <TestComponent onInit={(auth) => { authState = auth; }} />
                </AuthProvider>
            );

            await act(async () => {
                await authState.register('newuser@test.com', 'securePassword123');
            });

            // Verify registration succeeded and API key fetch was called
            await waitFor(() => {
                expect(getByTestId('authenticated')).toHaveTextContent('Yes');
                expect(getByTestId('api-keys-count')).toHaveTextContent('0');
            });
        });
    });
});
