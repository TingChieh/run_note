"""HTTP & SSE integration tests for AI assistant Phase 2 on an isolated PostGIS _test database.

Covers: cross-user 404 isolation across every conversation/message route, auth/CSRF/consent/context,
conversation CRUD, streaming tool loop with independent read-only sessions, sliding history window,
idempotency replay & conflict, concurrency lock, explicit cancellation, error/timeout handling,
and non-refunding quotas on failure or deletion.
"""

import asyncio
import json
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.config import Settings
from app.core.errors import ApiError
from app.main import create_app
from app.modules.activities.model import Activity
from app.modules.ai_assistant.model import AIMessage
from app.modules.ai_assistant.provider import (
    ProviderRoundResult,
    ProviderTextDelta,
    ProviderToolCall,
)
from app.modules.footprints.model import ActivityProvinceCache
from app.modules.footprints.provinces import atlas_version as china_atlas_version
from app.modules.users.model import User
from tests.conftest import headers, register

pytestmark = pytest.mark.integration


def _parse_sse(raw: str) -> list[tuple[str, dict]]:
    events: list[tuple[str, dict]] = []
    for block in raw.strip().split("\n\n"):
        if not block.strip():
            continue
        event = ""
        data = "{}"
        for line in block.splitlines():
            if line.startswith("event:"):
                event = line[6:].strip()
            elif line.startswith("data:"):
                data = line[5:].strip()
        if event:
            events.append((event, json.loads(data)))
    return events


class _ScriptedProvider:
    """Deterministic async mock provider with optional pause/error hooks."""

    def __init__(self):
        self.calls: list[dict] = []
        self.script: list = []
        self.entered = threading.Event()
        self.release: threading.Event | None = None
        self.cancelled = threading.Event()

    def queue(self, *steps):
        self.script.extend(steps)

    async def stream_chat(self, messages, tools, settings, *, deadline):
        self.calls.append(
            {
                "messages": json.loads(json.dumps(messages, ensure_ascii=False)),
                "tool_names": [t["function"]["name"] for t in tools],
            }
        )
        step = self.script.pop(0) if self.script else {"deltas": ["默认答复"], "result": {}}
        if isinstance(step, Exception):
            raise step

        self.entered.set()
        for piece in step.get("deltas", []):
            yield ProviderTextDelta(text=piece)

        if step.get("wait_until_released") and self.release is not None:
            try:
                while not self.release.is_set():
                    await asyncio.sleep(0.02)
            except asyncio.CancelledError:
                self.cancelled.set()
                raise

        res = step.get("result", {})
        yield ProviderRoundResult(
            text="".join(step.get("deltas", [])),
            tool_calls=res.get("tool_calls", []),
            finish_reason=res.get("finish_reason", "stop"),
            input_tokens=res.get("input_tokens", 120),
            output_tokens=res.get("output_tokens", 40),
            cached_input_tokens=res.get("cached_input_tokens", 60),
        )


@pytest.fixture
def assistant_api():
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.skip("Explicit isolated test database required")
    settings = Settings(
        database_url=url,
        site_origin="http://127.0.0.1:5183",
        auth_rate_hash_key=uuid4().hex,
        ai_base_url="http://127.0.0.1:1/v1",
        ai_model="deepseek-chat",
        ai_api_key="synthetic-test-key",
        ai_daily_message_limit=10,
        ai_daily_token_budget=50_000,
        ai_site_daily_token_budget=500_000,
        _env_file=None,
    )
    now_box = [datetime(2026, 11, 22, 10, 0, tzinfo=UTC)]
    app = create_app(settings.model_copy())
    other_app = create_app(settings.model_copy())
    app.state.clock = lambda: now_box[0]
    other_app.state.clock = lambda: now_box[0]
    provider = _ScriptedProvider()
    app.state.ai_assistant_provider = provider
    other_app.state.ai_assistant_provider = provider
    other_app.state.ai_assistant_streams = app.state.ai_assistant_streams
    created_users: list[UUID] = []

    def _register(client: TestClient) -> str:
        uid = register(client)
        created_users.append(UUID(uid))
        return uid

    try:
        with (
            TestClient(app, base_url=settings.site_origin) as client_a,
            TestClient(other_app, base_url=settings.site_origin) as client_b,
        ):
            yield client_a, client_b, app, provider, now_box, _register
    finally:
        if created_users:
            with app.state.session_factory.begin() as db:
                for uid in created_users:
                    user = db.get(User, uid)
                    if user is not None:
                        db.delete(user)


