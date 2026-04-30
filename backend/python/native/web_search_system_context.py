"""System context helpers for the industrial web_search_py pipeline."""

from __future__ import annotations

import re
from datetime import date as calendar_date, timedelta
from typing import Any, List


def resolve_target_date_phrase(normalized_query: str, date_provider: Any = calendar_date) -> str:
    lowered = normalized_query.lower()
    explicit_date_match = re.search(r"\b(\d{2}/\d{2}/\d{4})\b", lowered)
    if explicit_date_match:
        return explicit_date_match.group(1)
    if "demain" in lowered:
        target_date = date_provider.today() + timedelta(days=1)
        return target_date.strftime("%d/%m/%Y")
    if "aujourd'hui" in lowered or "aujourdhui" in lowered:
        return date_provider.today().strftime("%d/%m/%Y")
    return ""


def _append_context_item(items: List[str], value: str) -> None:
    normalized_value = value.strip()
    if normalized_value and normalized_value not in items and len(items) < 20:
        items.append(normalized_value)


def build_system_context(
    normalized_query: str,
    *,
    language: str = "fr",
    location: str = "",
    specialization: str = "",
    date_provider: Any = calendar_date,
) -> List[str]:
    today = date_provider.today()
    tomorrow = today + timedelta(days=1)
    context_items: List[str] = []
    target_date_phrase = resolve_target_date_phrase(normalized_query, date_provider)

    _append_context_item(context_items, f"language:{(language or 'fr').strip() or 'fr'}")
    _append_context_item(context_items, f"current_date:{today.strftime('%d/%m/%Y')}")
    _append_context_item(context_items, f"relative_today:{today.strftime('%d/%m/%Y')}")
    _append_context_item(context_items, f"relative_tomorrow:{tomorrow.strftime('%d/%m/%Y')}")
    if target_date_phrase:
        _append_context_item(context_items, f"target_date:{target_date_phrase}")
    if location.strip():
        _append_context_item(context_items, f"location:{location.strip()}")
    if specialization.strip():
        _append_context_item(context_items, f"specialization:{specialization.strip()}")
    if normalized_query.strip():
        _append_context_item(context_items, f"query:{normalized_query.strip()}")

    return context_items