"""Business search engine adapters for pre-reranking web search execution."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict
from urllib.parse import quote_plus


DEFAULT_WEB_ENGINE = "duckduckgo.com"


def _normalize_whitespace(value: str) -> str:
    return " ".join(str(value or "").split())


@dataclass(frozen=True)
class SearchEngineAdapter:
    engine: str
    adapter_name: str
    query_param_name: str
    base_search_url: str
    execution_kind: str
    supported_runtime: bool
    default_params: Dict[str, str]

    def build_query_url(self, engine_query_text: str) -> str:
        encoded_query = quote_plus(_normalize_whitespace(engine_query_text))
        separator = "&" if "?" in self.base_search_url else "?"
        return f"{self.base_search_url}{separator}{self.query_param_name}={encoded_query}"

    def build_execution_request(
        self,
        *,
        engine_query_text: str,
        region: str,
        safesearch: str,
        max_results: int,
    ) -> Dict[str, object]:
        execution_request: Dict[str, object] = {
            "engine": self.engine,
            "adapter_name": self.adapter_name,
            "execution_kind": self.execution_kind,
            "supported_runtime": self.supported_runtime,
            "engine_query_text": engine_query_text,
            "engine_query_url": self.build_query_url(engine_query_text),
            "request": {
                **self.default_params,
                self.query_param_name: engine_query_text,
                "region": region,
                "safe_search": safesearch,
                "max_results": max_results,
            },
        }

        if self.engine == "duckduckgo.com":
            execution_request["backend"] = "html"

        return execution_request


_ADAPTERS: Dict[str, SearchEngineAdapter] = {
    "duckduckgo.com": SearchEngineAdapter(
        engine="duckduckgo.com",
        adapter_name="DuckDuckGoSearchAdapter",
        query_param_name="q",
        base_search_url="https://duckduckgo.com/",
        execution_kind="ddgs_text",
        supported_runtime=True,
        default_params={},
    ),
    "google.com": SearchEngineAdapter(
        engine="google.com",
        adapter_name="GoogleSearchAdapter",
        query_param_name="q",
        base_search_url="https://www.google.com/search",
        execution_kind="http_search_page",
        supported_runtime=True,
        default_params={},
    ),
    "bing.com": SearchEngineAdapter(
        engine="bing.com",
        adapter_name="BingSearchAdapter",
        query_param_name="q",
        base_search_url="https://www.bing.com/search",
        execution_kind="http_search_page",
        supported_runtime=True,
        default_params={},
    ),
    "baidu.com": SearchEngineAdapter(
        engine="baidu.com",
        adapter_name="BaiduSearchAdapter",
        query_param_name="wd",
        base_search_url="https://www.baidu.com/s",
        execution_kind="http_search_page",
        supported_runtime=True,
        default_params={},
    ),
    "qwant.com": SearchEngineAdapter(
        engine="qwant.com",
        adapter_name="QwantSearchAdapter",
        query_param_name="q",
        base_search_url="https://www.qwant.com/",
        execution_kind="http_search_page",
        supported_runtime=True,
        default_params={"t": "web"},
    ),
}


def resolve_search_engine_adapter(web_engine: str) -> SearchEngineAdapter:
    normalized_engine = _normalize_whitespace(web_engine).lower() or DEFAULT_WEB_ENGINE
    adapter = _ADAPTERS.get(normalized_engine)
    if adapter is None:
        raise ValueError(f"SEARCH_ENGINE_UNAVAILABLE:{normalized_engine}")
    return adapter