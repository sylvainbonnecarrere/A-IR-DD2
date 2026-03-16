/**
 * services/adapters/LocalLLMAdapter.ts
 *
 * Adapter for local LLM providers (LMStudio, Ollama, Jan…) that do NOT natively
 * support the OpenAI `tools` API.
 *
 * Strategy:
 *  1. Inject a FunctionCallingPromptBuilder fragment into the system prompt so the
 *     LLM learns to emit <tool_call>…</tool_call> XML blocks.
 *  2. Stream the response from lmStudioService.generateContentStream and collect
 *     the full text.
 *  3. Run ToolCallParser on the collected text to extract any tool call blocks.
 *  4. Return an LLMResponse with both the cleaned text and parsed tool calls.
 *
 * Anti-regression: this adapter is ONLY instantiated by AdapterFactory for
 * LMStudio / Ollama providers.  All other providers continue to use their
 * existing generateContentStream paths.
 */

import { LLMProvider } from '../../types';
import { generateContentStream } from '../lmStudioService';
import { buildFunctionCallingPrompt } from '../llm/FunctionCallingPromptBuilder';
import { parseToolCalls } from '../llm/ToolCallParser';
import type { ILLMAdapter, LLMRequest, LLMResponse } from './ILLMAdapter';

export interface LocalLLMAdapterConfig {
    /** Local endpoint, e.g. "http://localhost:1234" */
    endpoint: string;
    /** Model identifier as configured in LMStudio */
    model: string;
    /** Optional bearer token */
    apiKey?: string;
    /** fr | en — language for FC prompt fragment (default: fr) */
    promptLanguage?: 'fr' | 'en';
}

export class LocalLLMAdapter implements ILLMAdapter {
    readonly supportsNativeToolCalling = false;
    readonly provider: LLMProvider;

    private readonly endpoint: string;
    private readonly model: string;
    private readonly apiKey?: string;
    private readonly promptLanguage: 'fr' | 'en';

    constructor(provider: LLMProvider, config: LocalLLMAdapterConfig) {
        this.provider = provider;
        this.endpoint = config.endpoint;
        this.model = config.model;
        this.apiKey = config.apiKey;
        this.promptLanguage = config.promptLanguage ?? 'fr';
    }

    async complete(request: LLMRequest): Promise<LLMResponse> {
        // 1. Build enriched system prompt (original + FC teaching fragment)
        const fcFragment = request.functions.length > 0
            ? '\n\n' + buildFunctionCallingPrompt(request.functions, { language: this.promptLanguage })
            : '';
        const enrichedSystem = (request.systemPrompt ?? '') + fcFragment;

        // 2. Stream from lmStudioService (no tool array — we're doing text-based FC)
        const stream = generateContentStream(
            this.endpoint,
            this.model,
            enrichedSystem,
            request.messages,
            undefined,          // no native tools — we use prompt engineering
            request.outputConfig,
            this.apiKey
        );

        // 3. Collect full text from stream
        let fullText = '';
        try {
            for await (const chunk of stream) {
                if (chunk.response && 'text' in chunk.response && chunk.response.text) {
                    fullText += chunk.response.text;
                }
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return {
                content: '',
                finishReason: 'error',
                rawContent: message,
            };
        }

        // 4. Parse tool calls from accumulated text
        const parseResult = parseToolCalls(fullText);

        return {
            content: parseResult.textBefore,
            toolCalls: parseResult.hasToolCalls ? parseResult.toolCalls : undefined,
            finishReason: parseResult.hasToolCalls ? 'tool_calls' : 'stop',
            rawContent: fullText,
        };
    }
}
