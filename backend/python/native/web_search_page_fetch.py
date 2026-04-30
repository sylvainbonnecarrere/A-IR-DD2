"""Page fetch helpers for the industrial web_search_py pipeline."""

from __future__ import annotations

import html
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Callable, Dict, Iterable, List, Tuple
from urllib.request import Request, urlopen


DEFAULT_FETCH_TIMEOUT_SECONDS = 15
DEFAULT_MAX_CONTENT_BYTES = 250_000
DEFAULT_MAX_FETCH_WORKERS = 3
_HTML_BREAK_TAGS_RE = re.compile(r"<(?:br|/p|/div|/li|/h[1-6]|/tr|/section|/article)\b[^>]*>", re.IGNORECASE)
_HTML_COMMENT_RE = re.compile(r"<!--.*?-->", re.DOTALL)
_SCRIPT_STYLE_RE = re.compile(r"<(script|style)\b[^>]*>.*?</\1>", re.IGNORECASE | re.DOTALL)
_TAG_RE = re.compile(r"<[^>]+>")
_META_CHARSET_RE = re.compile(r'<meta[^>]+charset=["\']?([a-zA-Z0-9_\-]+)', re.IGNORECASE)


def build_page_fetch_request(url: str) -> Request:
    return Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
        },
    )


def normalize_html_to_text(payload: str) -> str:
    without_comments = _HTML_COMMENT_RE.sub(" ", payload)
    without_scripts = _SCRIPT_STYLE_RE.sub(" ", without_comments)
    with_breaks = _HTML_BREAK_TAGS_RE.sub("\n", without_scripts)
    without_tags = _TAG_RE.sub(" ", with_breaks)
    unescaped = html.unescape(without_tags)
    normalized_lines = [" ".join(line.split()) for line in unescaped.splitlines()]
    return "\n".join(line for line in normalized_lines if line).strip()


def detect_charset(content_type: str | None, payload: bytes, default: str = "utf-8") -> str:
    if content_type:
        charset_match = re.search(r"charset=([a-zA-Z0-9_\-]+)", content_type, flags=re.IGNORECASE)
        if charset_match:
            return charset_match.group(1)

    payload_head = payload[:2048].decode("ascii", errors="ignore")
    meta_match = _META_CHARSET_RE.search(payload_head)
    if meta_match:
        return meta_match.group(1)

    return default


def decode_html_payload(payload: bytes, content_type: str | None) -> Tuple[str, str]:
    charset = detect_charset(content_type, payload)
    try:
        return payload.decode(charset, errors="replace"), charset
    except LookupError:
        return payload.decode("utf-8", errors="replace"), "utf-8"


def fetch_page(
    url: str,
    *,
    timeout: int = DEFAULT_FETCH_TIMEOUT_SECONDS,
    max_content_bytes: int = DEFAULT_MAX_CONTENT_BYTES,
    opener: Callable[..., Any] = urlopen,
) -> Dict[str, Any]:
    request = build_page_fetch_request(url)
    with opener(request, timeout=timeout) as response:
        content_type = response.headers.get("Content-Type") if getattr(response, "headers", None) else None
        payload = response.read(max_content_bytes + 1)

    truncated = len(payload) > max_content_bytes
    bounded_payload = payload[:max_content_bytes]
    decoded_html, charset = decode_html_payload(bounded_payload, content_type)
    normalized_text = normalize_html_to_text(decoded_html)

    return {
        "url": url,
        "status": "fetched",
        "content_type": content_type or "",
        "charset": charset,
        "content": normalized_text,
        "truncated": truncated,
        "fetched": True,
    }


def _fallback_page_result(url: str, snippet: str, status: str, error: str | None = None) -> Dict[str, Any]:
    return {
        "url": url,
        "status": status,
        "content_type": "",
        "charset": "",
        "content": snippet,
        "truncated": False,
        "fetched": False,
        **({"error": error} if error else {}),
    }


def fetch_selected_pages(
    selected_results: Iterable[Dict[str, Any]],
    *,
    dig_snippet: bool,
    timeout: int = DEFAULT_FETCH_TIMEOUT_SECONDS,
    max_content_bytes: int = DEFAULT_MAX_CONTENT_BYTES,
    max_workers: int = DEFAULT_MAX_FETCH_WORKERS,
    opener: Callable[..., Any] = urlopen,
) -> List[Dict[str, Any]]:
    normalized_results = list(selected_results)
    if not dig_snippet:
        return [
            _fallback_page_result(
                str(result.get("url", "")),
                str(result.get("snippet", "")),
                "snippet_only",
            )
            for result in normalized_results
            if str(result.get("url", "")).strip()
        ]

    indexed_results = [
        (index, result)
        for index, result in enumerate(normalized_results)
        if str(result.get("url", "")).strip()
    ]

    fetched_pages: List[Dict[str, Any] | None] = [None] * len(indexed_results)

    with ThreadPoolExecutor(max_workers=max(1, min(max_workers, len(indexed_results) or 1))) as executor:
        futures = {
            executor.submit(
                fetch_page,
                str(result.get("url", "")),
                timeout=timeout,
                max_content_bytes=max_content_bytes,
                opener=opener,
            ): (position, result)
            for position, result in indexed_results
        }

        for future in as_completed(futures):
            position, result = futures[future]
            url = str(result.get("url", ""))
            snippet = str(result.get("snippet", ""))
            try:
                fetched_pages[position] = future.result()
            except Exception as exc:
                fetched_pages[position] = _fallback_page_result(
                    url,
                    snippet,
                    "fetch_failed_snippet_fallback",
                    str(exc),
                )

    return [page for page in fetched_pages if page is not None]