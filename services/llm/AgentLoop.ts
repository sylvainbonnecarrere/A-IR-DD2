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
    errorCode?: string;
    errorSubsystem?: string;
    retryable?: boolean;
    deterministicFailure?: boolean;
    duplicateSuppressed?: boolean;
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
    /** Why the loop stopped. */
    finishReason?: 'stop' | 'tool_calls' | 'length' | 'error';
    /** Structured terminal error when the local adapter fails. */
    terminalError?: {
        code: string;
        message: string;
        retryable: boolean;
        provider: unknown;
        model: string;
    };
    traceLog?: string[];
}

function buildEmptyLocalResponseError(adapter: ILLMAdapter): AgentLoopResult {
    const message = 'Le modele local a retourne une reponse vide sans appel d\'outil.';

    return {
        finalResponse: `[Erreur LLM] ${message}`,
        toolCallLog: [],
        iterations: 1,
        finishReason: 'error',
        terminalError: {
            code: 'empty_response',
            message,
            retryable: false,
            provider: adapter.provider,
            model: 'unknown',
        },
        traceLog: ['llm.empty_response_without_tool_call'],
    };
}

export interface AgentLoopEvent {
    type: 'llm_start' | 'llm_done' | 'tool_call_start' | 'tool_call_done' | 'tool_protocol_violation' | 'max_iterations';
    iteration: number;
    toolCall?: ParsedToolCall;
    toolResult?: unknown;
    response?: string;
    traceMessage?: string;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

const MAX_ITERATIONS = 10;
const TOOL_CALL_DEDUP_WINDOW_MS = 30_000;

let _idCounter = 0;
function generateId(): string {
    return `tc_${Date.now()}_${++_idCounter}`;
}

type ToolExecutionErrorDetails = {
    code?: string;
    subsystem?: string;
    retryable?: boolean;
    deterministic?: boolean;
    failureKind?: string;
    httpStatus?: number;
    rawError?: unknown;
};

class ToolExecutionError extends Error {
    readonly code?: string;
    readonly subsystem?: string;
    readonly retryable: boolean;
    readonly deterministic: boolean;
    readonly failureKind?: string;
    readonly httpStatus?: number;
    readonly rawError?: unknown;