def _grant_consent(client: TestClient) -> None:
    res = client.put(
        "/api/v1/ai-assistant/consent", headers=headers(client), json={"consented": True}
    )
    assert res.status_code == 200
    assert res.json()["data"]["consented"] is True


def _create_conv(client: TestClient, title: str = "") -> str:
    res = client.post(
        "/api/v1/ai-assistant/conversations", headers=headers(client), json={"title": title}
    )
    assert res.status_code == 201
    return res.json()["data"]["id"]


def _send_sse(client: TestClient, conv_id: str, content: str, key: UUID | None = None):
    return client.post(
        f"/api/v1/ai-assistant/conversations/{conv_id}/messages",
        headers={**headers(client), "Idempotency-Key": str(key or uuid4())},
        json={"content": content},
    )


def _seed_owner_run(app, owner_id: str) -> None:
    with app.state.session_factory.begin() as db:
        act = Activity(
            user_id=UUID(owner_id),
            source="gpx",
            title="CANARY_API_TITLE_999",
            notes="CANARY_API_NOTE_999",
            category="10km",
            tags=["CANARY_API_TAG"],
            activity_date=date(2026, 11, 20),
            date_source="timestamp",
            timezone="Asia/Shanghai",
            distance_m=Decimal("10000.000"),
            elapsed_seconds=Decimal("2850.000"),
            timer_seconds=Decimal("2820.000"),
            avg_heart_rate_bpm=156,
            avg_pace_seconds_per_km=Decimal("282.000"),
            temporal_quality="complete",
            quality_summary={"warnings": []},
            metrics_version="gpx-v1",
        )
        db.add(act)
        db.flush()
        db.add(
            ActivityProvinceCache(
                user_id=UUID(owner_id),
                activity_id=act.id,
                atlas_version=china_atlas_version(),
                province_codes=[330000],
            )
        )
        user = db.get(User, UUID(owner_id))
        user.activity_data_version += 1


def test_cross_user_404_across_all_conversation_and_message_routes(assistant_api):
    client_a, client_b, _app, provider, _now_box, reg = assistant_api
    reg(client_a)
    reg(client_b)
    _grant_consent(client_a)
    _grant_consent(client_b)

    conv_id = _create_conv(client_a, "我的训练记录")
    provider.queue({"deltas": ["完成回答"], "result": {"input_tokens": 100, "output_tokens": 20}})
    sse_res = _send_sse(client_a, conv_id, "查近一周跑量")
    assert sse_res.status_code == 200
    events = _parse_sse(sse_res.text)
    msg_id = events[0][1]["assistant_message_id"]

    # User B receives 404 (never 403) on every single route referencing User A's IDs.
    assert client_b.get(f"/api/v1/ai-assistant/conversations/{conv_id}").status_code == 404
    assert (
        client_b.patch(
            f"/api/v1/ai-assistant/conversations/{conv_id}",
            headers=headers(client_b),
            json={"title": "篡改标题"},
        ).status_code
        == 404
    )
    assert (
        client_b.delete(
            f"/api/v1/ai-assistant/conversations/{conv_id}",
            headers=headers(client_b),
        ).status_code
        == 404
    )
    assert _send_sse(client_b, conv_id, "偷看数据").status_code == 404
    assert (
        client_b.post(
            f"/api/v1/ai-assistant/conversations/{conv_id}/messages/{msg_id}/cancel",
            headers=headers(client_b),
        ).status_code
        == 404
    )

    # User A's conversation and message remain completely intact.
    detail = client_a.get(f"/api/v1/ai-assistant/conversations/{conv_id}")
    assert detail.status_code == 200
    assert detail.json()["data"]["conversation"]["title"] == "我的训练记录"
    assert len(detail.json()["data"]["messages"]) == 2


