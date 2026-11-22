"""Unit tests for DeepSeek async streaming client and agent-loop orchestrator (zero network)."""

import asyncio
import json
import logging
import time
from collections.abc import AsyncIterator
from datetime import UTC, date, datetime
from uuid import uuid4

import httpx
import pytest

from app.core.config import Settings
from app.core.errors import ApiError
from app.modules.ai_assistant.orchestrator import (
    ActiveStreamRegistry,
    TurnStart,
    stream_turn,
)
from app.modules.ai_assistant.provider import (
    DeepSeekProvider,
    ProviderRoundResult,
    ProviderTextDelta,
    ProviderToolCall,
)


def _settings(**overrides) -> Settings:
    values = {
        "database_url": "postgresql+psycopg://fake:fake@127.0.0.1:1/test",
        "ai_base_url": "https://api.deepseek.com",
        "ai_model": "deepseek-chat",
        "ai_api_key": "sk-secret-synthetic-999",
        "ai_stream_total_timeout_seconds": 90,
        "ai_upstream_read_timeout_seconds": 30,
        "ai_max_tool_rounds": 4,
        "ai_max_output_tokens": 2048,
        **overrides,
    }
    return Settings(_env_file=None, **values)


def _sse_body(*chunks: dict | str) -> bytes:
    lines: list[str] = []
    for item in chunks:
        if isinstance(item, str):
            lines.append(f"data: {item}\n\n")
        else:
            lines.append(f"data: {json.dumps(item, ensure_ascii=False)}\n\n")
    return "".join(lines).encode("utf-8")


def _parse_sse_frames(frames: list[str]) -> list[tuple[str, dict]]:
    parsed: list[tuple[str, dict]] = []
    for frame in frames:
        event = ""
        data = "{}"
        for line in frame.strip().splitlines():
            if line.startswith("event:"):
                event = line[6:].strip()
            elif line.startswith("data:"):
                data = line[5:].strip()
        parsed.append((event, json.loads(data)))
    return parsed


def test_deepseek_provider_streams_deltas_usage_and_logs_no_secrets(caplog):
    captured: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["auth"] = request.headers.get("authorization")
        captured["body"] = json.loads(request.content.decode("utf-8"))
        body = _sse_body(
            {"choices": [{"delta": {"content": "最近四周"}}]},
            {"choices": [{"delta": {"content": "共跑了 40 公里。"}, "finish_reason": "stop"}]},
            {
                "choices": [],
                "usage": {
                    "prompt_tokens": 1200,
                    "completion_tokens": 35,
                    "prompt_cache_hit_tokens": 900,
                },
            },
            "[DONE]",
        )
        return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=body)

    async def run():
        provider = DeepSeekProvider(transport=httpx.MockTransport(handler))
        items = []
        async for item in provider.stream_chat(
            [{"role": "user", "content": "SECRET_PROMPT_42"}],
            [],
            _settings(),
            deadline=time.monotonic() + 10,
        ):
            items.append(item)
        return items

    with caplog.at_level(logging.INFO):
        items = asyncio.run(run())

    assert captured["url"] == "https://api.deepseek.com/chat/completions"
    assert captured["auth"] == "Bearer sk-secret-synthetic-999"
    assert captured["body"]["thinking"] == {"type": "disabled"}
    assert captured["body"]["stream"] is True
    assert captured["body"]["stream_options"] == {"include_usage": True}

    deltas = [i.text for i in items if isinstance(i, ProviderTextDelta)]
    results = [i for i in items if isinstance(i, ProviderRoundResult)]
    assert deltas == ["最近四周", "共跑了 40 公里。"]
    assert len(results) == 1
    assert results[0].text == "最近四周共跑了 40 公里。"
    assert results[0].finish_reason == "stop"
    assert results[0].input_tokens == 1200
    assert results[0].output_tokens == 35
    assert results[0].cached_input_tokens == 900

    log_blob = "\n".join(rec.getMessage() for rec in caplog.records)
    assert "sk-secret-synthetic-999" not in log_blob
    assert "SECRET_PROMPT_42" not in log_blob
    assert "共跑了 40 公里" not in log_blob


