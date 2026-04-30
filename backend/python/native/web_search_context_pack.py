"""Context block assembly for the industrial web_search_py pipeline."""

from __future__ import annotations

from typing import Any, Dict, List


def _estimate_tokens(value: str) -> int:
    return max(1, len(value) // 4)


def build_llm_context_block(
    user_query: str,
    selected_sources: List[Dict[str, Any]],
    *,
    max_context_tokens: int,
) -> Dict[str, Any]:
    instructions = (
        "Réponds uniquement à partir des fragments ci-dessous. "
        "Cite les sources avec leurs références [S1], [S2], etc. "
        "N'invente aucun fait hors de ces sources."
    )

    included_sources: List[Dict[str, Any]] = []
    rendered_blocks: List[str] = []
    estimated_tokens = _estimate_tokens(instructions) + _estimate_tokens(user_query)
    truncated = False

    for index, source in enumerate(selected_sources, start=1):
        reference = f"S{index}"
        block = (
            f"[{reference}] score={source.get('relevance_score', 0)}\n"
            f"URL: {source.get('url', '')}\n"
            f"Fragment critique: {source.get('critical_fragment', '')}"
        )
        projected_tokens = estimated_tokens + _estimate_tokens(block)
        if included_sources and projected_tokens > max_context_tokens:
            truncated = True
            break

        included_sources.append({
            "reference": reference,
            "url": str(source.get("url", "")),
            "relevance_score": int(source.get("relevance_score", 0)),
            "critical_fragment": str(source.get("critical_fragment", "")),
        })
        rendered_blocks.append(block)
        estimated_tokens = projected_tokens

    content = "\n\n".join([
        f"Question utilisateur: {user_query}",
        instructions,
        *rendered_blocks,
        "Sources utilisées: " + ", ".join(source["reference"] for source in included_sources) if included_sources else "Sources utilisées: aucune",
    ])

    return {
        "instructions": instructions,
        "sources": included_sources,
        "content": content,
        "estimated_tokens": estimated_tokens,
        "truncated": truncated,
    }