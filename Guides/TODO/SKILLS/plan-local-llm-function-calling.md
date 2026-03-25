# Plan Exhaustif : Function Calling & Skills pour LLMs Locaux
## Application Multi-LLM (Cloud + Local) — TypeScript / Node / Python / React

> **Audience** : Architectes & développeurs  
> **Problème central** : Les LLMs locaux (via Jan, LM Studio, Ollama) ne supportent pas nativement le function calling ni l'invocation de skills agents, contrairement aux APIs cloud (Anthropic, OpenAI, Gemini).  
> **Objectif** : Concevoir une couche d'abstraction SOLID, évolutive, testable, qui donne aux LLMs locaux exactement les mêmes capacités que les LLMs cloud — sans modifier le code métier ni les skills existants.

---

## Table des Matières

1. [Analyse du Problème](#1-analyse-du-problème)
2. [Architecture Générale — Vue d'Ensemble](#2-architecture-générale--vue-densemble)
3. [Pattern 1 — Prompt Engineering + Parser Structuré (Universelle)](#3-pattern-1--prompt-engineering--parser-structuré-universelle)
4. [Pattern 2 — Grammar / JSON Schema Constrained Decoding](#4-pattern-2--grammar--json-schema-constrained-decoding)
5. [Pattern 3 — ReAct Loop natif en TypeScript](#5-pattern-3--react-loop-natif-en-typescript)
6. [Pattern 4 — Structured Output avec Modèles Fine-tunés](#6-pattern-4--structured-output-avec-modèles-fine-tunés)
7. [Couche d'Abstraction Universelle — LLMAdapter](#7-couche-dabstraction-universelle--llmadapter)
8. [Registre de Fonctions & Skills — FunctionRegistry](#8-registre-de-fonctions--skills--functionregistry)
9. [Execution Engine — ToolExecutor](#9-execution-engine--toolexecutor)
10. [Gestion du Contexte & Mémoire pour LLMs Locaux](#10-gestion-du-contexte--mémoire-pour-llms-locaux)
11. [Intégration Jan / LM Studio / Ollama](#11-intégration-jan--lm-studio--ollama)
12. [Fallback & Routing Intelligent](#12-fallback--routing-intelligent)
13. [Sécurité & Sandboxing](#13-sécurité--sandboxing)
14. [Tests & Observabilité](#14-tests--observabilité)
15. [Implémentation Python Backend](#15-implémentation-python-backend)
16. [Intégration Frontend React](#16-intégration-frontend-react)
17. [Matrice de Compatibilité des Modèles](#17-matrice-de-compatibilité-des-modèles)
18. [Roadmap d'Implémentation](#18-roadmap-dimplémentation)
19. [Annexes](#19-annexes)

---

## 1. Analyse du Problème

### 1.1 Pourquoi les LLMs locaux ne supportent pas nativement le function calling ?

Le function calling "natif" des APIs cloud repose sur **trois mécanismes distincts** que les serveurs locaux n'implémentent pas toujours :

| Mécanisme | APIs Cloud | Ollama | LM Studio | Jan |
|-----------|-----------|--------|-----------|-----|
| **Special tokens** `<tool_call>` | ✅ Injectés par le backend | ⚠️ Selon modèle | ⚠️ Selon modèle | ⚠️ Selon modèle |
| **Grammar-constrained decoding** | ✅ Backend géré | ✅ `/api/generate` avec `grammar` | ✅ Via llama.cpp | ❌ Limité |
| **Parsing de la réponse + retry** | ✅ Côté provider | ❌ À implémenter | ❌ À implémenter | ❌ À implémenter |
| **Format OpenAI tool_calls** | ✅ Natif | ⚠️ Support partiel | ✅ Bon support | ⚠️ Partiel |
| **Multi-turn tool result** | ✅ Natif | ⚠️ Selon modèle | ⚠️ Selon modèle | ❌ Limité |

### 1.2 Racine du problème : 3 niveaux de défaillance

```
Niveau 1 — FORMAT : Le modèle ne sait pas générer du JSON valide pour un tool call
Niveau 2 — PROTOCOL : Le serveur local ne gère pas les messages tool/tool_result
Niveau 3 — EXECUTION : Même si le JSON est généré, rien ne l'exécute côté app
```

### 1.3 Contraintes à respecter

- **Rétrocompatibilité** : le code qui utilise les LLMs cloud ne doit pas changer
- **Évolutivité** : ajouter un nouveau LLM local = 1 fichier d'adaptateur
- **Dégradation gracieuse** : si le LLM local échoue à générer un tool call valide, fallback sans crasher
- **Performance** : overhead de la couche d'abstraction < 50ms
- **SOLID** : chaque composant a une seule responsabilité, interfaces bien définies

---

## 2. Architecture Générale — Vue d'Ensemble

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         APPLICATION LAYER                                │
│                   (Agents, Skills, Business Logic)                       │
└────────────────────────────┬────────────────────────────────────────────┘
                             │ Appels via interface AgentLLM
┌────────────────────────────▼────────────────────────────────────────────┐
│                      UNIVERSAL LLM ADAPTER                               │
│                                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌────────────┐  │
│  │ AnthropicAdap│  │ OpenAIAdapter │  │ OllamaAdapter│  │ LMStudioAd │  │
│  │ (natif FC)   │  │ (natif FC)   │  │ (émulé FC)   │  │ (émulé FC) │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  └────────────┘  │
└────────────────────────────┬────────────────────────────────────────────┘
                             │
        ┌────────────────────┼────────────────────┐
        ▼                    ▼                    ▼
┌───────────────┐  ┌─────────────────┐  ┌────────────────────┐
│ FunctionRegistry│  │  ToolExecutor   │  │  ContextManager    │
│ (TypeScript + │  │  (Node + Python) │  │  (Mémoire locale)  │
│  Python skills)│  └────────┬────────┘  └────────────────────┘
└───────────────┘           │
                  ┌─────────┼─────────┐
                  ▼         ▼         ▼
           ┌──────────┐ ┌───────┐ ┌───────────┐
           │TS Function│ │Python │ │HTTP Skill │
           │  Handler  │ │Runner │ │ (externe) │
           └──────────┘ └───────┘ └───────────┘
```

### 2.1 Principe SOLID appliqué

| Principe | Application |
|----------|-------------|
| **S** — Single Responsibility | `LLMAdapter` ne fait que la communication LLM. `ToolExecutor` ne fait qu'exécuter. `FunctionRegistry` ne fait que gérer les définitions. |
| **O** — Open/Closed | Ajouter un LLM = implémenter `ILLMAdapter`, zéro modification existante |
| **L** — Liskov Substitution | Tout adaptateur peut remplacer n'importe quel autre sans impact |
| **I** — Interface Segregation | `ILLMAdapter`, `IToolExecutor`, `IFunctionRegistry` séparés |
| **D** — Dependency Inversion | L'agent dépend des interfaces, jamais des implémentations concrètes |

---

## 3. Pattern 1 — Prompt Engineering + Parser Structuré (Universelle)

> **Recommandé comme base de tous les autres patterns.** Fonctionne avec 100% des LLMs locaux, même les plus basiques.

### 3.1 Principe

Au lieu de s'appuyer sur le mécanisme natif de function calling, on **injecte les définitions de fonctions dans le system prompt** et on **parse la réponse texte** pour extraire les appels de fonctions.

```
System Prompt = "Tu es un agent. Voici les fonctions disponibles : [JSON Schema]
                 Pour appeler une fonction, écris EXACTEMENT :
                 <tool_call>{"name": "...", "arguments": {...}}</tool_call>"

User : "Génère un rapport Word sur les ventes Q3"

LLM Response : "Je vais générer ce rapport pour vous.
                <tool_call>{"name": "document.generate.docx", "arguments": {"title": "Rapport Ventes Q3", "sections": [...]}}</tool_call>"

Parser : extrait le JSON → valide → exécute → renvoie résultat au LLM
```

### 3.2 Implémentation TypeScript — System Prompt Builder

```typescript
// src/llm/prompt-builders/function-calling-prompt.builder.ts

import { FunctionDefinition } from '../types/function.types';

export class FunctionCallingPromptBuilder {
  
  /**
   * Construit le system prompt qui enseigne au LLM local
   * comment appeler des fonctions via du texte structuré.
   */
  static build(
    functions: FunctionDefinition[],
    options: PromptBuilderOptions = {}
  ): string {
    const { language = 'fr', maxFunctions = 20, exampleCount = 2 } = options;

    const functionDocs = functions
      .slice(0, maxFunctions)
      .map(fn => this.formatFunction(fn))
      .join('\n\n');

    const examples = this.buildExamples(functions.slice(0, exampleCount));

    return `
## CAPACITÉS D'ACTION

Tu as accès aux fonctions suivantes. Pour invoquer une fonction, tu DOIS utiliser EXACTEMENT ce format :

<tool_call>
{"name": "NOM_FONCTION", "arguments": {ARGUMENTS_JSON}}
</tool_call>

### Règles STRICTES :
1. N'invoque UNE SEULE fonction par bloc <tool_call>
2. Les arguments DOIVENT être du JSON valide
3. Attends le résultat avant de continuer
4. Si une fonction échoue, explique pourquoi et propose une alternative
5. N'invente PAS de fonctions qui ne sont pas listées ci-dessous

### Fonctions disponibles :

${functionDocs}

### Exemples d'invocation :

${examples}

---
`.trim();
  }

  private static formatFunction(fn: FunctionDefinition): string {
    return `**${fn.name}**
Description : ${fn.description}
\`\`\`json
${JSON.stringify({
  name: fn.name,
  arguments: this.schemaToExample(fn.inputSchema)
}, null, 2)}
\`\`\`
Paramètres requis : ${fn.required?.join(', ') || 'aucun'}
Retourne : ${fn.outputDescription || 'Résultat de l\'opération'}`;
  }

  private static buildExamples(fns: FunctionDefinition[]): string {
    return fns.map(fn => `
User: "${fn.exampleQuery || 'Exemple d\'utilisation'}"
Assistant: Je vais utiliser ${fn.name} pour répondre à votre demande.
<tool_call>
${JSON.stringify({ name: fn.name, arguments: fn.exampleArguments || {} }, null, 2)}
</tool_call>
`).join('\n');
  }

  private static schemaToExample(schema: JSONSchema): Record<string, unknown> {
    // Génère un exemple minimal depuis le JSON Schema
    if (!schema?.properties) return {};
    return Object.fromEntries(
      Object.entries(schema.properties).map(([key, val]: [string, any]) => [
        key,
        val.example ?? val.default ?? this.defaultForType(val.type)
      ])
    );
  }

  private static defaultForType(type: string): unknown {
    const defaults: Record<string, unknown> = {
      string: 'exemple',
      number: 0,
      integer: 0,
      boolean: true,
      array: [],
      object: {}
    };
    return defaults[type] ?? null;
  }
}
```

### 3.3 Parser de Tool Calls

```typescript
// src/llm/parsers/tool-call.parser.ts

export interface ParsedToolCall {
  name: string;
  arguments: Record<string, unknown>;
  raw: string;
  confidence: number; // 0-1
}

export interface ParseResult {
  toolCalls: ParsedToolCall[];
  textBefore: string;
  textAfter: string;
  hasToolCalls: boolean;
}

export class ToolCallParser {
  
  // Stratégies de parsing par ordre de priorité
  private static STRATEGIES = [
    ToolCallParser.parseXMLTags,        // <tool_call>...</tool_call>
    ToolCallParser.parseMarkdownFences,  // ```json\n{"name":...}\n```
    ToolCallParser.parseFunctionSyntax,  // function_name(args)
    ToolCallParser.parseHeuristicJSON,   // JSON brut dans la réponse (dernier recours)
  ];

  static parse(response: string): ParseResult {
    for (const strategy of this.STRATEGIES) {
      const result = strategy(response);
      if (result.hasToolCalls) return result;
    }
    return { toolCalls: [], textBefore: response, textAfter: '', hasToolCalls: false };
  }

  private static parseXMLTags(response: string): ParseResult {
    const pattern = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
    const toolCalls: ParsedToolCall[] = [];
    let textBefore = response;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(response)) !== null) {
      try {
        const parsed = JSON.parse(match[1].trim());
        if (parsed.name && typeof parsed.name === 'string') {
          toolCalls.push({
            name: parsed.name,
            arguments: parsed.arguments ?? parsed.args ?? parsed.parameters ?? {},
            raw: match[1],
            confidence: 0.95
          });
        }
      } catch {
        // JSON invalide — on tente une réparation
        const repaired = ToolCallParser.repairJSON(match[1]);
        if (repaired) toolCalls.push({ ...repaired, confidence: 0.7 });
      }
    }

    if (toolCalls.length > 0) {
      const firstMatch = response.indexOf('<tool_call>');
      textBefore = response.slice(0, firstMatch).trim();
    }

    return { toolCalls, textBefore, textAfter: '', hasToolCalls: toolCalls.length > 0 };
  }

  private static parseMarkdownFences(response: string): ParseResult {
    // Cherche ```json\n{"name": "...", ...}\n```
    const pattern = /```(?:json)?\s*\n([\s\S]*?)\n```/g;
    const toolCalls: ParsedToolCall[] = [];
    let match: RegExpExecArray | null;
    
    while ((match = pattern.exec(response)) !== null) {
      try {
        const parsed = JSON.parse(match[1]);
        if (parsed.name && (parsed.arguments || parsed.args)) {
          toolCalls.push({
            name: parsed.name,
            arguments: parsed.arguments ?? parsed.args ?? {},
            raw: match[1],
            confidence: 0.85
          });
        }
      } catch { /* skip */ }
    }

    return { toolCalls, textBefore: response, textAfter: '', hasToolCalls: toolCalls.length > 0 };
  }

  private static parseFunctionSyntax(response: string): ParseResult {
    // Capture : generate_document({"title": "...", ...})
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
          confidence: 0.75
        });
      } catch { /* skip */ }
    }

    return { toolCalls, textBefore: response, textAfter: '', hasToolCalls: toolCalls.length > 0 };
  }

  private static parseHeuristicJSON(response: string): ParseResult {
    // Dernier recours : cherche un JSON avec "name" et "arguments"
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
          confidence: 0.5 // Faible confiance
        });
      } catch { /* skip */ }
    }

    return { toolCalls, textBefore: response, textAfter: '', hasToolCalls: toolCalls.length > 0 };
  }

  /**
   * Tente de réparer un JSON malformé courant :
   * - Guillemets simples → doubles
   * - Virgules trailing
   * - Clés non quotées
   */
  static repairJSON(raw: string): ParsedToolCall | null {
    try {
      // Tentative 1 : guillemets simples
      const fixed1 = raw.replace(/'/g, '"');
      const parsed1 = JSON.parse(fixed1);
      if (parsed1.name) return { name: parsed1.name, arguments: parsed1.arguments ?? {}, raw, confidence: 0.6 };
    } catch { /* continue */ }

    try {
      // Tentative 2 : trailing commas
      const fixed2 = raw.replace(/,\s*([}\]])/g, '$1');
      const parsed2 = JSON.parse(fixed2);
      if (parsed2.name) return { name: parsed2.name, arguments: parsed2.arguments ?? {}, raw, confidence: 0.6 };
    } catch { /* continue */ }

    return null;
  }
}
```

### 3.4 Multi-turn Loop : Gestion du Cycle Complet

```typescript
// src/llm/loops/agent-loop.ts

export class AgentLoop {
  private maxIterations = 10;

  constructor(
    private adapter: ILLMAdapter,
    private executor: IToolExecutor,
    private registry: IFunctionRegistry
  ) {}

  async run(
    userMessage: string,
    context: AgentContext,
    onEvent?: (event: AgentLoopEvent) => void
  ): Promise<AgentLoopResult> {
    
    const messages: Message[] = [
      ...context.history,
      { role: 'user', content: userMessage }
    ];

    let iteration = 0;
    const toolCallLog: ToolCallRecord[] = [];

    while (iteration < this.maxIterations) {
      iteration++;

      // Appel LLM (natif ou émulé selon l'adaptateur)
      const response = await this.adapter.complete({
        messages,
        functions: this.registry.getAll(),
        systemPrompt: context.systemPrompt
      });

      onEvent?.({ type: 'llm_response', response, iteration });

      // Parse des tool calls (natif ou via parser texte)
      const toolCalls = response.toolCalls ?? [];

      // Pas de tool call → réponse finale
      if (toolCalls.length === 0) {
        return {
          finalResponse: response.content,
          toolCallLog,
          iterations: iteration,
          messages: [...messages, { role: 'assistant', content: response.content }]
        };
      }

      // Exécution des tool calls
      const toolResults: ToolResult[] = [];
      for (const tc of toolCalls) {
        onEvent?.({ type: 'tool_call_start', toolCall: tc });
        
        const result = await this.executor.execute(tc.name, tc.arguments, context);
        toolCallLog.push({ toolCall: tc, result, timestamp: Date.now() });
        toolResults.push({ toolCallId: tc.id ?? tc.name, result });

        onEvent?.({ type: 'tool_call_complete', toolCall: tc, result });
      }

      // Ajout des messages pour le prochain tour
      messages.push({ role: 'assistant', content: response.content, toolCalls });
      messages.push({ role: 'tool', content: this.formatToolResults(toolResults) });
    }

    throw new AgentLoopError(`Max iterations (${this.maxIterations}) reached`);
  }

  private formatToolResults(results: ToolResult[]): string {
    return results.map(r =>
      `[Résultat de ${r.toolCallId}]:\n${JSON.stringify(r.result, null, 2)}`
    ).join('\n\n');
  }
}
```

---

## 4. Pattern 2 — Grammar / JSON Schema Constrained Decoding

> **Le plus fiable pour les LLMs locaux qui le supportent.** Force le modèle à générer du JSON valide au niveau du token sampling.

### 4.1 Principe

llama.cpp (qui propulse Ollama, LM Studio, Jan) supporte la **grammar-constrained decoding** : on passe une grammaire BNF (GBNF) ou un JSON Schema au sampler. Le modèle ne peut physiquement pas générer de tokens qui violeraient la grammaire.

```
Sans grammar : LLM génère librement → peut produire du JSON invalide
Avec grammar : Le sampler masque les tokens invalides → JSON toujours valide
```

### 4.2 Génération de Grammaire GBNF depuis JSON Schema

```typescript
// src/llm/grammar/json-schema-to-gbnf.ts

/**
 * Convertit un JSON Schema en grammaire GBNF compatible llama.cpp
 * Source de référence : https://github.com/ggerganov/llama.cpp/blob/master/grammars/
 */
export class JSONSchemaToGBNF {
  
  static convert(schema: JSONSchema, functionNames: string[]): string {
    const nameEnum = functionNames.map(n => `"${n}"`).join(' | ');
    
    return `
# Grammaire pour tool call structuré
root   ::= tool-call
tool-call ::= "{" ws "\\"name\\"" ws ":" ws name ws "," ws "\\"arguments\\"" ws ":" ws arguments ws "}"
name   ::= ${nameEnum}
arguments ::= object
${this.schemaToGBNF(schema)}
object ::= "{" ws (string ws ":" ws value (ws "," ws string ws ":" ws value)*)? ws "}"
array  ::= "[" ws (value (ws "," ws value)*)? ws "]"
value  ::= object | array | string | number | boolean | null
string ::= "\\"" ([^"\\\\] | "\\\\" .)* "\\""
number ::= "-"? ([0-9] | [1-9] [0-9]*) ("." [0-9]+)? (([eE] [+-]? [0-9]+))?
boolean ::= "true" | "false"
null   ::= "null"
ws     ::= [ \\t\\n\\r]*
`.trim();
  }

  private static schemaToGBNF(schema: JSONSchema): string {
    // Convertit récursivement le JSON Schema en règles GBNF
    if (!schema.properties) return '';
    
    const rules = Object.entries(schema.properties).map(([key, prop]: [string, any]) => {
      if (prop.type === 'string' && prop.enum) {
        const enumVals = prop.enum.map((v: string) => `"${v}"`).join(' | ');
        return `${key}-val ::= ${enumVals}`;
      }
      return `${key}-val ::= value`; // Fallback générique
    });

    return rules.join('\n');
  }
}
```

### 4.3 Utilisation avec Ollama

```typescript
// src/llm/adapters/ollama.adapter.ts (section grammar)

async completeWithGrammar(
  messages: Message[],
  functions: FunctionDefinition[]
): Promise<LLMResponse> {
  
  const grammar = JSONSchemaToGBNF.convert(
    this.buildToolCallSchema(functions),
    functions.map(f => f.name)
  );

  // Deux modes selon l'endpoint Ollama
  if (this.config.useGenerateEndpoint) {
    // /api/generate — support grammar natif
    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      body: JSON.stringify({
        model: this.model,
        prompt: this.messagesToPrompt(messages),
        grammar,           // ← Grammar GBNF
        stream: false,
        options: {
          temperature: 0.1, // Basse température pour les tool calls
          top_p: 0.95,
        }
      })
    });
    return this.parseGenerateResponse(await response.json());

  } else {
    // /api/chat — format OpenAI compatible, grammar dans options
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      body: JSON.stringify({
        model: this.model,
        messages: this.formatMessages(messages),
        format: 'json',   // Force JSON output (moins précis que grammar)
        stream: false,
        options: { temperature: 0.1 }
      })
    });
    return this.parseChatResponse(await response.json());
  }
}

private buildToolCallSchema(functions: FunctionDefinition[]): JSONSchema {
  return {
    type: 'object',
    required: ['name', 'arguments'],
    properties: {
      name: {
        type: 'string',
        enum: functions.map(f => f.name)
      },
      arguments: {
        type: 'object'
      }
    }
  };
}
```

### 4.4 Utilisation avec LM Studio

```typescript
// LM Studio expose une API OpenAI-compatible avec response_format

const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
  method: 'POST',
  body: JSON.stringify({
    model: this.model,
    messages,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'tool_call',
        strict: true,
        schema: this.buildToolCallSchema(functions)
      }
    },
    temperature: 0.1
  })
});
```

---

## 5. Pattern 3 — ReAct Loop Natif en TypeScript

> **Idéal pour les agents complexes.** Le pattern ReAct (Reasoning + Acting) structure explicitement le raisonnement du LLM avant chaque action.

### 5.1 Principe du ReAct

```
Thought: Je dois générer un rapport Word. J'utilise document.generate.docx.
Action: document.generate.docx
Action Input: {"title": "Rapport Q3", "sections": [...]}
Observation: {"file_url": "https://...", "page_count": 5}
Thought: Le fichier a été généré avec succès.
Final Answer: Votre rapport est disponible ici : [lien]
```

### 5.2 Implémentation ReAct

```typescript
// src/llm/loops/react-loop.ts

