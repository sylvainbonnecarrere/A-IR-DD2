import mongoose from 'mongoose';
import { LLMConfig } from '../models/LLMConfig.model';
import { LocalLLMProfile } from '../models/LocalLLMProfile.model';
import { isLocalProvider } from '../utils/providerUtils';
import config from '../config/environment';

type Mapping = Record<string, unknown>;

function toMapping(value: unknown): Mapping {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Mapping
        : {};
}

function toNonEmptyString(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function normalizeEndpointForSandbox(endpoint: string): string {
    try {
        const url = new URL(endpoint);
        if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
            url.hostname = 'host.docker.internal';
        }
        return url.toString().replace(/\/$/, '');
    } catch {
        return endpoint;
    }
}

function normalizeBearerToken(authHeader?: string): string | null {
    if (typeof authHeader !== 'string') {
        return null;
    }

    const trimmed = authHeader.trim();
    if (!trimmed) {
        return null;
    }

    return trimmed.toLowerCase().startsWith('bearer ')
        ? trimmed.slice(7).trim() || null
        : trimmed;
}

function resolveHiddenCompletionUrl(): string {
    return `http://host.docker.internal:${config.port}/api/web-search/hidden-llm/complete`;
}

async function resolveLocalEndpoint(userId: string, llmConfig: Mapping): Promise<string> {
    const localProfileId = toNonEmptyString(llmConfig.localLLMProfileId);

    if (localProfileId && mongoose.Types.ObjectId.isValid(localProfileId)) {
        const localProfile = await LocalLLMProfile.findOne({
            _id: localProfileId,
            userId: new mongoose.Types.ObjectId(userId),
            enabled: true,
        }).lean();

        if (localProfile?.endpoint) {
            return normalizeEndpointForSandbox(localProfile.endpoint);
        }
    }

    const storedConfig = await LLMConfig.findOne({
        userId: new mongoose.Types.ObjectId(userId),
        provider: 'LLM local (on premise)',
        enabled: true,
    });

    const endpoint = storedConfig?.getLocalEndpoint() ?? '';
    if (!endpoint) {
        throw new Error('Aucun endpoint LLM local actif n\'est configuré pour la transformation invisible web search.');
    }

    return normalizeEndpointForSandbox(endpoint);
}

async function resolveCloudApiKey(userId: string, provider: string): Promise<string> {
    const storedConfig = await LLMConfig.findOne({
        userId: new mongoose.Types.ObjectId(userId),
        provider,
        enabled: true,
    });

    if (!storedConfig) {
        throw new Error(`Aucune configuration LLM active n\'est disponible pour le provider '${provider}'.`);
    }

    const apiKey = storedConfig.getDecryptedApiKey();
    if (!apiKey) {
        throw new Error(`La configuration LLM '${provider}' ne contient pas de secret exploitable.`);
    }

    return apiKey;
}

export async function resolveWebSearchPrivateContext(
    functionName: string,
    userId: string,
    privateContext?: Record<string, unknown>,
    authHeader?: string,
): Promise<Record<string, unknown> | undefined> {
    if (functionName !== 'web_search_py' || !privateContext) {
        return privateContext;
    }

    const root = toMapping(privateContext);
    const webSearch = toMapping(root.web_search);
    const llm = toMapping(webSearch.llm);
    const params = toMapping(webSearch.params);
    const provider = toNonEmptyString(llm.provider);
    const model = toNonEmptyString(llm.model);
    const authToken = normalizeBearerToken(authHeader);

    if (!provider || !model) {
        return {
            ...root,
            web_search: {
                ...webSearch,
                params,
            },
        };
    }

    const llmRuntime = isLocalProvider(provider)
        ? {
            provider,
            model,
            endpoint: await resolveLocalEndpoint(userId, llm),
            transport: 'application-backend',
            completion_api_url: resolveHiddenCompletionUrl(),
            ...(authToken ? { auth_token: authToken } : {}),
        }
        : {
            provider,
            model,
            api_key: await resolveCloudApiKey(userId, provider),
            transport: 'application-backend',
            completion_api_url: resolveHiddenCompletionUrl(),
            ...(authToken ? { auth_token: authToken } : {}),
        };

    return {
        ...root,
        web_search: {
            ...webSearch,
            params,
            llm_runtime: llmRuntime,
        },
    };
}