"""Deterministic pre-reranking orchestration for web_search_py."""

from __future__ import annotations

from typing import Any, Dict, List

from native.web_search_engine_adapters import resolve_search_engine_adapter
from native.web_search_engine_query_plan import build_engine_query_plans
from native.web_search_query_transformation import transform_query
from native.web_search_result_filter import deduplicate_raw_results
from native.web_search_system_context import build_system_context


DUCKDUCKGO_DDGS_BACKEND = "html"


def build_presearch_state(
    context: Any,
    args: Dict[str, Any],
    *,
    raw_query: str,
    language: str,
    runtime_params: Dict[str, Any],
) -> Dict[str, Any]:
    system_context = build_system_context(
        raw_query,
        language=language,
        location=str(args.get("location", "") or ""),
        specialization=str(args.get("specialization", "") or ""),
    )

    transformed_query = transform_query(
        context,
        raw_query,
        system_context=system_context,
        runtime_params=runtime_params,
    )
    if str(transformed_query.get("mode", "") or "") != "llm":
        raise ValueError(
            "QUERY_TRANSFORMATION_FAILED: "
            f"{str(transformed_query.get('raw_output', '') or 'hidden query transformation failed')}"
        )

    transformed_query_raw = str(
        transformed_query.get("transformed_query_raw")
        or transformed_query.get("normalized_query")
        or raw_query
    ).strip()
    engine_query_plans = build_engine_query_plans(
        web_engine=str(runtime_params.get("web_engine", "duckduckgo.com") or "duckduckgo.com"),
        transformed_query_raw=transformed_query_raw,
        allowed_domains=list(runtime_params.get("allowed_domains", [])),
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
) -> Dict[str, Any]:
    raw_results: List[Dict[str, Any]] = []
    engine_execution_trace: List[Dict[str, Any]] = []

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

        engine_query_text = str(execution_request.get("engine_query_text", "") or "").strip()
        candidate_results = _execute_ddgs_text(ddgs, engine_query_text, region, safesearch, num_results * 2)
        raw_results.extend(candidate_results)
        raw_results = deduplicate_raw_results(raw_results)
        engine_execution_trace.append({
            **plan,
            "adapter_name": execution_request.get("adapter_name", adapter.adapter_name),
            "execution_kind": execution_request.get("execution_kind", adapter.execution_kind),
            "query_engine": execution_request.get("engine_query_url", plan.get("engine_query_url", "")),
            "status": "completed",
            "backend": "ddgs_text_html",
            "result_count": len(candidate_results),
        })

    return {
        "results_raw": raw_results,
        "engine_execution_trace": engine_execution_trace,
    }