def test_deepseek_provider_assembles_chunked_tool_calls_and_cached_details():
    def handler(_request: httpx.Request) -> httpx.Response:
        body = _sse_body(
            {
                "choices": [
                    {
                        "delta": {
                            "tool_calls": [
                                {
                                    "index": 0,
                                    "id": "call_abc",
                                    "function": {"name": "get_running_", "arguments": '{"date_'},
                                }
                            ]
                        }
                    }
                ]
            },
            {
                "choices": [
                    {
                        "delta": {
                            "tool_calls": [
                                {
                                    "index": 0,
                                    "function": {
                                        "name": "summary",
                                        "arguments": 'from":"2026-11-01","date_to":"2026-12-01"}',
                                    },
                                }
                            ]
                        },
                        "finish_reason": "tool_calls",
                    }
                ]
            },
            {
                "choices": [],
                "usage": {
                    "prompt_tokens": 800,
                    "completion_tokens": 20,
                    "prompt_tokens_details": {"cached_tokens": 500},
                },
            },
            "[DONE]",
        )
        return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=body)

    async def run():
        provider = DeepSeekProvider(transport=httpx.MockTransport(handler))
        return [
            item
            async for item in provider.stream_chat(
                [{"role": "user", "content": "查11月汇总"}],
                [],
                _settings(),
                deadline=time.monotonic() + 10,
            )
        ]

    items = asyncio.run(run())
    assert len(items) == 1
    result = items[0]
    assert isinstance(result, ProviderRoundResult)
    assert result.finish_reason == "tool_calls"
    assert result.cached_input_tokens == 500
    assert result.tool_calls == [
        ProviderToolCall(
            id="call_abc",
            name="get_running_summary",
            arguments='{"date_from":"2026-11-01","date_to":"2026-12-01"}',
        )
    ]


@pytest.mark.parametrize(
    "status_code,expected_code",
    [
        (302, "AI_PROVIDER_ERROR"),
        (429, "AI_PROVIDER_ERROR"),
        (500, "AI_PROVIDER_ERROR"),
    ],
)
def test_deepseek_provider_rejects_redirects_and_non_2xx(status_code, expected_code):
    calls = 0

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        headers = {"location": "https://evil.example.test/steal"} if status_code == 302 else {}
        return httpx.Response(status_code, headers=headers, content=b"error")

    async def run():
        provider = DeepSeekProvider(transport=httpx.MockTransport(handler))
        async for _ in provider.stream_chat(
            [{"role": "user", "content": "hi"}], [], _settings(), deadline=time.monotonic() + 10
        ):
            pass

    with pytest.raises(ApiError) as err:
        asyncio.run(run())
    assert err.value.code == expected_code
    assert calls == 1


def test_deepseek_provider_maps_malformed_json_and_timeouts():
    def bad_json(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"data: {not-valid-json\n\n")

    def read_timeout(_request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("upstream read timed out")

    async def run(fn, *, deadline_offset=10.0):
        provider = DeepSeekProvider(transport=httpx.MockTransport(fn))
        async for _ in provider.stream_chat(
            [{"role": "user", "content": "hi"}],
            [],
            _settings(),
            deadline=time.monotonic() + deadline_offset,
        ):
            pass

    with pytest.raises(ApiError) as err:
        asyncio.run(run(bad_json))
    assert err.value.code == "AI_OUTPUT_INVALID"

    with pytest.raises(ApiError) as err:
        asyncio.run(run(read_timeout))
    assert err.value.code == "AI_TIMEOUT"

    with pytest.raises(ApiError) as err:
        asyncio.run(run(bad_json, deadline_offset=-0.1))
    assert err.value.code == "AI_TIMEOUT"


@pytest.mark.parametrize(
    "raw_body",
    [
        b"",
        _sse_body({"choices": [{"delta": {"content": "半截内容"}}]}),
        _sse_body({"choices": [{"delta": {"content": "无完成标记"}}]}, "[DONE]"),
        _sse_body({"choices": [{"delta": {"content": "缺少DONE"}, "finish_reason": "stop"}]}),
        _sse_body({"choices": [{"delta": {}, "finish_reason": "stop"}]}, "[DONE]"),
    ],
)
def test_deepseek_provider_rejects_empty_or_incomplete_streams(raw_body):
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=raw_body)

    async def run():
        provider = DeepSeekProvider(transport=httpx.MockTransport(handler))
        async for _ in provider.stream_chat(
            [{"role": "user", "content": "hi"}], [], _settings(), deadline=time.monotonic() + 10
        ):
            pass

    with pytest.raises(ApiError) as err:
        asyncio.run(run())
    assert err.value.code == "AI_OUTPUT_INVALID"


