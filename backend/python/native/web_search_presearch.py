"""Deterministic pre-reranking orchestration for web_search_py."""

from __future__ import annotations

import html
import json
import re
import time
from typing import Any, Dict, List
from urllib.parse import parse_qs, unquote, urlparse
from urllib.request import Request, urlopen

from native.web_search_engine_adapters import resolve_search_engine_adapter
from native.web_search_engine_query_plan import build_engine_query_plans
import native.web_search_query_transformation as query_transformation
from native.web_search_result_filter import deduplicate_raw_results
from native.web_search_system_context import build_system_context


DUCKDUCKGO_DDGS_BACKEND = "html"
HTTP_SEARCH_PAGE_TIMEOUT_SECONDS = 15
HTTP_SEARCH_PAGE_MAX_BYTES = 400_000

# Keep monkeypatch compatibility in tests that replace `presearch.transform_query`.
transform_query = query_transformation.transform_query
build_candidate_queries = query_transformation.build_candidate_queries


def _normalize_whitespace(value: str) -> str:
    return " ".join(str(value or "").split())


def _truncate_text(value: Any, max_length: int = 240) -> str:
    normalized = _normalize_whitespace(str(value or ""))
    if len(normalized) <= max_length:
        return normalized
    return f"{normalized[: max_length - 3].rstrip()}..."


def _emit_debug_event(event: str, **payload: Any) -> None:
    try:
        print(json.dumps({"WEB_SEARCH_DEBUG": event, **payload}, ensure_ascii=False))
    except Exception:
        pass


def _summarize_engine_query_plans_for_debug(engine_query_plans: List[Dict[str, Any]], limit: int = 5) -> List[Dict[str, Any]]:
    summarized: List[Dict[str, Any]] = []
    for plan in engine_query_plans[: max(0, int(limit))]:
        summarized.append({
            "engine": str(plan.get("engine", "") or ""),
            "adapter_name": str(plan.get("adapter_name", "") or ""),
            "domain": str(plan.get("domain", "") or ""),
            "engine_query_text": _truncate_text(plan.get("engine_query_text", ""), 200),
            "engine_query_url": str(plan.get("engine_query_url", "") or ""),
        })
    return summarized


def _summarize_candidate_results_for_debug(results: List[Dict[str, Any]], limit: int = 3) -> List[Dict[str, Any]]:
    summarized: List[Dict[str, Any]] = []
    for item in results[: max(0, int(limit))]:
        summarized.append({
            "title": _truncate_text(item.get("title", ""), 160),
            "url": str(item.get("href", "") or item.get("url", "") or ""),
            "snippet": _truncate_text(item.get("body", "") or item.get("snippet", ""), 220),
        })
    return summarized


def _build_http_search_request(url: str) -> Request:
    return Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
        },
    )


def _extract_http_result_url(engine: str, raw_href: str) -> str:
    href = html.unescape(str(raw_href or "")).strip()
    if not href or href.startswith(("javascript:", "mailto:", "#")):
        return ""

    parsed = urlparse(href)
    if engine == "google.com":
        if href.startswith("/url?") or parsed.path == "/url":
            query = parse_qs(parsed.query)
            for key in ("q", "url"):
                values = query.get(key) or []
                if values:
                    href = unquote(values[0])
                    parsed = urlparse(href)
                    break
        elif parsed.netloc.endswith("google.com") or parsed.netloc.endswith("www.google.com"):
            return ""
    elif engine == "bing.com" and parsed.netloc.endswith("bing.com"):
        return ""
    elif engine == "qwant.com" and parsed.netloc.endswith("qwant.com"):
        return ""
    elif engine == "baidu.com" and parsed.netloc.endswith("baidu.com"):
        return ""

    parsed = urlparse(href)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return ""
    return href


def _build_result_snippet(title: str, container_text: str) -> str:
    normalized_title = _normalize_whitespace(title)
    normalized_container = _normalize_whitespace(container_text)
    if normalized_title and normalized_container.startswith(normalized_title):
        normalized_container = normalized_container[len(normalized_title):].strip()
    if normalized_title:
        normalized_container = normalized_container.replace(normalized_title, " ", 1)
    return _normalize_whitespace(normalized_container)[:320]