export class ReActLoop {
  private THOUGHT_PATTERN = /Thought:\s*(.*?)(?=Action:|Final Answer:|$)/s;
  private ACTION_PATTERN = /Action:\s*([\w.]+)/;
  private ACTION_INPUT_PATTERN = /Action Input:\s*([\s\S]*?)(?=Observation:|Thought:|Final Answer:|$)/;
  private FINAL_ANSWER_PATTERN = /Final Answer:\s*([\s\S]*?)$/;

  constructor(
    private adapter: ILLMAdapter,
    private executor: IToolExecutor,
    private registry: IFunctionRegistry
  ) {}

  private buildReActPrompt(functions: FunctionDefinition[]): string {
    const toolDescs = functions.map(f => 
      `${f.name}: ${f.description}`
    ).join('\n');

    return `Tu es un assistant capable d'agir. Utilise ce format STRICT :

Thought: [Ton raisonnement sur ce que tu dois faire]
Action: [Nom exact de l'action à effectuer, parmi : ${functions.map(f => f.name).join(', ')}]
Action Input: [Arguments JSON pour l'action]
Observation: [Résultat de l'action - fourni par le système]
... (répéter Thought/Action/Observation si nécessaire)
Final Answer: [Ta réponse finale à l'utilisateur]

Outils disponibles :
${toolDescs}

Important :
- Utilise TOUJOURS le format ci-dessus
- N'invente pas de résultats pour Observation
- Final Answer signifie que tu as terminé
`;
  }

