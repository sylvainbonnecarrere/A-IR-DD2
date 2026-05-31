import apiClient from '../utils/apiClient';
import * as llmConfigService from './llmConfigService';
import * as localLLMProfileService from './localLLMProfileService';
import {
    INITIAL_RUNTIME_LLM_CONFIGS,
    buildRuntimeConfigsFromApiKeys,
    buildRuntimeConfigsFromUiConfigs,
} from './runtimeConfigRepository';
import { getErrorMessage, isTransientNetworkError } from '../utils/transientNetworkError';
import type { LLMConfig, LocalLLMProfile } from '../types';
import type { LLMApiKey } from '../contexts/types/auth.types';

export interface RuntimeBootstrapState {
    llmApiKeys: LLMApiKey[] | null;
    runtimeLLMConfigs: LLMConfig[];
    localLLMProfiles: LocalLLMProfile[];
}

async function fetchLLMApiKeys(token: string, retryCount = 0): Promise<LLMApiKey[]> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
        const { data: keys } = await apiClient.post<LLMApiKey[]>(
            '/api/llm/get-all-api-keys',
            {},
            {
                signal: controller.signal,
                headers: { Authorization: `Bearer ${token}` },
            }
        );

        return keys;
    } catch (err: any) {
        if ((err.name === 'AbortError' || err.code === 'ERR_CANCELED')) {
            console.warn('[runtimeBootstrapService] Runtime key fetch timeout');
        } else if (err.response?.status === 401 && retryCount < 2) {
            clearTimeout(timeoutId);
            await new Promise((resolve) => setTimeout(resolve, 500));
            return fetchLLMApiKeys(token, retryCount + 1);
        } else {
            const log = isTransientNetworkError(err) ? console.warn : console.error;
            log('[runtimeBootstrapService] Runtime key fetch failed:', getErrorMessage(err));
        }

        return [];
    } finally {
        clearTimeout(timeoutId);
    }
}

async function loadLocalLLMProfiles(token?: string): Promise<LocalLLMProfile[]> {
    try {
        return await localLLMProfileService.getAllProfiles({
            useApi: !!token,
            token,
        });
    } catch (err) {
        const log = isTransientNetworkError(err) ? console.warn : console.error;
        log('[runtimeBootstrapService] Local LLM profile load failed:', getErrorMessage(err));
        return [];
    }
}

export async function loadAuthenticatedRuntimeBootstrap(token: string): Promise<RuntimeBootstrapState> {
    const [keys, profiles] = await Promise.all([
        fetchLLMApiKeys(token),
        loadLocalLLMProfiles(token),
    ]);

    return {
        llmApiKeys: keys,
        runtimeLLMConfigs: buildRuntimeConfigsFromApiKeys(keys),
        localLLMProfiles: profiles,
    };
}

export async function loadGuestRuntimeBootstrap(): Promise<RuntimeBootstrapState> {
    try {
        const [guestConfigs, guestProfiles] = await Promise.all([
            llmConfigService.getAllLLMConfigs({ useApi: false }),
            localLLMProfileService.getAllProfiles({ useApi: false }),
        ]);

        return {
            llmApiKeys: null,
            runtimeLLMConfigs: buildRuntimeConfigsFromUiConfigs(guestConfigs),
            localLLMProfiles: guestProfiles,
        };
    } catch (err) {
        const log = isTransientNetworkError(err) ? console.warn : console.error;
        log('[runtimeBootstrapService] Guest runtime config load failed:', getErrorMessage(err));

        return {
            llmApiKeys: null,
            runtimeLLMConfigs: INITIAL_RUNTIME_LLM_CONFIGS,
            localLLMProfiles: [],
        };
    }
}