def _parse_http_search_results(engine: str, payload: str, max_results: int) -> List[Dict[str, Any]]:
    try:
        from lxml import html as lxml_html
    except Exception:
        return []

    tree = lxml_html.fromstring(payload)
    anchors: List[Any] = []
    xpaths_by_engine = {
        "google.com": ["//div[@id='search']//a[h3]", "//a[h3]"],
        "bing.com": ["//li[contains(@class, 'b_algo')]//h2/a", "//a[h2]"],
        "qwant.com": ["//article//a[h3]", "//a[h3]"],
        "baidu.com": ["//div[contains(@class, 'result')]//h3/a", "//a[h3]"],
    }

    for xpath in xpaths_by_engine.get(engine, ["//a[@href]"]):
        anchors = tree.xpath(xpath)
        if anchors:
            break
    if not anchors:
        anchors = tree.xpath("//a[@href]")

    results: List[Dict[str, Any]] = []
    seen_urls = set()
    for anchor in anchors:
        href = _extract_http_result_url(engine, anchor.get("href", ""))
        if not href or href in seen_urls:
            continue

        title = _normalize_whitespace(anchor.text_content())
        if len(title) < 4:
            continue

        container_text = ""
        for xpath in ("ancestor::div[1]", "ancestor::li[1]", "ancestor::article[1]"):
            containers = anchor.xpath(xpath)
            if containers:
                container_text = containers[0].text_content()
                break

        results.append({
            "title": title,
            "href": href,
            "body": _build_result_snippet(title, container_text),
        })
        seen_urls.add(href)
        if len(results) >= max_results:
            break

    return results


def _execute_http_search_page(engine: str, engine_query_url: str, max_results: int) -> Dict[str, Any]:
    request = _build_http_search_request(engine_query_url)
    opener = globals().get("urlopen", urlopen)
    with opener(request, timeout=HTTP_SEARCH_PAGE_TIMEOUT_SECONDS) as response:
        content_type = response.headers.get("Content-Type") if getattr(response, "headers", None) else ""
        payload_bytes = response.read(HTTP_SEARCH_PAGE_MAX_BYTES + 1)
        status_code = getattr(response, "status", None) or getattr(response, "code", None) or 200
        final_url = response.geturl() if hasattr(response, "geturl") else engine_query_url

    decoded_payload = payload_bytes[:HTTP_SEARCH_PAGE_MAX_BYTES].decode("utf-8", errors="replace")
    return {
        "results": _parse_http_search_results(engine, decoded_payload, max_results),
        "requested_url": engine_query_url,
        "final_url": final_url,
        "status_code": status_code,
        "content_type": content_type or "",
    }


