/**
 * services/llm/ToolCallParser.ts
 *
 * Parses tool-call invocations embedded in free-text LLM responses.
 * Used by LocalLLMAdapter to emulate native function-calling for providers
 * that do not natively support the OpenAI `tools` API (LMStudio, Ollama, …).
 *
 * 4 strategies tried in priority order:
 *  1. XML tags        : <tool_call>{"name":…,"arguments":{…}}</tool_call>  (confidence 0.95)
 *  2. Markdown fences : ```json\n{"name":…,"arguments":{…}}\n```           (confidence 0.85)
 *  3. Function syntax : name({"arg": value})                               (confidence 0.75)
 *  4. Heuristic JSON  : bare JSON object with "name"+"arguments" keys       (confidence 0.50)
 *
 * Security: the parser never executes any code — it only extracts strings
 * and parses them with JSON.parse / simple string repairs.
 */

export interface ParsedToolCall {
    /** The function name extracted from the LLM response. */
    name: string;
    /** Parsed argument map. */
    arguments: Record<string, unknown>;
    /** Raw matched string (for debug / logging). */
    raw: string;
    /** Parser confidence in the extraction (0–1). */
    confidence: number;
}

export interface ParseResult {
    toolCalls: ParsedToolCall[];
    /** Text found before the first tool call block. */
    textBefore: string;
    /** Text found after the last tool call block. */
    textAfter: string;
    hasToolCalls: boolean;
}

// ─── helpers ────────────────────────────────────────────────────────────────

/**
 * Attempt common JSON repairs on a malformed string:
 *  - single quotes → double quotes
 *  - trailing commas
 * Returns null when repair fails.
 */
function repairJSON(raw: string): ParsedToolCall | null {
    const attempts = [
        raw.replace(/'/g, '"'),
        raw.replace(/,\s*([}\]])/g, '$1'),
        raw.replace(/'/g, '"').replace(/,\s*([}\]])/g, '$1'),
    ];

    for (const attempt of attempts) {
        try {
            const parsed = JSON.parse(attempt);
            if (parsed && typeof parsed.name === 'string') {
                return {
                    name: parsed.name,
                    arguments: parsed.arguments ?? parsed.args ?? parsed.parameters ?? {},
                    raw,
                    confidence: 0.60,
                };
            }
        } catch {
            // try next repair
        }
    }
    return null;
}

// ─── strategy implementations ────────────────────────────────────────────────

function parseXMLTags(response: string): ParseResult {
    const pattern = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
    const toolCalls: ParsedToolCall[] = [];
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(response)) !== null) {
        const raw = match[1].trim();
        try {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed.name === 'string') {
                toolCalls.push({
                    name: parsed.name,
                    arguments: parsed.arguments ?? parsed.args ?? parsed.parameters ?? {},
                    raw,
                    confidence: 0.95,
                });
            }
        } catch {
            const repaired = repairJSON(raw);
            if (repaired) toolCalls.push(repaired);
        }
    }

    let textBefore = response;
    let textAfter = '';
    if (toolCalls.length > 0) {
        const firstIdx = response.indexOf('<tool_call>');
        const lastMatch = [...response.matchAll(/<\/tool_call>/g)];
        const lastEndIdx = lastMatch.length > 0
            ? response.lastIndexOf('</tool_call>') + '</tool_call>'.length
            : firstIdx;
        textBefore = response.slice(0, firstIdx).trim();
        textAfter = response.slice(lastEndIdx).trim();
    }

    return { toolCalls, textBefore, textAfter, hasToolCalls: toolCalls.length > 0 };
}

function parseMarkdownFences(response: string): ParseResult {
    const pattern = /```(?:json)?\s*\n([\s\S]*?)\n```/g;
    const toolCalls: ParsedToolCall[] = [];
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(response)) !== null) {
        const raw = match[1].trim();
        try {
            const parsed = JSON.parse(raw);
            if (
                parsed &&
                typeof parsed.name === 'string' &&
                (parsed.arguments !== undefined || parsed.args !== undefined)
            ) {
                toolCalls.push({
                    name: parsed.name,
                    arguments: parsed.arguments ?? parsed.args ?? {},
                    raw,
                    confidence: 0.85,
                });
            }
        } catch { /* skip invalid JSON blocks */ }
    }

    return { toolCalls, textBefore: response, textAfter: '', hasToolCalls: toolCalls.length > 0 };
}

function parseFunctionSyntax(response: string): ParseResult {
    // Matches: some_function({"key": "value"})
    const pattern = /(\w+(?:\.\w+)*)\s*\(\s*(\{[\s\S]*?\})\s*\)/g;
    const toolCalls: ParsedToolCall[] = [];
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(response)) !== null) {
        try {
            const args = JSON.parse(match[2]);
            toolCalls.push({
                name: match[1],
                arguments: args,
                raw: match[0],
                confidence: 0.75,
            });
        } catch { /* skip */ }
    }

    return { toolCalls, textBefore: response, textAfter: '', hasToolCalls: toolCalls.length > 0 };
}

function parseHeuristicJSON(response: string): ParseResult {
    // Last-resort: look for a JSON object with both "name" and "arguments" keys
    const pattern = /\{[^{}]*"name"\s*:\s*"([^"]+)"[^{}]*"arguments"\s*:\s*(\{[^{}]*\})[^{}]*\}/g;
    const toolCalls: ParsedToolCall[] = [];
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(response)) !== null) {
        try {
            const args = JSON.parse(match[2]);
            toolCalls.push({
                name: match[1],
                arguments: args,
                raw: match[0],
                confidence: 0.50,
            });
        } catch { /* skip */ }
    }

    return { toolCalls, textBefore: response, textAfter: '', hasToolCalls: toolCalls.length > 0 };
}

// ─── Public API ─────────────────────────────────────────────────────────────

const STRATEGIES = [parseXMLTags, parseMarkdownFences, parseFunctionSyntax, parseHeuristicJSON];

/**
 * Parse a raw LLM text response and extract any tool call invocations.
 *
 * Tries four strategies in priority order and returns the first successful result.
 * If no strategy finds a tool call the result has `hasToolCalls: false`.
 */
export function parseToolCalls(response: string): ParseResult {
    for (const strategy of STRATEGIES) {
        const result = strategy(response);
        if (result.hasToolCalls) return result;
    }
    return {
        toolCalls: [],
        textBefore: response,
        textAfter: '',
        hasToolCalls: false,
    };
}
