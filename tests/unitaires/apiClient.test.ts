/**
 * @file tests/unitaires/apiClient.test.ts
 * @description Unit tests for apiClient interceptors and BC-05 refresh flow
 * @coverage:
 * - Request interceptor (Authorization header injection)
 * - Response interceptor refresh/retry on 401
 * - Session degradation when refresh fails
 * - Guest mode (no token)
 */

import axios, { AxiosInstance } from 'axios';
import MockAdapter from 'axios-mock-adapter';

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

describe('apiClient Interceptors', () => {
    let apiClient: AxiosInstance;
    let instanceMock: MockAdapter;
    let transportMock: MockAdapter;
    let consoleWarnSpy: jest.SpyInstance;
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(async () => {
        localStorage.clear();
        jest.resetModules();
        jest.clearAllMocks();

        consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

        const apiClientModule = await import('../../utils/apiClient');
        const axiosModule = await import('axios');
        apiClient = apiClientModule.default.getInstance();
        instanceMock = new MockAdapter(apiClient);
        transportMock = new MockAdapter(axiosModule.default);
    });

    afterEach(() => {
        instanceMock.restore();
        transportMock.restore();
        consoleWarnSpy.mockRestore();
        consoleErrorSpy.mockRestore();
    });

    describe('Request Interceptor', () => {
        test('should attach Bearer token when auth data exists', async () => {
            const mockAuthData = {
                user: { id: '123', email: 'test@example.com', role: 'user' },
                accessToken: 'test-access-token-12345',
                refreshToken: 'test-refresh-token',
            };

            localStorage.setItem('auth_data_v1', JSON.stringify(mockAuthData));

            instanceMock.onGet('/api/test').reply(200, { success: true });

            await apiClient.get('/api/test');

            expect(instanceMock.history.get[0].headers.Authorization).toBe('Bearer test-access-token-12345');
        });

        test('should NOT attach header in guest mode (no token)', async () => {
            // localStorage is empty (guest mode)
            instanceMock.onGet('/api/test').reply(200, { success: true });

            await apiClient.get('/api/test');

            expect(instanceMock.history.get[0].headers.Authorization).toBeUndefined();
        });

        test('should degrade corrupted localStorage gracefully', async () => {
            localStorage.setItem('auth_data_v1', 'invalid-json');
            const dispatchSpy = jest.spyOn(window, 'dispatchEvent');

            instanceMock.onGet('/api/test').reply(200, { success: true });

            // Should not throw
            await apiClient.get('/api/test');

            expect(instanceMock.history.get[0].headers.Authorization).toBeUndefined();
            expect(dispatchSpy).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'auth:session-degraded' })
            );

            dispatchSpy.mockRestore();
        });
    });

    describe('Response Interceptor', () => {
        test('should refresh token and retry request after 401', async () => {
            const mockAuthData = {
                user: { id: '123', email: 'test@example.com', role: 'user' },
                accessToken: 'expired-token',
                refreshToken: 'test-refresh-token',
            };

            localStorage.setItem('auth_data_v1', JSON.stringify(mockAuthData));
            const dispatchSpy = jest.spyOn(window, 'dispatchEvent');

            instanceMock.onGet('/api/protected').replyOnce(401, { error: 'Unauthorized' });
            instanceMock.onGet('/api/protected').replyOnce(200, { data: 'success-after-refresh' });
            transportMock.onPost('http://localhost:3001/api/auth/refresh')
                .reply(200, { accessToken: 'fresh-access-token' });

            const response = await apiClient.get('/api/protected');

            expect(response.status).toBe(200);
            expect(response.data).toEqual({ data: 'success-after-refresh' });
            expect(transportMock.history.post).toHaveLength(1);
            expect(instanceMock.history.get).toHaveLength(2);
            expect(instanceMock.history.get[1].headers.Authorization).toBe('Bearer fresh-access-token');
            expect(JSON.parse(localStorage.getItem('auth_data_v1') || '{}')).toMatchObject({
                accessToken: 'fresh-access-token',
                refreshToken: 'test-refresh-token',
            });
            expect(dispatchSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'auth:session-refreshed',
                })
            );

            dispatchSpy.mockRestore();
        });

        test('should perform a single refresh when multiple requests fail with 401 concurrently', async () => {
            const mockAuthData = {
                user: { id: '123', email: 'test@example.com', role: 'user' },
                accessToken: 'expired-token',
                refreshToken: 'test-refresh-token',
            };

            localStorage.setItem('auth_data_v1', JSON.stringify(mockAuthData));
            const dispatchSpy = jest.spyOn(window, 'dispatchEvent');

            instanceMock.onGet('/api/protected-a').replyOnce(401, { error: 'Unauthorized' });
            instanceMock.onGet('/api/protected-a').replyOnce(200, { data: 'a-ok' });
            instanceMock.onGet('/api/protected-b').replyOnce(401, { error: 'Unauthorized' });
            instanceMock.onGet('/api/protected-b').replyOnce(200, { data: 'b-ok' });
            transportMock.onPost('http://localhost:3001/api/auth/refresh')
                .reply(200, { accessToken: 'fresh-access-token' });

            const [responseA, responseB] = await Promise.all([
                apiClient.get('/api/protected-a'),
                apiClient.get('/api/protected-b'),
            ]);

            expect(responseA.status).toBe(200);
            expect(responseB.status).toBe(200);
            expect(responseA.data).toEqual({ data: 'a-ok' });
            expect(responseB.data).toEqual({ data: 'b-ok' });
            expect(transportMock.history.post).toHaveLength(1);
            expect(instanceMock.history.get).toHaveLength(4);
            expect(JSON.parse(localStorage.getItem('auth_data_v1') || '{}')).toMatchObject({
                accessToken: 'fresh-access-token',
                refreshToken: 'test-refresh-token',
            });
            expect(dispatchSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'auth:session-refreshed',
                })
            );

            dispatchSpy.mockRestore();
        });

        test('should degrade session when refresh fails', async () => {
            const mockAuthData = {
                user: { id: '123', email: 'test@example.com', role: 'user' },
                accessToken: 'expired-token',
                refreshToken: 'invalid-refresh-token',
            };

            localStorage.setItem('auth_data_v1', JSON.stringify(mockAuthData));
            const dispatchSpy = jest.spyOn(window, 'dispatchEvent');

            instanceMock.onGet('/api/protected').reply(401, { error: 'Unauthorized' });
            transportMock.onPost('http://localhost:3001/api/auth/refresh')
                .reply(401, { error: 'Invalid refresh token' });

            await expect(apiClient.get('/api/protected')).rejects.toMatchObject({
                response: expect.objectContaining({ status: 401 }),
            });

            expect(localStorage.getItem('auth_data_v1')).toBeNull();
            expect(dispatchSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'auth:session-degraded',
                })
            );

            dispatchSpy.mockRestore();
        });

        test('should handle 403 Forbidden', async () => {
            instanceMock.onGet('/api/admin').reply(403, { error: 'Forbidden' });

            try {
                await apiClient.get('/api/admin');
            } catch (error: any) {
                expect(error.response.status).toBe(403);
            }
        });

        test('should pass through successful responses', async () => {
            instanceMock.onGet('/api/test').reply(200, { data: 'success' });

            const response = await apiClient.get('/api/test');

            expect(response.status).toBe(200);
            expect(response.data).toEqual({ data: 'success' });
        });
    });

    describe('Guest Mode (Non-Régression)', () => {
        test('should allow requests without auth in guest mode', async () => {
            instanceMock.onGet('/api/public').reply(200, { public: 'data' });

            const response = await apiClient.get('/api/public');

            expect(response.status).toBe(200);
            expect(response.data).toEqual({ public: 'data' });
            expect(instanceMock.history.get[0].headers.Authorization).toBeUndefined();
        });

        test('should not interfere with POST requests in guest mode', async () => {
            instanceMock.onPost('/api/public-action').reply(201, { created: true });

            const response = await apiClient.post('/api/public-action', { data: 'test' });

            expect(response.status).toBe(201);
            expect(instanceMock.history.post[0].headers.Authorization).toBeUndefined();
        });
    });

    describe('Error Scenarios', () => {
        test('should handle network errors', async () => {
            instanceMock.onGet('/api/test').networkError();

            try {
                await apiClient.get('/api/test');
            } catch (error: any) {
                expect(error.message).toMatch(/Network Error/);
            }
        });

        test('should handle timeout errors', async () => {
            instanceMock.onGet('/api/test').timeoutOnce();

            try {
                await apiClient.get('/api/test');
            } catch (error: any) {
                expect(error.code).toBe('ECONNABORTED');
            }
        });
    });
});
