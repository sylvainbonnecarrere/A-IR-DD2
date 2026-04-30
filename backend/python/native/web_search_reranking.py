"""Hidden-LLM reranking helpers for the industrial web_search_py pipeline."""

from __future__ import annotations

import json
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Dict, List

from native.web_search_llm_client import complete_text
from native.web_search_result_filter import matches_allowed_domain, score_source_trust


RERANK_TIMEOUT_SECONDS = 10
RERANK_MAX_TOKENS = 220


def _normalize_whitespace(value: str) -> str:
    return " ".join(value.split())


def _clip_text(value: str, max_length: int = 320) -> str:
    normalized = _normalize_whitespace(value)
    if len(normalized) <= max_length:
        return normalized
    return f"{normalized[: max(0, max_length - 1)].rstrip()}…"


def _extract_query_terms(query: str) -> List[str]:
    return [
        token for token in re.split(r"[^a-zà-ÿ0-9]+", query.lower())
        if len(token) >= 3
    ]


def _extract_json_object(payload: str) -> Dict[str, Any]:
    try:
        parsed = json.loads(payload)
        return parsed if isinstance(parsed, dict) else {}
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", payload, re.DOTALL)
        if not match:
            return {}
        parsed = json.loads(match.group(0))
        return parsed if isinstance(parsed, dict) else {}


def _pick_critical_fragment(content: str, query_terms: List[str], must_include_terms: List[str]) -> str:
    normalized_content = _normalize_whitespace(content)
    if not normalized_content:
        return ""

    candidates = [
        _normalize_whitespace(chunk)
        for chunk in re.split(r"(?<=[\.!?])\s+|\n+", normalized_content)
        if _normalize_whitespace(chunk)
    ]
    if not candidates:
        return _clip_text(normalized_content)

    def score_fragment(fragment: str) -> int:
        lowered = fragment.lower()
        score = sum(1 for term in query_terms if term in lowered)
        score += sum(2 for term in must_include_terms if term.lower() in lowered)
        return score

    return _clip_text(sorted(candidates, key=score_fragment, reverse=True)[0])


def _fallback_score_candidate(candidate: Dict[str, Any], normalized_query: str, allowed_domains: List[str], must_include_terms: List[str], rerank_strategy: str) -> Dict[str, Any]:
    content = str(candidate.get("source_content", ""))
    lowered = content.lower()
    query_terms = _extract_query_terms(normalized_query)
    overlap = sum(1 for term in query_terms if term in lowered)
    must_include_overlap = sum(1 for term in must_include_terms if term.lower() in lowered)
    url = str(candidate.get("url", ""))
    score = min(10, max(0, overlap + must_include_overlap * 2 + (1 if score_source_trust(url, allowed_domains) > 0 else 0) + (1 if rerank_strategy == "Deep" and candidate.get("source_kind") == "page_content" else 0)))
    critical_fragment = _pick_critical_fragment(content, query_terms, must_include_terms)
    reasoning_parts = []
    if overlap:
        reasoning_parts.append("recouvrement lexical")
    if must_include_overlap:
        reasoning_parts.append("termes requis présents")
    if score_source_trust(url, allowed_domains) > 0:
        reasoning_parts.append("domaine crédible")
    if candidate.get("source_kind") == "page_content":
        reasoning_parts.append("contenu vérifié")

    return {
        "relevance_score": score,
        "reasoning": ", ".join(reasoning_parts[:3]) or "fallback structurel",
        "critical_fragment": critical_fragment,
        "mode": "fallback",
    }


def build_rerank_candidates(
    results: List[Dict[str, Any]],
    fetched_fragments: List[Dict[str, Any]],
    rerank_strategy: str,
) -> List[Dict[str, Any]]:
    fetched_by_url = {
        str(fragment.get("url", "")): fragment
        for fragment in fetched_fragments
        if str(fragment.get("url", "")).strip()
    }

    candidates: List[Dict[str, Any]] = []
    for result in results:
        url = str(result.get("url", ""))
        fetched_fragment = fetched_by_url.get(url)
        use_fetched = rerank_strategy == "Deep" and fetched_fragment and str(fetched_fragment.get("content", "")).strip()
        source_content = str(fetched_fragment.get("content", "")) if use_fetched else str(result.get("snippet", ""))
        candidates.append({
            "title": str(result.get("title", "")),
            "url": url,
            "source_kind": "page_content" if use_fetched else "search_snippet",
            "source_content": source_content,
        })

    return candidates


