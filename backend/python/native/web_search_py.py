"""
web_search_py — Recherche web via DuckDuckGo (sans clé API)
"""
import html
import re
import warnings
from datetime import date, timedelta
from typing import Any, Dict, List, Tuple
from urllib.parse import parse_qs, quote_plus, urlparse, unquote
from urllib.request import Request, urlopen
from core.function_context import FunctionContext

warnings.filterwarnings(
    "ignore",
    category=RuntimeWarning,
    module=r"duckduckgo_search(\..*)?",
)
warnings.filterwarnings(
    "ignore",
    message=r"This package \(`duckduckgo_search`\) has been renamed to `ddgs`!.*",
    category=RuntimeWarning,
)

try:
    from ddgs import DDGS  # type: ignore[import-not-found]
    _DEPS_OK = True
except ImportError:
    try:
        from duckduckgo_search import DDGS
        _DEPS_OK = True
    except ImportError:
        _DEPS_OK = False


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

_WEATHER_TERMS = (
    "météo",
    "meteo",
    "température",
    "températures",
    "temperature",
    "temperatures",
    "minimale",
    "minimales",
    "maximale",
    "maximales",
    "prévision",
    "prévisions",
    "prevision",
    "previsions",
    "demain",
)

_WEATHER_DOMAINS = (
    "meteofrance.com",
    "weather.com",
    "accuweather.com",
    "tameteo.com",
    "lachainemeteo.com",
    "meteoblue.com",
    "weatherandclimate.com",
)

_FORECAST_HINTS = (
    "demain",
    "aujourd'hui",
    "aujourdhui",
    "prévisions",
    "previsions",
    "prévision",
    "prevision",
    "15 jours",
    "par heure",
)

_HISTORICAL_HINTS = (
    "archive",
    "historique",
    "history",
    "climate",
    "avril 2026",
    "april 2026",
    "page=month",
    "month=",
)

_QUERY_STOPWORDS = {
    "cherche",
    "chercher",
    "recherche",
    "web",
    "internet",
    "sur",
    "le",
    "la",
    "les",
    "de",
    "des",
    "du",
    "pour",
    "et",
    "à",
    "a",
}

_LOCATION_NOISE_TERMS = _QUERY_STOPWORDS.union({
    "internet",
    "web",
    "météo",
    "meteo",
    "température",
    "températures",
    "temperature",
    "temperatures",
    "prévision",
    "prévisions",
    "prevision",
    "previsions",
    "temps",
    "allant",
    "donne",
    "moi",
})

_LEADING_NOISE_PATTERNS = (
    r"^cherche(?:r)?\s+sur\s+le\s+web\s+",
    r"^cherche(?:r)?\s+sur\s+internet\s+",
    r"^cherche(?:r)?\s+",
    r"^recherche\s+sur\s+le\s+web\s+",
    r"^recherche\s+",
    r"^trouve\s+",
    r"^find\s+",
    r"^search\s+",
    r"^peux[- ]?tu\s+",
    r"^merci\s+de\s+",
)

_DOCUMENTATION_TERMS = (
    "documentation",
    "docs",
    "guide",
    "api",
    "sdk",
    "reference",
)

_SOURCE_TRUST_POLICIES: Dict[str, Dict[str, int]] = {
    "weather_location_forecast": {
        "meteofrance.com": 40,
        "weather.com": 18,
        "accuweather.com": 16,
        "tameteo.com": 14,
        "lachainemeteo.com": 14,
        "meteoblue.com": 10,
        "weatherandclimate.com": 6,
    },
    "documentation_lookup": {
        "platform.openai.com": 40,
        "openai.com": 22,
        "docs.anthropic.com": 40,
        "anthropic.com": 22,
        "ai.google.dev": 40,
        "developers.google.com": 26,
        "google.com": 12,
        "docs.python.org": 32,
        "developer.mozilla.org": 32,
        "learn.microsoft.com": 32,
        "docs.github.com": 32,
    },
    "generic_search": {},
}

_SEARCH_BACKENDS: Tuple[str, ...] = (
    "duckduckgo",
    "auto",
)


