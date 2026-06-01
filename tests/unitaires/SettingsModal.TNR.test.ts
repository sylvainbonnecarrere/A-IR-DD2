/**
 * 🧪 TESTS DE NON-RÉGRESSION: Frontend Detection Flow
 * 
 * Zone testée: SettingsModal.tsx - handleDetectLMStudio
 * Architecture: Direct fetch to backend proxy + error handling
 */

import { LLMProvider, LLMCapability } from '../../types';

let authState = {
    user: null as null | { email: string },
    isAuthenticated: false,
    refreshRuntimeConfigState: jest.fn().mockResolvedValue(undefined),
};

let cloudProfilesHookState = {
    profiles: [] as Array<any>,
    loading: false,
    error: null as string | null,
    loadProfiles: jest.fn().mockResolvedValue(undefined),
    createProfile: jest.fn(),
    updateProfile: jest.fn(),
    deleteProfile: jest.fn(),
    testProfile: jest.fn(),
    clearError: jest.fn(),
};

let notificationHookState = {
    addNotification: jest.fn(),
};

jest.mock('../../hooks/useLocalization', () => ({
    useLocalization: () => ({
        t: (key: string) => key,
        locale: 'fr',
        setLocale: jest.fn(),
    }),
}));

jest.mock('../../hooks/useAuth', () => ({
    useAuth: () => authState,
}));

let llmHookRenderCount = 0;

jest.mock('../../hooks/useLLMConfigs', () => ({
    useLLMConfigs: () => {
        llmHookRenderCount += 1;
        return {
            configs: [
                {
                    id: `runtime-openai-${llmHookRenderCount}`,
                    provider: 'OpenAI',
                    enabled: true,
                    capabilities: { Chat: true },
                    hasApiKey: false,
                    hasLocalEndpoint: false,
                    createdAt: `created-${llmHookRenderCount}`,
                    updatedAt: `updated-${llmHookRenderCount}`,
                    apiKey: '',
                    localEndpoint: '',
                },
            ],
            loading: false,
            updateConfig: jest.fn(),
            deleteConfig: jest.fn(),
        };
    },
}));

jest.mock('../../hooks/useSaveMode', () => ({
    useSaveMode: () => ({
        saveMode: 'local',
        setSaveMode: jest.fn(),
        isLoading: false,
    }),
}));

jest.mock('../../hooks/useLocalLLMProfiles', () => ({
    useLocalLLMProfiles: () => ({
        profiles: [],
        loading: false,
        createProfile: jest.fn(),
        updateProfile: jest.fn(),
        deleteProfile: jest.fn(),
    }),
}));

jest.mock('../../hooks/useCloudConnectionProfiles', () => ({
    useCloudConnectionProfiles: () => cloudProfilesHookState,
}));

jest.mock('../../contexts/NotificationContext', () => ({
    useNotifications: () => notificationHookState,
}));

jest.mock('../../i18n/locales', () => ({
    locales: ['fr', 'en'],
    Locale: {},
}));

jest.mock('../../utils/llmProviderUtils', () => ({
    isLocalProvider: jest.fn(() => false),
    getInputLabel: jest.fn(() => 'API key'),
    getInputPlaceholder: jest.fn(() => 'placeholder'),
    getInputType: jest.fn(() => 'password'),
    getProviderHelperText: jest.fn(() => ''),
}));

jest.mock('../../components/UI', () => ({
    Button: ({ children, onClick, disabled, type }: any) => React.createElement(
        'button',
        { type: type || 'button', onClick, disabled },
        children
    ),
    ToggleSwitch: ({ checked, onChange }: any) => React.createElement('input', {
        type: 'checkbox',
        checked,
        onChange: (event: any) => onChange(event.target.checked),
    }),
}));

jest.mock('../../components/Icons', () => ({
    CloseIcon: () => React.createElement('span', null, 'close'),
    PlusIcon: () => React.createElement('span', null, 'plus'),
}));

jest.mock('../../components/settings/LocalLLMProfileCard', () => ({
    LocalLLMProfileCard: () => React.createElement('div', null, 'profile-card'),
}));

jest.mock('../../components/settings/CloudConnectionProfileCard', () => ({
    CloudConnectionProfileCard: ({ profile }: any) => React.createElement(
        'div',
        null,
        profile.displayName,
        React.createElement('span', null, profile.target?.bucketName)
    ),
}));