def _evaluate_candidate_with_llm(
    context: Any,
    candidate: Dict[str, Any],
    user_query: str,
    normalized_query: str,
    reranking_prompt: str,
    must_include_terms: List[str],
) -> Dict[str, Any]:
    rendered_prompt = (reranking_prompt or "")
    rendered_prompt = rendered_prompt.replace("{{user_query}}", user_query)
    rendered_prompt = rendered_prompt.replace(
        "{{source_content}}",
        json.dumps({
            "url": candidate.get("url", ""),
            "title": candidate.get("title", ""),
            "content": candidate.get("source_content", ""),
        }, ensure_ascii=False),
    )
    contract = "Retourne strictement un JSON avec relevance_score, reasoning et critical_fragment."
    payload = complete_text(
        context,
        system_prompt="\n\n".join([rendered_prompt, contract]).strip(),
        user_prompt="\n".join([
            f"INTENTION_INITIALE: {user_query}",
            f"REQUETE_NORMALISEE: {normalized_query}",
            f"TERMES_REQUIS: {json.dumps(must_include_terms, ensure_ascii=False)}",
            f"SOURCE_WEB: {json.dumps(candidate, ensure_ascii=False)}",
        ]),
        timeout=RERANK_TIMEOUT_SECONDS,
        max_tokens=RERANK_MAX_TOKENS,
    )
    parsed = _extract_json_object(payload)
    if not parsed:
        raise ValueError(f"Sortie reranking non JSON: {payload}")

    relevance_score = parsed.get("relevance_score")
    try:
        normalized_score = max(0, min(10, int(relevance_score)))
    except (TypeError, ValueError):
        raise ValueError(f"Score de reranking invalide: {parsed}")

    critical_fragment = _clip_text(str(parsed.get("critical_fragment", "") or candidate.get("source_content", "")))
    return {
        "relevance_score": normalized_score,
        "reasoning": _clip_text(str(parsed.get("reasoning", "") or "jugement LLM"), 120),
        "critical_fragment": critical_fragment,
        "mode": "llm",
    }


def rerank_sources(
    context: Any,
    user_query: str,
    transformed_query: Dict[str, Any],
    results: List[Dict[str, Any]],
    fetched_fragments: List[Dict[str, Any]],
    *,
    runtime_params: Dict[str, Any],
) -> Dict[str, List[Dict[str, Any]]]:
    normalized_query = str(transformed_query.get("normalized_query", user_query))
    allowed_domains = list(runtime_params.get("allowed_domains", []))
    must_include_terms = list(transformed_query.get("must_include_terms", []))
    rerank_strategy = str(runtime_params.get("rerank_strategy", "Fast"))
    threshold = int(runtime_params.get("relevance_threshold", 7))
    reranking_prompt = str(runtime_params.get("reranking_prompt", "") or "")
    candidates = build_rerank_candidates(results, fetched_fragments, rerank_strategy)

    def evaluate(candidate: Dict[str, Any]) -> Dict[str, Any]:
        if allowed_domains and not matches_allowed_domain(str(candidate.get("url", "")), allowed_domains):
            fallback = _fallback_score_candidate(candidate, normalized_query, allowed_domains, must_include_terms, rerank_strategy)
            fallback["relevance_score"] = 0
            fallback["reasoning"] = "domaine non autorisé"
            return {
                "title": str(candidate.get("title", "")),
                "url": str(candidate.get("url", "")),
                "source_kind": str(candidate.get("source_kind", "search_snippet")),
                **fallback,
            }

        try:
            evaluation = _evaluate_candidate_with_llm(
                context,
                candidate,
                user_query,
                normalized_query,
                reranking_prompt,
                must_include_terms,
            )
        except Exception:
            evaluation = _fallback_score_candidate(candidate, normalized_query, allowed_domains, must_include_terms, rerank_strategy)

        return {
            "title": str(candidate.get("title", "")),
            "url": str(candidate.get("url", "")),
            "source_kind": str(candidate.get("source_kind", "search_snippet")),
            **evaluation,
        }

    max_workers = max(1, min(3, len(candidates) or 1))
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(evaluate, candidate): index for index, candidate in enumerate(candidates)}
        indexed_results: List[Dict[str, Any] | None] = [None] * len(candidates)
        for future in as_completed(futures):
            indexed_results[futures[future]] = future.result()

    evaluations = [item for item in indexed_results if item is not None]
    ranked = sorted(evaluations, key=lambda item: (int(item.get("relevance_score", 0)), item.get("url", "")), reverse=True)
    selected = [
        item for item in ranked
        if int(item.get("relevance_score", 0)) >= threshold and str(item.get("critical_fragment", "")).strip()
    ]
    return {
        "evaluations": ranked,
        "selected": selected,
    }