def _normalize_whitespace(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def _create_execution_trace(raw_query: str, language: str, num_results: int, safe_search: bool) -> Dict[str, Any]:
    return {
        "input": {
            "query": raw_query,
            "language": language,
            "num_results": num_results,
            "safe_search": safe_search,
        },
        "intent": {},
        "queries": [],
        "consulted_sources": [],
        "selected_sources": [],
        "steps": [],
        "errors": [],
    }


def _record_step(trace: Dict[str, Any], name: str, status: str, details: Dict[str, Any] | None = None) -> None:
    trace["steps"].append({
        "name": name,
        "status": status,
        "details": details or {},
    })


def _record_error(trace: Dict[str, Any], step: str, exc: Exception) -> Dict[str, str]:
    error = {
        "step": step,
        "type": type(exc).__name__,
        "message": str(exc),
    }
    trace["errors"].append(error)
    _record_step(trace, step, "failed", {"error": error})
    return error


def _build_failure_response(
    original_query: str,
    normalized_query: str,
    trace: Dict[str, Any],
    step: str,
    exc: Exception,
) -> Dict[str, Any]:
    error = _record_error(trace, step, exc)
    return {
        "results": [],
        "query": original_query,
        "normalized_query": normalized_query,
        "total_results": 0,
        "error": error,
        "trace": trace,
    }


def _extract_weather_location(query: str) -> str:
    normalized_query = re.sub(r"[^A-Za-zÀ-ÿ' -]", " ", query)
    tokens = [token for token in re.split(r"\s+", normalized_query) if token]
    boundary_terms = _LOCATION_NOISE_TERMS.union({
        "demain",
        "aujourd'hui",
        "aujourdhui",
        "soir",
        "semaine",
        "ce",
        "cette",
    })
    prepositions = {"a", "à", "sur", "pour"}

    candidates: List[str] = []
    for index, token in enumerate(tokens):
        if token.lower() not in prepositions:
            continue

        location_tokens: List[str] = []
        for next_token in tokens[index + 1:]:
            lowered = next_token.lower()
            if lowered in prepositions and location_tokens:
                break
            if lowered in boundary_terms and location_tokens:
                break
            if lowered in boundary_terms:
                continue
            location_tokens.append(next_token)

        cleaned_location = _normalize_whitespace(" ".join(location_tokens))
        cleaned_lower = cleaned_location.lower()
        if not cleaned_location:
            continue
        if any(term in cleaned_lower for term in _WEATHER_TERMS):
            continue
        candidates.append(cleaned_location)

    if candidates:
        return candidates[-1]

    fallback_tokens: List[str] = []
    temporal_terms = {
        "demain",
        "aujourd'hui",
        "aujourdhui",
        "soir",
        "matin",
        "semaine",
        "weekend",
        "week-end",
    }

    for token in tokens:
        lowered = token.lower()
        if lowered in boundary_terms or lowered in temporal_terms:
            continue
        if lowered in _WEATHER_TERMS:
            continue
        if lowered in _QUERY_STOPWORDS:
            continue
        fallback_tokens.append(token)

    if not fallback_tokens:
        return ""

    return _normalize_whitespace(" ".join(fallback_tokens)).title()


def _extract_html_result_url(raw_href: str) -> str:
    if not raw_href:
        return ""

    decoded_href = html.unescape(raw_href).strip()
    parsed = urlparse(decoded_href)
    if parsed.path.startswith("/l/"):
        uddg = parse_qs(parsed.query).get("uddg", [])
        if uddg:
            return unquote(uddg[0])
    return decoded_href


def _execute_duckduckgo_html_search(
    candidate_query: str,
    region: str,
    max_results: int,
) -> List[Dict[str, Any]]:
    endpoint = f"https://html.duckduckgo.com/html/?q={quote_plus(candidate_query)}&kl={quote_plus(region)}"
    request = Request(
        endpoint,
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
            "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
        },
    )

    with urlopen(request, timeout=15) as response:
        payload = response.read().decode("utf-8", errors="replace")

    anchor_pattern = re.compile(
        r'<a[^>]+class="[^\"]*result__a[^\"]*"[^>]+href="(?P<href>[^"]+)"[^>]*>(?P<title>.*?)</a>',
        re.IGNORECASE | re.DOTALL,
    )
    snippet_pattern = re.compile(
        r'<a[^>]+class="[^\"]*result__snippet[^\"]*"[^>]*>(?P<snippet>.*?)</a>|<div[^>]+class="[^\"]*result__snippet[^\"]*"[^>]*>(?P<snippet_div>.*?)</div>',
        re.IGNORECASE | re.DOTALL,
    )

    results: List[Dict[str, Any]] = []
    snippet_matches = list(snippet_pattern.finditer(payload))

    for index, anchor_match in enumerate(anchor_pattern.finditer(payload)):
        raw_href = anchor_match.group("href")
        href = _extract_html_result_url(raw_href)
        if not href:
            continue

        raw_title = re.sub(r"<[^>]+>", " ", anchor_match.group("title"))
        title = _normalize_whitespace(html.unescape(raw_title))
        snippet = ""
        if index < len(snippet_matches):
            raw_snippet = snippet_matches[index].group("snippet") or snippet_matches[index].group("snippet_div") or ""
            snippet = _normalize_whitespace(html.unescape(re.sub(r"<[^>]+>", " ", raw_snippet)))

        results.append({
            "title": title,
            "href": href,
            "body": snippet,
        })

        if len(results) >= max_results:
            break

    return results


