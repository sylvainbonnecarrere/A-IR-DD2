import { fetchChatCompletion } from './lmstudioProxy.service';

type Mapping = Record<string, unknown>;

export interface WebSearchHiddenLlmRuntime {
    provider: string;
    model: string;
    endpoint?: string;
    api_key?: string;
    transport?: string;
}

export interface WebSearchHiddenLlmRequest {
    runtime: WebSearchHiddenLlmRuntime;
    systemPrompt: string;
    userPrompt: string;
    timeoutSeconds?: number;
    maxTokens?: number;
    allowReasoningRetry?: boolean;
}

const OPENAI_COMPATIBLE_ENDPOINTS: Record<string, string> = {
    OpenAI: 'https://api.openai.com/v1/chat/completions',
    Mistral: 'https://api.mistral.ai/v1/chat/completions',
    Grok: 'https://api.x.ai/v1/chat/completions',
    Perplexity: 'https://api.perplexity.ai/chat/completions',
    Qwen: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
    'Kimi K2': 'https://api.moonshot.ai/v1/chat/completions',
    DeepSeek: 'https://api.deepseek.com/chat/completions',
};

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

function buildMessages(systemPrompt: string, userPrompt: string) {
    const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
    const systemContent = systemPrompt.trim();
    if (systemContent) {
        messages.push({ role: 'system', content: systemContent });
    }
    messages.push({ role: 'user', content: userPrompt });
    return messages;
}

function normalizeTimeoutSeconds(timeoutSeconds?: number): number {
    if (!Number.isFinite(timeoutSeconds) || timeoutSeconds === undefined || timeoutSeconds === null) {
        return 120;
    }

    if (timeoutSeconds <= 0) {
        return 0;
    }

    return Math.max(1, Math.trunc(timeoutSeconds));
}

function normalizeMaxTokens(maxTokens?: number): number {
    if (!Number.isFinite(maxTokens) || !maxTokens) {
        return 220;
    }

    return Math.min(Math.max(1, Math.trunc(maxTokens)), 1000);
}

function computeExpandedMaxTokens(currentMaxTokens: number): number {
    return Math.min(Math.max(currentMaxTokens * 3, 512), 1000);
}

function getRemainingTimeoutMs(deadlineMs: number): number {
    return Math.max(deadlineMs - Date.now(), 1);
}

function describeTimeout(timeoutSeconds?: number): { timeoutSeconds: number; timeoutDisabled: boolean; deadlineMs: number | null } {
    const normalizedTimeoutSeconds = normalizeTimeoutSeconds(timeoutSeconds);
    if (normalizedTimeoutSeconds <= 0) {
        return {
            timeoutSeconds: 0,
            timeoutDisabled: true,
            deadlineMs: null,
        };
    }

    return {
        timeoutSeconds: normalizedTimeoutSeconds,
        timeoutDisabled: false,
        deadlineMs: Date.now() + normalizedTimeoutSeconds * 1000,
    };
}

function getEffectiveTimeoutMs(deadlineMs: number | null): number {
    return deadlineMs === null ? 0 : getRemainingTimeoutMs(deadlineMs);
}

async function fetchJson(url: string, init: RequestInit, timeoutMs: number): Promise<any> {
    const controller = new AbortController();
    const hasTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0;
    const timeoutId = hasTimeout ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
    const startedAt = Date.now();

    try {
        console.info('[WebSearchHiddenLLM] fetchJson start', {
            url,
            timeoutMs: hasTimeout ? timeoutMs : 0,
            timeoutDisabled: !hasTimeout,
        });
        const response = await fetch(url, {
            ...init,
            signal: controller.signal,
        });

        if (!response.ok) {
            const errorText = await response.text().catch(() => response.statusText);
            throw new Error(`HTTP ${response.status}: ${errorText || response.statusText}`);
        }

        const payload = await response.json();
        console.info('[WebSearchHiddenLLM] fetchJson success', {
            url,
            durationMs: Date.now() - startedAt,
            timeoutMs: hasTimeout ? timeoutMs : 0,
            timeoutDisabled: !hasTimeout,
            status: response.status,
        });
        return payload;
    } finally {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
    }
}

function extractOpenAICompatibleText(response: unknown): string {
    const payload = toMapping(response);
    const choices = Array.isArray(payload.choices) ? payload.choices : [];
    const message = choices.length > 0 ? toMapping(toMapping(choices[0]).message) : {};
    const content = message.content;

    if (typeof content !== 'string' || !content.trim()) {
        throw new Error(`Réponse OpenAI-compatible invalide: ${JSON.stringify(payload)}`);
    }

    return content.trim();
}

