"""Industrial hidden-LLM web search pipeline."""

from __future__ import annotations

import html
import json
import warnings
from typing import Any, Dict, List, Tuple
from urllib.parse import parse_qs, quote_plus, unquote, urlparse
from urllib.request import Request, urlopen

from core.function_context import FunctionContext
from native.web_search_context_pack import build_llm_context_block
import native.web_search_page_fetch as page_fetch_service
from native.web_search_presearch import build_presearch_state, execute_engine_query_plans
from native.web_search_reranking import rerank_sources
from native.web_search_result_filter import deduplicate_raw_results, project_results
from native.web_search_runtime_params import resolve_runtime_params

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

_DUCKDUCKGO_TEXT_BACKENDS: Tuple[str, ...] = (
    "html",
    "api",
    "lite",
)


def _resolve_search_backends(web_engine: str) -> Tuple[str, ...]:
    normalized_engine = (web_engine or "").strip().lower()

    if normalized_engine in {"", "duckduckgo", "duckduckgo.com"}:
        return _DUCKDUCKGO_TEXT_BACKENDS

    # DDGS is a DuckDuckGo client. Unsupported configured engines are tolerated for
    # backward compatibility, but we still execute against valid DuckDuckGo backends.
    return _DUCKDUCKGO_TEXT_BACKENDS


def _normalize_whitespace(value: str) -> str:
    return " ".join(value.split())


def _emit_debug_event(event: str, **payload: Any) -> None:
    try:
        print(json.dumps({"WEB_SEARCH_DEBUG": event, **payload}, ensure_ascii=False))
    except Exception:
        pass


def _create_execution_trace(raw_query: str, language: str, num_results: int, safe_search: bool, web_engine: str) -> Dict[str, Any]:
    return {
        "input": {
            "query": raw_query,
            "language": language,
            "num_results": num_results,
            "safe_search": safe_search,
            "web_engine": web_engine,
        },
        "system_context": [],
        "transformed_query_raw": "",
        "engine_query_plans": [],
        "engine_execution_trace": [],
        "transformation": {},
        "queries": [],
        "consulted_sources": [],
        "engine_top_results": [],
        "selected_sources": [],
        "rerank_diagnostics": {},
        "page_fetches": [],
        "steps": [],
        "errors": [],
    }


def _summarize_engine_results(raw_results: List[Dict[str, Any]], limit: int) -> List[Dict[str, Any]]:
    summarized: List[Dict[str, Any]] = []
    bounded_limit = max(0, int(limit))
    for index, result in enumerate(raw_results[:bounded_limit], start=1):
        url = str(result.get("href", "") or result.get("url", "")).strip()
        if not url:
            continue
        summarized.append({
            "rank": index,
            "title": str(result.get("title", "") or ""),
            "url": url,
            "snippet": str(result.get("body", "") or result.get("snippet", "") or ""),
        })
    return summarized


def _summarize_rerank_candidates(reranked_sources: List[Dict[str, Any]], limit: int) -> List[Dict[str, Any]]:
    summarized: List[Dict[str, Any]] = []
    bounded_limit = max(0, int(limit))
    for index, item in enumerate(reranked_sources[:bounded_limit], start=1):
        summarized.append({
            "rank": index,
            "title": str(item.get("title", "") or ""),
            "url": str(item.get("url", "") or ""),
            "source_kind": str(item.get("source_kind", "") or ""),
            "relevance_score": int(item.get("relevance_score", 0) or 0),
            "mode": str(item.get("mode", "") or ""),
            "reasoning": _normalize_whitespace(str(item.get("reasoning", "") or "")),
            "critical_fragment": _normalize_whitespace(str(item.get("critical_fragment", "") or "")),
            "fallback_reason": str(item.get("fallback_reason", "") or ""),
            "llm_error": _normalize_whitespace(str(item.get("llm_error", "") or "")),
        })
    return summarized


def _build_rerank_diagnostics(reranked_sources: List[Dict[str, Any]], threshold: int, selected_count: int) -> Dict[str, Any]:
    top_candidates = _summarize_rerank_candidates(reranked_sources, 3)
    return {
        "threshold": threshold,
        "evaluation_count": len(reranked_sources),
        "selected_count": selected_count,
        "best_score": int(reranked_sources[0].get("relevance_score", 0) or 0) if reranked_sources else 0,
        "fallback_count": sum(1 for item in reranked_sources if str(item.get("mode", "")).strip().lower() == "fallback"),
        "top_candidates": top_candidates,
    }


