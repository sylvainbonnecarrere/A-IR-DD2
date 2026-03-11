"""
web_search_py — Recherche web via DuckDuckGo (sans clé API)
"""
from typing import Any, Dict, List
from ..core.function_context import FunctionContext

try:
    from duckduckgo_search import DDGS
    _DEPS_OK = True
except ImportError:
    _DEPS_OK = False


def run(context: FunctionContext, args: Dict[str, Any]) -> Dict[str, Any]:
    """
    Effectue une recherche web et retourne les résultats structurés.

    Args (JSON) :
        query (str)        : Requête de recherche
        num_results (int)  : Nombre de résultats (1-20, défaut: 5)
        language (str)     : Langue des résultats (défaut: 'fr')
        safe_search (bool) : Safe search (défaut: true)

    Returns :
        results (list[{title, url, snippet, position}]), query (str), total_results (int)
    """
    if not _DEPS_OK:
        return {"error": "Dépendances manquantes : pip install duckduckgo-search"}

    query: str = args.get("query", "")
    num_results: int = min(max(int(args.get("num_results", 5)), 1), 20)
    language: str = args.get("language", "fr")
    safe_search: bool = args.get("safe_search", True)

    if not query:
        raise ValueError("query est requis")

    safesearch = "on" if safe_search else "off"

    # Mapping langue → région DuckDuckGo (format BCP-47 : langue-PAYS)
    # "fr" → "fr-fr" est correct, mais "en" → "en-en" est invalide, doit être "en-us"
    _LANG_TO_REGION: Dict[str, str] = {
        "en": "en-us",
        "fr": "fr-fr",
        "de": "de-de",
        "es": "es-es",
        "it": "it-it",
        "pt": "pt-pt",
        "nl": "nl-nl",
        "ru": "ru-ru",
        "ja": "ja-jp",
        "zh": "zh-cn",
        "ko": "ko-kr",
        "ar": "ar-sa",
        "pl": "pl-pl",
    }
    # Permettre un override explicit (ex: "en-gb") ou utiliser le mapping
    region_arg: str = args.get("region", "")
    region = region_arg if region_arg else _LANG_TO_REGION.get(language, "wt-wt")

    results: List[Dict[str, Any]] = []

    with DDGS() as ddgs:
        raw_results = list(ddgs.text(
            keywords=query,
            region=region,
            safesearch=safesearch,
            max_results=num_results
        ))

    for i, r in enumerate(raw_results):
        results.append({
            "title": r.get("title", ""),
            "url": r.get("href", ""),
            "snippet": r.get("body", ""),
            "position": i + 1,
        })

    return {
        "results": results,
        "query": query,
        "total_results": len(results),
    }