function extractLocalRuntimeText(response: unknown): string {
    const payload = toMapping(response);

    const directText = toNonEmptyString(payload.text);
    if (directText) {
        return directText;
    }

    const directMessage = toMapping(payload.message);
    const directMessageContent = toNonEmptyString(directMessage.content);
    if (directMessageContent) {
        return directMessageContent;
    }

    const choices = Array.isArray(payload.choices) ? payload.choices : [];
    const firstChoice = choices.length > 0 ? toMapping(choices[0]) : {};
    const message = toMapping(firstChoice.message);
    const content = toNonEmptyString(message.content);
    if (content) {
        return content;
    }

    const reasoningContent = toNonEmptyString(message.reasoning_content) ?? toNonEmptyString(firstChoice.reasoning_content);
    const finishReason = toNonEmptyString(firstChoice.finish_reason);
    if (reasoningContent) {
        throw new Error(
            `Réponse runtime local incomplète: contenu final vide après reasoning (${finishReason ?? 'finish_reason inconnu'}).`
        );
    }

    throw new Error(`Réponse runtime local invalide: ${JSON.stringify(payload)}`);
}

function extractOllamaText(response: unknown): string {
    const payload = toMapping(response);
    const message = toMapping(payload.message);
    const content = message.content;

    if (typeof content !== 'string' || !content.trim()) {
        throw new Error(`Réponse Ollama invalide: ${JSON.stringify(payload)}`);
    }

    return content.trim();
}

function shouldTryOllamaFallback(error: unknown): boolean {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    return message.includes('unexpected endpoint')
        || message.includes('404')
        || message.includes('405')
        || message.includes('not found')
        || message.includes('method not allowed');
}

function shouldRetryModelReload(error: unknown): boolean {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    return message.includes('model reloaded');
}

function shouldRetryReasoningLengthExhaustion(error: unknown): boolean {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    return message.includes('contenu final vide après reasoning (length)');
}

async function waitForModelReloadRecovery(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 800));
}

async function completeWithLocalRuntime(input: WebSearchHiddenLlmRequest): Promise<string> {
    const endpoint = toNonEmptyString(input.runtime.endpoint);
    if (!endpoint) {
        throw new Error('Le runtime local caché ne contient pas d\'endpoint exploitable.');
    }

    const startedAt = Date.now();
    const timeout = describeTimeout(input.timeoutSeconds);
    const baseMaxTokens = normalizeMaxTokens(input.maxTokens);
    const localUserPrompt = input.userPrompt;
    let requestedMaxTokens = baseMaxTokens;

    console.info('[WebSearchHiddenLLM] local runtime start', {
        provider: input.runtime.provider,
        model: input.runtime.model,
        endpoint,
        timeoutSeconds: timeout.timeoutSeconds,
        timeoutDisabled: timeout.timeoutDisabled,
        maxTokens: baseMaxTokens,
        systemPromptLength: input.systemPrompt.length,
        userPromptLength: input.userPrompt.length,
        effectiveUserPromptLength: localUserPrompt.length,
    });

    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            const attemptStartedAt = Date.now();
            const response = await fetchChatCompletion(endpoint, {
                model: input.runtime.model,
                messages: buildMessages(input.systemPrompt, localUserPrompt),
                temperature: 0.1,
                max_tokens: requestedMaxTokens,
                stream: false,
            }, getEffectiveTimeoutMs(timeout.deadlineMs));

            console.info('[WebSearchHiddenLLM] local runtime LMStudio response received', {
                model: input.runtime.model,
                attempt: attempt + 1,
                attemptDurationMs: Date.now() - attemptStartedAt,
                totalDurationMs: Date.now() - startedAt,
            });

            return extractLocalRuntimeText(response);
        } catch (error) {
            console.warn('[WebSearchHiddenLLM] local runtime attempt failed', {
                model: input.runtime.model,
                attempt: attempt + 1,
                totalDurationMs: Date.now() - startedAt,
                remainingTimeoutMs: getEffectiveTimeoutMs(timeout.deadlineMs),
                error: error instanceof Error ? error.message : String(error),
            });
            if (input.allowReasoningRetry !== false && shouldRetryReasoningLengthExhaustion(error) && attempt === 0 && requestedMaxTokens < 1000) {
                requestedMaxTokens = computeExpandedMaxTokens(requestedMaxTokens);
                console.info('[WebSearchHiddenLLM] local runtime retrying after reasoning-length exhaustion', {
                    model: input.runtime.model,
                    nextMaxTokens: requestedMaxTokens,
                    totalDurationMs: Date.now() - startedAt,
                });
                continue;
            }

            if (shouldRetryModelReload(error) && attempt === 0) {
                await waitForModelReloadRecovery();
                continue;
            }

            if (!shouldTryOllamaFallback(error)) {
                throw error;
            }

            break;
        }
    }

    const ollamaResponse = await fetchJson(
        `${endpoint.replace(/\/$/, '')}/api/chat`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: input.runtime.model,
                messages: buildMessages(input.systemPrompt, localUserPrompt),
                stream: false,
                think: false,
                options: {
                    temperature: 0.1,
                    num_predict: requestedMaxTokens,
                },
            }),
        },
        getEffectiveTimeoutMs(timeout.deadlineMs),
    );

    console.info('[WebSearchHiddenLLM] local runtime Ollama fallback response received', {
        model: input.runtime.model,
        totalDurationMs: Date.now() - startedAt,
    });

    return extractOllamaText(ollamaResponse);
}