def test_auth_csrf_consent_context_and_conversation_crud(assistant_api):
    client_a, _client_b, _app, provider, _now_box, reg = assistant_api

    # Unauthenticated requests fail with 401.
    assert client_a.get("/api/v1/ai-assistant/context").status_code == 401
    assert client_a.get("/api/v1/ai-assistant/conversations").status_code == 401

    reg(client_a)

    # Missing CSRF token on write fails with 403.
    assert client_a.put("/api/v1/ai-assistant/consent", json={"consented": True}).status_code == 403
    assert (
        client_a.post("/api/v1/ai-assistant/conversations", json={"title": "x"}).status_code == 403
    )

    # GET /context never triggers provider calls.
    ctx = client_a.get("/api/v1/ai-assistant/context")
    assert ctx.status_code == 200
    body = ctx.json()["data"]
    assert body["configured"] is True
    assert body["enabled"] is True
    assert body["consent"]["consented"] is False
    assert body["quota"]["daily_message_limit"] == 10
    assert provider.calls == []

    # Create, rename (PATCH strictness), list, delete.
    conv_id = _create_conv(client_a, "初始会话")
    assert (
        client_a.patch(
            f"/api/v1/ai-assistant/conversations/{conv_id}",
            headers=headers(client_a),
            json={},
        ).status_code
        == 422
    )
    assert (
        client_a.patch(
            f"/api/v1/ai-assistant/conversations/{conv_id}",
            headers=headers(client_a),
            json={"title": "新标题", "unknown_field": 1},
        ).status_code
        == 422
    )
    renamed = client_a.patch(
        f"/api/v1/ai-assistant/conversations/{conv_id}",
        headers=headers(client_a),
        json={"title": "十一月复盘"},
    )
    assert renamed.status_code == 200
    assert renamed.json()["data"]["title"] == "十一月复盘"

    listed = client_a.get("/api/v1/ai-assistant/conversations?limit=10&offset=0")
    assert listed.status_code == 200
    assert listed.json()["data"]["total"] == 1
    assert listed.json()["data"]["items"][0]["id"] == conv_id

    # Sending message without consent fails with 403 AI_CONSENT_REQUIRED.
    unconsented = _send_sse(client_a, conv_id, "总结一下")
    assert unconsented.status_code == 403
    assert unconsented.json()["error"]["code"] == "AI_CONSENT_REQUIRED"

    # Grant then revoke consent.
    _grant_consent(client_a)
    revoked = client_a.put(
        "/api/v1/ai-assistant/consent", headers=headers(client_a), json={"consented": False}
    )
    assert revoked.status_code == 200
    assert revoked.json()["data"]["consented"] is False
    assert (
        _send_sse(client_a, conv_id, "撤销后提问").json()["error"]["code"] == "AI_CONSENT_REQUIRED"
    )

    deleted = client_a.delete(
        f"/api/v1/ai-assistant/conversations/{conv_id}", headers=headers(client_a)
    )
    assert deleted.status_code == 200
    assert deleted.json()["data"] == {"deleted": True}
    assert client_a.get(f"/api/v1/ai-assistant/conversations/{conv_id}").status_code == 404