    constructor(message: string, details: ToolExecutionErrorDetails = {}) {
        super(message);
        this.name = 'ToolExecutionError';
        this.code = details.code;
        this.subsystem = details.subsystem;
        this.retryable = details.retryable ?? false;
        this.deterministic = details.deterministic ?? false;
        this.failureKind = details.failureKind;
        this.httpStatus = details.httpStatus;
        this.rawError = details.rawError;
    }
}

function stableSerialize(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map((item) => stableSerialize(item)).join(',')}]`;
    }

    if (value && typeof value === 'object') {
        return `{${Object.entries(value as Record<string, unknown>)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, nestedValue]) => `${JSON.stringify(key)}:${stableSerialize(nestedValue)}`)
            .join(',')}}`;
    }

    return JSON.stringify(value);
}

function createToolCallSignature(fn: ToolRegistryReadModel, args: Record<string, unknown>): string {
    return `${fn.id}::${stableSerialize(args)}`;
}

function isDeterministicHttpFailure(status?: number, code?: string, subsystem?: string, retryable?: boolean): boolean {
    if (retryable) {
        return false;
    }

    if (status === 403 || status === 404 || status === 409) {
        return true;
    }

    if (status === 503) {
        return true;
    }

    return code === 'RUNTIME_NOT_READY'
        || subsystem === 'build_preparation'
        || subsystem === 'runtime_readiness'
        || subsystem === 'validation';
}

function toErrorResultPayload(error: ToolExecutionError | Error): Record<string, unknown> {
    if (error instanceof ToolExecutionError) {
        return {
            error: error.message,
            ...(error.code ? { code: error.code } : {}),
            ...(error.subsystem ? { subsystem: error.subsystem } : {}),
            retryable: error.retryable,
            deterministic: error.deterministic,
            ...(error.failureKind ? { failureKind: error.failureKind } : {}),
        };
    }

    return {
        error: error.message,
        retryable: false,
        deterministic: false,
    };
}

function toToolResultHistoryPayload(record: ToolCallRecord): string {
    return JSON.stringify({
        post_tool_contract: {
            required_next_step: 'Return exactly one grounded <final_answer> based on this tool_result.',
            forbidden_behaviors: [
                'Do not greet the user again.',
                'Do not restart the conversation.',
                'Do not add generic filler, emojis, or speculative advice.',
                'Do not claim memory updates, persistence, or side effects unless the tool output states them explicitly.',
            ],
            preferred_style: 'Short, direct, and strictly grounded in the tool output.',
        },
        tool_results_context: {
            tool_name: record.functionName,
            tool_id: record.toolId ?? record.functionId,
            status: record.status,
            ...(record.executionId ? { execution_id: record.executionId } : {}),
            ...(record.errorCode ? { error_code: record.errorCode } : {}),
            ...(record.errorSubsystem ? { error_subsystem: record.errorSubsystem } : {}),
            ...(typeof record.retryable === 'boolean' ? { retryable: record.retryable } : {}),
            ...(typeof record.deterministicFailure === 'boolean' ? { deterministic_failure: record.deterministicFailure } : {}),
            ...(record.duplicateSuppressed ? { duplicate_suppressed: true } : {}),
        },
        input: record.arguments,
        output: record.result,
    }, null, 2);
}

function isDeterministicFailureRecord(record?: ToolCallRecord | null): boolean {
    return Boolean(record?.status === 'error' && record.deterministicFailure);
}

function isBlockingWebSearchFailureRecord(record?: ToolCallRecord | null): boolean {
    if (!record || record.functionName !== 'web_search_py' || record.status !== 'error') {
        return false;
    }

    if (record.errorCode === 'QUERY_TRANSFORMATION_FAILED') {
        return true;
    }

    if (record.errorCode === 'TIMEOUT' || record.failureKind === 'timeout') {
        return true;
    }

    const payload = toPlainObject(record.result);
    const payloadCode = asNonEmptyString(payload?.code);
    const payloadFailureKind = asNonEmptyString(payload?.failureKind);

    return payloadCode === 'TIMEOUT' || payloadFailureKind === 'timeout';
}

function isRecordStillFresh(record: ToolCallRecord, now: number): boolean {
    return now - record.timestamp.getTime() <= TOOL_CALL_DEDUP_WINDOW_MS;
}

function buildDuplicateSuppressedRecord(input: {
    fn: ToolRegistryReadModel;
    toolCall: ParsedToolCall;
    previous: ToolCallRecord;
    reason: string;
}): ToolCallRecord {
    const previousResult = typeof input.previous.result === 'object' && input.previous.result !== null
        ? input.previous.result as Record<string, unknown>
        : { result: input.previous.result };

    return {
        id: generateId(),
        toolId: input.fn.id,
        functionId: input.fn.legacyFunctionId ?? input.fn.id,
        functionName: input.toolCall.name,
        arguments: input.toolCall.arguments,
        result: {
            ...previousResult,
            duplicate_suppressed: true,
            suppression_reason: input.reason,
            previous_tool_call_id: input.previous.id,
        },
        status: input.previous.status,
        durationMs: 0,
        executionId: input.previous.executionId,
        runner: input.previous.runner,
        exitCode: input.previous.exitCode,
        failureKind: input.previous.failureKind,
        errorCode: input.previous.errorCode,
        errorSubsystem: input.previous.errorSubsystem,
        retryable: input.previous.retryable,
        deterministicFailure: input.previous.deterministicFailure,
        duplicateSuppressed: true,
        artifacts: input.previous.artifacts,
        timestamp: new Date(),
    };
}

function getLatestUserMessage(messages: ChatMessage[]): ChatMessage | null {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message.sender === 'user' && typeof message.text === 'string' && message.text.trim()) {
            return message;
        }
    }

    return null;
}

function toolAcceptsStringArgument(fn: ToolRegistryReadModel, argumentName: string): boolean {
    const schema = fn.inputSchema as {
        properties?: Record<string, { type?: string | string[] }>;
    } | null;
    const property = schema?.properties?.[argumentName];

    if (!property?.type) {
        return true;
    }

    return Array.isArray(property.type)
        ? property.type.includes('string')
        : property.type === 'string';
}

function inferPromptLanguage(text: string): 'fr' | 'en' {
    return /\b(le|la|les|des|une|un|du|de|demain|aujourd'hui|aujourd’hui|meteo|météo|temperature|température|cherche|consulte|internet|temps|quel|quelle|quels|quelles|films?|fran[cç]ais|voir|aller|moment|salle|affiche|actuellement)\b/i.test(text)
        ? 'fr'
        : 'en';
}

function toPlainObject(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function toObjectArray(value: unknown): Record<string, unknown>[] {
    return Array.isArray(value)
        ? value.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null && !Array.isArray(item))
        : [];
}

function classifyWebSearchLogicalFailure(result: unknown): ToolExecutionError | null {
    const payload = toPlainObject(result);
    const errorPayload = toPlainObject(payload?.error);
    const message = typeof errorPayload?.message === 'string'
        ? errorPayload.message
        : typeof payload?.error === 'string'
            ? payload.error
            : null;

    if (!message) {
        return null;
    }

    const step = typeof errorPayload?.step === 'string' ? errorPayload.step : undefined;
    const isQueryTransformationFailure = message.includes('QUERY_TRANSFORMATION_FAILED');
    const isDeterministicTemplateFailure = /lmstudio api error:\s*400|error rendering prompt with jinja template|no user query found in messages/i.test(message);
    const retryable = /timeout hidden llm|endpoint hidden llm injoignable|503|tempor/i.test(message) && !isDeterministicTemplateFailure;

    return new ToolExecutionError(message, {
        code: isQueryTransformationFailure ? 'QUERY_TRANSFORMATION_FAILED' : 'WEB_SEARCH_TOOL_ERROR',
        subsystem: 'tool_logic',
        retryable,
        deterministic: isDeterministicTemplateFailure,
        failureKind: step,
        rawError: result,
    });
}

function buildBlockingWebSearchFailureResponse(record: ToolCallRecord): AgentLoopResult {
    const payload = toPlainObject(record.result);
    const errorMessage = typeof payload?.error === 'string'
        ? payload.error
        : typeof toPlainObject(payload?.error)?.message === 'string'
            ? String(toPlainObject(payload?.error)?.message)
            : 'web_search_py a échoué avant l’exécution de la recherche.';

    return {
        finalResponse: `[Erreur outil] ${errorMessage}`,
        toolCallLog: [record],
        iterations: 1,
        finishReason: 'error',
        traceLog: ['tool.web_search_py.blocking_failure'],
    };
}

function toSingleLine(value: string, maxLength = 220): string {
    const collapsed = value.replace(/\s+/g, ' ').trim();
    if (collapsed.length <= maxLength) {
        return collapsed;
    }

    return `${collapsed.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function asNonEmptyString(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();
    return trimmed ? trimmed : null;
}

function buildWebSearchEmptyResponseFallback(
    record: ToolCallRecord,
    history: ChatMessage[]
): string | null {
    const result = toPlainObject(record.result);
    if (!result) {
        return null;
    }

    const latestUserMessage = getLatestUserMessage(history);
    const query = asNonEmptyString(result.query) ?? latestUserMessage?.text.trim() ?? 'votre demande';
    const normalizedQuery = asNonEmptyString(result.normalized_query);
    const totalResults = typeof result.total_results === 'number'
        ? result.total_results
        : toObjectArray(result.results).length;
    const trace = toPlainObject(result.trace);
    const plannedQueries = toObjectArray(trace?.queries);
    const completedQueries = plannedQueries.filter((item) => item.status === 'completed').length;
    const results = toObjectArray(result.results);
    const primaryResult = results[0] ?? toObjectArray(trace?.selected_sources)[0] ?? null;
    const primaryTitle = asNonEmptyString(primaryResult?.title);
    const primaryUrl = asNonEmptyString(primaryResult?.url);
    const primarySnippet = asNonEmptyString(primaryResult?.snippet);
    const language = inferPromptLanguage(latestUserMessage?.text ?? query);

    if (language === 'fr') {
        const lines = [
            `J'ai bien exécuté la recherche web pour "${query}".`,
            normalizedQuery && normalizedQuery !== query ? `Requête normalisée: ${normalizedQuery}.` : null,
            plannedQueries.length > 0
                ? `${plannedQueries.length} requête(s) candidate(s) préparée(s)${completedQueries > 0 ? `, ${completedQueries} terminée(s)` : ''}.`
                : null,
            `${totalResults} résultat(s) retenu(s).`,
            primaryTitle || primaryUrl
                ? `Source principale: ${primaryTitle ?? 'source web'}${primaryUrl ? ` (${primaryUrl})` : ''}.`
                : null,
            primarySnippet ? `Extrait: ${toSingleLine(primarySnippet)}.` : null,
            `Le modèle local n'a pas produit de synthèse après l'outil, j'affiche donc le résultat vérifiable directement.`,
        ].filter((line): line is string => Boolean(line));

        return lines.join('\n');
    }

    const lines = [
        `I executed the web search for "${query}" successfully.`,
        normalizedQuery && normalizedQuery !== query ? `Normalized query: ${normalizedQuery}.` : null,
        plannedQueries.length > 0
            ? `${plannedQueries.length} candidate query(ies) prepared${completedQueries > 0 ? `, ${completedQueries} completed` : ''}.`
            : null,
        `${totalResults} result(s) selected.`,
        primaryTitle || primaryUrl
            ? `Primary source: ${primaryTitle ?? 'web source'}${primaryUrl ? ` (${primaryUrl})` : ''}.`
            : null,
        primarySnippet ? `Snippet: ${toSingleLine(primarySnippet)}.` : null,
        `The local model did not produce a post-tool summary, so I am showing the verified result directly.`,
    ].filter((line): line is string => Boolean(line));

    return lines.join('\n');
}

function buildPostToolEmptyResponseFallback(
    history: ChatMessage[],
    toolCallLog: ToolCallRecord[]
): { response: string; traceKey: string } | null {
    const latestSuccessfulRecord = [...toolCallLog].reverse().find((record) => record.status === 'success');
    if (!latestSuccessfulRecord) {
        return null;
    }

    if (latestSuccessfulRecord.functionName === 'web_search_py') {
        const response = buildWebSearchEmptyResponseFallback(latestSuccessfulRecord, history);
        if (response) {
            return {
                response,
                traceKey: `llm.empty_response_after_tool_result_fallback.${latestSuccessfulRecord.functionName}`,
            };
        }
    }

    const latestUserMessage = getLatestUserMessage(history);
    const language = inferPromptLanguage(latestUserMessage?.text ?? latestSuccessfulRecord.functionName);
    const fallbackText = typeof latestSuccessfulRecord.result === 'string'
        ? toSingleLine(latestSuccessfulRecord.result, 280)
        : toSingleLine(JSON.stringify(latestSuccessfulRecord.result), 280);

    return {
        response: language === 'fr'
            ? `L'outil ${latestSuccessfulRecord.functionName} s'est exécuté correctement, mais le modèle local n'a pas produit de synthèse. Résultat direct: ${fallbackText}`
            : `The ${latestSuccessfulRecord.functionName} tool completed successfully, but the local model did not produce a summary. Direct result: ${fallbackText}`,
        traceKey: `llm.empty_response_after_tool_result_fallback.${latestSuccessfulRecord.functionName}`,
    };
}

function buildEmptyResponseFallbackToolCall(
    history: ChatMessage[],
    functions: ToolRegistryReadModel[]
): ParsedToolCall | null {
    if (history.some((message) => message.sender === 'tool_result')) {
        return null;
    }

    const latestUserMessage = getLatestUserMessage(history);
    if (!latestUserMessage) {
        return null;
    }

    const query = latestUserMessage.text.trim();
    const explicitWebIntent = /(internet|web|en ligne|online|search|recherche|consulte|actualité|actualite|news|météo|meteo|weather|température|temperature|forecast|prévision|prevision)/i.test(query);
    const implicitWeatherIntent = /(quel\s+temps|temps\s+fera|fera(?:[-'\s])?t(?:[-'\s])?il|fera(?:[-'\s])?t(?:[-'\s])?elle|pleuvra|pluie|averses?|orage|orages|neigera|neige|ensoleill[eé]|temp[eé]ratures?\s+max|temp[eé]ratures?\s+min)/i.test(query);
    const implicitCurrentInfoIntent = /(en\s+ce\s+moment|actuellement|en\s+salle|a(?:\s+l['’])?affiche|sort(?:ent|ie|ies)|quels?\s+films?|films?\s+fran[cç]ais|cin[eé]ma|cin[eé]mas|aller\s+voir|s[eé]ances?|programme)/i.test(query);
    if (!explicitWebIntent && !implicitWeatherIntent && !implicitCurrentInfoIntent) {
        return null;
    }

    const webSearchTool = functions.find((fn) => (
        fn.isEnabled
        && fn.name === 'web_search_py'
        && toolAcceptsStringArgument(fn, 'query')
    ));

    if (!webSearchTool) {
        return null;
    }

    const argumentsPayload: Record<string, unknown> = {
        query,
    };

    if (toolAcceptsStringArgument(webSearchTool, 'language')) {
        argumentsPayload.language = inferPromptLanguage(query);
    }

    return {
        name: webSearchTool.name,
        arguments: argumentsPayload,
        raw: '<tool_call source="agentloop_empty_response_fallback" />',
        confidence: 0.2,
    };
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
    authToken?: string,
    privateContext?: Record<string, unknown>
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
            testArgs: args,
            ...(privateContext ? { privateContext } : {})
        }),
    });

    if (!response.ok) {
        const errorPayload = await response.json().catch(async () => {
            const text = await response.text().catch(() => `HTTP ${response.status}`);
            return { error: text };
        });

        const errorMessage = typeof errorPayload?.error === 'string'
            ? errorPayload.error
            : `HTTP ${response.status}`;
        const errorDetails = errorPayload?.errorDetails;

        throw new ToolExecutionError(errorMessage, {
            code: errorDetails?.code,
            subsystem: errorDetails?.subsystem,
            retryable: errorDetails?.retryable,
            deterministic: isDeterministicHttpFailure(response.status, errorDetails?.code, errorDetails?.subsystem, errorDetails?.retryable),
            failureKind: errorDetails?.failureKind,
            httpStatus: response.status,
            rawError: errorPayload,
        });
    }

    const data = await response.json();
    if (!data.success) {
        throw new ToolExecutionError(data.errorDetails?.message || data.stderr || 'Sandbox execution failed', {
            code: data.errorDetails?.code,
            subsystem: data.errorDetails?.subsystem,
            retryable: data.errorDetails?.retryable,
            deterministic: isDeterministicHttpFailure(undefined, data.errorDetails?.code, data.errorDetails?.subsystem, data.errorDetails?.retryable),
            failureKind: data.errorDetails?.failureKind || data.metadata?.failureKind,
            rawError: data,
        });
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
    /** Hidden execution context injected for a specific tool call. */
    prepareToolExecution?: (input: {
        fn: ToolRegistryReadModel;
        toolCall: ParsedToolCall;
        iteration: number;
    }) => {
        args?: Record<string, unknown>;
        privateContext?: Record<string, unknown>;
    };
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
    const { authToken, onEvent, prepareToolExecution } = options;
    const toolCallLog: ToolCallRecord[] = [];
    const traceLog: string[] = [];
    let history: ChatMessage[] = [...messages];
    const runtimeFunctions: ToolRegistryReadModel[] = functions.map((fn) => (
        'description' in fn && 'inputSchema' in fn && 'isEnabled' in fn && !('_id' in fn)
            ? fn as ToolRegistryReadModel
            : mapUserFunctionToToolRegistry(fn as UserFunction)
    ));
    const recentToolCallsBySignature = new Map<string, ToolCallRecord>();

    for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
        onEvent?.({ type: 'llm_start', iteration });

        const request: LLMRequest = {
            messages: history,
            functions: runtimeFunctions,
            systemPrompt,
        };

        const response = await adapter.complete(request);

        if (response.parseTrace) {
            traceLog.push(`llm.parse.${response.parseTrace.status}.${response.parseTrace.strategy}`);
        }

        onEvent?.({ type: 'llm_done', iteration, response: response.content });

        if (response.finishReason === 'error') {
            if (response.parseTrace?.status === 'invalid_tool_call') {
                onEvent?.({
                    type: 'tool_protocol_violation',
                    iteration,
                    traceMessage: response.parseTrace.message,
                });
            }

            return {
                finalResponse: `[Erreur LLM] ${response.terminalError?.message ?? response.rawContent ?? 'Unknown error'}`,
                toolCallLog,
                iterations: iteration,
                finishReason: 'error',
                terminalError: response.terminalError,
                traceLog,
            };
        }

        // No tool calls → final response
        if (!response.toolCalls || response.toolCalls.length === 0) {
            if (!response.content.trim()) {
                const postToolFallback = buildPostToolEmptyResponseFallback(history, toolCallLog);
                if (postToolFallback) {
                    return {
                        finalResponse: postToolFallback.response,
                        toolCallLog,
                        iterations: iteration,
                        finishReason: 'stop',
                        traceLog: [...traceLog, postToolFallback.traceKey],
                    };
                }

                const fallbackToolCall = buildEmptyResponseFallbackToolCall(history, runtimeFunctions);
                if (fallbackToolCall) {
                    traceLog.push(`llm.empty_response_fallback.${fallbackToolCall.name}`);
                    response.toolCalls = [fallbackToolCall];
                    response.finishReason = 'tool_calls';
                } else {
                return {
                    ...buildEmptyLocalResponseError(adapter),
                    toolCallLog,
                    iterations: iteration,
                    traceLog: [...traceLog, 'llm.empty_response_without_tool_call'],
                };
                }
            }

            if (!response.toolCalls || response.toolCalls.length === 0) {

            return {
                finalResponse: response.content,
                toolCallLog,
                iterations: iteration,
                finishReason: response.finishReason,
                traceLog,
            };
            }
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
        const executedThisIteration = new Map<string, ToolCallRecord>();
        const iterationRecords: ToolCallRecord[] = [];
        let duplicateDeterministicSuppressions = 0;
        let executedSandboxCalls = 0;

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
                const signature = createToolCallSignature(fn, tc.arguments);
                const now = Date.now();
                const previousIterationRecord = executedThisIteration.get(signature);
                const previousRecentRecord = recentToolCallsBySignature.get(signature);

                if (previousIterationRecord) {
                    record = buildDuplicateSuppressedRecord({
                        fn,
                        toolCall: tc,
                        previous: previousIterationRecord,
                        reason: 'duplicate_same_iteration'
                    });
                } else if (previousRecentRecord && isRecordStillFresh(previousRecentRecord, now) && isDeterministicFailureRecord(previousRecentRecord)) {
                    record = buildDuplicateSuppressedRecord({
                        fn,
                        toolCall: tc,
                        previous: previousRecentRecord,
                        reason: 'duplicate_after_deterministic_failure'
                    });
                    duplicateDeterministicSuppressions += 1;
                } else {
                const preparedExecution = prepareToolExecution?.({
                    fn,
                    toolCall: tc,
                    iteration,
                });
                const executionArgs = preparedExecution?.args ?? tc.arguments;

                try {
                    const { result, durationMs, executionId, runner, exitCode, failureKind, artifacts } = await executeFunction(
                        fn,
                        executionArgs,
                        authToken,
                        preparedExecution?.privateContext
                    );

                    const logicalToolError = fn.name === 'web_search_py'
                        ? classifyWebSearchLogicalFailure(result)
                        : null;
                    if (logicalToolError) {
                        throw logicalToolError;
                    }

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
                    executedSandboxCalls += 1;
                } catch (err) {
                    const toolError = err instanceof ToolExecutionError
                        ? err
                        : new ToolExecutionError(err instanceof Error ? err.message : String(err));

                    record = {
                        id: generateId(),
                        toolId: fn.id,
                        functionId: fn.legacyFunctionId ?? fn.id,
                        functionName: tc.name,
                        arguments: tc.arguments,
                        result: toErrorResultPayload(toolError),
                        status: 'error',
                        durationMs: 0,
                        failureKind: toolError.failureKind,
                        errorCode: toolError.code,
                        errorSubsystem: toolError.subsystem,
                        retryable: toolError.retryable,
                        deterministicFailure: toolError.deterministic,
                        timestamp: new Date(),
                    };
                }
                }

                executedThisIteration.set(signature, record);
                recentToolCallsBySignature.set(signature, record);
            }

            toolCallLog.push(record);
            iterationRecords.push(record);
            onEvent?.({ type: 'tool_call_done', iteration, toolCall: tc, toolResult: record.result });

            // Append tool_result message to history so the LLM can see the output
            history = [
                ...history,
                {
                    id: record.id,
                    sender: 'tool_result',
                    text: toToolResultHistoryPayload(record),
                    toolCallId: record.id,
                    toolName: record.functionName,
                    isError: record.status === 'error',
                    timestamp: record.timestamp,
                } as ChatMessage,
            ];
        }

        const blockingWebSearchFailure = iterationRecords.find((record) => isBlockingWebSearchFailureRecord(record));

        if (blockingWebSearchFailure) {
            return {
                ...buildBlockingWebSearchFailureResponse(blockingWebSearchFailure),
                toolCallLog,
                iterations: iteration,
                traceLog: [...traceLog, 'tool.web_search_py.blocking_failure'],
            };
        }

        if (executedSandboxCalls === 0 && duplicateDeterministicSuppressions > 0) {
            const stopMessage = response.content.trim()
                ? `${response.content}\n\n[Arrêt de sécurité] Appel d'outil identique bloqué après un échec déterministe déjà observé.`
                : `[Arrêt de sécurité] Appel d'outil identique bloqué après un échec déterministe déjà observé.`;

            return {
                finalResponse: stopMessage,
                toolCallLog,
                iterations: iteration,
                finishReason: 'error',
                traceLog,
            };
        }
    }

    onEvent?.({ type: 'max_iterations', iteration: MAX_ITERATIONS });
    return {
        finalResponse: `[Limite atteinte] Le nombre maximum d'itérations (${MAX_ITERATIONS}) a été atteint.`,
        toolCallLog,
        iterations: MAX_ITERATIONS,
        finishReason: 'length',
        traceLog,
    };
}