async function completeWithOpenAICompatibleCloud(input: WebSearchHiddenLlmRequest): Promise<string> {
    const apiKey = toNonEmptyString(input.runtime.api_key);
    if (!apiKey) {
        throw new Error(`La configuration '${input.runtime.provider}' ne contient pas de secret exploitable.`);
    }

    const endpoint = OPENAI_COMPATIBLE_ENDPOINTS[input.runtime.provider];
    if (!endpoint) {
        throw new Error(`Provider OpenAI-compatible non supporté: ${input.runtime.provider}`);
    }

    const response = await fetchJson(
        endpoint,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: input.runtime.model,
                messages: buildMessages(input.systemPrompt, input.userPrompt),
                temperature: 0.1,
                max_tokens: normalizeMaxTokens(input.maxTokens),
                stream: false,
            }),
        },
        normalizeTimeoutSeconds(input.timeoutSeconds) * 1000,
    );

    return extractOpenAICompatibleText(response);
}

async function completeWithGemini(input: WebSearchHiddenLlmRequest): Promise<string> {
    const apiKey = toNonEmptyString(input.runtime.api_key);
    if (!apiKey) {
        throw new Error('Runtime Gemini incomplet pour web_search_py.');
    }

    const response = await fetchJson(
        `https://generativelanguage.googleapis.com/v1beta/models/${input.runtime.model}:generateContent?key=${apiKey}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                system_instruction: {
                    parts: [{ text: input.systemPrompt }],
                },
                contents: [{
                    role: 'user',
                    parts: [{ text: input.userPrompt }],
                }],
                generationConfig: {
                    temperature: 0.1,
                    maxOutputTokens: normalizeMaxTokens(input.maxTokens),
                },
            }),
        },
        normalizeTimeoutSeconds(input.timeoutSeconds) * 1000,
    );

    const candidates = Array.isArray(response?.candidates) ? response.candidates : [];
    const content = candidates.length > 0 ? toMapping(toMapping(candidates[0]).content) : {};
    const parts = Array.isArray(content.parts) ? content.parts : [];
    const text = parts.length > 0 ? toMapping(parts[0]).text : null;

    if (typeof text !== 'string' || !text.trim()) {
        throw new Error(`Réponse Gemini invalide: ${JSON.stringify(response)}`);
    }

    return text.trim();
}

async function completeWithAnthropic(input: WebSearchHiddenLlmRequest): Promise<string> {
    const apiKey = toNonEmptyString(input.runtime.api_key);
    if (!apiKey) {
        throw new Error('Runtime Anthropic incomplet pour web_search_py.');
    }

    const response = await fetchJson(
        'https://api.anthropic.com/v1/messages',
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model: input.runtime.model,
                system: input.systemPrompt,
                max_tokens: normalizeMaxTokens(input.maxTokens),
                temperature: 0.1,
                messages: [{ role: 'user', content: input.userPrompt }],
            }),
        },
        normalizeTimeoutSeconds(input.timeoutSeconds) * 1000,
    );

    const content = Array.isArray(response?.content) ? response.content : [];
    const text = content.length > 0 ? toMapping(content[0]).text : null;

    if (typeof text !== 'string' || !text.trim()) {
        throw new Error(`Réponse Anthropic invalide: ${JSON.stringify(response)}`);
    }

    return text.trim();
}

export async function completeWebSearchHiddenLlm(input: WebSearchHiddenLlmRequest): Promise<string> {
    const provider = toNonEmptyString(input.runtime.provider);
    const model = toNonEmptyString(input.runtime.model);

    if (!provider || !model) {
        throw new Error('Le runtime LLM caché est incomplet pour web_search_py.');
    }

    if (provider === 'LLM local (on premise)') {
        return completeWithLocalRuntime(input);
    }

    if (provider === 'Gemini') {
        return completeWithGemini(input);
    }

    if (provider === 'Anthropic') {
        return completeWithAnthropic(input);
    }

    if (provider in OPENAI_COMPATIBLE_ENDPOINTS) {
        return completeWithOpenAICompatibleCloud(input);
    }

    throw new Error(`Provider LLM caché non supporté pour web_search_py: ${provider}`);
}