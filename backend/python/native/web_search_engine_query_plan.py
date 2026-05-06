"""Explicit business engine query planning for the pre-reranking web search flow."""

from __future__ import annotations

from typing import Dict, List

from native.web_search_engine_adapters import resolve_search_engine_adapter


def _normalize_whitespace(value: str) -> str:
    return " ".join(str(value or "").split())


def _unique_domains(allowed_domains: List[str]) -> List[str]:
    unique_domains: List[str] = []
    for domain in allowed_domains:
        normalized_domain = _normalize_whitespace(domain).lower()
        if normalized_domain and normalized_domain not in unique_domains:
            unique_domains.append(normalized_domain)
    return unique_domains


def build_engine_query_plans(
    *,
    web_engine: str,
    transformed_query_raw: str,
    allowed_domains: List[str],
) -> List[Dict[str, str]]:
    adapter = resolve_search_engine_adapter(web_engine)
    normalized_query = _normalize_whitespace(transformed_query_raw)
    if not normalized_query:
        return []

    domains = _unique_domains(allowed_domains)
    plan_domains = domains or [""]
    plans: List[Dict[str, str]] = []

    for domain in plan_domains:
        # Produce a concise engine query for common patterns (eg. weather + date + location)
        engine_query_text = normalized_query
        try:
            import re
            if re.search(r"\bm[eé]t[eé]o\b", normalized_query, re.IGNORECASE):
                # attempt to extract location and explicit date
                loc_m = re.search(r"à\s+([A-Z][\w\-]+)|sur\s+([A-Z][\w\-]+)", normalized_query)
                date_m = re.search(r"(\d{2}/\d{2}/\d{4})", normalized_query)
                location = (loc_m.group(1) or loc_m.group(2)) if loc_m else ""
                date_str = date_m.group(1) if date_m else ""
                parts = ["météo"]
                if location:
                    parts.append(f'"{location}"')
                if date_str:
                    parts.append(f"le {date_str}")
                concise = " ".join(parts)
                engine_query_text = concise or normalized_query
        except Exception:
            engine_query_text = normalized_query

        if domain:
            engine_query_text = f"site:{domain} {engine_query_text}"
        plans.append({
            "engine": adapter.engine,
            "adapter_name": adapter.adapter_name,
            "transformed_query_raw": normalized_query,
            "domain": domain,
            "engine_query_text": engine_query_text,
            "engine_query_url": adapter.build_query_url(engine_query_text),
        })

    return plans