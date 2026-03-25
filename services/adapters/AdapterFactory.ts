/**
 * services/adapters/AdapterFactory.ts
 *
 * Single creation point for all LLM adapters.
 * Implements the Factory Pattern — callers never instantiate adapters directly.
 *
 * Anti-regression guarantee:
 *  - Only LMStudio (LLMProvider.LMStudio) returns a LocalLLMAdapter.
 *  - All other providers return null, indicating that the standard
 *    llmService.generateContentStream path should be used unchanged.
 *
 * How to add a new local provider:
 *  1. Add the provider to LOCAL_PROVIDERS below.
 *  2. Ensure its service follows the lmStudioService interface.
 *  3. Extend LocalLLMAdapter if the service has a different signature.
 */

import { LLMProvider } from '../../types';
import type { LLMConfig } from '../../types';
import { LocalLLMAdapter } from './LocalLLMAdapter';
import type { ILLMAdapter } from './ILLMAdapter';

/** Providers handled via text-based emulated function calling. */
const LOCAL_PROVIDERS: LLMProvider[] = [LLMProvider.LMStudio];

/**
 * Create an adapter for the given provider and configuration.
 *
 * Returns null for all native providers (OpenAI, Anthropic, Gemini, …) so
 * that the existing `llmService.generateContentStream` path is used.
 *
 * @param provider        Target LLM provider
 * @param llmConfigs      LLM configuration list from the agent/workflow store
 * @param model           Model id selected by the agent
 * @param endpointOverride Resolved endpoint from localLLMProfile (takes precedence).
 *                        Pass this from V2AgentNode `resolveLocalEndpoint()` so each
 *                        instance uses its own profile, not the generic LLMConfig.
 */
export function createAdapter(
    provider: LLMProvider,
    config: LLMConfig | null,
    model: string,
    authToken?: string
): ILLMAdapter | null {
    if (!LOCAL_PROVIDERS.includes(provider)) {
        // Native function-calling provider — use existing streaming path
        return null;
    }

    const endpoint: string = (config as any)?.localEndpoint
        || (config as any)?.apiKey
        || 'http://localhost:1234';

    return new LocalLLMAdapter(provider, {
        endpoint,
        model,
        apiKey: (config as any)?.apiKey,
        authToken,
    });
}
