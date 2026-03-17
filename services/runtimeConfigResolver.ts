import { Agent, HistoryConfig, LLMConfig, LLMProvider, LocalLLMProfile } from '../types';
import { isLocalProvider } from '../utils/llmProviderUtils';

interface RuntimeResolutionInput {
    provider: LLMProvider;
    llmConfigs: LLMConfig[];
    localLLMProfiles?: LocalLLMProfile[];
    localLLMProfileId?: string;
}

export interface RuntimeResolution {
    provider: LLMProvider;
    config: LLMConfig | null;
    credential: string;
    localProfile: LocalLLMProfile | null;
    identityKey: string;
}

function getBaseConfig(provider: LLMProvider, llmConfigs: LLMConfig[]): LLMConfig | null {
    return llmConfigs.find(config => config.provider === provider) || null;
}

function getLocalProfile(localLLMProfileId: string | undefined, localLLMProfiles: LocalLLMProfile[]): LocalLLMProfile | null {
    if (!localLLMProfileId) {
        return null;
    }

    return localLLMProfiles.find(profile => profile.id === localLLMProfileId) || null;
}

export function resolveRuntimeConfigByIdentity({
    provider,
    llmConfigs,
    localLLMProfiles = [],
    localLLMProfileId,
}: RuntimeResolutionInput): RuntimeResolution {
    const baseConfig = getBaseConfig(provider, llmConfigs);

    if (!isLocalProvider(provider)) {
        return {
            provider,
            config: baseConfig,
            credential: baseConfig?.apiKey || '',
            localProfile: null,
            identityKey: provider,
        };
    }

    const localProfile = getLocalProfile(localLLMProfileId, localLLMProfiles);
    const resolvedEndpoint = localProfile?.endpoint || baseConfig?.localEndpoint || baseConfig?.apiKey || '';

    return {
        provider,
        config: baseConfig
            ? {
                ...baseConfig,
                enabled: baseConfig.enabled && (localProfile?.enabled ?? true),
                localEndpoint: resolvedEndpoint,
                hasLocalEndpoint: !!resolvedEndpoint,
            }
            : null,
        credential: resolvedEndpoint,
        localProfile,
        identityKey: `${provider}:${localProfile?.id || localLLMProfileId || 'default'}`,
    };
}

export function resolveAgentRuntimeConfig(
    agent: Pick<Agent, 'llmProvider' | 'localLLMProfileId'> | null | undefined,
    llmConfigs: LLMConfig[],
    localLLMProfiles: LocalLLMProfile[] = []
): RuntimeResolution {
    if (!agent) {
        return {
            provider: LLMProvider.Gemini,
            config: null,
            credential: '',
            localProfile: null,
            identityKey: 'missing-agent',
        };
    }

    return resolveRuntimeConfigByIdentity({
        provider: agent.llmProvider,
        localLLMProfileId: agent.localLLMProfileId,
        llmConfigs,
        localLLMProfiles,
    });
}

export function resolveHistoryRuntimeConfig(
    historyConfig: Pick<HistoryConfig, 'llmProvider'> | null | undefined,
    llmConfigs: LLMConfig[],
    localLLMProfiles: LocalLLMProfile[] = [],
    inheritedLocalLLMProfileId?: string,
): RuntimeResolution {
    if (!historyConfig) {
        return {
            provider: LLMProvider.Gemini,
            config: null,
            credential: '',
            localProfile: null,
            identityKey: 'missing-history',
        };
    }

    return resolveRuntimeConfigByIdentity({
        provider: historyConfig.llmProvider,
        localLLMProfileId: inheritedLocalLLMProfileId,
        llmConfigs,
        localLLMProfiles,
    });
}