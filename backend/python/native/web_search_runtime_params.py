"""Runtime parameter resolution for the industrial web_search_py pipeline."""

from __future__ import annotations

from typing import Any, Dict, List


DEFAULT_FETCH_TIMEOUT_SECONDS = 15
DEFAULT_HIDDEN_LLM_TIMEOUT_SECONDS = 45
DEFAULT_LOCAL_HIDDEN_LLM_TIMEOUT_SECONDS = 120
DEFAULT_MAX_CONTENT_BYTES = 250_000
DEFAULT_MAX_FETCH_WORKERS = 3
DEFAULT_RELEVANCE_THRESHOLD = 7
DEFAULT_RERANK_STRATEGY = "Fast"
DEFAULT_MAX_CONTEXT_TOKENS = 4000
DEFAULT_MAX_USES = 5
DEFAULT_WEB_ENGINE = "duckduckgo.com"


def _as_bool(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"true", "1", "yes", "on"}:
            return True
        if lowered in {"false", "0", "no", "off"}:
            return False
    return default


def _as_int(value: Any, default: int, minimum: int = 1) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default

    return max(minimum, parsed)


def _to_mapping(value: Any) -> Dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _to_string_list(value: Any) -> List[str]:
    if not isinstance(value, list):
        return []

    normalized: List[str] = []
    for item in value:
        if not isinstance(item, str):
            continue
        trimmed = item.strip()
        if trimmed and trimmed not in normalized:
            normalized.append(trimmed)
    return normalized


def _as_string(value: Any, default: str = "") -> str:
    if value is None:
        return default
    if isinstance(value, str):
        return value
    return str(value)


def _is_local_hidden_llm_runtime(runtime: Dict[str, Any]) -> bool:
    provider = str(runtime.get("provider", "") or "").strip().lower()
    endpoint = str(runtime.get("endpoint", "") or "").strip()
    api_key = str(runtime.get("api_key", "") or "").strip()
    return "local" in provider or bool(endpoint and not api_key)


def resolve_runtime_params(context: Any, args: Dict[str, Any]) -> Dict[str, Any]:
    private_web_search = _to_mapping(getattr(context, "private_context", {}).get("web_search", {}))
    private_params = _to_mapping(private_web_search.get("params"))
    canonical_params = _to_mapping(args.get("web_search_params"))
    camel_params = _to_mapping(args.get("webSearchParams"))
    llm_runtime = _to_mapping(private_web_search.get("llm_runtime"))

    merged_params: Dict[str, Any] = {
        **camel_params,
        **canonical_params,
        **private_params,
    }
    default_hidden_llm_timeout_seconds = (
        DEFAULT_LOCAL_HIDDEN_LLM_TIMEOUT_SECONDS
        if _is_local_hidden_llm_runtime(llm_runtime)
        else DEFAULT_HIDDEN_LLM_TIMEOUT_SECONDS
    )

    num_results = _as_int(args.get("num_results"), 5, minimum=1)
    selected_result_limit = _as_int(
        merged_params.get("web_engine_nb_result_select", args.get("web_engine_nb_result_select", num_results)),
        num_results,
        minimum=1,
    )
    return {
        "dig_snippet": _as_bool(merged_params.get("dig_snippet", args.get("dig_snippet", False))),
        "selected_result_limit": selected_result_limit,
        "relevance_threshold": _as_int(
            merged_params.get("relevance_threshold", args.get("relevance_threshold", DEFAULT_RELEVANCE_THRESHOLD)),
            DEFAULT_RELEVANCE_THRESHOLD,
            minimum=1,
        ),
        "rerank_strategy": str(merged_params.get("rerank_strategy", args.get("rerank_strategy", DEFAULT_RERANK_STRATEGY)) or DEFAULT_RERANK_STRATEGY),
        "max_context_tokens": _as_int(
            merged_params.get("max_context_tokens", args.get("max_context_tokens", DEFAULT_MAX_CONTEXT_TOKENS)),
            DEFAULT_MAX_CONTEXT_TOKENS,
            minimum=256,
        ),
        "fetch_timeout_seconds": _as_int(
            merged_params.get("fetch_timeout_seconds", args.get("fetch_timeout_seconds", DEFAULT_FETCH_TIMEOUT_SECONDS)),
            DEFAULT_FETCH_TIMEOUT_SECONDS,
            minimum=1,
        ),
        "hidden_llm_timeout_seconds": _as_int(
            merged_params.get("hidden_llm_timeout_seconds", args.get("hidden_llm_timeout_seconds", default_hidden_llm_timeout_seconds)),
            default_hidden_llm_timeout_seconds,
            minimum=1,
        ),
        "max_content_bytes": _as_int(
            merged_params.get("max_content_bytes", args.get("max_content_bytes", DEFAULT_MAX_CONTENT_BYTES)),
            DEFAULT_MAX_CONTENT_BYTES,
            minimum=1024,
        ),
        "max_fetch_workers": _as_int(
            merged_params.get("max_fetch_workers", args.get("max_fetch_workers", DEFAULT_MAX_FETCH_WORKERS)),
            DEFAULT_MAX_FETCH_WORKERS,
            minimum=1,
        ),
        "max_uses": _as_int(
            merged_params.get("max_uses", args.get("max_uses", DEFAULT_MAX_USES)),
            DEFAULT_MAX_USES,
            minimum=1,
        ),
        "nb_request_transformation": 1,
        "request_list": False,
        "cross_lingual_search": _as_bool(merged_params.get("cross_lingual_search", args.get("cross_lingual_search", False))),
        "allowed_domains": _to_string_list(merged_params.get("allowed_domains", args.get("allowed_domains", []))),
        "query_transformation": str(merged_params.get("query_transformation", args.get("query_transformation", "")) or ""),
        "mock_transformed_query": _as_string(merged_params.get("mock_transformed_query", args.get("mock_transformed_query", "")), "").strip(),
        "mock_search_response_html": _as_string(merged_params.get("mock_search_response_html", args.get("mock_search_response_html", "")), "").strip(),
        "reranking_prompt": str(merged_params.get("reranking_prompt", args.get("reranking_prompt", "")) or ""),
        "web_engine_search": _as_bool(merged_params.get("web_engine_search", args.get("web_engine_search", True)), default=True),
        "web_engine": str(merged_params.get("web_engine", args.get("web_engine", DEFAULT_WEB_ENGINE)) or DEFAULT_WEB_ENGINE),
        "llm_runtime": llm_runtime,
    }