  async run(userMessage: string, context: AgentContext): Promise<string> {
    const functions = this.registry.getAll();
    const systemPrompt = this.buildReActPrompt(functions);
    
    let prompt = userMessage;
    const conversationHistory: string[] = [];
    let iterations = 0;
    const maxIterations = 8;

    while (iterations < maxIterations) {
      iterations++;

      const response = await this.adapter.complete({
        messages: [{ role: 'user', content: prompt }],
        systemPrompt,
        functions: [], // Pas de function calling natif en ReAct
        stopSequences: ['Observation:'] // S'arrête avant Observation pour qu'on l'injecte
      });

      const rawText = response.content;
      conversationHistory.push(rawText);

      // Vérification Final Answer
      const finalMatch = this.FINAL_ANSWER_PATTERN.exec(rawText);
      if (finalMatch) return finalMatch[1].trim();

      // Extraction Thought + Action
      const actionMatch = this.ACTION_PATTERN.exec(rawText);
      const actionInputMatch = this.ACTION_INPUT_PATTERN.exec(rawText);

      if (!actionMatch) {
        // Le LLM n'a pas suivi le format — forcer une réponse finale
        return rawText;
      }

      const actionName = actionMatch[1].trim();
      let actionInput: Record<string, unknown> = {};

      if (actionInputMatch) {
        try {
          actionInput = JSON.parse(actionInputMatch[1].trim());
        } catch {
          actionInput = { raw: actionInputMatch[1].trim() };
        }
      }

      // Exécution de l'action
      const observation = await this.executor.execute(actionName, actionInput, context);
      
      // Injection de l'Observation dans le prochain prompt
      prompt = `${userMessage}\n\n${conversationHistory.join('\n')}\nObservation: ${JSON.stringify(observation)}\n`;
    }

    throw new Error('ReAct max iterations reached');
  }
}
```

---

## 6. Pattern 4 — Structured Output avec Modèles Fine-tunés

> **Solution la plus puissante à long terme.** Utilise des modèles qui ont été fine-tunés pour le function calling.

### 6.1 Modèles Recommandés avec Function Calling Local

| Modèle | Taille | FC Support | Notes |
|--------|--------|-----------|-------|
| **Mistral 7B Instruct v0.3** | 7B | ✅ Natif | Format `[TOOL_CALLS]` |
| **Mistral NeMo Instruct** | 12B | ✅ Natif | Meilleur rapport qualité/taille |
| **Llama 3.1 8B Instruct** | 8B | ✅ Natif | Format `<tool_call>` |
| **Llama 3.1 70B Instruct** | 70B | ✅ Natif | Meilleur qualité, GPU requis |
| **Qwen2.5 7B Instruct** | 7B | ✅ Natif | Excellent pour code + FC |
| **Qwen2.5 14B Instruct** | 14B | ✅ Natif | Très bon compromis |
| **Hermes 2 Pro** | 7B/13B | ✅ Natif | Optimisé FC, format OpenAI |
| **Functionary** | 7B/13B | ✅ Natif | Spécialisé function calling |
| **xTuner/Mistral-7B-FC** | 7B | ✅ Natif | Fine-tuné FC spécifique |
| **gemma2:9b** | 9B | ⚠️ Partiel | Avec prompt engineering |

### 6.2 Template de Prompt par Modèle

```typescript
// src/llm/templates/model-prompt-templates.ts

export const MODEL_TEMPLATES: Record<string, ModelTemplate> = {
  'mistral': {
    toolCallFormat: '[TOOL_CALLS] [{"name": "FUNC", "arguments": {}}]',
    systemWrapper: (system: string) => `[INST] ${system} [/INST]`,
    userWrapper: (msg: string) => `[INST] ${msg} [/INST]`,
    parseToolCall: (response: string) => {
      const match = /\[TOOL_CALLS\]\s*(\[[\s\S]*?\])/g.exec(response);
      if (!match) return null;
      const calls = JSON.parse(match[1]);
      return calls.map((c: any) => ({ name: c.name, arguments: c.arguments }));
    }
  },

  'llama3': {
    toolCallFormat: '<tool_call>\n{"name": "FUNC", "arguments": {}}\n</tool_call>',
    systemWrapper: (system: string) => 
      `<|start_header_id|>system<|end_header_id|>\n${system}<|eot_id|>`,
    userWrapper: (msg: string) => 
      `<|start_header_id|>user<|end_header_id|>\n${msg}<|eot_id|>\n<|start_header_id|>assistant<|end_header_id|>`,
    parseToolCall: (response: string) => {
      const parser = new ToolCallParser();
      return parser.parse(response).toolCalls;
    }
  },

  'qwen': {
    toolCallFormat: '<tool_call>\n{"name": "FUNC", "arguments": {}}\n</tool_call>',
    systemWrapper: (system: string) => `<|im_start|>system\n${system}<|im_end|>`,
    userWrapper: (msg: string) => `<|im_start|>user\n${msg}<|im_end|>\n<|im_start|>assistant\n`,
    parseToolCall: (response: string) => {
      const match = /<tool_call>([\s\S]*?)<\/tool_call>/g.exec(response);
      if (!match) return null;
      const parsed = JSON.parse(match[1]);
      return [{ name: parsed.name, arguments: parsed.arguments }];
    }
  },

  'hermes': {
    toolCallFormat: '<tool_call>\n{"name": "FUNC", "arguments": {}}\n</tool_call>',
    systemWrapper: (system: string) => `<|im_start|>system\n${system}<|im_end|>`,
    userWrapper: (msg: string) => `<|im_start|>user\n${msg}<|im_end|>\n<|im_start|>assistant\n`,
    parseToolCall: (response: string) => {
      // Hermes utilise le même format que Qwen/ChatML
      const matches = [...response.matchAll(/<tool_call>([\s\S]*?)<\/tool_call>/g)];
      return matches.map(m => JSON.parse(m[1]));
    }
  }
};
```

### 6.3 Auto-détection du Template

```typescript
// src/llm/templates/template-detector.ts

export class ModelTemplateDetector {
  
  static detect(modelName: string): ModelTemplate {
    const lower = modelName.toLowerCase();
    
    if (lower.includes('mistral') || lower.includes('mixtral')) return MODEL_TEMPLATES.mistral;
    if (lower.includes('llama-3') || lower.includes('llama3')) return MODEL_TEMPLATES.llama3;
    if (lower.includes('qwen')) return MODEL_TEMPLATES.qwen;
    if (lower.includes('hermes')) return MODEL_TEMPLATES.hermes;
    if (lower.includes('phi')) return MODEL_TEMPLATES.phi;
    
    // Fallback : template générique avec prompt engineering
    return MODEL_TEMPLATES.generic;
  }

  // Détection automatique via API Ollama
  static async detectFromAPI(baseUrl: string, modelName: string): Promise<ModelTemplate> {
    try {
      const info = await fetch(`${baseUrl}/api/show`, {
        method: 'POST',
        body: JSON.stringify({ name: modelName })
      }).then(r => r.json());
      
      const template = info.template ?? '';
      const family = info.details?.family ?? '';
      
      if (template.includes('[TOOL_CALLS]')) return MODEL_TEMPLATES.mistral;
      if (template.includes('<tool_call>')) return MODEL_TEMPLATES.llama3;
      if (template.includes('im_start')) return MODEL_TEMPLATES.qwen;
      
      return this.detect(modelName);
    } catch {
      return this.detect(modelName);
    }
  }
}
```

---

## 7. Couche d'Abstraction Universelle — LLMAdapter

### 7.1 Interface Commune

```typescript
// src/llm/interfaces/llm-adapter.interface.ts

export interface ILLMAdapter {
  readonly name: string;
  readonly supportsNativeFunctionCalling: boolean;
  readonly supportedModalities: Modality[];

  complete(request: CompletionRequest): Promise<LLMResponse>;
  stream(request: CompletionRequest): AsyncIterable<LLMStreamChunk>;
  getModels(): Promise<string[]>;
  healthCheck(): Promise<boolean>;
}

export interface CompletionRequest {
  messages: Message[];
  functions?: FunctionDefinition[];
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  stopSequences?: string[];
  responseFormat?: 'text' | 'json';
}

export interface LLMResponse {
  content: string;
  toolCalls?: ToolCall[];
  usage?: TokenUsage;
  model: string;
  finishReason: 'stop' | 'tool_use' | 'length' | 'error';
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  confidence?: number;
}
```

### 7.2 Adaptateur Ollama Complet

```typescript
// src/llm/adapters/ollama.adapter.ts

import { ILLMAdapter, CompletionRequest, LLMResponse } from '../interfaces/llm-adapter.interface';
import { ToolCallParser } from '../parsers/tool-call.parser';
import { FunctionCallingPromptBuilder } from '../prompt-builders/function-calling-prompt.builder';
import { ModelTemplateDetector } from '../templates/template-detector';

export interface OllamaAdapterConfig {
  baseUrl: string;            // ex: http://localhost:11434
  model: string;              // ex: llama3.1:8b
  useNativeFC?: boolean;      // Tenter le FC natif d'abord
  useGrammar?: boolean;       // Utiliser grammar-constrained decoding
  fallbackToPromptEngineering?: boolean; // Fallback si FC natif échoue
  timeout?: number;
}

