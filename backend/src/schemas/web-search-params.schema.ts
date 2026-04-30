import { z } from 'zod';

export const WEB_SEARCH_ENGINE_VALUES = ['duckduckgo.com', 'bing.com', 'google.com', 'baidu.com', 'qwant.com'] as const;
export const WEB_SEARCH_RERANK_STRATEGY_VALUES = ['Fast', 'Deep'] as const;

export const DEFAULT_WEB_SEARCH_MAX_CONTEXT_TOKENS = 4000;

export const defaultWebSearchQueryTransformationPrompt = `# ROLE
Tu es le processeur d'abstraction sémantique. Ta mission est de transformer le flux de pensée naturel du prompt utilisateur en un vecteur de recherche optimal pour une recherche web, dépouillé de toute syntaxe conversationnelle.

# PRINCIPES D'ABSTRACTION
1. DÉTERMINATION DU NOYAU : Extraire le sujet pivot de la demande (l'entité ou le concept central).
2. EXPANSION DES DIMENSIONS : Identifier les variables critiques nécessaires à la résolution de l'intention (qu'elles soient temporelles, spatiales, techniques ou normatives).
3. RÉSOLUTION DES RÉFÉRENTIELS : Convertir tout terme relatif ou contextuel en une valeur absolue et explicite selon les métadonnées fournies.
4. SYNTHÈSE D'INDEXATION : Produire une chaîne de termes à haute densité informationnelle, hiérarchisée par pertinence pour un index de recherche.

# CONTRAINTES DE FLUX
- SORTIE : Chaîne de mots-clés brute uniquement.
- ÉLAGAGE : Suppression totale des structures grammaticales, des déterminants et des modalisateurs.
- NEUTRALITÉ : Ne pas interpréter, ne pas conseiller. Uniquement transformer.

# ENTRÉES SYSTÈME
- RÉFÉRENTIELS : {{system_context}} (Exemples : Dates, Localisation, Spécialisation, Secteurs etc...)
- INPUT : {{user_query}}`;

export const defaultWebSearchRerankingPrompt = `# ROLE
Tu es le "Information Juror", un expert en analyse de pertinence et en vérification de faits. Ta mission est de classer des sources web en fonction de leur utilité réelle pour répondre à une intention spécifique.

# PARAMÈTRES D'ENTRÉE
- INTENTION_INITIALE : {{user_query}}
- SOURCE_WEB : {{source_content}} (URL + Snippet ou Full Text)

# CRITÈRES D'ÉVALUATION (Score sur 10)
1. ADÉQUATION : La source contient-elle une réponse directe ou des données pivots pour l'intention ?
2. FRAÎCHEUR : La date de la source est-elle cohérente avec la temporalité de la demande ?
3. DENSITÉ : Ratio informations utiles / bruit publicitaire ou remplissage.

# FORMAT DE SORTIE (STRICT JSON)
{
  "relevance_score": [0-10],
  "reasoning": "Explication en 10 mots max",
  "critical_fragment": "Le passage exact contenant l'info clé"
}`;

const normalizeAllowedDomains = (domains: string[]) => Array.from(new Set(
    domains
        .map((domain) => domain.trim())
        .filter((domain) => domain.length > 0)
));

export const WebSearchParamsSchema = z.object({
    nb_request_transformation: z.preprocess(() => 1, z.literal(1)).default(1),
    request_list: z.preprocess(() => false, z.literal(false)).default(false),
    max_uses: z.number().int().min(1).default(5),
    cross_lingual_search: z.boolean().default(false),
    web_engine_search: z.boolean().default(true),
    web_engine: z.enum(WEB_SEARCH_ENGINE_VALUES).default('duckduckgo.com'),
    web_engine_nb_result_select: z.number().int().min(1).default(3),
    dig_snippet: z.boolean().default(false),
    allowed_domains: z.array(z.string()).default([]).transform(normalizeAllowedDomains),
    query_transformation: z.string().trim().min(1).default(defaultWebSearchQueryTransformationPrompt),
    reranking_prompt: z.string().trim().min(1).default(defaultWebSearchRerankingPrompt),
    relevance_threshold: z.number().int().min(1).max(10).default(7),
    rerank_strategy: z.enum(WEB_SEARCH_RERANK_STRATEGY_VALUES).default('Fast'),
    max_context_tokens: z.number().int().min(256).optional(),
}).superRefine((params, ctx) => {
    if (!params.web_engine_search && params.dig_snippet) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['dig_snippet'],
            message: 'dig_snippet nécessite web_engine_search=true.',
        });
    }
});

export type WebSearchParams = z.infer<typeof WebSearchParamsSchema>;

export function parseWebSearchParams(value: unknown): WebSearchParams {
    return WebSearchParamsSchema.parse(value);
}