def build_presearch_state(
    context: Any,
    args: Dict[str, Any],
    *,
    raw_query: str,
    language: str,
    runtime_params: Dict[str, Any],
) -> Dict[str, Any]:
    web_engine = str(runtime_params.get("web_engine", "duckduckgo.com") or "duckduckgo.com")
    llm_runtime = runtime_params.get("llm_runtime") if isinstance(runtime_params, dict) else {}
    llm_runtime = llm_runtime if isinstance(llm_runtime, dict) else {}
    mock_transformed_query = _normalize_whitespace(str(runtime_params.get("mock_transformed_query", "") or ""))

    prompt_length = 0
    prompt_preview = ""
    try:
        prompt_preview_value = query_transformation._render_query_transformation_prompt(
            str(runtime_params.get("query_transformation", "") or ""),
            user_query=raw_query,
            system_context=[],
            runtime_params=runtime_params,
        )
        prompt_length = len(prompt_preview_value or "")
        prompt_preview = _truncate_text(prompt_preview_value, 180)
    except Exception:
        prompt_preview = _truncate_text(runtime_params.get("query_transformation", ""), 180)
        prompt_length = len(prompt_preview or "")

    _emit_debug_event(
        "build_search_plan_start",
        query=_truncate_text(raw_query, 180),
        language=language,
        web_engine=web_engine,
        hidden_llm_timeout_seconds=int(runtime_params.get("hidden_llm_timeout_seconds", 0) or 0),
        llm_provider=str(llm_runtime.get("provider", "") or ""),
        llm_model=str(llm_runtime.get("model", "") or ""),
        has_mock_transformed_query=bool(mock_transformed_query),
        prompt_length=prompt_length,
        prompt_preview=prompt_preview,
    )

    system_context = build_system_context(
        raw_query,
        language=language,
        location=str(args.get("location", "") or ""),
        specialization=str(args.get("specialization", "") or ""),
    )
    _emit_debug_event("build_search_plan_context", system_context=system_context)

    transform_started_at = time.perf_counter()
    if mock_transformed_query:
        transformed_query = {
            "normalized_query": mock_transformed_query,
            "queries": [mock_transformed_query],
            "english_queries": [],
            "must_include_terms": [],
            "exclude_terms": [],
            "raw_output": mock_transformed_query,
            "transformed_query_raw": mock_transformed_query,
            "mode": "mock",
        }
        _emit_debug_event(
            "query_transformation_mock",
            transformed_query_raw=mock_transformed_query,
            duration_ms=round((time.perf_counter() - transform_started_at) * 1000, 2),
        )
    else:
        _emit_debug_event(
            "query_transformation_start",
            timeout_seconds=int(runtime_params.get("hidden_llm_timeout_seconds", 0) or 0),
            llm_provider=str(llm_runtime.get("provider", "") or ""),
            llm_model=str(llm_runtime.get("model", "") or ""),
            prompt_length=prompt_length,
        )
        try:
            transformed_query = transform_query(
                context,
                raw_query,
                system_context=system_context,
                runtime_params=runtime_params,
            )
        except Exception as exc:
            _emit_debug_event(
                "query_transformation_error",
                duration_ms=round((time.perf_counter() - transform_started_at) * 1000, 2),
                error=_truncate_text(exc, 220),
            )
            raise

    transform_duration_ms = round((time.perf_counter() - transform_started_at) * 1000, 2)

    if not mock_transformed_query:
        _emit_debug_event(
            "query_transformation_result",
            mode=str(transformed_query.get("mode", "unknown") or "unknown"),
            duration_ms=transform_duration_ms,
            transformed_query_raw=_truncate_text(transformed_query.get("transformed_query_raw", transformed_query.get("normalized_query", "")), 200),
            raw_output_excerpt=_truncate_text(transformed_query.get("raw_output", ""), 220),
        )

    transform_mode = str(transformed_query.get("mode", "") or "").strip().lower()
    if transform_mode == "fallback":
        raw_error = _normalize_whitespace(str(transformed_query.get("raw_output", "") or "Transformation cachée indisponible."))
        _emit_debug_event(
            "query_transformation_failed",
            duration_ms=transform_duration_ms,
            error=_truncate_text(raw_error, 220),
        )
        if raw_error.lower().startswith("query_transformation_failed"):
            raise RuntimeError(raw_error)
        raise RuntimeError(f"QUERY_TRANSFORMATION_FAILED: {raw_error}")

    transformed_query_raw = str(
        transformed_query.get("transformed_query_raw")
        or transformed_query.get("normalized_query")
        or raw_query
    ).strip()
    # First, attempt to produce candidate queries from an analyzed intent
    # (legacy behaviour: weather intents include a site-prefixed candidate).
    engine_query_plans = []
    try:
        from native import web_search_py as compat
        intent = {}
        try:
            # analyze the original user phrasing (preserve words like 'demain')
            intent = compat._analyze_query_intent(raw_query)
        except Exception:
            intent = {}

        if str(intent.get("kind", "") or "").lower() == "weather":
            candidates = list(build_candidate_queries(intent) or [])
            adapter = resolve_search_engine_adapter(web_engine)
            for c in candidates:
                engine_query_plans.append({
                    "engine": adapter.engine,
                    "adapter_name": adapter.adapter_name,
                    "transformed_query_raw": transformed_query_raw,
                    "domain": "",
                    "engine_query_text": c,
                    "engine_query_url": adapter.build_query_url(c),
                })
    except Exception:
        engine_query_plans = []

    if not engine_query_plans:
        # fallback to the domain-driven engine plans
        engine_query_plans = build_engine_query_plans(
            web_engine=web_engine,
            transformed_query_raw=transformed_query_raw,
            allowed_domains=list(runtime_params.get("allowed_domains", [])),
        )

    _emit_debug_event(
        "build_search_plan_ready",
        transformed_query_raw=_truncate_text(transformed_query_raw, 200),
        web_engine=web_engine,
        engine_query_plans=_summarize_engine_query_plans_for_debug(engine_query_plans),
    )

    return {
        "system_context": system_context,
        "transformed_query": transformed_query,
        "transformed_query_raw": transformed_query_raw,
        "engine_query_plans": engine_query_plans,
    }