export class OllamaAdapter implements ILLMAdapter {
  readonly name = 'ollama';
  readonly supportedModalities: Modality[] = ['text'];
  
  private template: ModelTemplate;
  private _supportsNativeFC = false;

  constructor(private config: OllamaAdapterConfig) {}

  get supportsNativeFunctionCalling(): boolean {
    return this._supportsNativeFC;
  }

  async initialize(): Promise<void> {
    this.template = await ModelTemplateDetector.detectFromAPI(
      this.config.baseUrl,
      this.config.model
    );
    this._supportsNativeFC = await this.probeNativeFunctionCalling();
  }

  async complete(request: CompletionRequest): Promise<LLMResponse> {
    // Stratégie 1 : FC natif (si modèle supporte + config activée)
    if (this.config.useNativeFC && this._supportsNativeFC && request.functions?.length) {
      const result = await this.completeWithNativeFC(request);
      if (result.toolCalls?.length || result.finishReason !== 'error') {
        return result;
      }
    }

    // Stratégie 2 : Grammar-constrained decoding
    if (this.config.useGrammar && request.functions?.length) {
      const result = await this.completeWithGrammar(request);
      if (result.finishReason !== 'error') return result;
    }

    // Stratégie 3 : Prompt engineering + parsing (fallback universel)
    return this.completeWithPromptEngineering(request);
  }

  private async completeWithNativeFC(request: CompletionRequest): Promise<LLMResponse> {
    try {
      const tools = request.functions?.map(fn => ({
        type: 'function' as const,
        function: {
          name: fn.name,
          description: fn.description,
          parameters: fn.inputSchema
        }
      }));

      const body = {
        model: this.config.model,
        messages: this.formatMessagesForModel(request.messages, request.systemPrompt),
        tools,
        stream: false,
        options: {
          temperature: request.temperature ?? 0.7,
          num_predict: request.maxTokens ?? 4096
        }
      };

      const response = await this.post('/api/chat', body);
      return this.parseOllamaToolResponse(response);

    } catch (error) {
      return { content: '', finishReason: 'error', model: this.config.model };
    }
  }

  private async completeWithGrammar(request: CompletionRequest): Promise<LLMResponse> {
    try {
      const grammar = JSONSchemaToGBNF.convert(
        this.buildFunctionSchema(request.functions!),
        request.functions!.map(f => f.name)
      );

      const prompt = this.buildPrompt(request.messages, request.systemPrompt);

      const response = await this.post('/api/generate', {
        model: this.config.model,
        prompt,
        grammar,
        stream: false,
        options: { temperature: 0.1, top_p: 0.95 }
      });

      const parsed = ToolCallParser.parse(response.response ?? '');
      
      return {
        content: parsed.textBefore,
        toolCalls: parsed.toolCalls.map(tc => ({
          id: `tc_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          name: tc.name,
          arguments: tc.arguments,
          confidence: tc.confidence
        })),
        finishReason: parsed.hasToolCalls ? 'tool_use' : 'stop',
        model: this.config.model
      };

    } catch {
      return { content: '', finishReason: 'error', model: this.config.model };
    }
  }

  private async completeWithPromptEngineering(request: CompletionRequest): Promise<LLMResponse> {
    let systemPrompt = request.systemPrompt ?? '';
    
    // Injecter les définitions de fonctions dans le system prompt
    if (request.functions?.length) {
      const fcPrompt = FunctionCallingPromptBuilder.build(request.functions);
      systemPrompt = `${systemPrompt}\n\n${fcPrompt}`;
    }

    const messages = this.formatMessagesForModel(request.messages, systemPrompt);
    
    const response = await this.post('/api/chat', {
      model: this.config.model,
      messages,
      stream: false,
      options: {
        temperature: request.temperature ?? 0.7,
        stop: request.stopSequences ?? ['</tool_call>', 'Observation:']
      }
    });

    const rawContent = response.message?.content ?? '';
    const parsed = ToolCallParser.parse(rawContent);

    return {
      content: parsed.textBefore || rawContent,
      toolCalls: parsed.hasToolCalls ? parsed.toolCalls.map(tc => ({
        id: `tc_${Date.now()}`,
        name: tc.name,
        arguments: tc.arguments,
        confidence: tc.confidence
      })) : undefined,
      finishReason: parsed.hasToolCalls ? 'tool_use' : 'stop',
      model: this.config.model
    };
  }

  /**
   * Probe pour détecter si le modèle supporte le FC natif
   */
  private async probeNativeFunctionCalling(): Promise<boolean> {
    try {
      const probeResponse = await this.post('/api/chat', {
        model: this.config.model,
        messages: [{ role: 'user', content: 'Hello, réponds juste "OK"' }],
        tools: [{
          type: 'function',
          function: { name: 'test', description: 'test', parameters: { type: 'object', properties: {} } }
        }],
        stream: false
      });
      return !probeResponse.error;
    } catch {
      return false;
    }
  }

  private async post(path: string, body: unknown): Promise<any> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeout ?? 30000);
    
    try {
      const response = await fetch(`${this.config.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      
      if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
      return response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  private formatMessagesForModel(messages: Message[], systemPrompt?: string): any[] {
    const result = [];
    if (systemPrompt) result.push({ role: 'system', content: systemPrompt });
    return [...result, ...messages.map(m => ({ role: m.role, content: m.content }))];
  }

  async stream(request: CompletionRequest): AsyncIterable<LLMStreamChunk> {
    // Implémentation du streaming avec parsing incrémental des tool calls
    const response = await fetch(`${this.config.baseUrl}/api/chat`, {
      method: 'POST',
      body: JSON.stringify({
        model: this.config.model,
        messages: this.formatMessagesForModel(request.messages, request.systemPrompt),
        stream: true
      })
    });

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const chunk = JSON.parse(line);
          yield {
            type: 'text_delta',
            delta: chunk.message?.content ?? '',
            done: chunk.done
          };
        } catch { /* skip malformed */ }
      }
    }
  }

  async getModels(): Promise<string[]> {
    const response = await fetch(`${this.config.baseUrl}/api/tags`).then(r => r.json());
    return response.models?.map((m: any) => m.name) ?? [];
  }

  async healthCheck(): Promise<boolean> {
    try {
      await fetch(`${this.config.baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
      return true;
    } catch { return false; }
  }
}
```

### 7.3 Adaptateur LM Studio

```typescript
// src/llm/adapters/lm-studio.adapter.ts

export class LMStudioAdapter implements ILLMAdapter {
  readonly name = 'lm-studio';
  readonly supportsNativeFunctionCalling = true; // Via format OpenAI
  readonly supportedModalities: Modality[] = ['text', 'image'];

  constructor(private config: { baseUrl: string; model: string; apiKey?: string }) {}

  async complete(request: CompletionRequest): Promise<LLMResponse> {
    const body: any = {
      model: this.config.model,
      messages: this.formatMessages(request),
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens ?? 4096,
      stream: false
    };

    // LM Studio supporte les tools au format OpenAI
    if (request.functions?.length) {
      body.tools = request.functions.map(fn => ({
        type: 'function',
        function: {
          name: fn.name,
          description: fn.description,
          parameters: fn.inputSchema
        }
      }));
      body.tool_choice = 'auto';
    }

    // Structured output via JSON Schema
    if (request.responseFormat === 'json' && request.functions?.length) {
      body.response_format = {
        type: 'json_schema',
        json_schema: {
          name: 'response',
          strict: false,
          schema: this.buildResponseSchema(request.functions)
        }
      };
    }

    const response = await fetch(`${this.config.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.apiKey && { Authorization: `Bearer ${this.config.apiKey}` })
      },
      body: JSON.stringify(body)
    }).then(r => r.json());

    return this.parseOpenAIResponse(response);
  }

  private parseOpenAIResponse(response: any): LLMResponse {
    const choice = response.choices?.[0];
    const message = choice?.message;

    if (message?.tool_calls?.length) {
      return {
        content: message.content ?? '',
        toolCalls: message.tool_calls.map((tc: any) => ({
          id: tc.id,
          name: tc.function.name,
          arguments: JSON.parse(tc.function.arguments ?? '{}')
        })),
        finishReason: 'tool_use',
        model: response.model,
        usage: response.usage
      };
    }

    // Fallback : parser le contenu texte si pas de tool_calls natifs
    const parsed = ToolCallParser.parse(message?.content ?? '');
    return {
      content: parsed.textBefore || message?.content ?? '',
      toolCalls: parsed.hasToolCalls ? parsed.toolCalls.map(tc => ({
        id: `tc_${Date.now()}`,
        name: tc.name,
        arguments: tc.arguments
      })) : undefined,
      finishReason: parsed.hasToolCalls ? 'tool_use' : 'stop',
      model: response.model,
      usage: response.usage
    };
  }

  // ... stream(), getModels(), healthCheck()
}
```

### 7.4 Adaptateur Jan

```typescript
// src/llm/adapters/jan.adapter.ts
// Jan expose une API OpenAI-compatible sur le port 1337

export class JanAdapter implements ILLMAdapter {
  readonly name = 'jan';
  // Jan a un support FC variable selon les modèles installés
  readonly supportsNativeFunctionCalling = false;
  readonly supportedModalities: Modality[] = ['text'];

  constructor(private config: { 
    baseUrl: string;        // Default: http://localhost:1337
    model: string;
    enablePromptFallback: boolean;
  }) {}

  async complete(request: CompletionRequest): Promise<LLMResponse> {
    // Jan : tenter d'abord le format OpenAI tools
    if (request.functions?.length) {
      try {
        const nativeResult = await this.completeWithOpenAITools(request);
        if (nativeResult.toolCalls?.length) return nativeResult;
      } catch { /* fallback */ }
    }

    // Fallback : Prompt Engineering
    return this.completeWithFallback(request);
  }

  private async completeWithOpenAITools(request: CompletionRequest): Promise<LLMResponse> {
    const response = await fetch(`${this.config.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.config.model,
        messages: this.formatMessages(request),
        tools: request.functions?.map(fn => ({
          type: 'function',
          function: { name: fn.name, description: fn.description, parameters: fn.inputSchema }
        })),
        tool_choice: 'auto',
        stream: false
      })
    }).then(r => r.json());

    if (response.error) throw new Error(response.error.message);
    return this.parseOpenAIResponse(response);
  }

  // ... même pattern que OllamaAdapter pour le fallback
}
```

### 7.5 LLM Factory — Point d'Entrée Unique

```typescript
// src/llm/llm.factory.ts

export type LLMProvider = 'anthropic' | 'openai' | 'ollama' | 'lm-studio' | 'jan' | 'azure-openai';

export interface LLMProviderConfig {
  provider: LLMProvider;
  model: string;
  baseUrl?: string;
  apiKey?: string;
  options?: Record<string, unknown>;
}

export class LLMFactory {
  
  static create(config: LLMProviderConfig): ILLMAdapter {
    switch (config.provider) {
      case 'anthropic':
        return new AnthropicAdapter({
          apiKey: config.apiKey ?? process.env.ANTHROPIC_API_KEY!,
          model: config.model
        });

      case 'openai':
        return new OpenAIAdapter({
          apiKey: config.apiKey ?? process.env.OPENAI_API_KEY!,
          model: config.model
        });

      case 'ollama':
        return new OllamaAdapter({
          baseUrl: config.baseUrl ?? 'http://localhost:11434',
          model: config.model,
          useNativeFC: true,
          useGrammar: true,
          fallbackToPromptEngineering: true,
          ...(config.options ?? {})
        });

      case 'lm-studio':
        return new LMStudioAdapter({
          baseUrl: config.baseUrl ?? 'http://localhost:1234',
          model: config.model,
          apiKey: config.apiKey ?? 'lm-studio' // LM Studio accepte n'importe quelle clé
        });

      case 'jan':
        return new JanAdapter({
          baseUrl: config.baseUrl ?? 'http://localhost:1337',
          model: config.model,
          enablePromptFallback: true
        });

      default:
        throw new Error(`Unknown LLM provider: ${config.provider}`);
    }
  }

  /**
   * Crée un adaptateur avec auto-détection depuis l'URL
   * Utile pour les configurations dynamiques
   */
  static async createAuto(baseUrl: string, model: string): Promise<ILLMAdapter> {
    // Probe des endpoints connus
    const endpoints = [
      { path: '/api/tags', provider: 'ollama' as LLMProvider },
      { path: '/v1/models', provider: 'lm-studio' as LLMProvider },
      { path: '/v1/models', provider: 'jan' as LLMProvider },
    ];

    for (const ep of endpoints) {
      try {
        const r = await fetch(`${baseUrl}${ep.path}`, { signal: AbortSignal.timeout(2000) });
        if (r.ok) return this.create({ provider: ep.provider, model, baseUrl });
      } catch { /* next */ }
    }

    throw new Error(`Cannot auto-detect LLM server at ${baseUrl}`);
  }
}
```

---

## 8. Registre de Fonctions & Skills — FunctionRegistry

### 8.1 Interface

```typescript
// src/functions/interfaces/function-registry.interface.ts

export interface FunctionDefinition {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  outputSchema?: JSONSchema;
  outputDescription?: string;
  category?: string;
  tags?: string[];
  exampleQuery?: string;
  exampleArguments?: Record<string, unknown>;
  handler?: FunctionHandler;          // Handler TypeScript inline
  skillId?: string;                   // Référence vers un skill du SkillRegistry
  pythonRunner?: string;              // Chemin vers un script Python
  httpEndpoint?: string;              // URL d'un service HTTP externe
  required?: string[];
  timeout?: number;
}

export type FunctionHandler = (
  args: Record<string, unknown>,
  context: ExecutionContext
) => Promise<unknown>;

export interface IFunctionRegistry {
  register(fn: FunctionDefinition): void;
  unregister(name: string): void;
  get(name: string): FunctionDefinition | undefined;
  getAll(): FunctionDefinition[];
  getByCategory(category: string): FunctionDefinition[];
  search(query: string): Promise<FunctionDefinition[]>;
  validate(name: string, args: unknown): ValidationResult;
}
```

### 8.2 Implémentation

```typescript
// src/functions/function-registry.ts

import Ajv from 'ajv';

export class FunctionRegistry implements IFunctionRegistry {
  private functions = new Map<string, FunctionDefinition>();
  private ajv = new Ajv({ allErrors: true, coerceTypes: true });

  register(fn: FunctionDefinition): void {
    if (this.functions.has(fn.name)) {
      console.warn(`[FunctionRegistry] Overwriting function: ${fn.name}`);
    }
    
    // Pré-compilation du validateur pour performance
    if (fn.inputSchema) {
      this.ajv.addSchema(fn.inputSchema, fn.name);
    }
    
    this.functions.set(fn.name, fn);
  }

  /**
   * Enregistre automatiquement tous les skills du SkillRegistry
   * comme fonctions disponibles
   */
  async registerFromSkillRegistry(skillRegistry: ISkillRegistry): Promise<void> {
    const skills = skillRegistry.getAll();
    for (const skill of skills) {
      this.register({
        name: skill.id,
        description: skill.description,
        inputSchema: skill.inputSchema,
        outputSchema: skill.outputSchema,
        outputDescription: skill.outputDescription,
        category: skill.category,
        tags: skill.tags,
        skillId: skill.id,  // Délégation au SkillExecutor
        timeout: skill.timeout_ms
      });
    }
  }

  validate(name: string, args: unknown): ValidationResult {
    const fn = this.functions.get(name);
    if (!fn) return { valid: false, errors: [`Function '${name}' not found`] };
    if (!fn.inputSchema) return { valid: true, errors: [] };
    
    const validate = this.ajv.getSchema(name);
    if (!validate) return { valid: true, errors: [] };
    
    const valid = validate(args);
    return {
      valid: !!valid,
      errors: validate.errors?.map(e => `${e.instancePath}: ${e.message}`) ?? []
    };
  }

  getAll(): FunctionDefinition[] {
    return Array.from(this.functions.values());
  }

  async search(query: string): Promise<FunctionDefinition[]> {
    // Recherche simple par mots-clés sur name/description/tags
    const lower = query.toLowerCase();
    return this.getAll().filter(fn =>
      fn.name.toLowerCase().includes(lower) ||
      fn.description.toLowerCase().includes(lower) ||
      fn.tags?.some(t => t.toLowerCase().includes(lower))
    );
  }

  /**
   * Sélectionne intelligemment un sous-ensemble de fonctions
   * pour ne pas surcharger le context window
   */
  async selectRelevant(
    userMessage: string, 
    maxFunctions: number = 10
  ): Promise<FunctionDefinition[]> {
    const all = this.getAll();
    if (all.length <= maxFunctions) return all;
    
    // Recherche sémantique basique par mots-clés
    const keywords = userMessage.toLowerCase().split(/\s+/);
    const scored = all.map(fn => ({
      fn,
      score: keywords.reduce((s, kw) => 
        s + (fn.description.toLowerCase().includes(kw) ? 1 : 0) +
            (fn.name.toLowerCase().includes(kw) ? 2 : 0) +
            (fn.tags?.some(t => t.includes(kw)) ? 1 : 0),
        0
      )
    }));

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, maxFunctions)
      .map(s => s.fn);
  }
}
```

---

## 9. Execution Engine — ToolExecutor

### 9.1 Interface & Implémentation

```typescript
// src/functions/tool-executor.ts

export class ToolExecutor implements IToolExecutor {
  
  constructor(
    private registry: IFunctionRegistry,
    private skillExecutor: ISkillExecutor,   // Pour les skills du SkillRegistry
    private config: ExecutorConfig = {}
  ) {}

  async execute(
    functionName: string,
    args: Record<string, unknown>,
    context: ExecutionContext
  ): Promise<ExecutionResult> {
    
    const fn = this.registry.get(functionName);
    if (!fn) {
      return {
        success: false,
        error: `Fonction inconnue : "${functionName}". Fonctions disponibles : ${this.registry.getAll().map(f => f.name).join(', ')}`
      };
    }

    // Validation des arguments
    const validation = this.registry.validate(functionName, args);
    if (!validation.valid) {
      return {
        success: false,
        error: `Arguments invalides pour "${functionName}" : ${validation.errors.join(', ')}`
      };
    }

    // Dispatch selon le type de fonction
    try {
      const result = await this.dispatch(fn, args, context);
      return { success: true, data: result };
    } catch (error: any) {
      return {
        success: false,
        error: `Erreur lors de l'exécution de "${functionName}" : ${error.message}`
      };
    }
  }

  private async dispatch(
    fn: FunctionDefinition,
    args: Record<string, unknown>,
    context: ExecutionContext
  ): Promise<unknown> {
    
    // 1. Handler TypeScript inline (prioritaire)
    if (fn.handler) {
      return withTimeout(fn.handler(args, context), fn.timeout ?? 30000);
    }

    // 2. Délégation au SkillExecutor (pour les skills DOCX, PDF, etc.)
    if (fn.skillId) {
      return this.skillExecutor.execute(fn.skillId, args);
    }

    // 3. Script Python
    if (fn.pythonRunner) {
      return this.runPython(fn.pythonRunner, args, fn.timeout);
    }

    // 4. Endpoint HTTP externe
    if (fn.httpEndpoint) {
      return this.callHttp(fn.httpEndpoint, args, fn.timeout);
    }

    throw new Error(`Fonction "${fn.name}" n'a pas de handler défini`);
  }

  private async runPython(
    scriptPath: string,
    args: Record<string, unknown>,
    timeout = 30000
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const proc = spawn('python3', [scriptPath], {
        env: { ...process.env, FUNCTION_INPUT: JSON.stringify(args) },
        timeout
      });
      
      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', d => stdout += d);
      proc.stderr.on('data', d => stderr += d);
      proc.on('close', code => {
        if (code !== 0) reject(new Error(stderr || `Exit code ${code}`));
        else {
          try { resolve(JSON.parse(stdout)); }
          catch { resolve({ output: stdout }); }
        }
      });
    });
  }

