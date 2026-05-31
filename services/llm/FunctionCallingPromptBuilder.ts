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

import type { PromptToolReadModel } from '../../types/function.types';

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

function formatFunction(fn: PromptToolReadModel, lang: 'fr' | 'en'): string {
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
 *  4. Return final user-visible text inside `<final_answer>…</final_answer>`.
 *
 * @param functions  List of enabled UserFunctions visible to this agent.
 * @param options    Language + function count overrides.
 * @returns          A self-contained string ready to be appended to the system prompt.
 */
export function buildFunctionCallingPrompt(
    functions: PromptToolReadModel[],
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

Pour répondre sans outil, tu DOIS utiliser EXACTEMENT ce format :

<final_answer>
Réponse utilisateur
</final_answer>

### Règles STRICTES :
1. N'invoque qu'UNE SEULE fonction par bloc <tool_call>
2. Les arguments DOIVENT être du JSON valide
3. Attends le résultat avant de continuer
4. Si une fonction est pertinente, tu DOIS appeler la fonction avant toute réponse finale
5. Pour toute demande web / internet / recherche en ligne, utilise un tool de recherche web si disponible
6. Si une fonction échoue, signale l'échec dans <final_answer> sans inventer de succès
7. N'invente PAS de fonctions qui ne sont pas listées ci-dessous
8. Ne produis aucun texte en dehors de <tool_call> ou <final_answer>
9. Après un tool_result en succès, ton message suivant DOIT être un unique <final_answer> ancré sur la sortie outil
10. Après un tool_result, n'ajoute pas de salutation, relance conversationnelle, emoji, ni texte générique de politesse
11. Après un tool_result, ne prétends pas avoir mémorisé, enregistré ou compris autre chose que ce qui est explicitement présent dans la sortie outil
12. Si la sortie outil suffit, réponds brièvement avec le résultat utile, rien de plus

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

To answer without a tool, you MUST use EXACTLY this format:

<final_answer>
User-facing answer
</final_answer>

### STRICT rules:
1. Invoke ONLY ONE function per <tool_call> block
2. Arguments MUST be valid JSON
3. Wait for the result before continuing
4. If a listed function is relevant, you MUST call it before any final answer
5. For web / internet / online research requests, use a web-search tool when available
6. If a function fails, report the failure in <final_answer> and do not invent success
7. Do NOT invent functions that are not listed below
8. Do not output any text outside <tool_call> or <final_answer>
9. After a successful tool_result, your next message MUST be a single <final_answer> grounded in the tool output
10. After a tool_result, do not add greetings, conversational restarts, emojis, or generic politeness filler
11. After a tool_result, do not claim to remember, store, or infer anything beyond what is explicitly present in the tool output
12. If the tool output is sufficient, answer briefly with the useful result and nothing else

### Available functions:

${functionDocs}
`.trim();
}
