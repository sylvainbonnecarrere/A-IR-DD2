/**
 * services/llm/AgentLoop.ts
 *
 * Multi-turn agent execution loop for emulated function-calling providers
 * (LMStudio, Ollama…).
 *
 * Algorithm (max 10 iterations, circuit-breaker):
 *  1. Call adapter.complete(request)
 *  2. If response has no tool calls → return final text
 *  3. For each tool call → execute via backend sandbox API
 *  4. Append tool + tool_result messages to history
 *  5. Repeat from step 1
 *
 * Design:
 *  - Depends on ILLMAdapter only (Strategy Pattern)
 *  - Tool execution via the backend `/api/sandbox/run` route
 *  - Progress events emitted via onEvent callback (for UI streaming simulation)
 *
 * Security:
 *  - Function names are validated against the known function list (no injection)
 *  - HTTP requests go to the authenticated backend only
 */

import { API_BASE_URL } from '../../config/api.config';
import type { ChatMessage, ToolSelection } from '../../types';
import type { ToolRegistryReadModel, UserFunction } from '../../types/function.types';
import type { ILLMAdapter, LLMRequest } from '../adapters/ILLMAdapter';
import type { ParsedToolCall } from './ToolCallParser';
import { mapUserFunctionToToolRegistry } from '../../types/function.types';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ToolCallRecord {
    /** Unique invocation id (generated each loop). */
    id: string;
    toolId?: string;
    functionId?: string;
    functionName: string;
    arguments: Record<string, unknown>;
    result: unknown;
    status: 'success' | 'error';
    durationMs: number;
    executionId?: string;
    runner?: string;
    exitCode?: number;
    failureKind?: string;
    artifacts?: Array<{ path: string; kind: 'file' | 'json' | 'log' }>;
    timestamp: Date;
}

export interface AgentLoopResult {
    /** Final text response to display to the user. */
    finalResponse: string;
    /** All tool calls executed during the loop. */
    toolCallLog: ToolCallRecord[];
    /** Number of LLM turns taken. */
    iterations: number;
}

export interface AgentLoopEvent {
    type: 'llm_start' | 'llm_done' | 'tool_call_start' | 'tool_call_done' | 'max_iterations';
    iteration: number;
    toolCall?: ParsedToolCall;
    toolResult?: unknown;
    response?: string;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

const MAX_ITERATIONS = 10;

let _idCounter = 0;
function generateId(): string {
    return `tc_${Date.now()}_${++_idCounter}`;
}

/**
 * Look up a UserFunction by name from the provided list.
 * Returns null if not found or disabled — guards against prompt-injected names.
 */
function findFunction(name: string, functions: ToolRegistryReadModel[]): ToolRegistryReadModel | null {
    return functions.find(f => f.name === name && f.isEnabled) ?? null;
}

/**
 * Execute a UserFunction via the backend sandbox route POST /api/sandbox/run.
 * Body: { functionId, testArgs }
 * Response: { success, output, stdout, stderr, durationMs, executionId, runner, exitCode, metadata }
 */
async function executeFunction(
    fn: ToolRegistryReadModel,
    args: Record<string, unknown>,
    authToken?: string
): Promise<{
    result: unknown;
    durationMs: number;
    executionId?: string;
    runner?: string;
    exitCode?: number;
    failureKind?: string;
    artifacts?: Array<{ path: string; kind: 'file' | 'json' | 'log' }>;
}> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

    const response = await fetch(`${API_BASE_URL}/api/sandbox/run`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            functionId: fn.legacyFunctionId ?? fn.id,
            toolSelection: {
                toolId: fn.id,
                versionRef: {
                    versionTag: fn.versionTag,
                    versionNumber: fn.versionNumber,
                    workspaceId: fn.workspaceId ?? null,
                },
            } satisfies ToolSelection,
            testArgs: args
        }),
    });

    if (!response.ok) {
        const errorText = await response.text().catch(() => `HTTP ${response.status}`);
        throw new Error(errorText);
    }

    const data = await response.json();
    if (!data.success) {
        throw new Error(data.stderr || 'Sandbox execution failed');
    }
    return {
        result: data.output ?? {},
        durationMs: data.durationMs ?? 0,
        executionId: data.executionId,
        runner: data.runner,
        exitCode: data.exitCode,
        failureKind: data.metadata?.failureKind,
        artifacts: data.metadata?.artifacts
    };
}

// ─── AgentLoop ───────────────────────────────────────────────────────────────

export interface AgentLoopOptions {
    /** JWT bearer token forwarded with tool execution requests. */
    authToken?: string;
    /** FC prompt language (default: 'fr'). */
    language?: 'fr' | 'en';
    /** Progress callback for UI updates. */
    onEvent?: (event: AgentLoopEvent) => void;
}