  private async callHttp(
    endpoint: string,
    args: Record<string, unknown>,
    timeout = 10000
  ): Promise<unknown> {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(timeout)
    });
    
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    return response.json();
  }
}
```

---

## 10. Gestion du Contexte & Mémoire pour LLMs Locaux

### 10.1 Problème spécifique aux LLMs Locaux

Les LLMs locaux ont généralement des **context windows plus petites** (4K-32K tokens vs 200K pour Claude). La gestion du contexte est donc critique.

```typescript
// src/memory/context-manager.ts

export class ContextManager {
  
  constructor(private config: ContextManagerConfig) {}

  /**
   * Prépare les messages pour un LLM local en tenant compte
   * de sa fenêtre de contexte limitée
   */
  async prepareMessages(
    history: Message[],
    systemPrompt: string,
    functions: FunctionDefinition[],
    maxContextTokens: number
  ): Promise<Message[]> {
    
    const systemTokens = this.estimateTokens(systemPrompt);
    const functionTokens = this.estimateTokens(JSON.stringify(functions));
    const reservedForResponse = 1024;
    
    const availableForHistory = maxContextTokens - systemTokens - functionTokens - reservedForResponse;

    if (availableForHistory < 512) {
      // Context trop petit : réduire le nombre de fonctions
      const reducedFunctions = functions.slice(0, 3);
      return this.prepareMessages(history, systemPrompt, reducedFunctions, maxContextTokens);
    }

    return this.truncateHistory(history, availableForHistory);
  }

  /**
   * Stratégie de troncation intelligente :
   * - Garde TOUJOURS le premier message (contexte initial)
   * - Garde TOUJOURS les N derniers messages
   * - Résume les messages intermédiaires si nécessaire
   */
  private async truncateHistory(
    messages: Message[],
    maxTokens: number
  ): Promise<Message[]> {
    
    let totalTokens = messages.reduce((sum, m) => sum + this.estimateTokens(m.content), 0);
    
    if (totalTokens <= maxTokens) return messages;
    
    // Stratégie : garder les 2 premiers + les 6 derniers + résumer le milieu
    const keepFirst = 2;
    const keepLast = 6;
    
    if (messages.length <= keepFirst + keepLast) {
      // Pas assez de messages pour résumer : tronquer le contenu
      return this.truncateContent(messages, maxTokens);
    }

    const first = messages.slice(0, keepFirst);
    const last = messages.slice(-keepLast);
    const middle = messages.slice(keepFirst, -keepLast);

    const summary = await this.summarize(middle);
    const summaryMessage: Message = {
      role: 'system',
      content: `[Résumé de la conversation précédente]: ${summary}`
    };

    return [...first, summaryMessage, ...last];
  }

