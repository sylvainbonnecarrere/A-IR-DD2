import { createAdapter } from '../../services/adapters/AdapterFactory';
import {
    resolveAgentRuntimeConfig,
    resolveHistoryRuntimeConfig,
    resolveRuntimeConfigByIdentity,
} from '../../services/runtimeConfigResolver';
import { Agent, LLMCapability, LLMConfig, LLMProvider, LocalLLMProfile } from '../../types';

describe('BC-03 runtime identity resolver', () => {
    const runtimeConfigs: LLMConfig[] = [
        {
            provider: LLMProvider.LMStudio,
            enabled: true,
            localEndpoint: 'http://shared-default:1234',
            capabilities: {
                [LLMCapability.Chat]: true,
                [LLMCapability.FunctionCalling]: true,
            },
        },
        {
            provider: LLMProvider.OpenAI,
            enabled: true,
            apiKey: 'sk-openai',
            capabilities: {
                [LLMCapability.Chat]: true,
            },
        },
    ];

    const localProfiles: LocalLLMProfile[] = [
        {
            id: 'profile-a',
            name: 'Local A',
            endpoint: 'http://localhost:11434',
            enabled: true,
            capabilities: { [LLMCapability.Chat]: true },
        },
        {
            id: 'profile-b',
            name: 'Local B',
            endpoint: 'http://localhost:1234',
            enabled: true,
            capabilities: { [LLMCapability.Chat]: true },
        },
    ];

    it('isolates two local agents sharing the same provider by profile identity', () => {
        const firstAgent: Pick<Agent, 'llmProvider' | 'localLLMProfileId'> = {
            llmProvider: LLMProvider.LMStudio,
            localLLMProfileId: 'profile-a',
        };
        const secondAgent: Pick<Agent, 'llmProvider' | 'localLLMProfileId'> = {
            llmProvider: LLMProvider.LMStudio,
            localLLMProfileId: 'profile-b',
        };

        const firstResolution = resolveAgentRuntimeConfig(firstAgent, runtimeConfigs, localProfiles);
        const secondResolution = resolveAgentRuntimeConfig(secondAgent, runtimeConfigs, localProfiles);

        expect(firstResolution.credential).toBe('http://localhost:11434');
        expect(secondResolution.credential).toBe('http://localhost:1234');
        expect(firstResolution.identityKey).not.toBe(secondResolution.identityKey);
    });

    it('keeps follow-up and summarization on the same local identity when history uses a local provider', () => {
        const resolution = resolveHistoryRuntimeConfig(
            { llmProvider: LLMProvider.LMStudio },
            runtimeConfigs,
            localProfiles,
            'profile-b'
        );

        expect(resolution.localProfile?.id).toBe('profile-b');
        expect(resolution.credential).toBe('http://localhost:1234');
        expect(resolution.identityKey).toContain('profile-b');
    });

    it('preserves cloud-provider lookup behavior without introducing local profile coupling', () => {
        const resolution = resolveRuntimeConfigByIdentity({
            provider: LLMProvider.OpenAI,
            llmConfigs: runtimeConfigs,
            localLLMProfiles: localProfiles,
            localLLMProfileId: 'profile-a',
        });

        expect(resolution.credential).toBe('sk-openai');
        expect(resolution.localProfile).toBeNull();
        expect(resolution.identityKey).toBe(LLMProvider.OpenAI);
    });

    it('creates a local adapter from the resolved identity-specific endpoint', () => {
        const resolution = resolveAgentRuntimeConfig(
            {
                llmProvider: LLMProvider.LMStudio,
                localLLMProfileId: 'profile-a',
            },
            runtimeConfigs,
            localProfiles,
        );

        const adapter = createAdapter(LLMProvider.LMStudio, resolution.config, 'mistral-local');

        expect(adapter).not.toBeNull();
        expect((adapter as any).endpoint).toBe('http://localhost:11434');
    });
});