def _execute_ddgs_text(ddgs: Any, engine_query_text: str, region: str, safesearch: str, max_results: int) -> List[Dict[str, Any]]:
    try:
        return list(ddgs.text(
            query=engine_query_text,
            region=region,
            safesearch=safesearch,
            max_results=max_results,
            backend=DUCKDUCKGO_DDGS_BACKEND,
        ))
    except TypeError:
        return list(ddgs.text(
            keywords=engine_query_text,
            region=region,
            safesearch=safesearch,
            max_results=max_results,
            backend=DUCKDUCKGO_DDGS_BACKEND,
        ))


def execute_engine_query_plans(
    ddgs: Any,
    *,
    engine_query_plans: List[Dict[str, str]],
    region: str,
    safesearch: str,
    num_results: int,
    runtime_params: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    raw_results: List[Dict[str, Any]] = []
    engine_execution_trace: List[Dict[str, Any]] = []
    from urllib.parse import urlparse
    runtime_params = runtime_params if isinstance(runtime_params, dict) else {}
    mock_search_response_html = str(runtime_params.get("mock_search_response_html", "") or "").strip()

    # Respect legacy override if tests set `_SEARCH_BACKENDS` in module globals
    search_backends = tuple(globals().get('_SEARCH_BACKENDS', ('duckduckgo', 'auto')))

    for plan in engine_query_plans:
        engine = str(plan.get("engine", "") or "")
        adapter = resolve_search_engine_adapter(engine)
        execution_request = adapter.build_execution_request(
            engine_query_text=str(plan.get("engine_query_text", "") or "").strip(),
            region=region,
            safesearch=safesearch,
            max_results=num_results * 2,
        )
        if not bool(execution_request.get("supported_runtime", False)):
            raise ValueError(f"SEARCH_ENGINE_UNAVAILABLE:{engine}")

        # prefer execution_request.engine_query_text, fallback to plan's engine_query_text
        engine_query_text = str(execution_request.get("engine_query_text", "") or plan.get("engine_query_text", "") or plan.get("transformed_query_raw", "") or "").strip()
        engine_query_url = str(execution_request.get("engine_query_url", "") or plan.get("engine_query_url", "") or "").strip()

        attempts = []
        candidate_results = []
        candidate_success = False
        execution_kind = str(execution_request.get("execution_kind", adapter.execution_kind) or adapter.execution_kind)
        http_request_meta: Dict[str, Any] = {}

        _emit_debug_event(
            "engine_query_dispatch",
            engine=engine,
            adapter_name=str(execution_request.get("adapter_name", adapter.adapter_name) or adapter.adapter_name),
            execution_kind=execution_kind,
            engine_query_text=_truncate_text(engine_query_text, 200),
            engine_query_url=engine_query_url,
            requested_result_count=num_results * 2,
        )

        if execution_kind == "http_search_page":
            try:
                if mock_search_response_html:
                    http_payload = {
                        "results": _parse_http_search_results(engine, mock_search_response_html, num_results * 2),
                        "requested_url": engine_query_url,
                        "final_url": engine_query_url,
                        "status_code": 200,
                        "content_type": "text/html; charset=utf-8",
                        "mocked_response": True,
                    }
                else:
                    http_payload = _execute_http_search_page(
                        engine,
                        engine_query_url,
                        num_results * 2,
                    )
                candidate_results = list(http_payload.get("results", []))
                http_request_meta = {
                    "requested_url": http_payload.get("requested_url", ""),
                    "final_url": http_payload.get("final_url", ""),
                    "http_status": http_payload.get("status_code", 0),
                    "content_type": http_payload.get("content_type", ""),
                    **({"mocked_response": True} if bool(http_payload.get("mocked_response", False)) else {}),
                }
                attempts.append({
                    "backend": "http_search_page_mock" if bool(http_payload.get("mocked_response", False)) else "http_search_page",
                    "status": "completed",
                    "result_count": len(candidate_results),
                    **http_request_meta,
                })
                raw_results.extend(candidate_results)
                raw_results = deduplicate_raw_results(raw_results)
                candidate_success = True
            except Exception as exc:
                attempts.append({"backend": "http_search_page", "status": "failed", "error": {"step": "execute_search", "type": type(exc).__name__, "message": str(exc)}})
                _emit_debug_event(
                    "engine_query_result",
                    engine=engine,
                    adapter_name=str(execution_request.get("adapter_name", adapter.adapter_name) or adapter.adapter_name),
                    execution_kind=execution_kind,
                    engine_query_text=_truncate_text(engine_query_text, 200),
                    engine_query_url=engine_query_url,
                    status="failed",
                    result_count=0,
                    attempts=attempts,
                    error={"type": type(exc).__name__, "message": _truncate_text(exc, 220)},
                )
                raise
        else:
            # Try configured ddgs backends in order (legacy tests override `_SEARCH_BACKENDS`).
            for backend in search_backends:
                try:
                    try:
                        results = list(ddgs.text(
                            query=engine_query_text,
                            region=region,
                            safesearch=safesearch,
                            max_results=num_results * 2,
                            backend=backend,
                        ))
                    except TypeError:
                        results = list(ddgs.text(
                            keywords=engine_query_text,
                            region=region,
                            safesearch=safesearch,
                            max_results=num_results * 2,
                            backend=backend,
                        ))
                    attempts.append({"backend": backend, "status": "completed", "result_count": len(results)})
                    if results:
                        candidate_results.extend(results)
                        raw_results.extend(results)
                        raw_results = deduplicate_raw_results(raw_results)
                        candidate_success = True
                        break
                except Exception as exc:
                    attempts.append({"backend": backend, "status": "failed", "error": {"step": "execute_search", "type": type(exc).__name__, "message": str(exc)}})

            # If no configured ddgs backend succeeded, fall back to direct duckduckgo html scraping
            if not candidate_success:
                try:
                    html_results = _execute_ddgs_text(ddgs, engine_query_text, region, safesearch, num_results * 2)
                    if html_results:
                        attempts.append({"backend": "duckduckgo_html", "status": "completed", "result_count": len(html_results)})
                        candidate_results.extend(html_results)
                        raw_results.extend(html_results)
                        raw_results = deduplicate_raw_results(raw_results)
                        candidate_success = True
                    else:
                        attempts.append({"backend": "duckduckgo_html", "status": "failed"})
                except Exception as exc:
                    attempts.append({"backend": "duckduckgo_html", "status": "failed", "error": {"step": "execute_search", "type": type(exc).__name__, "message": str(exc)}})

        # If we obtained results, attempt a focused site-specific follow-up
        # search against the domain of the first result to improve precision
        # (keeps historical behaviour observed in baseline tests).
        try:
            if raw_results and execution_kind != "http_search_page":
                first_href = str(raw_results[0].get('href', '') or '')
                parsed = urlparse(first_href)
                domain = parsed.netloc
                if domain:
                    site_query = f"site:{domain} {engine_query_text}"
                    # try site-specific queries using the same backend order
                    for backend in search_backends:
                        try:
                            try:
                                sresults = list(ddgs.text(
                                    query=site_query,
                                    region=region,
                                    safesearch=safesearch,
                                    max_results=num_results * 2,
                                    backend=backend,
                                ))
                            except TypeError:
                                sresults = list(ddgs.text(
                                    keywords=site_query,
                                    region=region,
                                    safesearch=safesearch,
                                    max_results=num_results * 2,
                                    backend=backend,
                                ))
                            attempts.append({"backend": backend, "status": "completed", "result_count": len(sresults)})
                            if sresults:
                                raw_results.extend(sresults)
                                raw_results = deduplicate_raw_results(raw_results)
                                break
                        except Exception:
                            attempts.append({"backend": backend, "status": "failed"})
        except Exception:
            pass
        # Normalize backend name for trace compatibility with legacy tests
        backend_name = str(adapter.engine or "").lower()
        if 'duckduckgo' in backend_name:
            backend_name = 'duckduckgo'

        engine_execution_trace.append({
            **plan,
            "adapter_name": execution_request.get("adapter_name", adapter.adapter_name),
            "execution_kind": execution_kind,
            "query_engine": execution_request.get("engine_query_url", plan.get("engine_query_url", "")),
            "status": "completed" if candidate_success else "failed",
            "backend": backend_name,
            "result_count": len(candidate_results),
            "attempts": attempts,
            **http_request_meta,
        })

        _emit_debug_event(
            "engine_query_result",
            engine=engine,
            adapter_name=str(execution_request.get("adapter_name", adapter.adapter_name) or adapter.adapter_name),
            execution_kind=execution_kind,
            engine_query_text=_truncate_text(engine_query_text, 200),
            engine_query_url=engine_query_url,
            status="completed" if candidate_success else "failed",
            result_count=len(candidate_results),
            attempts=attempts,
            top_results=_summarize_candidate_results_for_debug(candidate_results),
            **http_request_meta,
        )

    return {
        "results_raw": raw_results,
        "engine_execution_trace": engine_execution_trace,
    }