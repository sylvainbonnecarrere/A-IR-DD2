"""Stub natif temporaire pour web_search_py."""

from typing import Any, Dict
from core.function_context import FunctionContext


def run(context: FunctionContext, args: Dict[str, Any] | None) -> str:
    """Retourne un message temporaire pendant la reconstruction de la feature."""
    _ = context
    _ = args
    return "La fonction web search est en cours d'implémentation"