class _SlowStream(httpx.AsyncByteStream):
    def __init__(self, cancelled_flag: list[bool]):
        self.cancelled_flag = cancelled_flag

    async def __aiter__(self) -> AsyncIterator[bytes]:
        yield b'data: {"choices":[{"delta":{"content":"part1"}}]}\n\n'
        try:
            await asyncio.sleep(5)
        except asyncio.CancelledError:
            self.cancelled_flag.append(True)
            raise

    async def aclose(self) -> None:
        pass


def test_deepseek_provider_cancels_upstream_stream_on_task_cancel():
    cancelled: list[bool] = []

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, stream=_SlowStream(cancelled))

    async def run():
        provider = DeepSeekProvider(transport=httpx.MockTransport(handler))
        got_first = asyncio.Event()

        async def consume():
            async for item in provider.stream_chat(
                [{"role": "user", "content": "hi"}],
                [],
                _settings(),
                deadline=time.monotonic() + 10,
            ):
                if isinstance(item, ProviderTextDelta):
                    got_first.set()

        task = asyncio.create_task(consume())
        await got_first.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(run())
    assert cancelled == [True]


def test_orchestrator_emits_ping_heartbeat_enforces_tool_caps_and_handles_bad_tools(monkeypatch):
    from app.modules.ai_assistant import orchestrator

    saved: list[dict] = []
    monkeypatch.setattr(orchestrator, "_mark_streaming", lambda *_a, **_kw: True)
    monkeypatch.setattr(orchestrator, "_load_history", lambda *_a, **_kw: [])
    monkeypatch.setattr(orchestrator, "_is_cancelled_in_db", lambda *_a, **_kw: False)

    def fake_save(_sf, _oid, _mid, status, **kwargs):
        saved.append({"status": status, **kwargs})
        return True

    monkeypatch.setattr(orchestrator, "_persist_finish", fake_save)

    class _FakeProvider:
        def __init__(self):
            self.round_tools_counts: list[int] = []

        async def stream_chat(self, _messages, tools, _settings, *, deadline):
            self.round_tools_counts.append(len(tools))
            if len(self.round_tools_counts) == 1:
                await asyncio.sleep(0.08)
                # Return 1 unknown tool + 8 invalid calls (exceeds MAX_TOOL_CALLS_PER_TURN = 8).
                calls = [ProviderToolCall(id="c0", name="drop_database", arguments="{}")] + [
                    ProviderToolCall(
                        id=f"c{i}",
                        name="get_activity_detail",
                        arguments='{"activity_id":"not-a-uuid"}',
                    )
                    for i in range(1, 9)
                ]
                yield ProviderRoundResult(
                    text="",
                    tool_calls=calls,
                    finish_reason="tool_calls",
                    input_tokens=100,
                    output_tokens=20,
                    cached_input_tokens=50,
                )
            else:
                yield ProviderTextDelta(text="已处理工具异常并给出回答。")
                yield ProviderRoundResult(
                    text="已处理工具异常并给出回答。",
                    tool_calls=[],
                    finish_reason="length",
                    input_tokens=150,
                    output_tokens=30,
                    cached_input_tokens=100,
                )

    class _DummySession:
        def __enter__(self):
            return self

        def __exit__(self, *_a):
            return False

        def rollback(self):
            pass

    async def not_disconnected():
        return False

    provider = _FakeProvider()
    turn = TurnStart(
        owner_id=uuid4(),
        timezone="Asia/Shanghai",
        today=date(2026, 11, 22),
        conversation_id=uuid4(),
        user_message_id=uuid4(),
        assistant_message_id=uuid4(),
        user_content="测试工具上限",
        remaining_messages_today=29,
        remaining_tokens_today=140_000,
    )

    async def collect():
        return [
            frame
            async for frame in stream_turn(
                turn,
                session_factory=lambda: _DummySession(),
                settings=_settings(ai_max_tool_rounds=3),
                provider=provider,
                clock=lambda: datetime(2026, 11, 22, 10, 0, tzinfo=UTC),
                streams=ActiveStreamRegistry(),
                is_disconnected=not_disconnected,
                heartbeat_interval=0.03,
            )
        ]

    events = _parse_sse_frames(asyncio.run(collect()))
    names = [name for name, _ in events]
    assert names[0] == "meta"
    assert names[1] == "status"
    assert "ping" in names
    assert names.count("tool_start") == 8  # capped at MAX_TOOL_CALLS_PER_TURN (9th call skipped)
    assert names.count("tool_end") == 8
    assert all(data["ok"] is False for name, data in events if name == "tool_end")
    # Second round receives empty tools because total_tool_calls reached 8.
    assert provider.round_tools_counts == [10, 0]
    done_event, done_data = events[-1]
    assert done_event == "done"
    assert done_data["status"] == "succeeded"
    assert done_data["is_truncated"] is True
    assert done_data["usage"] == {
        "input_tokens": 250,
        "output_tokens": 50,
        "cached_input_tokens": 150,
    }
    assert saved[-1]["status"] == "succeeded"
    assert saved[-1]["input_tokens"] == 250


