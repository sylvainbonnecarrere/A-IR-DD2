"""Hidden-LLM query transformation helpers for the industrial web_search_py pipeline."""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Dict

from native.web_search_llm_client import complete_text


MAX_TRANSFORMED_QUERY_LENGTH = 500
TRANSFORM_TIMEOUT_SECONDS = 0
TRANSFORM_MAX_TOKENS = 220
DEFAULT_QUERY_TRANSFORMATION_TEMPLATE = (
    "# ROLE\n"
    "Tu es le processeur d'abstraction sémantique. Ta mission est de transformer le flux de pensée naturel du prompt utilisateur en un vecteur de recherche optimal pour une recherche web, dépouillé de toute syntaxe conversationnelle.\n\n"
    "# PRINCIPES D'ABSTRACTION\n"
    "1. DÉTERMINATION DU NOYAU : Extraire le sujet pivot de la demande (l'entité ou le concept central).\n"
    "2. EXPANSION DES DIMENSIONS : Identifier les variables critiques nécessaires à la résolution de l'intention (qu'elles soient temporelles, spatiales, techniques ou normatives).\n"
    "3. RÉSOLUTION DES RÉFÉRENTIELS : Convertir tout terme relatif ou contextuel en une valeur absolue et explicite selon les métadonnées fournies.\n"
    "4. SYNTHÈSE D'INDEXATION : Produire une chaîne de termes à haute densité informationnelle, hiérarchisée par pertinence pour un index de recherche.\n\n"
    "# CONTRAINTES DE FLUX\n"
    "- SORTIE : Chaîne de mots-clés brute uniquement.\n"
    "- ÉLAGAGE : Suppression totale des structures grammaticales, des déterminants et des modalisateurs.\n"
    "- NEUTRALITÉ : Ne pas interpréter, ne pas conseiller. Uniquement transformer.\n\n"
    "# ENTRÉES SYSTÈME\n"
    "- RÉFÉRENTIELS : {{system_context}} (Exemples : Dates, Localisation, Spécialisation, Secteurs etc...)\n"
    "- INPUT : {{user_query}}"
)


logger = logging.getLogger(__name__)


def normalize_whitespace(value: str) -> str:
    return " ".join(value.split())


def _render_system_context(system_context: Any) -> str:
    if isinstance(system_context, str):
        return system_context
    if isinstance(system_context, (list, dict, tuple)):
        return json.dumps(system_context, ensure_ascii=False)
    return str(system_context or "")


def _render_query_transformation_prompt(template: str, *, user_query: str, system_context: Any) -> str:
    rendered = (template or "").strip() or DEFAULT_QUERY_TRANSFORMATION_TEMPLATE
    rendered = rendered.replace("{{user_query}}", user_query)
    rendered = rendered.replace("{{system_context}}", _render_system_context(system_context))
    return rendered.strip()


def _fallback_normalized_query(user_query: str) -> str:
    lowered = normalize_whitespace(user_query.lower())
    lowered = re.sub(r"\b(?:sur\s+internet|sur\s+le\s+web|internet|web)\b", " ", lowered)
    lowered = re.sub(r"\b(?:peux-tu|peux tu|merci de|cherche|chercher|recherche|find|search)\b", " ", lowered)
    lowered = re.sub(r"[^a-zà-ÿ0-9'\-:/\. ]", " ", lowered)
    lowered = normalize_whitespace(lowered)
    return lowered or normalize_whitespace(user_query)


def _sanitize_transformed_query_raw(raw_output: str, *, user_query: str) -> str:
    transformed_query_raw = normalize_whitespace(raw_output)
    if not transformed_query_raw:
        transformed_query_raw = _fallback_normalized_query(user_query)
    return transformed_query_raw[:MAX_TRANSFORMED_QUERY_LENGTH].strip()


def transform_query(
    context: Any,
    user_query: str,
    *,
    system_context: Any,
    runtime_params: Dict[str, Any],
) -> Dict[str, Any]:
    transform_started_at = __import__('time').perf_counter()
    rendered_prompt = _render_query_transformation_prompt(
        str(runtime_params.get("query_transformation", "") or ""),
        user_query=user_query,
        system_context=system_context,
    )
    if not rendered_prompt:
        rendered_prompt = user_query.strip()

    try:
        logger.info(
            "web_search transform_query start: timeout=%ss timeout_disabled=%s max_tokens=%s user_query_length=%s prompt_length=%s",
            TRANSFORM_TIMEOUT_SECONDS,
            TRANSFORM_TIMEOUT_SECONDS <= 0,
            TRANSFORM_MAX_TOKENS,
            len(user_query or ""),
            len(rendered_prompt or ""),
        )
        raw_output = complete_text(
            context,
            system_prompt="",
            user_prompt=rendered_prompt,
            timeout=TRANSFORM_TIMEOUT_SECONDS,
            max_tokens=TRANSFORM_MAX_TOKENS,
        )
        raw_output = str(raw_output or "").strip()
        logger.info(
            "web_search transform_query success: duration_ms=%.2f result_length=%s result=%s",
            (__import__('time').perf_counter() - transform_started_at) * 1000,
            len(raw_output),
            raw_output,
        )
        transformed_query_raw = _sanitize_transformed_query_raw(raw_output, user_query=user_query)
        return {
            "normalized_query": transformed_query_raw,
            "queries": [transformed_query_raw],
            "english_queries": [],
            "must_include_terms": [],
            "exclude_terms": [],
            "raw_output": raw_output,
            "transformed_query_raw": transformed_query_raw,
            "mode": "llm",
        }
    except Exception as exc:
        logger.warning(
            "web_search transform_query failed: duration_ms=%.2f error=%s",
            (__import__('time').perf_counter() - transform_started_at) * 1000,
            exc,
        )
        fallback_normalized_query = _fallback_normalized_query(user_query)
        return {
            "normalized_query": fallback_normalized_query,
            "queries": [fallback_normalized_query],
            "english_queries": [],
            "must_include_terms": [],
            "exclude_terms": [],
            "raw_output": str(exc),
            "transformed_query_raw": fallback_normalized_query,
            "mode": "fallback",
        }