def _is_weather_query(query: str) -> bool:
    lowered = query.lower()
    return any(term in lowered for term in _WEATHER_TERMS)


def _extract_location_terms(location: str) -> List[str]:
    return [
        token for token in re.split(r"[^a-zà-ÿ0-9]+", location.lower())
        if token and token not in _QUERY_STOPWORDS
    ]


def _result_text(result: Dict[str, Any]) -> str:
    return " ".join([
        str(result.get("title", "")),
        str(result.get("href", "")),
        str(result.get("body", "")),
    ]).lower()


def _matches_location(result: Dict[str, Any], location_terms: List[str]) -> bool:
    if not location_terms:
        return True
    haystack = _result_text(result)
    return all(term in haystack for term in location_terms)


def _get_domain(url: str) -> str:
    return urlparse(url).netloc.lower().removeprefix("www.")


def _score_source_trust(url: str, strategy: str) -> int:
    domain = _get_domain(url)
    policy = _SOURCE_TRUST_POLICIES.get(strategy, {})

    for trusted_domain, score in policy.items():
        if domain == trusted_domain or domain.endswith(f".{trusted_domain}"):
            return score

    return 0


def _resolve_target_date_phrase(normalized_query: str) -> str:
    lowered = normalized_query.lower()
    explicit_date_match = re.search(r"\b(\d{2}/\d{2}/\d{4})\b", lowered)
    if explicit_date_match:
        return explicit_date_match.group(1)
    if "demain" in lowered:
        target_date = date.today() + timedelta(days=1)
        return target_date.strftime("%d/%m/%Y")
    if "aujourd'hui" in lowered or "aujourdhui" in lowered:
        return date.today().strftime("%d/%m/%Y")
    return ""


def _unique_queries(candidates: List[str]) -> List[str]:
    unique_candidates: List[str] = []
    for candidate in candidates:
        normalized_candidate = _normalize_whitespace(candidate)
        if normalized_candidate and normalized_candidate not in unique_candidates:
            unique_candidates.append(normalized_candidate)
    return unique_candidates


def _build_weather_candidate_queries(location: str, normalized_query: str, target_date_phrase: str) -> List[str]:
    if not location:
        return [normalized_query]

    quoted_location = f'"{location}"'
    dated_suffix = f" le {target_date_phrase}" if target_date_phrase else ""
    canonical_weather_query = f"météo et températures minimales et maximales à {location}{dated_suffix}".strip()
    candidates = [
        f'site:meteofrance.com météo {quoted_location}{dated_suffix}',
        f'site:meteocity.com météo {quoted_location}{dated_suffix}',
        f'site:tameteo.com météo {quoted_location}{dated_suffix}',
        f'site:lachainemeteo.com météo {quoted_location}{dated_suffix}',
        f'site:weather.com météo {quoted_location}{dated_suffix}',
        canonical_weather_query,
        normalized_query,
    ]

    return _unique_queries(candidates)