/**
 * Run a complete multi-turn agent loop with the given adapter.
 *
 * @param adapter    The LLM adapter to use (LocalLLMAdapter for emulated providers).
 * @param messages   Initial conversation history.
 * @param functions  Functions available to the agent for this session.
 * @param systemPrompt Agent system prompt (without FC fragment — adapter adds it).
 * @param options    Auth token, language, progress events.
 */
export async function runAgentLoop(
    adapter: ILLMAdapter,
    messages: ChatMessage[],
    functions: UserFunction[] | ToolRegistryReadModel[],
    systemPrompt: string,
    options: AgentLoopOptions = {}
): Promise<AgentLoopResult> {
    const { authToken, onEvent } = options;
    const toolCallLog: ToolCallRecord[] = [];
    let history: ChatMessage[] = [...messages];
    const runtimeFunctions: ToolRegistryReadModel[] = functions.map((fn) => (
        'description' in fn && 'inputSchema' in fn && 'isEnabled' in fn && !('_id' in fn)
            ? fn as ToolRegistryReadModel
            : mapUserFunctionToToolRegistry(fn as UserFunction)
    ));

    for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
        onEvent?.({ type: 'llm_start', iteration });

        const request: LLMRequest = {
            messages: history,
            functions: runtimeFunctions,
            systemPrompt,
        };

        const response = await adapter.complete(request);

        onEvent?.({ type: 'llm_done', iteration, response: response.content });

        if (response.finishReason === 'error') {
            return {
                finalResponse: `[Erreur LLM] ${response.rawContent ?? 'Unknown error'}`,
                toolCallLog,
                iterations: iteration,
            };
        }

        // No tool calls → final response
        if (!response.toolCalls || response.toolCalls.length === 0) {
            return {
                finalResponse: response.content,
                toolCallLog,
                iterations: iteration,
            };
        }

        // Append assistant turn to history
        history = [
            ...history,
            {
                id: generateId(),
                sender: 'agent',
                text: response.content,
                timestamp: new Date(),
            } as ChatMessage,
        ];

        // Execute tool calls
        for (const tc of response.toolCalls) {
            onEvent?.({ type: 'tool_call_start', iteration, toolCall: tc });

            const fn = findFunction(tc.name, runtimeFunctions);

            let record: ToolCallRecord;

            if (!fn) {
                // Unknown function — emit an error tool_result and continue
                record = {
                    id: generateId(),
                    toolId: undefined,
                    functionId: '',
                    functionName: tc.name,
                    arguments: tc.arguments,
                    result: { error: `Function '${tc.name}' is not available.` },
                    status: 'error',
                    durationMs: 0,
                    timestamp: new Date(),
                };
            } else {
                try {
                    const { result, durationMs, executionId, runner, exitCode, failureKind, artifacts } = await executeFunction(fn, tc.arguments, authToken);
                    record = {
                        id: generateId(),
                        toolId: fn.id,
                        functionId: fn.legacyFunctionId ?? fn.id,
                        functionName: tc.name,
                        arguments: tc.arguments,
                        result,
                        status: 'success',
                        durationMs,
                        executionId,
                        runner,
                        exitCode,
                        failureKind,
                        artifacts,
                        timestamp: new Date(),
                    };
                } catch (err) {
                    record = {
                        id: generateId(),
                        toolId: fn.id,
                        functionId: fn.legacyFunctionId ?? fn.id,
                        functionName: tc.name,
                        arguments: tc.arguments,
                        result: { error: err instanceof Error ? err.message : String(err) },
                        status: 'error',
                        durationMs: 0,
                        timestamp: new Date(),
                    };
                }
            }

            toolCallLog.push(record);
            onEvent?.({ type: 'tool_call_done', iteration, toolCall: tc, toolResult: record.result });

            // Append tool_result message to history so the LLM can see the output
            const resultText = typeof record.result === 'string'
                ? record.result
                : JSON.stringify(record.result, null, 2);

            history = [
                ...history,
                {
                    id: record.id,
                    sender: 'tool_result',
                    text: resultText,
                    toolCallId: record.id,
                    toolName: record.functionName,
                    isError: record.status === 'error',
                    timestamp: record.timestamp,
                } as ChatMessage,
            ];
        }
    }

    onEvent?.({ type: 'max_iterations', iteration: MAX_ITERATIONS });
    return {
        finalResponse: `[Limite atteinte] Le nombre maximum d'itérations (${MAX_ITERATIONS}) a été atteint.`,
        toolCallLog,
        iterations: MAX_ITERATIONS,
    };
}