def _build_no_relevant_result_message(rerank_diagnostics: Dict[str, Any]) -> str:
    threshold = int(rerank_diagnostics.get("threshold", 0) or 0)
    evaluation_count = int(rerank_diagnostics.get("evaluation_count", 0) or 0)
    best_score = int(rerank_diagnostics.get("best_score", 0) or 0)
    top_candidates = list(rerank_diagnostics.get("top_candidates", []))

    if not top_candidates:
        return (
            "Aucune source suffisamment pertinente n'a été validée par le moteur d'abstraction. "
            f"Seuil={threshold}, évaluées={evaluation_count}, meilleur_score={best_score}."
        )

    serialized_candidates: List[str] = []
    for candidate in top_candidates:
        parts = [
            f"[{candidate.get('rank', '?')}] {str(candidate.get('title', '') or candidate.get('url', '') or 'source inconnue')}",
            f"score={int(candidate.get('relevance_score', 0) or 0)}",
        ]
        mode = str(candidate.get("mode", "") or "").strip()
        if mode:
            parts.append(f"mode={mode}")
        reasoning = _normalize_whitespace(str(candidate.get("reasoning", "") or ""))
        if reasoning:
            parts.append(f"raison={reasoning}")
        fallback_reason = str(candidate.get("fallback_reason", "") or "").strip()
        if fallback_reason:
            parts.append(f"fallback={fallback_reason}")
        llm_error = _normalize_whitespace(str(candidate.get("llm_error", "") or ""))
        if llm_error:
            parts.append(f"llm_error={llm_error}")
        serialized_candidates.append(" | ".join(parts))

    details = " ; ".join(serialized_candidates)
    normalized_details = _normalize_whitespace(details)
    if len(normalized_details) > 900:
        normalized_details = f"{normalized_details[:897].rstrip()}..."

    return (
        "Aucune source suffisamment pertinente n'a été validée par le moteur d'abstraction. "
        f"Seuil={threshold}, évaluées={evaluation_count}, meilleur_score={best_score}. "
        f"Top candidats: {normalized_details}"
    )


def _summarize_engine_query_plans(engine_query_plans: List[Dict[str, Any]], limit: int = 5) -> List[Dict[str, Any]]:
    summarized: List[Dict[str, Any]] = []
    for index, plan in enumerate(engine_query_plans[: max(0, int(limit))], start=1):
        summarized.append({
            "rank": index,
            "engine": str(plan.get("engine", "") or ""),
            "domain": str(plan.get("domain", "") or ""),
            "engine_query_text": str(plan.get("engine_query_text", "") or ""),
            "engine_query_url": str(plan.get("engine_query_url", "") or ""),
        })
    return summarized


def _summarize_trace_queries(trace_queries: List[Dict[str, Any]], limit: int = 5) -> List[Dict[str, Any]]:
    summarized: List[Dict[str, Any]] = []
    for index, item in enumerate(trace_queries[: max(0, int(limit))], start=1):
        attempts = item.get("attempts", []) if isinstance(item.get("attempts"), list) else []
        summarized.append({
            "rank": index,
            "query": str(item.get("query", "") or ""),
            "engine": str(item.get("engine", "") or ""),
            "backend": str(item.get("backend", "") or ""),
            "engine_query_url": str(item.get("engine_query_url", "") or ""),
            "status": str(item.get("status", "") or ""),
            "result_count": int(item.get("result_count", 0) or 0),
            "attempts": attempts,
        })
    return summarized


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


def _build_failure_response(original_query: str, normalized_query: str, trace: Dict[str, Any], step: str, exc: Exception) -> Dict[str, Any]:
    error = _record_error(trace, step, exc)
    _emit_debug_event(
        "failure",
        step=step,
        message=error.get("message", ""),
        transformed_query_raw=trace.get("transformed_query_raw", ""),
        web_engine=trace.get("input", {}).get("web_engine", ""),
        engine_query_plans=_summarize_engine_query_plans(list(trace.get("engine_query_plans", []))),
        top_results=trace.get("engine_top_results", []),
    )
    return {
        "results": [],
        "query": original_query,
        "normalized_query": normalized_query,
        "total_results": 0,
        "error": error,
        "trace": trace,
    }


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