def _build_documentation_candidate_queries(normalized_query: str) -> List[str]:
    candidates = [normalized_query]
    lowered = normalized_query.lower()

    if "openai" in lowered:
        candidates.extend([
            f'site:platform.openai.com/docs {normalized_query}',
            f'site:openai.com {normalized_query}',
            'site:platform.openai.com/docs responses api',
        ])

    if "anthropic" in lowered or "claude" in lowered:
        candidates.extend([
            f'site:docs.anthropic.com {normalized_query}',
            'site:docs.anthropic.com claude api',
        ])

    if "google" in lowered or "gemini" in lowered:
        candidates.extend([
            f'site:ai.google.dev {normalized_query}',
            'site:ai.google.dev gemini api',
        ])

    return _unique_queries(candidates)


def _build_generic_candidate_queries(normalized_query: str) -> List[str]:
    return _unique_queries([normalized_query])


def _build_candidate_queries(intent: Dict[str, Any]) -> List[str]:
    strategy = str(intent.get("search_strategy", "generic_search"))
    normalized_query = str(intent.get("normalized_query", ""))

    if strategy == "weather_location_forecast":
        return _build_weather_candidate_queries(
            str(intent.get("location", "")),
            normalized_query,
            str(intent.get("target_date_phrase", "")),
        )

    if strategy == "documentation_lookup":
        return _build_documentation_candidate_queries(normalized_query)

    return _build_generic_candidate_queries(normalized_query)


def _execute_candidate_searches(
    ddgs: Any,
    candidate_queries: List[str],
    trace: Dict[str, Any],
    region: str,
    safesearch: str,
    num_results: int,
    weather_query: bool,
) -> List[Dict[str, Any]]:
    raw_results: List[Dict[str, Any]] = []
    last_error: Exception | None = None

    for index, candidate_query in enumerate(candidate_queries):
        candidate_success = False

        for backend in _SEARCH_BACKENDS:
            try:
                candidate_results = _execute_single_backend_search(
                    ddgs,
                    candidate_query,
                    region,
                    safesearch,
                    num_results * 2,
                    backend,
                )
                trace["queries"][index]["status"] = "completed"
                trace["queries"][index]["result_count"] = len(candidate_results)
                _trace_query_attempt(trace, index, backend, "completed", result_count=len(candidate_results))
                raw_results.extend(candidate_results)
                raw_results = _deduplicate_raw_results(raw_results)
                candidate_success = True

                if not weather_query and len(raw_results) >= num_results:
                    return raw_results

                if candidate_results:
                    break
            except Exception as exc:
                last_error = exc
                _trace_query_attempt(
                    trace,
                    index,
                    backend,
                    "failed",
                    error={
                        "step": "execute_search",
                        "type": type(exc).__name__,
                        "message": str(exc),
                    },
                )

        if not candidate_success:
            try:
                candidate_results = _execute_duckduckgo_html_search(
                    candidate_query,
                    region,
                    num_results * 2,
                )
                if candidate_results:
                    trace["queries"][index]["status"] = "completed"
                    trace["queries"][index]["result_count"] = len(candidate_results)
                    _trace_query_attempt(trace, index, "duckduckgo_html", "completed", result_count=len(candidate_results))
                    raw_results.extend(candidate_results)
                    raw_results = _deduplicate_raw_results(raw_results)
                    candidate_success = True

                    if not weather_query and len(raw_results) >= num_results:
                        return raw_results
            except Exception as exc:
                last_error = exc
                _trace_query_attempt(
                    trace,
                    index,
                    "duckduckgo_html",
                    "failed",
                    error={
                        "step": "execute_search",
                        "type": type(exc).__name__,
                        "message": str(exc),
                    },
                )

        if not candidate_success:
            trace["queries"][index]["status"] = "failed"

    if raw_results:
        return raw_results

    if last_error is not None:
        raise last_error

    return raw_results