  /**
   * Résume une séquence de messages via le LLM
   */
  private async summarize(messages: Message[]): Promise<string> {
    // Utilise le même LLM ou un modèle dédié au résumé
    const content = messages.map(m => `${m.role}: ${m.content}`).join('\n');
    // ... appel LLM pour résumé
    return `Contexte précédent résumé (${messages.length} messages)`;
  }

  /**
   * Estimation du nombre de tokens (approximation)
   * Règle empirique : ~4 caractères = 1 token pour le français/anglais
   */
  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}
```

### 10.2 Context Window par Modèle/Serveur

```typescript
// src/llm/configs/model-context-windows.ts

export const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  // Ollama models
  'llama3.1:8b':          128_000,
  'llama3.1:70b':         128_000,
  'mistral:7b':            32_000,
  'mistral-nemo:12b':     128_000,
  'qwen2.5:7b':           128_000,
  'qwen2.5:14b':          128_000,
  'phi3:mini':             128_000,
  'gemma2:9b':              8_192,
  'deepseek-r1:7b':        32_000,
  
  // Modèles génériques (conservative)
  'default-local':          8_192,
  'default-cloud':        200_000,
};

export async function getContextWindow(
  adapter: ILLMAdapter,
  model: string
): Promise<number> {
  // Tenter de récupérer depuis l'API
  if (adapter.name === 'ollama') {
    try {
      const info = await fetch(`${adapter.baseUrl}/api/show`, {
        method: 'POST', body: JSON.stringify({ name: model })
      }).then(r => r.json());
      const ctxLen = info.model_info?.['llama.context_length'];
      if (ctxLen) return ctxLen;
    } catch { /* fallback */ }
  }
  
  return MODEL_CONTEXT_WINDOWS[model] ?? MODEL_CONTEXT_WINDOWS['default-local'];
}
```

---

## 11. Intégration Jan / LM Studio / Ollama

### 11.1 Configuration Unifiée

```typescript
// src/config/local-llm.config.ts

export interface LocalLLMConfig {
  servers: LocalLLMServer[];
  defaultServer?: string;
  autoDiscover?: boolean;        // Probe automatique des ports locaux
  autoDiscoverPorts?: number[];  // Ports à prober [11434, 1234, 1337]
}

export interface LocalLLMServer {
  id: string;
  name: string;
  type: 'ollama' | 'lm-studio' | 'jan';
  baseUrl: string;
  defaultModel?: string;
  capabilities: {
    nativeFunctionCalling: boolean;
    grammarDecoding: boolean;
    streaming: boolean;
    vision: boolean;
    maxContextTokens: number;
  };
}

// Configuration par défaut
export const DEFAULT_LOCAL_LLM_CONFIG: LocalLLMConfig = {
  autoDiscover: true,
  autoDiscoverPorts: [11434, 1234, 1337],
  servers: [
    {
      id: 'ollama-local',
      name: 'Ollama (Local)',
      type: 'ollama',
      baseUrl: 'http://localhost:11434',
      capabilities: {
        nativeFunctionCalling: false,  // Mis à jour dynamiquement
        grammarDecoding: true,
        streaming: true,
        vision: false,
        maxContextTokens: 8192
      }
    },
    {
      id: 'lmstudio-local',
      name: 'LM Studio (Local)',
      type: 'lm-studio',
      baseUrl: 'http://localhost:1234',
      capabilities: {
        nativeFunctionCalling: true,
        grammarDecoding: true,
        streaming: true,
        vision: false,
        maxContextTokens: 8192
      }
    },
    {
      id: 'jan-local',
      name: 'Jan (Local)',
      type: 'jan',
      baseUrl: 'http://localhost:1337',
      capabilities: {
        nativeFunctionCalling: false,
        grammarDecoding: false,
        streaming: true,
        vision: false,
        maxContextTokens: 4096
      }
    }
  ]
};
```

### 11.2 Service de Discovery Automatique

```typescript
// src/llm/discovery/local-llm-discovery.service.ts

export class LocalLLMDiscoveryService {
  
  private readonly PROBE_ENDPOINTS: Record<string, string> = {
    ollama:     '/api/tags',
    'lm-studio': '/v1/models',
    jan:        '/v1/models'
  };

  /**
   * Découvre automatiquement les serveurs LLM locaux disponibles
   * sur les ports standards
   */
  async discover(ports: number[] = [11434, 1234, 1337]): Promise<LocalLLMServer[]> {
    const discovered: LocalLLMServer[] = [];
    
    const probes = ports.map(port => this.probePort(port));
    const results = await Promise.allSettled(probes);
    
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        discovered.push(result.value);
      }
    }
    
    return discovered;
  }

  private async probePort(port: number): Promise<LocalLLMServer | null> {
    const baseUrl = `http://localhost:${port}`;
    
    for (const [type, path] of Object.entries(this.PROBE_ENDPOINTS)) {
      try {
        const response = await fetch(`${baseUrl}${path}`, {
          signal: AbortSignal.timeout(1000)
        });
        
        if (response.ok) {
          const models = await this.getModels(baseUrl, type as any);
          return {
            id: `${type}-${port}`,
            name: `${type} (port ${port})`,
            type: type as any,
            baseUrl,
            capabilities: await this.probeCapabilities(baseUrl, type as any, models[0])
          };
        }
      } catch { /* next type */ }
    }
    
    return null;
  }

  private async probeCapabilities(
    baseUrl: string, 
    type: string,
    model?: string
  ): Promise<LocalLLMServer['capabilities']> {
    // Tester le function calling natif avec un appel minimal
    const nativeFC = await this.testNativeFunctionCalling(baseUrl, type, model);
    const grammarDecoding = type === 'ollama' || type === 'lm-studio';
    const maxContext = await this.getMaxContextTokens(baseUrl, type, model);
    
    return {
      nativeFunctionCalling: nativeFC,
      grammarDecoding,
      streaming: true,
      vision: await this.testVisionCapability(baseUrl, type, model),
      maxContextTokens: maxContext
    };
  }
}
```

---

## 12. Fallback & Routing Intelligent

### 12.1 Router Multi-LLM

```typescript
// src/llm/routing/llm-router.ts

export interface RoutingRule {
  condition: (request: RoutingRequest) => boolean;
  adapter: string;       // ID de l'adaptateur
  priority: number;
  reason: string;
}

export class LLMRouter {
  private adapters = new Map<string, ILLMAdapter>();
  private rules: RoutingRule[] = [];

  constructor(private config: RouterConfig) {
    this.initDefaultRules();
  }

  private initDefaultRules(): void {
    this.rules = [
      // 1. Requêtes nécessitant du vision → cloud
      {
        condition: (r) => r.hasImages || r.hasVideos,
        adapter: 'anthropic',
        priority: 100,
        reason: 'Vision capability required'
      },
      // 2. Function calling complexe → préférer cloud ou modèle FC-capable
      {
        condition: (r) => r.functions && r.functions.length > 5,
        adapter: 'anthropic',
        priority: 90,
        reason: 'Complex function calling'
      },
      // 3. Données sensibles → local obligatoire
      {
        condition: (r) => r.metadata?.sensitive === true,
        adapter: 'ollama-local',
        priority: 95,
        reason: 'Sensitive data - local processing required'
      },
      // 4. Offline mode → local
      {
        condition: (r) => r.metadata?.offlineMode === true,
        adapter: 'ollama-local',
        priority: 95,
        reason: 'Offline mode enabled'
      },
      // 5. Default : préférer cloud si disponible
      {
        condition: () => true,
        adapter: 'anthropic',
        priority: 10,
        reason: 'Default cloud adapter'
      }
    ];
  }

  async route(request: RoutingRequest): Promise<ILLMAdapter> {
    const sorted = this.rules
      .filter(r => r.condition(request))
      .sort((a, b) => b.priority - a.priority);

    for (const rule of sorted) {
      const adapter = this.adapters.get(rule.adapter);
      if (!adapter) continue;
      
      const healthy = await adapter.healthCheck().catch(() => false);
      if (healthy) {
        console.debug(`[LLMRouter] Routing to ${rule.adapter}: ${rule.reason}`);
        return adapter;
      }
      
      console.warn(`[LLMRouter] Adapter ${rule.adapter} unhealthy, trying next...`);
    }

    throw new Error('No available LLM adapter found');
  }

  /**
   * Stratégie de fallback en cascade :
   * Cloud primary → Local fallback → Error
   */
  async completeWithFallback(request: CompletionRequest): Promise<LLMResponse> {
    const adapterOrder = [
      this.adapters.get('anthropic'),
      this.adapters.get('openai'),
      this.adapters.get('ollama-local'),
      this.adapters.get('lmstudio-local'),
      this.adapters.get('jan-local'),
    ].filter(Boolean) as ILLMAdapter[];

    for (const adapter of adapterOrder) {
      try {
        const healthy = await adapter.healthCheck();
        if (!healthy) continue;
        
        const response = await adapter.complete(request);
        if (response.finishReason !== 'error') return response;
      } catch (error) {
        console.warn(`[LLMRouter] Adapter ${adapter.name} failed:`, error);
      }
    }

    throw new Error('All LLM adapters failed');
  }
}
```

---

## 13. Sécurité & Sandboxing

### 13.1 Validation et Sanitisation

```typescript
// src/security/function-call-sanitizer.ts

export class FunctionCallSanitizer {
  
  /**
   * Valide et sanitise un tool call avant exécution
   * Protection contre les prompt injections via tool call fabricés
   */
  static sanitize(
    toolCall: ToolCall,
    registry: IFunctionRegistry,
    context: SecurityContext
  ): SanitizeResult {
    const errors: string[] = [];

    // 1. Vérifier que la fonction existe dans le registry
    const fn = registry.get(toolCall.name);
    if (!fn) {
      return { valid: false, errors: [`Function not in registry: ${toolCall.name}`] };
    }

    // 2. Vérifier les permissions du contexte
    if (fn.requiredPermissions?.length) {
      const missing = fn.requiredPermissions.filter(p => !context.permissions.includes(p));
      if (missing.length > 0) {
        errors.push(`Missing permissions: ${missing.join(', ')}`);
      }
    }

    // 3. Détecter les injections de prompt dans les arguments
    const argsStr = JSON.stringify(toolCall.arguments);
    const injectionPatterns = [
      /ignore\s+(previous|above|all)\s+instructions/i,
      /\bsystem\s*prompt\b/i,
      /<\|(?:im_start|system|user|assistant|end_header_id)\|>/i,
      /\[INST\]|\[\/INST\]/i
    ];

    for (const pattern of injectionPatterns) {
      if (pattern.test(argsStr)) {
        errors.push(`Potential prompt injection detected in arguments`);
        break;
      }
    }

    // 4. Validation du schéma (déjà fait dans le registry mais double-check)
    const validation = registry.validate(toolCall.name, toolCall.arguments);
    if (!validation.valid) {
      errors.push(...validation.errors);
    }

    // 5. Rate limiting par fonction
    if (!this.checkRateLimit(toolCall.name, context.userId)) {
      errors.push(`Rate limit exceeded for function: ${toolCall.name}`);
    }

    return { valid: errors.length === 0, errors };
  }