def test_orchestrator_handles_cancel_race_before_succeeded_finish_and_retries_save(monkeypatch):
    from app.modules.ai_assistant import orchestrator

    monkeypatch.setattr(orchestrator, "_mark_streaming", lambda *_a, **_kw: True)
    monkeypatch.setattr(orchestrator, "_load_history", lambda *_a, **_kw: [])

    # Case 1 (P3-1): _is_cancelled_in_db returns False right before finish_turn("succeeded"),
    # then another worker cancels the row so finish_turn("succeeded") returns False and
    # _is_cancelled_in_db now returns True -> orchestrator must backfill cancelled & emit cancelled.
    db_cancelled = [False]
    calls: list[tuple[str, str | None]] = []

    def fake_is_cancelled(*_a, **_kw):
        return db_cancelled[0]

    def fake_persist(_sf, _oid, _mid, status, **kwargs):
        calls.append((status, kwargs.get("content")))
        if status == "succeeded":
            db_cancelled[0] = True
            return False
        return True

    monkeypatch.setattr(orchestrator, "_is_cancelled_in_db", fake_is_cancelled)
    monkeypatch.setattr(orchestrator, "_persist_finish", fake_persist)

    class _SimpleProvider:
        async def stream_chat(self, _messages, _tools, _settings, *, deadline):
            yield ProviderTextDelta(text="已完成的内容")
            yield ProviderRoundResult(
                text="已完成的内容",
                tool_calls=[],
                finish_reason="stop",
                input_tokens=80,
                output_tokens=20,
                cached_input_tokens=40,
            )

    async def not_disconnected():
        return False

    turn = TurnStart(
        owner_id=uuid4(),
        timezone="Asia/Shanghai",
        today=date(2026, 11, 22),
        conversation_id=uuid4(),
        user_message_id=uuid4(),
        assistant_message_id=uuid4(),
        user_content="窄窗口测试",
        remaining_messages_today=29,
        remaining_tokens_today=100_000,
    )

    async def collect():
        return [
            frame
            async for frame in stream_turn(
                turn,
                session_factory=lambda: None,
                settings=_settings(),
                provider=_SimpleProvider(),
                clock=lambda: datetime(2026, 11, 22, 10, 0, tzinfo=UTC),
                streams=ActiveStreamRegistry(),
                is_disconnected=not_disconnected,
            )
        ]

    events = _parse_sse_frames(asyncio.run(collect()))
    assert events[-1][0] == "done"
    assert events[-1][1]["status"] == "cancelled"
    assert events[-1][1]["finish_reason"] == "cancelled"
    assert calls == [("succeeded", "已完成的内容"), ("cancelled", "已完成的内容")]

    # Case 2 (P3-2): transient DB error on first _persist_finish must leave persisted=False so
    # the exception/finally handler can still persist a terminal state instead of leaving streaming.
    retry_calls: list[str] = []

    def flaky_persist(_sf, _oid, _mid, status, **_kwargs):
        retry_calls.append(status)
        if len(retry_calls) == 1:
            raise RuntimeError("transient DB disconnect")
        return True

    db_cancelled[0] = False
    monkeypatch.setattr(orchestrator, "_persist_finish", flaky_persist)
    events2 = _parse_sse_frames(asyncio.run(collect()))
    assert retry_calls == ["succeeded", "failed"]
    assert events2[-1][0] == "done"
    assert events2[-1][1]["status"] == "failed"


