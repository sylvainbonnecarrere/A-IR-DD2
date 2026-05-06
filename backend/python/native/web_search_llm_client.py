"""Thin internal client for hidden web_search_py LLM completions."""

from __future__ import annotations

import json
import socket
import sys
from typing import Any, Dict
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def _to_mapping(value: Any) -> Dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _normalize_bearer_token(value: Any) -> str:
    token = str(value or "").strip()
    if not token:
        return ""
    return token if token.lower().startswith("bearer ") else f"Bearer {token}"


def _read_json_response(request: Request, timeout: int) -> Dict[str, Any]:
    timeout_arg = None if timeout <= 0 else timeout
    try:
        with urlopen(request, timeout=timeout_arg) as response:
            payload = response.read().decode("utf-8", errors="replace")
    except HTTPError as exc:
        raw_error = exc.read().decode("utf-8", errors="replace")
        raise ValueError(raw_error or exc.reason) from exc
    except socket.timeout as exc:
        raise ValueError(f"Timeout hidden LLM après {timeout}s.") from exc
    except TimeoutError as exc:
        raise ValueError(f"Timeout hidden LLM après {timeout}s.") from exc
    except URLError as exc:
        raise ValueError(f"Endpoint hidden LLM injoignable: {exc}") from exc

    try:
        parsed = json.loads(payload)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Réponse JSON invalide du backend hidden LLM: {payload[:300]}") from exc

    return parsed if isinstance(parsed, dict) else {}


def _post_json(url: str, headers: Dict[str, str], body: Dict[str, Any], timeout: int) -> Dict[str, Any]:
    request = Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            **headers,
        },
        method="POST",
    )
    return _read_json_response(request, timeout)


def _emit_event(payload: Dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=False), file=sys.stderr)


def complete_text(
    context: Any,
    *,
    system_prompt: str,
    user_prompt: str,
    timeout: int = 30,
    max_tokens: int = 800,
    allow_reasoning_retry: bool = True,
) -> str:
    timeout_value = int(timeout)
    private_root = _to_mapping(getattr(context, "private_context", {}))
    web_search = _to_mapping(private_root.get("web_search"))
    runtime = _to_mapping(web_search.get("llm_runtime"))

    completion_api_url = str(runtime.get("completion_api_url", "") or "").strip()
    if not completion_api_url:
        raise ValueError("Aucun endpoint backend hidden LLM n'est disponible pour web_search_py.")

    request_runtime = {
        key: value
        for key, value in runtime.items()
        if key not in {"completion_api_url", "auth_token"}
    }

    headers: Dict[str, str] = {}
    auth_header = _normalize_bearer_token(runtime.get("auth_token"))
    if auth_header:
        headers["Authorization"] = auth_header

    _emit_event({
        "event": "web_search_hidden_llm_request_start",
        "provider": request_runtime.get("provider"),
        "model": request_runtime.get("model"),
        "timeout_seconds": timeout_value,
        "timeout_disabled": timeout_value <= 0,
        "max_tokens": max(1, int(max_tokens)),
        "allow_reasoning_retry": bool(allow_reasoning_retry),
        "system_prompt_length": len(system_prompt or ""),
        "user_prompt_length": len(user_prompt or ""),
    })

    response = _post_json(
        completion_api_url,
        headers,
        {
            "runtime": request_runtime,
            "systemPrompt": system_prompt,
            "userPrompt": user_prompt,
            "timeoutSeconds": max(0, timeout_value),
            "maxTokens": max(1, int(max_tokens)),
            "allowReasoningRetry": bool(allow_reasoning_retry),
        },
        max(0, timeout_value),
    )

    text = response.get("text") if isinstance(response, dict) else None
    if not isinstance(text, str) or not text.strip():
        raise ValueError(f"Réponse backend hidden LLM invalide: {response}")

    _emit_event({
        "event": "web_search_hidden_llm_request_success",
        "provider": request_runtime.get("provider"),
        "model": request_runtime.get("model"),
        "text_length": len(text.strip()),
    })

    return text.strip()