  private static rateLimits = new Map<string, { count: number; resetAt: number }>();

  private static checkRateLimit(functionName: string, userId: string): boolean {
    const key = `${userId}:${functionName}`;
    const limit = this.rateLimits.get(key);
    const now = Date.now();

    if (!limit || now > limit.resetAt) {
      this.rateLimits.set(key, { count: 1, resetAt: now + 60_000 });
      return true;
    }

    if (limit.count >= 10) return false; // Max 10 appels/min par fonction
    limit.count++;
    return true;
  }
}
```

---

## 14. Tests & Observabilité

### 14.1 Tests d'Intégration pour Chaque Adaptateur

```typescript
// src/llm/adapters/__tests__/ollama.adapter.test.ts

describe('OllamaAdapter — Function Calling', () => {
  let adapter: OllamaAdapter;
  
  const testFunctions: FunctionDefinition[] = [{
    name: 'get_weather',
    description: 'Retourne la météo pour une ville',
    inputSchema: {
      type: 'object',
      required: ['city'],
      properties: {
        city: { type: 'string', description: 'Nom de la ville' }
      }
    }
  }];

  beforeAll(async () => {
    adapter = new OllamaAdapter({ 
      baseUrl: process.env.OLLAMA_URL ?? 'http://localhost:11434',
      model: 'llama3.1:8b',
      useNativeFC: true,
      useGrammar: true,
      fallbackToPromptEngineering: true
    });
    await adapter.initialize();
  });

  it('doit invoquer une fonction via prompt engineering', async () => {
    const response = await adapter.complete({
      messages: [{ role: 'user', content: 'Quelle est la météo à Paris ?' }],
      functions: testFunctions
    });

    expect(response.toolCalls).toBeDefined();
    expect(response.toolCalls!.length).toBeGreaterThan(0);
    expect(response.toolCalls![0].name).toBe('get_weather');
    expect(response.toolCalls![0].arguments.city).toBeTruthy();
  });

  it('doit valider les arguments générés', async () => {
    const response = await adapter.complete({
      messages: [{ role: 'user', content: 'Météo à Lyon' }],
      functions: testFunctions
    });

    const registry = new FunctionRegistry();
    registry.register(testFunctions[0]);
    
    const validation = registry.validate(
      response.toolCalls![0].name,
      response.toolCalls![0].arguments
    );
    expect(validation.valid).toBe(true);
  });

  it('doit compléter une boucle multi-tour avec résultat de fonction', async () => {
    const loop = new AgentLoop(adapter, mockExecutor, mockRegistry);
    const result = await loop.run(
      'Quelle est la météo à Paris ? Dis-moi si je dois prendre un parapluie.',
      { history: [], systemPrompt: '' }
    );

    expect(result.finalResponse).toBeTruthy();
    expect(result.toolCallLog.length).toBeGreaterThan(0);
  });
});
```

### 14.2 Benchmark des Stratégies de Function Calling

```typescript
// src/llm/benchmarks/fc-strategy.benchmark.ts

export class FCStrategyBenchmark {
  
  async run(adapter: OllamaAdapter, testCases: BenchmarkTestCase[]): Promise<BenchmarkReport> {
    const strategies: FCStrategy[] = [
      'native',
      'grammar',
      'prompt-engineering',
      'react'
    ];

    const results: StrategyResult[] = [];

    for (const strategy of strategies) {
      const strategyResults = await Promise.all(
        testCases.map(tc => this.runTestCase(adapter, tc, strategy))
      );

      results.push({
        strategy,
        successRate: strategyResults.filter(r => r.success).length / strategyResults.length,
        avgLatencyMs: strategyResults.reduce((s, r) => s + r.latencyMs, 0) / strategyResults.length,
        avgTokens: strategyResults.reduce((s, r) => s + r.tokens, 0) / strategyResults.length,
        parseErrors: strategyResults.filter(r => !r.validJSON).length,
        schemaErrors: strategyResults.filter(r => !r.schemaValid).length,
      });
    }

    return { model: adapter.config.model, results };
  }
}
```

### 14.3 OpenTelemetry — Traces pour Function Calling Local

```typescript
// src/observability/llm-tracer.ts

import { trace, context, SpanStatusCode } from '@opentelemetry/api';

export class LLMTracer {
  private tracer = trace.getTracer('llm-adapter');

  async traceCompletion<T>(
    adapterName: string,
    model: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const span = this.tracer.startSpan(`llm.complete`, {
      attributes: {
        'llm.adapter': adapterName,
        'llm.model': model,
        'llm.type': adapterName.includes('ollama') ? 'local' : 'cloud'
      }
    });

    try {
      const result = await context.with(trace.setSpan(context.active(), span), fn);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error: any) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
      span.recordException(error);
      throw error;
    } finally {
      span.end();
    }
  }

  async traceToolCall(
    toolName: string,
    args: unknown,
    fn: () => Promise<unknown>
  ): Promise<unknown> {
    const span = this.tracer.startSpan(`tool.execute`, {
      attributes: {
        'tool.name': toolName,
        'tool.args_size': JSON.stringify(args).length
      }
    });

    const start = Date.now();
    try {
      const result = await fn();
      span.setAttribute('tool.duration_ms', Date.now() - start);
      span.setAttribute('tool.success', true);
      return result;
    } catch (error: any) {
      span.setAttribute('tool.success', false);
      span.setAttribute('tool.error', error.message);
      throw error;
    } finally {
      span.end();
    }
  }
}
```

---

## 15. Implémentation Python Backend

### 15.1 FastAPI — Endpoint d'Exécution de Fonctions

```python
# backend/functions/api.py

from fastapi import FastAPI, HTTPException, Depends
from pydantic import BaseModel
from typing import Any, Dict, Optional
import json
import subprocess
import sys

app = FastAPI(title="Function Executor API")


class FunctionCallRequest(BaseModel):
    name: str
    arguments: Dict[str, Any]
    context: Optional[Dict[str, Any]] = None


class FunctionCallResponse(BaseModel):
    success: bool
    data: Optional[Any] = None
    error: Optional[str] = None
    execution_time_ms: int


# Registre des fonctions Python disponibles
PYTHON_FUNCTIONS: Dict[str, callable] = {}

def register_function(name: str):
    """Décorateur pour enregistrer une fonction Python dans le registre."""
    def decorator(fn):
        PYTHON_FUNCTIONS[name] = fn
        return fn
    return decorator


@register_function("data.analyze.csv")
async def analyze_csv(arguments: Dict[str, Any]) -> Dict[str, Any]:
    import pandas as pd
    import io
    
    csv_content = arguments.get("csv_content", "")
    df = pd.read_csv(io.StringIO(csv_content))
    
    return {
        "rows": len(df),
        "columns": list(df.columns),
        "dtypes": df.dtypes.astype(str).to_dict(),
        "summary": df.describe().to_dict(),
        "missing_values": df.isnull().sum().to_dict()
    }


@register_function("document.extract.pdf")
async def extract_pdf(arguments: Dict[str, Any]) -> Dict[str, Any]:
    import pdfplumber
    import base64
    import io
    
    pdf_data = base64.b64decode(arguments["pdf_base64"])
    
    with pdfplumber.open(io.BytesIO(pdf_data)) as pdf:
        text = ""
        tables = []
        for page in pdf.pages:
            text += page.extract_text() or ""
            page_tables = page.extract_tables()
            if page_tables:
                tables.extend(page_tables)
    
    return {
        "text": text,
        "pages": len(pdf.pages),
        "tables": tables,
        "word_count": len(text.split())
    }


@app.post("/execute", response_model=FunctionCallResponse)
async def execute_function(request: FunctionCallRequest):
    import time
    start = time.time()
    
    fn = PYTHON_FUNCTIONS.get(request.name)
    if not fn:
        raise HTTPException(
            status_code=404, 
            detail=f"Function '{request.name}' not found. Available: {list(PYTHON_FUNCTIONS.keys())}"
        )
    
    try:
        result = await fn(request.arguments)
        return FunctionCallResponse(
            success=True,
            data=result,
            execution_time_ms=int((time.time() - start) * 1000)
        )
    except Exception as e:
        return FunctionCallResponse(
            success=False,
            error=str(e),
            execution_time_ms=int((time.time() - start) * 1000)
        )


@app.get("/functions")
async def list_functions():
    """Liste toutes les fonctions Python disponibles avec leurs métadonnées."""
    return {
        name: {
            "name": name,
            "doc": fn.__doc__ or ""
        }
        for name, fn in PYTHON_FUNCTIONS.items()
    }
```

### 15.2 Script Runner Python pour Sous-processus

```python
# backend/functions/runner.py
"""
Point d'entrée pour l'exécution de fonctions Python via subprocess.
Lit l'input depuis FUNCTION_INPUT env var, écrit l'output sur stdout.
"""

import sys
import json
import os
import traceback