def _execute_duckduckgo_html_search(candidate_query: str, region: str, max_results: int) -> List[Dict[str, Any]]:
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

    import re

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
        href = _extract_html_result_url(anchor_match.group("href"))
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
    attempt_payload: Dict[str, Any] = {
        "backend": backend,
        "status": status,
    }
    if result_count is not None:
        attempt_payload["result_count"] = result_count
    if error is not None:
        attempt_payload["error"] = error
    attempts.append(attempt_payload)


def _execute_single_backend_search(ddgs: Any, candidate_query: str, region: str, safesearch: str, max_results: int, backend: str) -> List[Dict[str, Any]]:
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


def _execute_candidate_searches(ddgs: Any, candidate_queries: List[str], trace: Dict[str, Any], region: str, safesearch: str, num_results: int, search_backends: Tuple[str, ...]) -> List[Dict[str, Any]]:
    raw_results: List[Dict[str, Any]] = []
    last_error: Exception | None = None

    for index, candidate_query in enumerate(candidate_queries):
        candidate_success = False

        for backend in search_backends:
            try:
                candidate_results = _execute_single_backend_search(ddgs, candidate_query, region, safesearch, num_results * 2, backend)
                trace["queries"][index]["status"] = "completed"
                trace["queries"][index]["result_count"] = len(candidate_results)
                _trace_query_attempt(trace, index, backend, "completed", result_count=len(candidate_results))
                raw_results.extend(candidate_results)
                raw_results = deduplicate_raw_results(raw_results)
                candidate_success = True
                if candidate_results:
                    break
            except Exception as exc:
                last_error = exc
                _trace_query_attempt(trace, index, backend, "failed", error={
                    "step": "execute_search",
                    "type": type(exc).__name__,
                    "message": str(exc),
                })

        if not candidate_success:
            try:
                candidate_results = _execute_duckduckgo_html_search(candidate_query, region, num_results * 2)
                if candidate_results:
                    trace["queries"][index]["status"] = "completed"
                    trace["queries"][index]["result_count"] = len(candidate_results)
                    _trace_query_attempt(trace, index, "duckduckgo_html", "completed", result_count=len(candidate_results))
                    raw_results.extend(candidate_results)
                    raw_results = deduplicate_raw_results(raw_results)
                    candidate_success = True
            except Exception as exc:
                last_error = exc
                _trace_query_attempt(trace, index, "duckduckgo_html", "failed", error={
                    "step": "execute_search",
                    "type": type(exc).__name__,
                    "message": str(exc),
                })

        if not candidate_success:
            trace["queries"][index]["status"] = "failed"

    if raw_results:
        return raw_results
    if last_error is not None:
        raise last_error
    return raw_results