def test_sse_tool_loop_independent_read_only_session_and_sliding_history(
    assistant_api, monkeypatch
):
    from app.modules.footprints import provinces

    client_a, _client_b, app, provider, now_box, reg = assistant_api
    owner_id = reg(client_a)
    _seed_owner_run(app, owner_id)
    _grant_consent(client_a)
    conv_id = _create_conv(client_a)

    # Force province_summary to raise inside tool execution so we prove tool failure/rollback
    # occurs in its own independent read-only session and never touches ai_messages rows.
    def _boom_province(*_a, **_kw):
        raise ApiError(422, "PROVINCE_LIMIT", "省份足迹计算较慢")

    monkeypatch.setattr(provinces, "province_summary", _boom_province)

    provider.queue(
        {
            "deltas": [],
            "result": {
                "tool_calls": [
                    ProviderToolCall(
                        id="call_1",
                        name="get_running_summary",
                        arguments='{"date_from":"2026-11-01","date_to":"2026-12-01"}',
                    ),
                    ProviderToolCall(
                        id="call_2",
                        name="get_footprint_summary",
                        arguments='{"scope":"china","year":2026}',
                    ),
                ],
                "finish_reason": "tool_calls",
                "input_tokens": 500,
                "output_tokens": 30,
                "cached_input_tokens": 200,
            },
        },
        {
            "deltas": ["2026年11月你完成了 1 次 10 公里跑，", "平均配速 4分42秒/公里。"],
            "result": {
                "finish_reason": "stop",
                "input_tokens": 900,
                "output_tokens": 50,
                "cached_input_tokens": 450,
            },
        },
    )

    res = _send_sse(client_a, conv_id, "帮我看看11月跑量和足迹")
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/event-stream")
    assert res.headers["cache-control"] == "no-store, no-transform"
    assert res.headers["x-accel-buffering"] == "no"

    events = _parse_sse(res.text)
    names = [name for name, _ in events]
    assert names[0] == "meta"
    assert names[1] == "status"
    assert names.count("tool_start") == 2
    assert names.count("tool_end") == 2
    assert "block" in names
    assert "delta" in names
    assert names[-1] == "done"

    # Zero canary leaks in SSE stream and in payloads handed to the provider.
    for secret in ("CANARY_API_TITLE_999", "CANARY_API_NOTE_999", "CANARY_API_TAG"):
        assert secret not in res.text
        assert secret not in json.dumps(provider.calls, ensure_ascii=False)

    # Verify degraded cache-only fallback still produced a footprint_summary_card block.
    block_types = [data["type"] for name, data in events if name == "block"]
    assert "metrics_card" in block_types
    assert "footprint_summary_card" in block_types

    done = events[-1][1]
    assert done["status"] == "succeeded"
    assert done["usage"] == {
        "input_tokens": 1400,
        "output_tokens": 80,
        "cached_input_tokens": 650,
    }

    # Turn 2 checks sliding history window includes Turn 1 user + assistant content.
    now_box[0] = now_box[0] + timedelta(seconds=15)
    provider.queue(
        {"deltas": ["继续保持轻松跑。"], "result": {"input_tokens": 300, "output_tokens": 15}}
    )
    res2 = _send_sse(client_a, conv_id, "下周怎么安排？")
    assert res2.status_code == 200
    second_turn_messages = provider.calls[-1]["messages"]
    roles_and_contents = [(m["role"], m["content"]) for m in second_turn_messages]
    assert ("user", "帮我看看11月跑量和足迹") in roles_and_contents
    assert (
        "assistant",
        "2026年11月你完成了 1 次 10 公里跑，平均配速 4分42秒/公里。",
    ) in roles_and_contents
    assert roles_and_contents[-1] == ("user", "下周怎么安排？")