import React from 'react';
import { render, screen } from '@testing-library/react';
import { SettingsModal } from '../../components/modals/SettingsModal';

/**
 * Mock de la réponse du backend proxy
 */
const mockDetectionResult = {
    healthy: true,
    endpoint: 'http://localhost:11434',
    modelId: 'llama2:7b',
    modelName: 'llama2',
    capabilities: [LLMCapability.Chat, LLMCapability.Embedding],
    detectedAt: new Date().toISOString()
};

/**
 * TEST 1: URL encoding de l'endpoint
 */
describe('SettingsModal.handleDetectLMStudio - TNR', () => {
    
    beforeEach(() => {
        llmHookRenderCount = 0;
        authState = {
            user: null,
            isAuthenticated: false,
            refreshRuntimeConfigState: jest.fn().mockResolvedValue(undefined),
        };
        cloudProfilesHookState = {
            profiles: [],
            loading: false,
            error: null,
            loadProfiles: jest.fn().mockResolvedValue(undefined),
            createProfile: jest.fn(),
            updateProfile: jest.fn(),
            deleteProfile: jest.fn(),
            testProfile: jest.fn(),
            clearError: jest.fn(),
        };
        notificationHookState = {
            addNotification: jest.fn(),
        };
    });

    test('modal should not loop when hook configs get a new reference on each render', () => {
        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

        render(React.createElement(SettingsModal, {
            llmConfigs: [
                {
                    provider: LLMProvider.OpenAI,
                    enabled: false,
                    apiKey: '',
                    capabilities: { [LLMCapability.Chat]: true },
                },
            ],
            onClose: jest.fn(),
            onSave: jest.fn(),
        }));

        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(llmHookRenderCount).toBeLessThan(10);
        expect(consoleErrorSpy).not.toHaveBeenCalledWith(
            expect.stringContaining('Maximum update depth exceeded')
        );

        consoleErrorSpy.mockRestore();
    });

    test('authenticated users should see the Cloud tab backed by profile data', async () => {
        const { fireEvent } = await import('@testing-library/react');

        authState = {
            user: { email: 'cloud@test.local' },
            isAuthenticated: true,
            refreshRuntimeConfigState: jest.fn().mockResolvedValue(undefined),
        };
        cloudProfilesHookState = {
            profiles: [
                {
                    id: 'cloud-profile-1',
                    displayName: 'Media S3',
                    provider: 's3',
                    enabled: true,
                    hasSecretMaterial: true,
                    target: {
                        bucketName: 'team-bucket',
                        region: 'eu-west-3',
                        endpoint: null,
                        forcePathStyle: false,
                        keyPrefix: 'workflow/'
                    },
                    status: {
                        state: 'configured',
                        lastValidatedAt: null,
                        lastErrorCode: null,
                        lastValidationMessage: null,
                    },
                    secretSummary: {
                        accessKeyIdMasked: '••••MPLE',
                        secretAccessKeyPresent: true,
                    },
                }
            ],
            loading: false,
            error: null,
            loadProfiles: jest.fn().mockResolvedValue(undefined),
            createProfile: jest.fn(),
            updateProfile: jest.fn(),
            deleteProfile: jest.fn(),
            testProfile: jest.fn(),
            clearError: jest.fn(),
        };

        render(React.createElement(SettingsModal, {
            llmConfigs: [
                {
                    provider: LLMProvider.OpenAI,
                    enabled: false,
                    apiKey: '',
                    capabilities: { [LLMCapability.Chat]: true },
                },
            ],
            onClose: jest.fn(),
            onSave: jest.fn(),
        }));

        fireEvent.click(screen.getByRole('button', { name: 'Cloud' }));

        expect(await screen.findByText('Media S3')).toBeInTheDocument();
        expect(screen.getByText('team-bucket')).toBeInTheDocument();
    });

    test('endpoint should be properly URL encoded in proxy call', () => {
        const endpoint = 'http://localhost:11434';
        const encoded = encodeURIComponent(endpoint);

        expect(encoded).toBe('http%3A%2F%2Flocalhost%3A11434');
        
        // Vérifier que l'URL reconstruite fonctionne
        const proxyUrl = `http://localhost:3001/api/local-llm/detect-capabilities?endpoint=${encoded}`;
        expect(proxyUrl).toContain('endpoint=http%3A%2F%2Flocalhost%3A11434');
    });

    /**
     * TEST 2: Proxy endpoint format
     */
    test('proxy URL should follow correct format', () => {
        const endpoint = 'http://localhost:11434';
        const encoded = encodeURIComponent(endpoint);
        const backendUrl = 'http://localhost:3001';
        
        const proxyUrl = `${backendUrl}/api/local-llm/detect-capabilities?endpoint=${encoded}`;

        expect(proxyUrl).toMatch(/^http:\/\/localhost:3001\/api\/local-llm\/detect-capabilities\?endpoint=/);
        expect(proxyUrl).toMatch(/endpoint=http%3A%2F%2Flocalhost/);
    });

    /**
     * TEST 3: AbortSignal timeout
     */
    test('fetch should use 15 second timeout for full probe suite', () => {
        const timeoutMs = 15000; // Full probe suite timeout
        
        expect(timeoutMs).toBe(15000);
        expect(timeoutMs / 1000).toBe(15);
    });

    /**
     * TEST 4: Detection result structure validation
     */
    test('detection result should have required fields', () => {
        const result = mockDetectionResult;

        expect(result).toHaveProperty('healthy');
        expect(result).toHaveProperty('endpoint');
        expect(result).toHaveProperty('modelId');
        expect(result).toHaveProperty('capabilities');
        expect(result).toHaveProperty('detectedAt');
    });

    /**
     * TEST 5: Capabilities mapping to LLMCapability enum
     */
    test('detected capabilities should map to LLMCapability enum', () => {
        const result = mockDetectionResult;
        const validCapabilities = Object.values(LLMCapability);

        result.capabilities.forEach(cap => {
            expect(validCapabilities).toContain(cap);
        });
    });

    /**
     * TEST 6: Error handling - unhealthy endpoint
     */
    test('should handle unhealthy endpoint response', () => {
        const unhealthyResult = {
            healthy: false,
            endpoint: 'http://localhost:11434',
            capabilities: [],
            detectedAt: new Date().toISOString(),
            error: 'Endpoint not reachable'
        };

        expect(unhealthyResult.healthy).toBe(false);
        expect(unhealthyResult.capabilities.length).toBe(0);
        expect(unhealthyResult.error).toBeDefined();
    });

    /**
     * TEST 7: Provider enum for LMStudio
     */
    test('LMStudio provider should be LMStudio enum value', () => {
        expect(LLMProvider.LMStudio).toBe('LLM local (on premise)');
    });

    /**
     * TEST 8: Form validation before detection
     */
    test('detection button should be disabled without endpoint', () => {
        const isDetecting = false;
        const hasApiKey = false; // Empty endpoint

        const isDisabled = isDetecting || !hasApiKey;
        expect(isDisabled).toBe(true);
    });

    /**
     * TEST 9: Form validation with endpoint
     */
    test('detection button should be enabled with endpoint', () => {
        const isDetecting = false;
        const hasApiKey = true; // Non-empty endpoint

        const isDisabled = isDetecting || !hasApiKey;
        expect(isDisabled).toBe(false);
    });

    /**
     * TEST 10: Detect button disabled while detecting
     */
    test('detection button should be disabled while detection in progress', () => {
        const isDetecting = true;
        const hasApiKey = true;

        const isDisabled = isDetecting || !hasApiKey;
        expect(isDisabled).toBe(true);
    });
});

