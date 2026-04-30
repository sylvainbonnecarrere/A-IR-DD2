"""Generic post-search filtering helpers for the industrial web_search_py pipeline."""

from __future__ import annotations

import re
from typing import Any, Dict, List
from urllib.parse import urlparse


_GENERIC_TRUST_HINTS = (
    (".gouv.fr", 16),
    (".gov", 16),
    (".edu", 14),
    ("wikipedia.org", 8),
)


def result_text(result: Dict[str, Any]) -> str:
    return " ".join([
        str(result.get("title", "")),
        str(result.get("href", "")),
        str(result.get("body", "")),
    ]).lower()


def get_domain(url: str) -> str:
    return urlparse(url).netloc.lower().removeprefix("www.")


def matches_allowed_domain(url: str, allowed_domains: List[str]) -> bool:
    if not allowed_domains:
        return True

    domain = get_domain(url)
    return any(domain == allowed or domain.endswith(f".{allowed}") for allowed in allowed_domains)


def score_source_trust(url: str, allowed_domains: List[str] | None = None) -> int:
    domain = get_domain(url)
    score = 0

    if allowed_domains and matches_allowed_domain(url, allowed_domains):
        score += 20

    for suffix, points in _GENERIC_TRUST_HINTS:
        if domain.endswith(suffix):
            score += points

    return score


def _extract_query_terms(query: str) -> List[str]:
    return [
        token for token in re.split(r"[^a-zà-ÿ0-9]+", query.lower())
        if len(token) >= 3
    ]


def deduplicate_raw_results(raw_results: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    deduplicated: List[Dict[str, Any]] = []
    seen_urls = set()

    for result in raw_results:
        url = str(result.get("href", "")).strip()
        if not url or url in seen_urls:
            continue
        seen_urls.add(url)
        deduplicated.append(result)

    return deduplicated


def score_result(
    result: Dict[str, Any],
    normalized_query: str,
    allowed_domains: List[str],
    must_include_terms: List[str],
) -> int:
    haystack = result_text(result)
    url = str(result.get("href", ""))
    query_terms = _extract_query_terms(normalized_query)
    overlap = sum(1 for term in query_terms if term in haystack)
    must_include_overlap = sum(1 for term in must_include_terms if term.lower() in haystack)
    score = score_source_trust(url, allowed_domains)
    score += min(18, overlap * 3)
    score += must_include_overlap * 5

    if must_include_terms and must_include_overlap == 0:
        score -= 12
    if allowed_domains and not matches_allowed_domain(url, allowed_domains):
        score -= 24

    return score


def project_results(
    raw_results: List[Dict[str, Any]],
    num_results: int,
    normalized_query: str,
    allowed_domains: List[str],
    must_include_terms: List[str],
) -> List[Dict[str, Any]]:
    deduplicated = deduplicate_raw_results(raw_results)
    filtered = [
        item for item in deduplicated
        if matches_allowed_domain(str(item.get("href", "")), allowed_domains)
    ] if allowed_domains else deduplicated

    ranked_results = sorted(
        enumerate(filtered or deduplicated),
        key=lambda item: (score_result(item[1], normalized_query, allowed_domains, must_include_terms), -item[0]),
        reverse=True,
    )

    formatted_results: List[Dict[str, Any]] = []
    for index, result in enumerate([item[1] for item in ranked_results][:num_results], start=1):
        formatted_results.append({
            "title": result.get("title", ""),
            "url": result.get("href", ""),
            "snippet": result.get("body", ""),
            "position": index,
        })

    return formatted_results