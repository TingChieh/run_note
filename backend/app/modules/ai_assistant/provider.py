"""Bounded async DeepSeek OpenAI-compatible streaming client.

Uses locked `httpx` with strict timeouts (5s connect, 30s read, overall deadline),
redirects forbidden, proxy environment ignored (`trust_env=False`), and zero automatic
retries. Never logs Authorization headers, request bodies, or model text.
"""

import asyncio
import json
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any

import httpx

from app.core.errors import ApiError

CONNECT_TIMEOUT_SECONDS = 5.0
WRITE_TIMEOUT_SECONDS = 10.0
POOL_TIMEOUT_SECONDS = 5.0
MAX_SSE_LINE_BYTES = 131_072


@dataclass(frozen=True)
class ProviderToolCall:
    id: str
    name: str
    arguments: str


@dataclass(frozen=True)
class ProviderTextDelta:
    text: str


@dataclass(frozen=True)
class ProviderRoundResult:
    text: str
    tool_calls: list[ProviderToolCall] = field(default_factory=list)
    finish_reason: str | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    cached_input_tokens: int | None = None


def build_chat_request(
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]],
    settings,
) -> dict[str, Any]:
    """Construct the DeepSeek chat completions streaming payload (D6: thinking disabled)."""
    body: dict[str, Any] = {
        "model": settings.ai_model,
        "messages": messages,
        "temperature": 0.2,
        "max_tokens": settings.ai_max_output_tokens,
        "stream": True,
        "stream_options": {"include_usage": True},
        "thinking": {"type": "disabled"},
    }
    if tools:
        body["tools"] = tools
        body["tool_choice"] = "auto"
    return body


def _extract_cached_tokens(usage: dict[str, Any]) -> int | None:
    if isinstance(usage.get("prompt_cache_hit_tokens"), int):
        return max(0, usage["prompt_cache_hit_tokens"])
    details = usage.get("prompt_tokens_details")
    if isinstance(details, dict) and isinstance(details.get("cached_tokens"), int):
        return max(0, details["cached_tokens"])
    return None


def _non_negative_int(value: Any) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else None


