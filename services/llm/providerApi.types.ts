// ⭐ US-RC-02 lot 6 : contrat commun des frontières API providers LLM (deepSeek, grok,
// anthropic, mistral, openAI, qwen, kimi, perplexity, lmStudio). Plus de `any` aux frontières :
// messages/parts/body/tool-calls bruts typés ici, `unknown` accepté partout ailleurs.
import type { JsonSchema } from '../../types';

export type ProviderRole = 'system' | 'user' | 'assistant' | 'tool';

/** Part de contenu multimodal (texte, image data-URL qwen, image_url openai/grok/anthropic). */
export interface ProviderContentPart {
  type?: string;
  text?: string;
  image?: string;
  image_url?: { url: string };
  [key: string]: unknown;
}

export interface ProviderToolCall {
  id: string;
  type: string;
  function: { name: string; arguments: string };
}

export interface ProviderChatMessage {
  role: ProviderRole;
  content: string | ProviderContentPart[] | null;
  tool_calls?: ProviderToolCall[];
  tool_call_id?: string;
  name?: string;
}

/** Appel tool brut renvoyé par une API provider (champs lus : index, id, function.name, function.arguments). */
export interface RawProviderToolCall {
  index?: number;
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
  [key: string]: unknown;
}

/** Corps de requête provider (sérialisé en JSON). */
export type ProviderRequestBody = Record<string, unknown>;

/** Définition d'outil envoyée à un provider. */
export interface ProviderToolDefinition {
  name: string;
  description: string;
  input_schema?: JsonSchema;
  [key: string]: unknown;
}

/** response_format Anthropic (Structured Outputs). */
export interface ProviderResponseFormat {
  type: string;
  json_schema?: unknown;
  [key: string]: unknown;
}

/** Modèle brut LMStudio/Ollama (champs lus : id, context_length). */
export interface RawLMStudioModel {
  id: string;
  context_length?: number;
  [key: string]: unknown;
}

/** Citation web (contrat llmService : { title, uri }). */
export type ProviderCitation = { title: string; uri: string };