def run(context: FunctionContext, args: Dict[str, Any]) -> Dict[str, Any]:
    raw_query = str(args.get("query", "") or "")
    num_results = min(max(int(args.get("num_results", 5)), 1), 20)
    language = str(args.get("language", "fr") or "fr")
    safe_search = bool(args.get("safe_search", True))
    runtime_params = resolve_runtime_params(context, args)
    trace = _create_execution_trace(raw_query, language, num_results, safe_search, str(runtime_params.get("web_engine", "duckduckgo.com")))
    fetched_fragments: List[Dict[str, Any]] = []
    verified_fragments: List[Dict[str, Any]] = []
    reranked_sources: List[Dict[str, Any]] = []
    llm_context_block: Dict[str, Any] = {
        "instructions": "",
        "sources": [],
        "content": "",
        "estimated_tokens": 0,
        "truncated": False,
    }

    if not _DEPS_OK:
        return _build_failure_response(
            raw_query,
            "",
            trace,
            "dependency_check",
            ImportError("Dépendances manquantes pour web_search_py : pip install ddgs duckduckgo-search"),
        )

    if not raw_query.strip():
        return _build_failure_response(raw_query, "", trace, "query_transformation", ValueError("query est requis"))

    if not bool(runtime_params.get("web_engine_search", True)):
        return _build_failure_response(raw_query, "", trace, "build_search_plan", ValueError("web_engine_search=false: aucun moteur de recherche n'est activé."))

    try:
        presearch_state = build_presearch_state(
            context,
            args,
            raw_query=raw_query,
            language=language,
            runtime_params=runtime_params,
        )
        system_context = list(presearch_state.get("system_context", []))
        transformed_query = dict(presearch_state.get("transformed_query", {}))
        normalized_query = str(presearch_state.get("transformed_query_raw", raw_query) or raw_query)
        engine_query_plans = list(presearch_state.get("engine_query_plans", []))
        candidate_queries = [str(item.get("engine_query_text", "") or "").strip() for item in engine_query_plans if str(item.get("engine_query_text", "") or "").strip()]

        trace["system_context"] = system_context
        trace["transformed_query_raw"] = normalized_query
        trace["engine_query_plans"] = engine_query_plans
        trace["transformation"] = {
            "mode": transformed_query.get("mode", "unknown"),
            "normalized_query": normalized_query,
            "transformed_query_raw": normalized_query,
            "raw_output": transformed_query.get("raw_output", ""),
        }
        _record_step(trace, "normalize_query", "completed", {
            "system_context_count": len(system_context),
            "mode": transformed_query.get("mode", "unknown"),
        })
        _record_step(trace, "build_search_plan", "completed", {
            "engine_plan_count": len(engine_query_plans),
        })
        _emit_debug_event(
            "query_transformation",
            mode=str(transformed_query.get("mode", "unknown") or "unknown"),
            transformed_query_raw=normalized_query,
            web_engine=str(runtime_params.get("web_engine", "") or ""),
            allowed_domains=list(runtime_params.get("allowed_domains", [])),
            engine_query_plans=_summarize_engine_query_plans(engine_query_plans),
        )
    except Exception as exc:
        return _build_failure_response(raw_query, "", trace, "build_search_plan", exc)

    region = str(args.get("region", "") or "") or _LANG_TO_REGION.get(language, "wt-wt")
    safesearch = "on" if safe_search else "off"

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            with DDGS() as ddgs:
                execution_payload = execute_engine_query_plans(
                    ddgs,
                    engine_query_plans=engine_query_plans,
                    region=region,
                    safesearch=safesearch,
                    num_results=num_results,
                    runtime_params=runtime_params,
                )
        raw_results = list(execution_payload.get("results_raw", []))
        engine_execution_trace = list(execution_payload.get("engine_execution_trace", []))
        trace["engine_execution_trace"] = engine_execution_trace
        trace["queries"] = [
            {
                "query": item.get("engine_query_text", ""),
                "status": item.get("status", "unknown"),
                "result_count": item.get("result_count", 0),
                "engine": item.get("engine", ""),
                "engine_query_url": item.get("engine_query_url", ""),
                "backend": item.get("backend", ""),
                "attempts": item.get("attempts", []),
            }
            for item in engine_execution_trace
        ]
        trace["consulted_sources"] = [
            {
                "title": str(result.get("title", "")),
                "url": str(result.get("href", "")),
            }
            for result in raw_results
            if str(result.get("href", "")).strip()
        ]
        trace["engine_top_results"] = _summarize_engine_results(
            raw_results,
            min(int(runtime_params.get("selected_result_limit", 3)), 3),
        )
        _record_step(trace, "execute_search", "completed", {
            "raw_result_count": len(raw_results),
            "engine_execution_count": len(engine_execution_trace),
        })
        _emit_debug_event(
            "engine_execution",
            web_engine=str(runtime_params.get("web_engine", "") or ""),
            transformed_query_raw=normalized_query,
            engine_queries=_summarize_trace_queries(trace["queries"]),
            top_results=trace.get("engine_top_results", []),
        )
    except Exception as exc:
        return _build_failure_response(raw_query, normalized_query, trace, "execute_search", exc)

    try:
        projected_results = project_results(
            raw_results,
            min(num_results, int(runtime_params.get("selected_result_limit", num_results))),
            normalized_query,
            list(runtime_params.get("allowed_domains", [])),
            list(transformed_query.get("must_include_terms", [])),
        )
        trace["selected_sources"] = [
            {
                "title": str(item.get("title", "")),
                "url": str(item.get("url", "")),
            }
            for item in projected_results
            if str(item.get("url", "")).strip()
        ]
        _record_step(trace, "project_results", "completed", {
            "selected_result_count": len(projected_results),
        })
    except Exception as exc:
        return _build_failure_response(raw_query, normalized_query, trace, "project_results", exc)

    try:
        fetched_fragments = page_fetch_service.fetch_selected_pages(
            projected_results,
            dig_snippet=bool(runtime_params.get("dig_snippet", False)),
            timeout=int(runtime_params.get("fetch_timeout_seconds", 15)),
            max_content_bytes=int(runtime_params.get("max_content_bytes", 250_000)),
            max_workers=int(runtime_params.get("max_fetch_workers", 3)),
        )
        trace["page_fetches"] = [
            {
                "url": str(item.get("url", "")),
                "status": str(item.get("status", "")),
                "fetched": bool(item.get("fetched", False)),
            }
            for item in fetched_fragments
        ]
        _record_step(trace, "fetch_pages", "completed", {
            "fetch_count": len(fetched_fragments),
            "dig_snippet": bool(runtime_params.get("dig_snippet", False)),
        })
    except Exception as exc:
        return _build_failure_response(raw_query, normalized_query, trace, "fetch_pages", exc)

    try:
        rerank_payload = rerank_sources(
            context,
            raw_query,
            transformed_query,
            projected_results,
            fetched_fragments,
            runtime_params=runtime_params,
        )
        reranked_sources = list(rerank_payload.get("evaluations", []))
        verified_fragments = list(rerank_payload.get("selected", []))[: int(runtime_params.get("max_uses", 5))]
        rerank_threshold = int(runtime_params.get("relevance_threshold", 7))
        trace["rerank_diagnostics"] = _build_rerank_diagnostics(
            reranked_sources,
            rerank_threshold,
            len(verified_fragments),
        )
        _record_step(trace, "rerank_sources", "completed", {
            "evaluation_count": len(reranked_sources),
            "selected_count": len(verified_fragments),
            "threshold": rerank_threshold,
            "best_score": trace["rerank_diagnostics"].get("best_score", 0),
        })
    except Exception as exc:
        return _build_failure_response(raw_query, normalized_query, trace, "rerank_sources", exc)

    if not verified_fragments:
        rerank_diagnostics = trace.get("rerank_diagnostics", {})
        return {
            "results": projected_results,
            "query": raw_query,
            "normalized_query": normalized_query,
            "system_context": trace.get("system_context", []),
            "transformed_query_raw": trace.get("transformed_query_raw", ""),
            "engine_query_plans": trace.get("engine_query_plans", []),
            "engine_execution_trace": trace.get("engine_execution_trace", []),
            "results_raw": raw_results,
            "engine_top_results": trace.get("engine_top_results", []),
            "total_results": len(projected_results),
            "error": {
                "step": "rerank_sources",
                "type": "NO_RELEVANT_RESULT",
                "message": _build_no_relevant_result_message(rerank_diagnostics),
                "diagnostics": rerank_diagnostics,
            },
            "reranked_sources": reranked_sources,
            "rerank_diagnostics": rerank_diagnostics,
            "verified_fragments": [],
            "llm_context_block": llm_context_block,
            "trace": trace,
        }

    try:
        llm_context_block = build_llm_context_block(
            raw_query,
            verified_fragments,
            max_context_tokens=int(runtime_params.get("max_context_tokens", 4000)),
        )
        _record_step(trace, "build_context_block", "completed", {
            "source_count": len(llm_context_block.get("sources", [])),
            "estimated_tokens": llm_context_block.get("estimated_tokens", 0),
        })
    except Exception as exc:
        return _build_failure_response(raw_query, normalized_query, trace, "build_context_block", exc)

    return {
        "results": projected_results,
        "query": raw_query,
        "normalized_query": normalized_query,
        "system_context": trace.get("system_context", []),
        "transformed_query_raw": trace.get("transformed_query_raw", ""),
        "engine_query_plans": trace.get("engine_query_plans", []),
        "engine_execution_trace": trace.get("engine_execution_trace", []),
        "results_raw": raw_results,
        "engine_top_results": trace.get("engine_top_results", []),
        "total_results": len(projected_results),
        "reranked_sources": reranked_sources,
        "rerank_diagnostics": trace.get("rerank_diagnostics", {}),
        "verified_fragments": verified_fragments,
        "llm_context_block": llm_context_block,
        "trace": trace,
    }