def main():
    # Lecture de l'input
    input_json = os.environ.get("FUNCTION_INPUT")
    if not input_json:
        # Fallback : lire depuis stdin
        input_json = sys.stdin.read()
    
    if not input_json:
        print(json.dumps({"error": "No input provided"}))
        sys.exit(1)
    
    try:
        request = json.loads(input_json)
    except json.JSONDecodeError as e:
        print(json.dumps({"error": f"Invalid JSON input: {e}"}))
        sys.exit(1)
    
    function_name = request.get("name")
    arguments = request.get("arguments", {})
    
    # Import dynamique du module de fonction
    function_module_path = request.get("module")
    if function_module_path:
        import importlib.util
        spec = importlib.util.spec_from_file_location("fn_module", function_module_path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        fn = getattr(module, "execute", None)
    else:
        # Lookup dans le registre local
        from functions.api import PYTHON_FUNCTIONS
        fn = PYTHON_FUNCTIONS.get(function_name)
    
    if not fn:
        print(json.dumps({"error": f"Function '{function_name}' not found"}))
        sys.exit(1)
    
    try:
        import asyncio
        if asyncio.iscoroutinefunction(fn):
            result = asyncio.run(fn(arguments))
        else:
            result = fn(arguments)
        
        print(json.dumps({"success": True, "data": result}))
    
    except Exception as e:
        print(json.dumps({
            "success": False, 
            "error": str(e),
            "traceback": traceback.format_exc()
        }))
        sys.exit(1)


if __name__ == "__main__":
    main()
```

---

## 16. Intégration Frontend React

### 16.1 Hook pour Sélection du LLM

```typescript
// src/hooks/useLLMConfig.ts

export interface LLMConfig {
  provider: LLMProvider;
  model: string;
  baseUrl?: string;
  isLocal: boolean;
}

export function useLLMConfig() {
  const [availableAdapters, setAvailableAdapters] = useState<AdapterStatus[]>([]);
  const [selectedConfig, setSelectedConfig] = useState<LLMConfig | null>(null);
  const [loading, setLoading] = useState(true);

  // Découverte automatique des LLMs locaux
  useEffect(() => {
    async function discover() {
      setLoading(true);
      try {
        const response = await fetch('/api/llm/discover');
        const { adapters } = await response.json();
        setAvailableAdapters(adapters);
        
        // Sélection auto : préférer cloud si disponible
        const cloud = adapters.find((a: any) => !a.isLocal && a.healthy);
        const local = adapters.find((a: any) => a.isLocal && a.healthy);
        setSelectedConfig(cloud ?? local ?? null);
      } finally {
        setLoading(false);
      }
    }
    discover();
  }, []);

  return { availableAdapters, selectedConfig, setSelectedConfig, loading };
}
```

### 16.2 Indicateur Visuel du Mode d'Exécution

```tsx
// src/components/LLMStatusBadge.tsx

export function LLMStatusBadge({ config }: { config: LLMConfig }) {
  return (
    <div className={`llm-badge ${config.isLocal ? 'local' : 'cloud'}`}>
      <span className="indicator" />
      <span className="label">
        {config.isLocal ? '🔒 Local' : '☁️ Cloud'} — {config.model}
      </span>
      {config.isLocal && (
        <span className="note">Données traitées localement</span>
      )}
    </div>
  );
}
```

### 16.3 Composant de Configuration LLM

```tsx
// src/components/LLMSelector.tsx

export function LLMSelector() {
  const { availableAdapters, selectedConfig, setSelectedConfig } = useLLMConfig();

  return (
    <div className="llm-selector">
      <h3>Modèle IA actif</h3>
      
      <div className="adapters-list">
        {availableAdapters.map(adapter => (
          <button
            key={adapter.id}
            className={`adapter-card ${selectedConfig?.id === adapter.id ? 'active' : ''} ${!adapter.healthy ? 'unhealthy' : ''}`}
            onClick={() => adapter.healthy && setSelectedConfig(adapter)}
          >
            <div className="adapter-icon">{adapter.isLocal ? '🖥️' : '☁️'}</div>
            <div className="adapter-info">
              <strong>{adapter.name}</strong>
              <small>{adapter.model}</small>
              {adapter.isLocal && (
                <span className="local-badge">Données locales</span>
              )}
            </div>
            <div className={`health-dot ${adapter.healthy ? 'green' : 'red'}`} />
          </button>
        ))}
      </div>
      
      {selectedConfig?.isLocal && (
        <div className="local-warning">
          ⚠️ Mode local actif. Certaines fonctionnalités avancées peuvent être limitées.
        </div>
      )}
    </div>
  );
}
```

---

## 17. Matrice de Compatibilité des Modèles

| Modèle | FC Natif Ollama | Grammar | Prompt Eng. | ReAct | Recommandé pour |
|--------|----------------|---------|-------------|-------|-----------------|
| **Llama 3.1 8B** | ✅ | ✅ | ✅ | ✅ | Usage général, bon FC |
| **Llama 3.1 70B** | ✅ | ✅ | ✅ | ✅ | Agents complexes (GPU) |
| **Mistral 7B v0.3** | ✅ | ✅ | ✅ | ✅ | FC fiable, léger |
| **Mistral NeMo 12B** | ✅ | ✅ | ✅ | ✅ | Meilleur local < 20B |
| **Qwen 2.5 7B** | ✅ | ✅ | ✅ | ✅ | Code + FC, multilingue |
| **Qwen 2.5 14B** | ✅ | ✅ | ✅ | ✅ | Meilleur qualité local |
| **Hermes 2 Pro** | ✅ | ✅ | ✅ | ✅ | Optimisé agents |
| **Phi-3 Mini** | ⚠️ | ✅ | ✅ | ✅ | Très léger (4GB RAM) |
| **Gemma 2 9B** | ❌ | ✅ | ✅ | ✅ | Grammar/prompt only |
| **DeepSeek-R1 7B** | ⚠️ | ✅ | ✅ | ✅ | Raisonnement, FC limité |

**Recommandations par cas d'usage :**

- **RAM < 8GB** : Phi-3 Mini (3.8B) ou Llama 3.2 3B
- **RAM 8-16GB** : Mistral 7B v0.3 ou Qwen 2.5 7B
- **RAM 16-32GB** : Mistral NeMo 12B ou Qwen 2.5 14B
- **GPU dédié** : Llama 3.1 70B ou Qwen 2.5 72B

---

## 18. Roadmap d'Implémentation

### Phase 1 — Fondations (Semaine 1-2)

**Priorité HAUTE**

- [ ] Définir l'interface `ILLMAdapter` et les types partagés
- [ ] Implémenter `ToolCallParser` avec les 4 stratégies de parsing
- [ ] Implémenter `FunctionCallingPromptBuilder`
- [ ] Implémenter `OllamaAdapter` avec les 3 stratégies (native → grammar → prompt)
- [ ] Implémenter `LMStudioAdapter`
- [ ] Tests unitaires : parser, prompt builder
- [ ] Tests d'intégration : Ollama avec `llama3.1:8b`

### Phase 2 — Registry & Execution (Semaine 3)

- [ ] Implémenter `FunctionRegistry` avec validation Ajv
- [ ] Implémenter `ToolExecutor` (dispatch TS/Python/HTTP)
- [ ] Implémenter `AgentLoop` (multi-turn)
- [ ] Implémenter `ReActLoop` 
- [ ] Connecter `FunctionRegistry.registerFromSkillRegistry()`
- [ ] Tests d'intégration end-to-end : message → tool call → execution → réponse

### Phase 3 — Routing & Resilience (Semaine 4)

- [ ] Implémenter `LLMRouter` avec règles de routing
- [ ] Implémenter `LocalLLMDiscoveryService`
- [ ] Implémenter `JanAdapter`
- [ ] Implémenter `ContextManager` avec compression
- [ ] Implémenter `FunctionCallSanitizer`
- [ ] `LLMFactory.createAuto()`

### Phase 4 — Observabilité & Frontend (Semaine 5-6)

- [ ] OpenTelemetry traces pour tous les adapters
- [ ] Benchmark `FCStrategyBenchmark`
- [ ] API Node.js : `GET /api/llm/discover`, `POST /api/llm/switch`
- [ ] Frontend : `useLLMConfig()`, `LLMSelector`, `LLMStatusBadge`
- [ ] Python FastAPI endpoint `/execute`
- [ ] Documentation API

### Phase 5 — Fine-tuning & Optimisation (Semaine 7-8)

- [ ] Évaluation des modèles sur un jeu de test spécifique à l'application
- [ ] Optimisation des prompts par modèle
- [ ] Cache des tool calls fréquents (Redis)
- [ ] Tests de charge et optimisation de la latence

---

## 19. Annexes

### Annexe A — Variables d'Environnement

```bash
# .env

# Cloud LLMs
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...

# LLMs Locaux
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_DEFAULT_MODEL=llama3.1:8b
OLLAMA_USE_NATIVE_FC=true
OLLAMA_USE_GRAMMAR=true
OLLAMA_FC_FALLBACK=true

LM_STUDIO_BASE_URL=http://localhost:1234
LM_STUDIO_DEFAULT_MODEL=mistral-7b-instruct-v0.3
LM_STUDIO_API_KEY=lm-studio

JAN_BASE_URL=http://localhost:1337
JAN_DEFAULT_MODEL=mistral-7b-instruct-v0.3

# Routing
LLM_AUTO_DISCOVER=true
LLM_DEFAULT_PROVIDER=anthropic
LLM_FALLBACK_ORDER=anthropic,openai,ollama,lmstudio,jan

# Sécurité
FUNCTION_CALL_RATE_LIMIT=10/min
SANDBOX_PYTHON=true
```

### Annexe B — Structure des Fichiers

```
src/
├── llm/
│   ├── interfaces/
│   │   ├── llm-adapter.interface.ts
│   │   └── types.ts
│   ├── adapters/
│   │   ├── anthropic.adapter.ts
│   │   ├── openai.adapter.ts
│   │   ├── ollama.adapter.ts
│   │   ├── lm-studio.adapter.ts
│   │   ├── jan.adapter.ts
│   │   └── __tests__/
│   ├── parsers/
│   │   ├── tool-call.parser.ts
│   │   └── tool-call.parser.test.ts
│   ├── prompt-builders/
│   │   └── function-calling-prompt.builder.ts
│   ├── grammar/
│   │   └── json-schema-to-gbnf.ts
│   ├── templates/
│   │   ├── model-prompt-templates.ts
│   │   └── template-detector.ts
│   ├── loops/
│   │   ├── agent-loop.ts
│   │   └── react-loop.ts
│   ├── routing/
│   │   └── llm-router.ts
│   ├── discovery/
│   │   └── local-llm-discovery.service.ts
│   ├── llm.factory.ts
│   └── configs/
│       └── model-context-windows.ts
├── functions/
│   ├── interfaces/
│   │   ├── function-registry.interface.ts
│   │   └── tool-executor.interface.ts
│   ├── function-registry.ts
│   ├── tool-executor.ts
│   └── __tests__/
├── memory/
│   └── context-manager.ts
├── security/
│   └── function-call-sanitizer.ts
└── observability/
    └── llm-tracer.ts

backend/
└── functions/
    ├── api.py
    ├── runner.py
    └── handlers/
        ├── document_handler.py
        └── data_handler.py
```

### Annexe C — Commandes de Test Rapide

```bash
# Tester Ollama avec function calling
curl http://localhost:11434/api/chat -d '{
  "model": "llama3.1:8b",
  "messages": [{"role": "user", "content": "Quelle est la météo à Paris ?"}],
  "tools": [{
    "type": "function",
    "function": {
      "name": "get_weather",
      "description": "Retourne la météo",
      "parameters": {
        "type": "object",
        "required": ["city"],
        "properties": {"city": {"type": "string"}}
      }
    }
  }],
  "stream": false
}'

# Tester le grammar decoding Ollama
curl http://localhost:11434/api/generate -d '{
  "model": "llama3.1:8b",
  "prompt": "Génère un tool call pour obtenir la météo à Paris",
  "format": "json",
  "stream": false
}'

# Découverte automatique
curl http://localhost:3000/api/llm/discover

# Health check tous les adapters
curl http://localhost:3000/api/llm/health
```

### Annexe D — Décision Tree : Quelle Stratégie Choisir ?

```
Est-ce que le modèle est dans la liste des FC-natifs ?
├── OUI → Essayer FC natif via /api/chat tools
│   ├── Succès (tool_calls dans la réponse) → UTILISER
│   └── Échec (pas de tool_calls ou erreur) → Essayer Grammar
│
└── NON → Essayer Grammar Decoding
    ├── Le serveur supporte /api/generate + grammar ?
    │   ├── OUI → UTILISER Grammar
    │   └── NON → Utiliser Prompt Engineering
    │
    └── Prompt Engineering → Parser la réponse texte
        ├── Parser trouve un tool call valide → UTILISER
        ├── Parser trouve un JSON mais invalide → Tenter réparation → retry
        └── Aucun tool call trouvé → ReAct Loop ou réponse directe
```

---

> **Note de maintenance** : Ce document doit être mis à jour à chaque nouveau modèle local supporté (notamment les releases Llama, Mistral, Qwen) et à chaque évolution de l'API Ollama/LM Studio/Jan. Les stratégies de grammar decoding et de FC natif évoluent rapidement dans l'écosystème local.

---

*Plan rédigé pour l'équipe Architecture & Développement — Version 1.0 — Mars 2026*