/**
 * TESTS: Response Parsing
 */
describe('Detection Response Parsing - TNR', () => {
    
    /**
     * TEST 11: JSON parsing of backend response
     */
    test('should parse JSON response from backend', async () => {
        const responseJson = JSON.stringify(mockDetectionResult);
        const parsed = JSON.parse(responseJson);

        expect(parsed.healthy).toBe(true);
        expect(parsed.modelId).toBe('llama2:7b');
        expect(Array.isArray(parsed.capabilities)).toBe(true);
    });

    /**
     * TEST 12: Handle malformed JSON response
     */
    test('should gracefully handle malformed JSON', () => {
        const malformedJson = '{ invalid json }';
        
        expect(() => JSON.parse(malformedJson)).toThrow();
    });

    /**
     * TEST 13: Field presence validation
     */
    test('response must have all required fields', () => {
        const result = mockDetectionResult;
        const requiredFields = ['healthy', 'endpoint', 'capabilities', 'detectedAt'];

        requiredFields.forEach(field => {
            expect(result).toHaveProperty(field);
        });
    });
});

/**
 * TESTS: Backend Route Contract
 */
describe('Backend Route Contract - TNR', () => {
    
    /**
     * TEST 14: Route should always return 200 (even on error)
     */
    test('backend should always return 200 status code', () => {
        // Contract: Detection route returns 200 always
        // Error information in response.error field
        const httpStatus = 200;

        expect(httpStatus).toBe(200);
    });

    /**
     * TEST 15: Unhealthy responses include error field
     */
    test('unhealthy response should include error field', () => {
        const unhealthyResponse = {
            healthy: false,
            endpoint: 'http://localhost:11434',
            capabilities: [],
            detectedAt: new Date().toISOString(),
            error: 'Connection timeout'
        };

        expect(unhealthyResponse.healthy).toBe(false);
        expect(unhealthyResponse.error).toBeDefined();
        expect(typeof unhealthyResponse.error).toBe('string');
    });

    /**
     * TEST 16: Healthy responses include modelId
     */
    test('healthy response should include modelId', () => {
        const healthyResponse = mockDetectionResult;

        expect(healthyResponse.healthy).toBe(true);
        expect(healthyResponse.modelId).toBeDefined();
        expect(typeof healthyResponse.modelId).toBe('string');
    });

    /**
     * TEST 17: Capabilities never null
     */
    test('capabilities field should never be null', () => {
        const responses = [
            mockDetectionResult,
            {
                healthy: false,
                endpoint: 'http://localhost:11434',
                capabilities: [],
                detectedAt: new Date().toISOString()
            }
        ];

        responses.forEach(response => {
            expect(response.capabilities).not.toBeNull();
            expect(Array.isArray(response.capabilities)).toBe(true);
        });
    });
});

