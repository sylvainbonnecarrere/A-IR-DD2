/**
 * services/llm/FunctionCallingPromptBuilder.ts
 *
 * Builds a system-prompt fragment that teaches a local LLM (LMStudio, Ollama, …)
 * how to invoke functions using a structured XML format that ToolCallParser can later decode.
 *
 * Integration point:
 *   LocalLLMAdapter prepends `build(functions)` to the agent's existing system prompt
 *   so that the LLM learns the calling convention without any API-level tool support.
 */

import type { UserFunction } from '../../types/function.types';

export interface PromptBuilderOptions {
    /** UI / hint language.  fr → French labels, anything else → English. */
    language?: 'fr' | 'en';
    /** Hard cap on number of functions emitted in the prompt (default: 20). */
    maxFunctions?: number;
}

// ─── helpers ────────────────────────────────────────────────────────────────

type JSONSchemaProperty = {
    type?: string;
    description?: string;
    example?: unknown;
    default?: unknown;
    enum?: unknown[];
};

type JSONSchema = {
    type?: string;
    properties?: Record<string, JSONSchemaProperty>;
    required?: string[];
};

function defaultForType(type: string): unknown {
    const map: Record<string, unknown> = {
        string: 'example',
        number: 0,
        integer: 0,
        boolean: true,
        array: [],
        object: {},
    };
    return map[type] ?? null;
}

function schemaToExample(schema: JSONSchema | null | undefined): Record<string, unknown> {
    if (!schema?.properties) return {};
    return Object.fromEntries(
        Object.entries(schema.properties).map(([key, val]) => [
            key,
            val.example ?? val.default ?? defaultForType(val.type ?? 'string'),
        ])
    );
}

function formatFunction(fn: UserFunction, lang: 'fr' | 'en'): string {
    const required = (fn.inputSchema as JSONSchema)?.required ?? [];
    const exampleArgs = schemaToExample(fn.inputSchema as JSONSchema);
    const exampleJson = JSON.stringify({ name: fn.name, arguments: exampleArgs }, null, 2);

    const requiredLabel = lang === 'fr' ? 'Paramètres requis' : 'Required parameters';
    const noneLabel = lang === 'fr' ? 'aucun' : 'none';

    return [
        `**${fn.name}**`,
        `Description : ${fn.description}`,
        '```json',
        exampleJson,
        '```',
        `${requiredLabel} : ${required.length > 0 ? required.join(', ') : noneLabel}`,
    ].join('\n');
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Build the system-prompt fragment for function calling.
 *
 * The fragment teaches the LLM to:
 *  1. Wrap every tool invocation in `<tool_call>…</tool_call>` XML tags.
 *  2. Wait for the result before continuing.
 *  3. Only use the listed functions.
 *
 * @param functions  List of enabled UserFunctions visible to this agent.
 * @param options    Language + function count overrides.
 * @returns          A self-contained string ready to be appended to the system prompt.
 */
export function buildFunctionCallingPrompt(
    functions: UserFunction[],
    options: PromptBuilderOptions = {}
): string {
    const { language = 'fr', maxFunctions = 20 } = options;
    const visible = functions.filter(f => f.isEnabled).slice(0, maxFunctions);

    if (visible.length === 0) return '';

    const functionDocs = visible.map(f => formatFunction(f, language)).join('\n\n');

    if (language === 'fr') {
        return `
## CAPACITÉS D'ACTION

Tu as accès aux fonctions suivantes. Pour invoquer une fonction, tu DOIS utiliser EXACTEMENT ce format XML :

<tool_call>
{"name": "NOM_FONCTION", "arguments": {ARGUMENTS_JSON}}
</tool_call>

### Règles STRICTES :
1. N'invoque qu'UNE SEULE fonction par bloc <tool_call>
2. Les arguments DOIVENT être du JSON valide
3. Attends le résultat avant de continuer
4. Si une fonction échoue, explique pourquoi et propose une alternative
5. N'invente PAS de fonctions qui ne sont pas listées ci-dessous

### Fonctions disponibles :

${functionDocs}
`.trim();
    }

    return `
## ACTION CAPABILITIES

You have access to the following functions. To invoke a function, you MUST use EXACTLY this XML format:

<tool_call>
{"name": "FUNCTION_NAME", "arguments": {JSON_ARGUMENTS}}
</tool_call>

### STRICT rules:
1. Invoke ONLY ONE function per <tool_call> block
2. Arguments MUST be valid JSON
3. Wait for the result before continuing
4. If a function fails, explain why and suggest an alternative
5. Do NOT invent functions that are not listed below

### Available functions:

${functionDocs}
`.trim();
}
