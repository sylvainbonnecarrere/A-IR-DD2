/**
 * services/adapters/ILLMAdapter.ts
 *
 * Common interface for all LLM adapters — both native (OpenAI, Anthropic, Gemini…)
 * and emulated (LMStudio, Ollama) function-calling providers.
 *
 * Design: Strategy Pattern — callers (AgentLoop) depend on this abstraction only,
 * never on concrete implementations.  AdapterFactory is the single creation point.
 */

import type { LLMProvider, ChatMessage, OutputConfig } from '../../types';
import type { ToolRegistryReadModel } from '../../types/function.types';
import type { ParsedToolCall, ToolCallParseTrace } from '../llm/ToolCallParser';

// ─── Value objects ───────────────────────────────────────────────────────────

export interface LLMRequest {
    /** Full conversation history (user + agent + tool + tool_result). */
    messages: ChatMessage[];
    /** Functions made available to the LLM for this turn. */
    functions: ToolRegistryReadModel[];
    /** Base system prompt (without FC additions). */
    systemPrompt?: string;
    /** Optional output constraints (JSON schema, format, …). */
    outputConfig?: OutputConfig;
}

export interface LocalLLMTerminalError {
    code: string;
    message: string;
    retryable: boolean;
    provider: LLMProvider;
    model: string;
}

export interface LLMResponse {
    /** The text content produced by the LLM (may be empty when only tool calls). */
    content: string;
    /**
     * Tool calls requested by the LLM.
     * - For native providers, sourced directly from the API structured response.
     * - For emulated providers, extracted by ToolCallParser from text content.
     */
    toolCalls?: ParsedToolCall[];
    /** Why the model stopped generating. */
    finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
    /** Optional raw text response (before tool call extraction). */
    rawContent?: string;
    /** Structured terminal error for local providers. */
    terminalError?: LocalLLMTerminalError;
    /** Structured parsing trace for emulated local tool-calling. */
    parseTrace?: ToolCallParseTrace;
}

// ─── Adapter contract ────────────────────────────────────────────────────────

/**
 * Every LLM adapter must implement this interface.
 *
 * `complete` is intentionally non-streaming: AgentLoop manages turns as
 * discrete units so that tool execution can occur between turns.
 * Streaming is handled separately by V2AgentNode for direct (non-loop) calls.
 */
export interface ILLMAdapter {
    /** LLMProvider enum value served by this adapter. */
    readonly provider: LLMProvider;

    /**
     * True when the underlying API has native function-calling support
     * (e.g. OpenAI `tools`, Anthropic `tools`, Gemini `tools`).
     * False for text-based emulation via FunctionCallingPromptBuilder.
     */
    readonly supportsNativeToolCalling: boolean;

    /**
     * Complete a single LLM turn synchronously.
     * Returns the full response including any tool calls.
     */
    complete(request: LLMRequest): Promise<LLMResponse>;
}