def test_orchestrator_caps_maxed_out_turn_usage_within_turn_token_limit(monkeypatch):
    """Maxed history (8000 chars) + maxed user prompt (4000 chars) + maxed 12KB tool results
    must stay strictly within turn_token_limit in done.usage and stop calling tools once
    context_budget replacement occurs or budget cannot fit another model request.
    """
    from app.modules.ai_assistant import orchestrator, service
    from app.modules.ai_assistant.tools import ToolExecutionResult

    settings = _settings(ai_max_tool_rounds=4, ai_max_output_tokens=2048)
    turn_limit = service.turn_token_limit(settings)
    assert turn_limit == 48_192

    # Build maxed-out 8,000-char CJK sliding history (4 x 2,000 chars) and 4,000-char user input.
    maxed_history = [
        {"role": "user" if i % 2 == 0 else "assistant", "content": "跑" * 2000} for i in range(4)
    ]
    maxed_user = "配" * 4000
    # ~12,259-byte tool payload per call (matching the review's exact stress case).
    big_payload = {
        "items": [{"k": "1234567890" * 10, "c": "杭州市西湖区跑步记录"} for _ in range(84)]
    }
    big_bytes = len(json.dumps(big_payload, ensure_ascii=False, separators=(",", ":")).encode())
    assert 12_000 <= big_bytes <= 12_288

    monkeypatch.setattr(orchestrator, "_mark_streaming", lambda *_a, **_kw: True)
    monkeypatch.setattr(orchestrator, "_load_history", lambda *_a, **_kw: list(maxed_history))
    monkeypatch.setattr(orchestrator, "_is_cancelled_in_db", lambda *_a, **_kw: False)
    monkeypatch.setattr(
        orchestrator,
        "_run_tool_in_isolated_session",
        lambda _sf, _ctx, name, _args: ToolExecutionResult(
            tool_name=name,
            model_payload=big_payload,
            ui_blocks=[],
            degraded=False,
            truncated=False,
        ),
    )

    saved: list[dict] = []
    monkeypatch.setattr(
        orchestrator,
        "_persist_finish",
        lambda _sf, _oid, _mid, status, **kw: saved.append({"status": status, **kw}) or True,
    )

    def _realistic_deepseek_tokens(messages, tools) -> int:
        # Realistic DeepSeek-V3 BPE approximation (~0.85 tok/CJK, ~0.35 tok/ASCII, 1.0/digit).
        blob = json.dumps(messages, ensure_ascii=False, separators=(",", ":"))
        if tools:
            blob += json.dumps(tools, ensure_ascii=False, separators=(",", ":"))
        digits = sum(1 for c in blob if "0" <= c <= "9")
        ascii_other = sum(1 for c in blob if ord(c) < 128 and not ("0" <= c <= "9"))
        non_ascii = len(blob) - digits - ascii_other
        return int(digits * 1.0 + ascii_other * 0.35 + non_ascii * 0.85) + 32

    class _StressProvider:
        def __init__(self):
            self.calls: list[dict] = []

        async def stream_chat(self, messages, tools, _settings, *, deadline):
            in_tok = _realistic_deepseek_tokens(messages, tools)
            self.calls.append({"tool_count": len(tools), "input_tokens": in_tok})
            # Even if the model keeps trying to call tools whenever tools are offered,
            # the orchestrator must stop offering tools (or stop calling the model) before
            # total usage can ever exceed turn_token_limit.
            if tools:
                yield ProviderRoundResult(
                    text="",
                    tool_calls=[
                        ProviderToolCall(
                            id=f"c_{len(self.calls)}_1",
                            name="search_activities",
                            arguments='{"limit":20}',
                        ),
                        ProviderToolCall(
                            id=f"c_{len(self.calls)}_2",
                            name="get_footprint_summary",
                            arguments='{"scope":"china"}',
                        ),
                        ProviderToolCall(
                            id=f"c_{len(self.calls)}_3",
                            name="get_personal_records",
                            arguments="{}",
                        ),
                    ],
                    finish_reason="tool_calls",
                    input_tokens=in_tok,
                    output_tokens=80,
                    cached_input_tokens=in_tok // 2,
                )
            else:
                yield ProviderTextDelta(text="基于已获取的数据给出最终总结。")
                yield ProviderRoundResult(
                    text="基于已获取的数据给出最终总结。",
                    tool_calls=[],
                    finish_reason="stop",
                    input_tokens=in_tok,
                    output_tokens=120,
                    cached_input_tokens=in_tok // 2,
                )

    async def not_disconnected():
        return False

    provider = _StressProvider()
    turn = TurnStart(
        owner_id=uuid4(),
        timezone="Asia/Shanghai",
        today=date(2026, 11, 22),
        conversation_id=uuid4(),
        user_message_id=uuid4(),
        assistant_message_id=uuid4(),
        user_content=maxed_user,
        remaining_messages_today=29,
        remaining_tokens_today=150_000,
    )

    async def collect():
        return [
            frame
            async for frame in stream_turn(
                turn,
                session_factory=lambda: None,
                settings=settings,
                provider=provider,
                clock=lambda: datetime(2026, 11, 22, 10, 0, tzinfo=UTC),
                streams=ActiveStreamRegistry(),
                is_disconnected=not_disconnected,
            )
        ]

    events = _parse_sse_frames(asyncio.run(collect()))
    done_event, done_data = events[-1]
    assert done_event == "done"
    assert done_data["status"] == "succeeded"
    total_used = done_data["usage"]["input_tokens"] + done_data["usage"]["output_tokens"]
    assert total_used <= turn_limit, f"total_used={total_used} exceeded turn_limit={turn_limit}"
    # Round 1 used 3 tools (3rd hit context_budget replacement), so Round 2 must NOT receive tools
    # (or must stop before calling again).
    assert len(provider.calls) <= 2
    if len(provider.calls) == 2:
        assert provider.calls[1]["tool_count"] == 0
    assert saved[-1]["input_tokens"] + saved[-1]["output_tokens"] == total_used

    # Also verify pre-call gate refuses an over-budget call when an adversarial provider ignores
    # empty tools and returns tool calls until budget is exhausted.
    class _AdversarialProvider:
        def __init__(self):
            self.call_count = 0

        async def stream_chat(self, messages, tools, _settings, *, deadline):
            self.call_count += 1
            in_tok = _realistic_deepseek_tokens(messages, tools)
            yield ProviderRoundResult(
                text="",
                tool_calls=[
                    ProviderToolCall(
                        id=f"adv_{self.call_count}",
                        name="search_activities",
                        arguments='{"limit":20}',
                    )
                ],
                finish_reason="tool_calls",
                input_tokens=in_tok,
                output_tokens=2048,
                cached_input_tokens=0,
            )

    adv_provider = _AdversarialProvider()

    async def collect_adv():
        return [
            frame
            async for frame in stream_turn(
                turn,
                session_factory=lambda: None,
                settings=settings,
                provider=adv_provider,
                clock=lambda: datetime(2026, 11, 22, 10, 0, tzinfo=UTC),
                streams=ActiveStreamRegistry(),
                is_disconnected=not_disconnected,
            )
        ]

    adv_events = _parse_sse_frames(asyncio.run(collect_adv()))
    adv_done = adv_events[-1][1]
    adv_total = adv_done["usage"]["input_tokens"] + adv_done["usage"]["output_tokens"]
    assert adv_total <= turn_limit, f"adv_total={adv_total} exceeded turn_limit={turn_limit}"
    assert adv_done["finish_reason"] == "budget_limit"
    assert adv_done["is_truncated"] is True
    assert adv_provider.call_count < 4