class DeepSeekProvider:
    """Async streaming client for DeepSeek's OpenAI-compatible `/chat/completions`."""

    def __init__(self, transport: httpx.AsyncBaseTransport | None = None):
        # Optional transport injection enables deterministic unit tests without network I/O.
        self._transport = transport

    async def stream_chat(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        settings,
        *,
        deadline: float,
    ) -> AsyncIterator[ProviderTextDelta | ProviderRoundResult]:
        if not settings.ai_configured:
            raise ApiError(503, "AI_NOT_CONFIGURED", "AI 服务尚未配置")

        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise ApiError(503, "AI_TIMEOUT", "AI 响应超时，请稍后重试")

        timeout = httpx.Timeout(
            connect=min(CONNECT_TIMEOUT_SECONDS, remaining),
            read=min(float(settings.ai_upstream_read_timeout_seconds), remaining),
            write=min(WRITE_TIMEOUT_SECONDS, remaining),
            pool=min(POOL_TIMEOUT_SECONDS, remaining),
        )
        url = settings.ai_base_url + "/chat/completions"
        headers = {
            "Authorization": "Bearer " + settings.ai_api_key.get_secret_value(),
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
        }
        payload = build_chat_request(messages, tools, settings)

        text_parts: list[str] = []
        tool_buffers: dict[int, dict[str, str]] = {}
        finish_reason: str | None = None
        saw_done = False
        input_tokens: int | None = None
        output_tokens: int | None = None
        cached_input_tokens: int | None = None

        try:
            async with httpx.AsyncClient(
                timeout=timeout,
                follow_redirects=False,
                trust_env=False,
                transport=self._transport,
            ) as client:
                async with client.stream("POST", url, headers=headers, json=payload) as response:
                    if not (200 <= response.status_code < 300):
                        raise ApiError(502, "AI_PROVIDER_ERROR", "AI 服务暂时不可用，请稍后重试")

                    line_iter = response.aiter_lines()
                    while True:
                        remaining = deadline - time.monotonic()
                        if remaining <= 0:
                            raise ApiError(503, "AI_TIMEOUT", "AI 响应超时，请稍后重试")
                        try:
                            raw_line = await asyncio.wait_for(anext(line_iter), timeout=remaining)
                        except StopAsyncIteration:
                            break
                        except TimeoutError:
                            raise ApiError(503, "AI_TIMEOUT", "AI 响应超时，请稍后重试") from None

                        if len(raw_line.encode("utf-8")) > MAX_SSE_LINE_BYTES:
                            raise ApiError(502, "AI_OUTPUT_INVALID", "AI 响应超出限制")
                        line = raw_line.strip()
                        if not line or line.startswith(":"):
                            continue
                        if not line.startswith("data:"):
                            continue
                        data_str = line[5:].strip()
                        if data_str == "[DONE]":
                            saw_done = True
                            break
                        try:
                            chunk = json.loads(data_str)
                        except ValueError:
                            raise ApiError(
                                502, "AI_OUTPUT_INVALID", "AI 返回了无法解析的响应"
                            ) from None
                        if not isinstance(chunk, dict):
                            raise ApiError(502, "AI_OUTPUT_INVALID", "AI 返回了无效响应")

                        usage = chunk.get("usage")
                        if isinstance(usage, dict):
                            input_tokens = _non_negative_int(usage.get("prompt_tokens"))
                            output_tokens = _non_negative_int(usage.get("completion_tokens"))
                            cached_input_tokens = _extract_cached_tokens(usage)

                        choices = chunk.get("choices")
                        if not isinstance(choices, list) or not choices:
                            continue
                        choice = choices[0]
                        if not isinstance(choice, dict):
                            continue
                        if choice.get("finish_reason"):
                            finish_reason = str(choice["finish_reason"])
                        delta = choice.get("delta")
                        if not isinstance(delta, dict):
                            continue

                        piece = delta.get("content")
                        if isinstance(piece, str) and piece:
                            text_parts.append(piece)
                            yield ProviderTextDelta(text=piece)

                        raw_tool_calls = delta.get("tool_calls")
                        if isinstance(raw_tool_calls, list):
                            for entry in raw_tool_calls:
                                if not isinstance(entry, dict):
                                    continue
                                idx = entry.get("index")
                                if not isinstance(idx, int) or idx < 0 or idx >= 16:
                                    continue
                                buf = tool_buffers.setdefault(
                                    idx, {"id": "", "name": "", "arguments": ""}
                                )
                                if isinstance(entry.get("id"), str) and entry["id"]:
                                    buf["id"] = entry["id"]
                                fn = entry.get("function")
                                if isinstance(fn, dict):
                                    if isinstance(fn.get("name"), str) and fn["name"]:
                                        buf["name"] += fn["name"]
                                    if isinstance(fn.get("arguments"), str) and fn["arguments"]:
                                        buf["arguments"] += fn["arguments"]
        except ApiError:
            raise
        except asyncio.CancelledError:
            raise
        except httpx.TimeoutException:
            raise ApiError(503, "AI_TIMEOUT", "AI 响应超时，请稍后重试") from None
        except httpx.HTTPError:
            raise ApiError(502, "AI_PROVIDER_ERROR", "AI 服务暂时不可用，请稍后重试") from None

        assembled_calls = [
            ProviderToolCall(
                id=buf["id"] or f"call_{idx}",
                name=buf["name"],
                arguments=buf["arguments"] or "{}",
            )
            for idx, buf in sorted(tool_buffers.items())
            if buf["name"]
        ]
        if not saw_done or finish_reason is None:
            raise ApiError(502, "AI_OUTPUT_INVALID", "AI 响应意外中断，请重试")
        if not text_parts and not assembled_calls:
            raise ApiError(502, "AI_OUTPUT_INVALID", "AI 未返回有效内容，请重试")
        yield ProviderRoundResult(
            text="".join(text_parts),
            tool_calls=assembled_calls,
            finish_reason=finish_reason,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cached_input_tokens=cached_input_tokens,
        )