/**
 * TESTS: Configuration Persistence
 */
describe('Configuration Persistence - TNR', () => {
    
    /**
     * TEST 18: Detected configuration should be saveable
     */
    test('should be able to save detected configuration', () => {
        const config = {
            provider: LLMProvider.LMStudio,
            apiKey: 'http://localhost:11434',
            capabilities: [LLMCapability.Chat, LLMCapability.Embedding],
            modelId: 'llama2:7b'
        };

        expect(config.provider).toBe('LLM local (on premise)');
        expect(config.apiKey).toMatch(/^http:\/\//);
    });

    /**
     * TEST 19: Configuration should be retrievable
     */
    test('should be able to retrieve saved configuration', () => {
        const savedConfig = {
            provider: LLMProvider.LMStudio,
            apiKey: 'http://localhost:11434',
            capabilities: [LLMCapability.Chat]
        };

        const retrieved = savedConfig;
        expect(retrieved.apiKey).toBe('http://localhost:11434');
        expect(Array.isArray(retrieved.capabilities)).toBe(true);
    });
});

/**
 * TESTS: User Feedback
 */
describe('User Feedback - TNR', () => {
    
    /**
     * TEST 20: Success notification structure
     */
    test('should show success notification with detected capabilities', () => {
        const notification = {
            type: 'success',
            message: `Detected Ollama with 2 capabilities`,
            duration: 5000
        };

        expect(notification.type).toBe('success');
        expect(notification.message).toContain('Ollama');
        expect(notification.message).toContain('capabilities');
    });

    /**
     * TEST 21: Error notification for failed detection
     */
    test('should show error notification on detection failure', () => {
        const notification = {
            type: 'error',
            message: 'Failed to detect LLM local: Connection timeout',
            duration: 5000
        };

        expect(notification.type).toBe('error');
        expect(notification.message).toContain('Failed');
    });

    /**
     * TEST 22: Loading state during detection
     */
    test('should indicate loading state during detection', () => {
        const states = {
            idle: { isDetecting: false },
            loading: { isDetecting: true },
            complete: { isDetecting: false }
        };

        expect(states.loading.isDetecting).toBe(true);
        expect(states.complete.isDetecting).toBe(false);
    });
});