def _deduplicate_raw_results(raw_results: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    deduplicated: List[Dict[str, Any]] = []
    seen_urls = set()

    for result in raw_results:
        url = str(result.get("href", "")).strip()
        if not url or url in seen_urls:
            continue
        seen_urls.add(url)
        deduplicated.append(result)

    return deduplicated


def _trace_query_attempt(
    trace: Dict[str, Any],
    index: int,
    backend: str,
    status: str,
    *,
    result_count: int | None = None,
    error: Dict[str, str] | None = None,
) -> None:
    attempts = trace["queries"][index].setdefault("attempts", [])
    attempt_details: Dict[str, Any] = {
        "backend": backend,
        "status": status,
    }
    if result_count is not None:
        attempt_details["result_count"] = result_count
    if error is not None:
        attempt_details["error"] = error
    attempts.append(attempt_details)


def _execute_single_backend_search(
    ddgs: Any,
    candidate_query: str,
    region: str,
    safesearch: str,
    max_results: int,
    backend: str,
) -> List[Dict[str, Any]]:
    try:
        return list(ddgs.text(
            query=candidate_query,
            region=region,
            safesearch=safesearch,
            max_results=max_results,
            backend=backend,
        ))
    except TypeError:
        return list(ddgs.text(
            keywords=candidate_query,
            region=region,
            safesearch=safesearch,
            max_results=max_results,
            backend=backend,
        ))


def _analyze_query_intent(query: str) -> Dict[str, Any]:
    cleaned = _normalize_whitespace(query)
    lowered = cleaned.lower()

    for pattern in _LEADING_NOISE_PATTERNS:
        lowered = re.sub(pattern, "", lowered, count=1, flags=re.IGNORECASE)

    lowered = re.sub(r"\b(?:s'il te plaît|stp|svp|please)\b", " ", lowered, flags=re.IGNORECASE)
    lowered = re.sub(r"[^a-zà-ÿ0-9' -]", " ", lowered, flags=re.IGNORECASE)
    lowered = _normalize_whitespace(lowered)

    if not lowered:
        raise ValueError("query est requis")

    if _is_weather_query(lowered):
        location = _extract_weather_location(cleaned)
        location_terms = _extract_location_terms(location)
        target_date_phrase = _resolve_target_date_phrase(lowered)
        normalized_weather_query = "météo et températures minimales et maximales"
        if location:
            normalized_weather_query += f" à {location}"
        if target_date_phrase:
            normalized_weather_query += f" le {target_date_phrase}"
        return {
            "original_query": cleaned,
            "normalized_query": normalized_weather_query,
            "kind": "weather",
            "confidence": 0.95,
            "location": location,
            "location_terms": location_terms,
            "target_date_phrase": target_date_phrase,
            "search_strategy": "weather_location_forecast",
        }

    documentation_query = any(term in lowered for term in _DOCUMENTATION_TERMS)

    return {
        "original_query": cleaned,
        "normalized_query": lowered,
        "kind": "generic_search",
        "confidence": 0.78 if documentation_query else 0.6,
        "location": "",
        "location_terms": [],
        "target_date_phrase": "",
        "search_strategy": "documentation_lookup" if documentation_query else "generic_search",
    }


def _score_result(result: Dict[str, Any], strategy: str, location_terms: List[str]) -> int:
    haystack = _result_text(result)
    url = str(result.get("href", ""))
    trust_score = _score_source_trust(url, strategy)

    score = trust_score
    if strategy == "weather_location_forecast":
        score += sum(2 for term in _WEATHER_TERMS if term in haystack)
        score += sum(6 for term in _FORECAST_HINTS if term in haystack)
        score -= sum(10 for term in _HISTORICAL_HINTS if term in haystack)
        if trust_score > 0:
            score += 8
        if "/previsions-meteo-france/" in url.lower():
            score += 12
        if location_terms:
            if _matches_location(result, location_terms):
                score += 40
            else:
                score -= 20
        score += sum(5 for term in location_terms if term in haystack)

    if strategy == "documentation_lookup":
        score += sum(4 for term in _DOCUMENTATION_TERMS if term in haystack)
        if "/docs" in url.lower() or "/api" in url.lower():
            score += 10

    return score


def _project_results(
    raw_results: List[Dict[str, Any]],
    num_results: int,
    strategy: str,
    location_terms: List[str],
) -> List[Dict[str, Any]]:
    ranked_results = sorted(
        enumerate(raw_results),
        key=lambda item: (_score_result(item[1], strategy, location_terms), -item[0]),
        reverse=True,
    )

    projected = [item[1] for item in ranked_results]
    if strategy == "weather_location_forecast":
        weather_only = [
            item for item in projected
            if _score_result(item, strategy, location_terms) > 0
        ]
        if weather_only:
            projected = weather_only

        if location_terms:
            location_filtered = [
                item for item in projected
                if _matches_location(item, location_terms)
            ]
            if location_filtered:
                projected = location_filtered

        forecast_focused = [
            item for item in projected
            if not any(term in _result_text(item) for term in _HISTORICAL_HINTS)
        ]
        if forecast_focused:
            projected = forecast_focused

    if strategy == "documentation_lookup":
        trusted_docs = [
            item for item in projected
            if _score_source_trust(str(item.get("href", "")), strategy) > 0
        ]
        if trusted_docs:
            projected = trusted_docs

    formatted_results: List[Dict[str, Any]] = []
    for index, result in enumerate(projected[:num_results], start=1):
        formatted_results.append({
            "title": result.get("title", ""),
            "url": result.get("href", ""),
            "snippet": result.get("body", ""),
            "position": index,
        })

    return formatted_results


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
    raw_query: str = str(args.get("query", "") or "")
    num_results: int = min(max(int(args.get("num_results", 5)), 1), 20)
    language: str = args.get("language", "fr")
    safe_search: bool = args.get("safe_search", True)
    trace = _create_execution_trace(raw_query, language, num_results, safe_search)

    if not _DEPS_OK:
        return _build_failure_response(
            raw_query,
            "",
            trace,
            "dependency_check",
            ImportError("Dépendances manquantes pour web_search_py : pip install ddgs duckduckgo-search"),
        )

    try:
        intent = _analyze_query_intent(raw_query)
        original_query = str(intent["original_query"])
        normalized_query = str(intent["normalized_query"])
        location = str(intent["location"])
        location_terms = list(intent["location_terms"])
        weather_query = str(intent["kind"]) == "weather"
        strategy = str(intent["search_strategy"])
        trace["intent"] = {
            "kind": intent["kind"],
            "confidence": intent["confidence"],
            "location": location,
            "location_terms": location_terms,
            "target_date_phrase": intent["target_date_phrase"],
            "search_strategy": intent["search_strategy"],
        }
        _record_step(trace, "normalize_query", "completed", {
            "normalized_query": normalized_query,
            "weather_query": weather_query,
            "search_strategy": strategy,
        })
    except Exception as exc:
        return _build_failure_response(raw_query, "", trace, "normalize_query", exc)

    safesearch = "on" if safe_search else "off"
    # Permettre un override explicit (ex: "en-gb") ou utiliser le mapping
    region_arg: str = args.get("region", "")
    region = region_arg if region_arg else _LANG_TO_REGION.get(language, "wt-wt")

    try:
        raw_results: List[Dict[str, Any]] = []
        target_date_phrase = str(intent["target_date_phrase"])
        candidate_queries = _build_candidate_queries(intent)
        trace["queries"] = [{"query": candidate_query, "status": "planned"} for candidate_query in candidate_queries]
        _record_step(trace, "build_search_plan", "completed", {
            "region": region,
            "candidate_query_count": len(candidate_queries),
            "target_date_phrase": target_date_phrase,
            "search_strategy": intent["search_strategy"],
        })
    except Exception as exc:
        return _build_failure_response(original_query, normalized_query, trace, "build_search_plan", exc)

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            with DDGS() as ddgs:
                raw_results = _execute_candidate_searches(
                    ddgs,
                    candidate_queries,
                    trace,
                    region,
                    safesearch,
                    num_results,
                    weather_query,
                )
        trace["consulted_sources"] = [
            {
                "title": str(result.get("title", "")),
                "url": str(result.get("href", "")),
            }
            for result in raw_results
            if str(result.get("href", "")).strip()
        ]
        _record_step(trace, "execute_search", "completed", {
            "raw_result_count": len(raw_results),
            "consulted_source_count": len(trace["consulted_sources"]),
        })
    except Exception as exc:
        return _build_failure_response(original_query, normalized_query, trace, "execute_search", exc)

    try:
        raw_results = _deduplicate_raw_results(raw_results)
        results = _project_results(raw_results, num_results, strategy, location_terms)
        trace["selected_sources"] = [
            {
                "title": str(result.get("title", "")),
                "url": str(result.get("url", "")),
            }
            for result in results
            if str(result.get("url", "")).strip()
        ]
        _record_step(trace, "project_results", "completed", {
            "selected_result_count": len(results),
        })
    except Exception as exc:
        return _build_failure_response(original_query, normalized_query, trace, "project_results", exc)

    return {
        "results": results,
        "query": original_query,
        "normalized_query": normalized_query,
        "total_results": len(results),
        "trace": trace,
    }