def test_idempotency_replay_conflict_concurrency_and_cancel_generation(assistant_api):
    client_a, _client_b, app, provider, now_box, reg = assistant_api
    reg(client_a)
    _grant_consent(client_a)
    conv_1 = _create_conv(client_a, "会话一")
    conv_2 = _create_conv(client_a, "会话二")

    # Turn 1 completes normally.
    key_1 = uuid4()
    provider.queue(
        {"deltas": ["首轮答复内容"], "result": {"input_tokens": 100, "output_tokens": 25}}
    )
    first = _send_sse(client_a, conv_1, "第一问", key=key_1)
    assert first.status_code == 200
    assert len(provider.calls) == 1

    # Replaying Idempotency-Key returns SSE replay without calling provider or charging quota.
    replay = _send_sse(client_a, conv_1, "第一问", key=key_1)
    assert replay.status_code == 200
    replay_events = _parse_sse(replay.text)
    assert replay_events[0][1]["replayed"] is True
    assert replay_events[-1][1]["finish_reason"] == "replayed"
    assert len(provider.calls) == 1
    ctx_after_replay = client_a.get("/api/v1/ai-assistant/context").json()["data"]
    assert ctx_after_replay["quota"]["messages_today"] == 1

    # Reusing the same Idempotency-Key on another conversation returns 409 IDEMPOTENCY_CONFLICT.
    conflict = _send_sse(client_a, conv_2, "第一问", key=key_1)
    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "IDEMPOTENCY_CONFLICT"

    # Turn 2 pauses mid-stream so we can test 409 AI_IN_PROGRESS and explicit POST .../cancel.
    now_box[0] = now_box[0] + timedelta(seconds=10)
    provider.entered.clear()
    provider.cancelled.clear()
    provider.release = threading.Event()
    provider.queue(
        {
            "deltas": ["生成了一半的内容…"],
            "wait_until_released": True,
            "result": {"input_tokens": 200, "output_tokens": 50},
        }
    )

    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(_send_sse, client_a, conv_1, "长回答测试", uuid4())
        assert provider.entered.wait(timeout=5)

        # Concurrent message from same user gets 409 AI_IN_PROGRESS with active message_id.
        concurrent = _send_sse(client_a, conv_1, "并发提问")
        assert concurrent.status_code == 409
        assert concurrent.json()["error"]["code"] == "AI_IN_PROGRESS"
        active_msg_id = concurrent.json()["error"]["details"][0]["message_id"]

        # Cancel generation explicitly -> aborts upstream and persists cancelled with partial text.
        cancel_res = client_a.post(
            f"/api/v1/ai-assistant/conversations/{conv_1}/messages/{active_msg_id}/cancel",
            headers=headers(client_a),
        )
        assert cancel_res.status_code == 200
        assert cancel_res.json()["data"] == {"cancelled": True, "status": "cancelled"}
        assert provider.cancelled.wait(timeout=5)

        stream_res = future.result(timeout=5)
        assert stream_res.status_code == 200

    with app.state.session_factory() as db:
        row = db.scalar(select(AIMessage).where(AIMessage.id == UUID(active_msg_id)))
        assert row is not None
        assert row.status == "cancelled"
        assert row.content == "生成了一半的内容…"


def test_provider_error_timeout_no_refund_and_delete_no_refund(assistant_api):
    client_a, _client_b, app, provider, now_box, reg = assistant_api
    reg(client_a)
    _grant_consent(client_a)
    conv_id = _create_conv(client_a, "错误与配额测试")

    provider.queue(ApiError(503, "AI_TIMEOUT", "AI 响应超时，请稍后重试"))
    res = _send_sse(client_a, conv_id, "会超时的提问")
    assert res.status_code == 200
    events = _parse_sse(res.text)
    err_events = [data for name, data in events if name == "error"]
    assert len(err_events) == 1
    assert err_events[0]["code"] == "AI_TIMEOUT"
    assert events[-1][0] == "done"
    assert events[-1][1]["status"] == "failed"
    assert events[-1][1]["error_code"] == "AI_TIMEOUT"
    failed_msg_id = UUID(events[-1][1]["message_id"])

    # Failed turn is persisted and still counts toward daily quota.
    ctx1 = client_a.get("/api/v1/ai-assistant/context").json()["data"]
    assert ctx1["quota"]["messages_today"] == 1

    # Deleting conversation wipes contents and does NOT refund quota.
    now_box[0] = now_box[0] + timedelta(seconds=5)
    del_res = client_a.delete(
        f"/api/v1/ai-assistant/conversations/{conv_id}", headers=headers(client_a)
    )
    assert del_res.status_code == 200
    ctx2 = client_a.get("/api/v1/ai-assistant/context").json()["data"]
    assert ctx2["quota"]["messages_today"] == 1

    with app.state.session_factory() as db:
        wiped = db.scalar(select(AIMessage).where(AIMessage.id == failed_msg_id))
        assert wiped is not None
        assert wiped.deleted_at is not None
        assert wiped.content is None
        assert wiped.ui_blocks == []
