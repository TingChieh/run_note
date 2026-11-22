"""Streaming agent-loop orchestrator for the RunNote AI running assistant.

Coordinates DeepSeek streaming rounds, independent short read-only DB sessions per tool call,
15-second SSE heartbeats, client-disconnect / explicit cancellation, and final sanitized DB writes.
"""

import asyncio
import json
import logging
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass
from datetime import date
from typing import Any
from uuid import UUID

from sqlalchemy import select
from starlette.concurrency import run_in_threadpool

from app.core.errors import ApiError
from app.modules.ai_assistant import service as assistant_service
from app.modules.ai_assistant.model import AIMessage
from app.modules.ai_assistant.provider import ProviderRoundResult, ProviderTextDelta
from app.modules.ai_assistant.schema import UIBlock
from app.modules.ai_assistant.tools import (
    TOOL_NAMES,
    ToolContext,
    ToolInputError,
    execute_tool,
    tool_definitions,
)

logger = logging.getLogger(__name__)

HEARTBEAT_INTERVAL_SECONDS = 15.0
CANCEL_POLL_INTERVAL_SECONDS = 1.0
MAX_TOOL_CALLS_PER_TURN = 8
MAX_UI_BLOCKS_PER_TURN = 12
MAX_TURN_TOOL_PAYLOAD_BYTES = 24_576
MESSAGE_FRAMING_TOKENS = 32
PROMPT_BASE_OVERHEAD_TOKENS = 128
BUDGET_EXHAUSTED_NOTICE = (
    "已达到本轮上下文预算上限，以上展示的数据卡片可供参考；建议拆分为更具体的问题继续提问。"
)


def estimate_text_tokens(text: str) -> int:
    """Strict upper-bound token estimate for Byte-Level BPE tokenizers (e.g. DeepSeek V4).

    Every ASCII character (including punctuation and digits) is bounded at 1 token/char,
    BMP non-ASCII code points at 3 tokens/code point, and astral code points (such as emoji
    and rare CJK Extension B) at 4 tokens/code point, matching the UTF-8 byte ceiling so
    official tokenization cannot exceed this estimate.
    """
    if not text:
        return 0
    total = 0
    for ch in text:
        code = ord(ch)
        if code < 128:
            total += 1
        elif code <= 0xFFFF:
            total += 3
        else:
            total += 4
    return total


def estimate_prompt_tokens(messages: list[dict[str, Any]], tools: list[dict[str, Any]]) -> int:
    """Estimate upper-bound input tokens for the next chat-completions request."""
    total = PROMPT_BASE_OVERHEAD_TOKENS
    for msg in messages:
        total += MESSAGE_FRAMING_TOKENS
        content = msg.get("content")
        if isinstance(content, str) and content:
            total += estimate_text_tokens(content)
        tool_calls = msg.get("tool_calls")
        if tool_calls:
            total += estimate_text_tokens(
                json.dumps(tool_calls, ensure_ascii=False, separators=(",", ":"))
            )
    if tools:
        total += MESSAGE_FRAMING_TOKENS + estimate_text_tokens(
            json.dumps(tools, ensure_ascii=False, separators=(",", ":"))
        )
    return total


TOOL_LABELS: dict[str, str] = {
    "get_running_summary": "查询跑步汇总数据",
    "get_running_trends": "分析跑量与配速趋势",
    "get_period_report": "读取周期统计报告",
    "compare_periods": "对比两个时期的跑步数据",
    "get_personal_records": "查询个人最佳与历史总览",
    "get_streaks_and_goals": "查询连续记录与跑量目标",
    "search_activities": "检索跑步记录摘要",
    "get_activity_detail": "查看单次跑步权威指标",
    "get_footprint_summary": "汇总省市与全球跑步足迹",
    "get_frequent_routes": "查询常跑路线统计",
}


def build_system_prompt(today: date, timezone_name: str) -> str:
    return (
        "你是 RunNote 的私人跑步数据助手。你的职责是基于工具返回的后端权威跑步数据，"
        "用清晰、诚实的简体中文回答用户的跑步数据分析问题。\n"
        f"当前用户本地日期：{today.isoformat()}，时区：{timezone_name}。\n"
        "严格规则：\n"
        "1. 一切数字、日期、里程、配速、心率、次数和对比变化必须完全来自工具返回值；"
        "严禁编造数据、虚构活动或猜测未提供的信息。\n"
        "2. 当数据为空、记录较少、心率/热量/步数覆盖率低、存在时间质量警告，或工具返回 "
        "`degraded`、`cached_only`、`building` 时，必须如实向用户说明限制与不确定性。\n"
        "3. 用时优先采用设备用时，配速为距离加权平均，平均心率为有效用时加权估计；"
        "热量与步数仅为已知记录小计，步数不能推断跑步步频。\n"
        "4. 不要提供医疗诊断、疾病判断或激进训练处方；涉及训练建议时保持保守，"
        "并简要提醒仅供参考、不构成医疗建议。\n"
        "5. 不要输出原始 HTML 或伪造活动链接；"
        "前端会根据后端返回的结构化卡片自动渲染图表与活动链接。\n"
        "6. 你无权访问身心健康日记、照片、活动备注、精确 GPS 坐标或他人数据；"
        "若用户询问此类内容，请直接说明系统为保护隐私未向助手提供这些数据。"
    )


def format_sse(event: str, data: dict[str, Any]) -> str:
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    return f"event: {event}\ndata: {payload}\n\n"


class ActiveStreamRegistry:
    """Thread-safe in-process registry mapping `(owner_id, message_id)` to a cancel Event."""

    def __init__(self) -> None:
        self._entries: dict[tuple[UUID, UUID], tuple[asyncio.AbstractEventLoop, asyncio.Event]] = {}

    def register(self, owner_id: UUID, message_id: UUID) -> asyncio.Event:
        loop = asyncio.get_running_loop()
        event = asyncio.Event()
        self._entries[(owner_id, message_id)] = (loop, event)
        return event

    def cancel(self, owner_id: UUID, message_id: UUID) -> bool:
        entry = self._entries.get((owner_id, message_id))
        if entry is None:
            return False
        loop, event = entry
        if loop.is_closed():
            return False
        try:
            loop.call_soon_threadsafe(event.set)
        except RuntimeError:
            return False
        return True

    def unregister(self, owner_id: UUID, message_id: UUID) -> None:
        self._entries.pop((owner_id, message_id), None)


@dataclass(frozen=True)
class TurnStart:
    owner_id: UUID
    timezone: str
    today: date
    conversation_id: UUID
    user_message_id: UUID
    assistant_message_id: UUID
    user_content: str
    remaining_messages_today: int
    remaining_tokens_today: int
    replayed: bool = False
    replayed_status: str | None = None
    replayed_content: str | None = None
    replayed_blocks: list[dict[str, Any]] | None = None
    replayed_error_code: str | None = None
    replayed_input_tokens: int | None = None
    replayed_output_tokens: int | None = None
    replayed_cached_input_tokens: int | None = None


def _run_tool_in_isolated_session(
    session_factory, ctx: ToolContext, tool_name: str, raw_arguments: str
):
    """Execute one read-only tool in its own short Session so rollbacks never touch turn rows."""
    with session_factory() as tool_db:
        try:
            return execute_tool(tool_db, ctx, tool_name, raw_arguments)
        finally:
            tool_db.rollback()


def _load_history(session_factory, turn: TurnStart) -> list[dict[str, str]]:
    with session_factory() as db:
        return assistant_service.recent_history_messages(
            db,
            turn.owner_id,
            turn.conversation_id,
            exclude_message_ids=(turn.user_message_id, turn.assistant_message_id),
        )


def _mark_streaming(session_factory, owner_id: UUID, message_id: UUID) -> bool:
    with session_factory.begin() as db:
        return assistant_service.mark_streaming(db, owner_id, message_id)


def _is_cancelled_in_db(session_factory, owner_id: UUID, message_id: UUID) -> bool:
    with session_factory() as db:
        status = db.scalar(
            select(AIMessage.status).where(
                AIMessage.id == message_id,
                AIMessage.user_id == owner_id,
                AIMessage.role == "assistant",
            )
        )
        return status == "cancelled"


def _persist_finish(
    session_factory,
    owner_id: UUID,
    message_id: UUID,
    status: str,
    *,
    finished_at,
    content: str | None,
    tool_calls_summary: list[dict[str, Any]],
    ui_blocks: list[UIBlock],
    error_code: str | None,
    input_tokens: int | None,
    output_tokens: int | None,
    cached_input_tokens: int | None,
) -> bool:
    with session_factory.begin() as db:
        return assistant_service.finish_turn(
            db,
            owner_id,
            message_id,
            status,
            finished_at=finished_at,
            content=content,
            tool_calls_summary=tool_calls_summary,
            ui_blocks=ui_blocks,
            error_code=error_code,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cached_input_tokens=cached_input_tokens,
        )


async def replay_completed_turn(turn: TurnStart) -> AsyncIterator[str]:
    """Replay an already-settled idempotent turn as SSE without calling DeepSeek."""
    yield format_sse(
        "meta",
        {
            "conversation_id": str(turn.conversation_id),
            "user_message_id": str(turn.user_message_id),
            "assistant_message_id": str(turn.assistant_message_id),
            "remaining_messages_today": turn.remaining_messages_today,
            "remaining_tokens_today": turn.remaining_tokens_today,
            "replayed": True,
        },
    )
    for block in turn.replayed_blocks or []:
        yield format_sse("block", block)
    if turn.replayed_content:
        yield format_sse("delta", {"text": turn.replayed_content})
    if turn.replayed_status == "failed":
        yield format_sse(
            "error",
            {
                "code": turn.replayed_error_code or "AI_PROVIDER_ERROR",
                "message": "该请求已失败，未重复调用 AI；可发起新提问重试",
                "retryable": True,
                "message_id": str(turn.assistant_message_id),
            },
        )
    yield format_sse(
        "done",
        {
            "message_id": str(turn.assistant_message_id),
            "status": turn.replayed_status or "succeeded",
            "finish_reason": "replayed",
            "is_truncated": False,
            "usage": {
                "input_tokens": turn.replayed_input_tokens,
                "output_tokens": turn.replayed_output_tokens,
                "cached_input_tokens": turn.replayed_cached_input_tokens,
            },
        },
    )


async def stream_turn(
    turn: TurnStart,
    *,
    session_factory,
    settings,
    provider,
    clock,
    streams: ActiveStreamRegistry,
    is_disconnected: Callable[[], Awaitable[bool]],
    heartbeat_interval: float = HEARTBEAT_INTERVAL_SECONDS,
    cancel_poll_interval: float = CANCEL_POLL_INTERVAL_SECONDS,
) -> AsyncIterator[str]:
    """Run the streaming DeepSeek + read-only tool loop and yield formatted SSE frames."""
    if turn.replayed:
        async for frame in replay_completed_turn(turn):
            yield frame
        return

    cancel_event = streams.register(turn.owner_id, turn.assistant_message_id)
    queue: asyncio.Queue[str | None] = asyncio.Queue()

    content_parts: list[str] = []
    content_length = 0
    content_truncated = False
    collected_blocks: list[UIBlock] = []
    tool_summary: list[dict[str, Any]] = []
    total_input_tokens = 0
    total_output_tokens = 0
    total_cached_tokens = 0
    saw_usage = False
    final_status = "failed"
    final_error_code: str | None = None
    final_finish_reason: str | None = None
    persisted = False

    def _usage_payload() -> dict[str, int | None]:
        if not saw_usage:
            return {"input_tokens": None, "output_tokens": None, "cached_input_tokens": None}
        return {
            "input_tokens": total_input_tokens,
            "output_tokens": total_output_tokens,
            "cached_input_tokens": total_cached_tokens,
        }

    async def _save_final(status: str, error_code: str | None = None) -> bool:
        nonlocal persisted
        if persisted:
            return True
        full_text = "".join(content_parts)
        saved = await asyncio.shield(
            run_in_threadpool(
                _persist_finish,
                session_factory,
                turn.owner_id,
                turn.assistant_message_id,
                status,
                finished_at=clock(),
                content=full_text if full_text else None,
                tool_calls_summary=tool_summary,
                ui_blocks=collected_blocks,
                error_code=error_code,
                input_tokens=total_input_tokens if saw_usage else None,
                output_tokens=total_output_tokens if saw_usage else None,
                cached_input_tokens=total_cached_tokens if saw_usage else None,
            )
        )
        if saved:
            persisted = True
        return saved

    async def _producer() -> None:
        nonlocal content_length, content_truncated
        nonlocal total_input_tokens, total_output_tokens, total_cached_tokens, saw_usage
        nonlocal final_status, final_error_code, final_finish_reason

        deadline = time.monotonic() + float(settings.ai_stream_total_timeout_seconds)
        try:
            await queue.put(
                format_sse(
                    "meta",
                    {
                        "conversation_id": str(turn.conversation_id),
                        "user_message_id": str(turn.user_message_id),
                        "assistant_message_id": str(turn.assistant_message_id),
                        "remaining_messages_today": turn.remaining_messages_today,
                        "remaining_tokens_today": turn.remaining_tokens_today,
                        "replayed": False,
                    },
                )
            )
            transitioned = await run_in_threadpool(
                _mark_streaming, session_factory, turn.owner_id, turn.assistant_message_id
            )
            if not transitioned:
                # Already cancelled before streaming started.
                final_status = "cancelled"
                await queue.put(
                    format_sse(
                        "done",
                        {
                            "message_id": str(turn.assistant_message_id),
                            "status": "cancelled",
                            "finish_reason": "cancelled",
                            "is_truncated": False,
                            "usage": _usage_payload(),
                        },
                    )
                )
                return

            await queue.put(format_sse("status", {"stage": "thinking", "message": "正在分析问题…"}))
            history = await run_in_threadpool(_load_history, session_factory, turn)
            messages: list[dict[str, Any]] = [
                {"role": "system", "content": build_system_prompt(turn.today, turn.timezone)},
                *history,
                {"role": "user", "content": turn.user_content},
            ]
            tools = tool_definitions()
            ctx = ToolContext(owner_id=turn.owner_id, timezone=turn.timezone, today=turn.today)
            total_tool_calls = 0
            total_tool_payload_bytes = 0
            tool_context_exhausted = False
            budget_spent = 0
            turn_budget = assistant_service.turn_token_limit(settings)
            max_output = int(settings.ai_max_output_tokens)

            for round_index in range(1, int(settings.ai_max_tool_rounds) + 1):
                if (
                    cancel_event.is_set()
                    or await is_disconnected()
                    or await run_in_threadpool(
                        _is_cancelled_in_db,
                        session_factory,
                        turn.owner_id,
                        turn.assistant_message_id,
                    )
                ):
                    raise asyncio.CancelledError

                prompt_no_tools = estimate_prompt_tokens(messages, [])
                prompt_with_tools = estimate_prompt_tokens(messages, tools)

                # Before Round 1, trim oldest history turns if needed so the initial prompt +
                # max_tokens fits inside turn_budget even under small ai_max_tool_rounds configs.
                if round_index == 1:
                    while (
                        len(messages) > 2
                        and budget_spent + prompt_no_tools + max_output > turn_budget
                    ):
                        messages.pop(1)
                        prompt_no_tools = estimate_prompt_tokens(messages, [])
                        prompt_with_tools = estimate_prompt_tokens(messages, tools)

                # Only offer tools when structural limits allow AND budget still fits BOTH this
                # tool round AND at least one follow-up final-answer round without tools.
                can_call_more_tools = (
                    round_index < int(settings.ai_max_tool_rounds)
                    and total_tool_calls < MAX_TOOL_CALLS_PER_TURN
                    and not tool_context_exhausted
                    and total_tool_payload_bytes < MAX_TURN_TOOL_PAYLOAD_BYTES
                    and (
                        budget_spent
                        + (prompt_with_tools + max_output)
                        + (prompt_no_tools + max_output)
                    )
                    <= turn_budget
                )
                round_tools = tools if can_call_more_tools else []
                this_prompt_est = prompt_with_tools if round_tools else prompt_no_tools

                # Strict pre-call gate: never issue a model request whose worst-case
                # (spent + prompt + max_tokens) cannot fit in turn_budget.
                if budget_spent + this_prompt_est + max_output > turn_budget:
                    if round_tools:
                        round_tools = []
                        this_prompt_est = prompt_no_tools
                    if budget_spent + this_prompt_est + max_output > turn_budget:
                        content_truncated = True
                        final_finish_reason = "budget_limit"
                        if not content_parts:
                            content_parts.append(BUDGET_EXHAUSTED_NOTICE)
                            content_length += len(BUDGET_EXHAUSTED_NOTICE)
                            await queue.put(format_sse("delta", {"text": BUDGET_EXHAUSTED_NOTICE}))
                        break

                round_result: ProviderRoundResult | None = None
                async for item in provider.stream_chat(
                    messages, round_tools, settings, deadline=deadline
                ):
                    if cancel_event.is_set() or await is_disconnected():
                        raise asyncio.CancelledError
                    if isinstance(item, ProviderTextDelta):
                        if content_length < assistant_service.MAX_ASSISTANT_CONTENT_CHARS:
                            remaining_chars = (
                                assistant_service.MAX_ASSISTANT_CONTENT_CHARS - content_length
                            )
                            chunk = item.text[:remaining_chars]
                            if len(chunk) < len(item.text):
                                content_truncated = True
                            content_parts.append(chunk)
                            content_length += len(chunk)
                            await queue.put(format_sse("delta", {"text": chunk}))
                        else:
                            content_truncated = True
                    elif isinstance(item, ProviderRoundResult):
                        round_result = item

                if round_result is None:
                    raise ApiError(502, "AI_OUTPUT_INVALID", "AI 未返回有效回复")

                if (
                    round_result.input_tokens is not None
                    or round_result.output_tokens is not None
                    or round_result.cached_input_tokens is not None
                ):
                    saw_usage = True
                    total_input_tokens += round_result.input_tokens or 0
                    total_output_tokens += round_result.output_tokens or 0
                    total_cached_tokens += round_result.cached_input_tokens or 0

                budget_spent += (
                    round_result.input_tokens
                    if round_result.input_tokens is not None
                    else this_prompt_est
                ) + (
                    round_result.output_tokens
                    if round_result.output_tokens is not None
                    else estimate_text_tokens(round_result.text)
                )

                final_finish_reason = round_result.finish_reason
                if not round_result.tool_calls:
                    break
                if budget_spent >= turn_budget:
                    content_truncated = True
                    final_finish_reason = "budget_limit"
                    if not content_parts:
                        content_parts.append(BUDGET_EXHAUSTED_NOTICE)
                        content_length += len(BUDGET_EXHAUSTED_NOTICE)
                        await queue.put(format_sse("delta", {"text": BUDGET_EXHAUSTED_NOTICE}))
                    break

                # Record assistant tool_calls turn in the conversation context.
                messages.append(
                    {
                        "role": "assistant",
                        "content": round_result.text or None,
                        "tool_calls": [
                            {
                                "id": call.id,
                                "type": "function",
                                "function": {"name": call.name, "arguments": call.arguments},
                            }
                            for call in round_result.tool_calls
                        ],
                    }
                )

                for call in round_result.tool_calls:
                    if (
                        cancel_event.is_set()
                        or await is_disconnected()
                        or await run_in_threadpool(
                            _is_cancelled_in_db,
                            session_factory,
                            turn.owner_id,
                            turn.assistant_message_id,
                        )
                    ):
                        raise asyncio.CancelledError

                    if total_tool_calls >= MAX_TOOL_CALLS_PER_TURN:
                        messages.append(
                            {
                                "role": "tool",
                                "tool_call_id": call.id,
                                "content": json.dumps(
                                    {
                                        "degraded": True,
                                        "reason": "tool_limit",
                                        "message": "本轮工具调用次数已达上限，请基于已有数据回答。",
                                    },
                                    ensure_ascii=False,
                                ),
                            }
                        )
                        continue

                    total_tool_calls += 1
                    label = TOOL_LABELS.get(call.name, "查询运动数据")
                    await queue.put(format_sse("tool_start", {"tool": call.name, "label": label}))
                    started = time.monotonic()

                    if call.name not in TOOL_NAMES:
                        duration_ms = int((time.monotonic() - started) * 1000)
                        tool_summary.append(
                            {
                                "tool": call.name[:64],
                                "duration_ms": duration_ms,
                                "degraded": True,
                                "truncated": False,
                                "error_code": "AI_TOOL_UNKNOWN",
                            }
                        )
                        await queue.put(
                            format_sse(
                                "tool_end",
                                {
                                    "tool": call.name,
                                    "label": label,
                                    "duration_ms": duration_ms,
                                    "degraded": True,
                                    "truncated": False,
                                    "ok": False,
                                },
                            )
                        )
                        messages.append(
                            {
                                "role": "tool",
                                "tool_call_id": call.id,
                                "content": json.dumps(
                                    {"error": "unsupported_tool", "message": "不支持该工具"},
                                    ensure_ascii=False,
                                ),
                            }
                        )
                        continue

                    try:
                        result = await run_in_threadpool(
                            _run_tool_in_isolated_session,
                            session_factory,
                            ctx,
                            call.name,
                            call.arguments,
                        )
                        duration_ms = int((time.monotonic() - started) * 1000)
                        tool_summary.append(
                            {
                                "tool": call.name,
                                "duration_ms": duration_ms,
                                "degraded": result.degraded,
                                "truncated": result.truncated,
                            }
                        )
                        await queue.put(
                            format_sse(
                                "tool_end",
                                {
                                    "tool": call.name,
                                    "label": label,
                                    "duration_ms": duration_ms,
                                    "degraded": result.degraded,
                                    "truncated": result.truncated,
                                    "ok": True,
                                },
                            )
                        )
                        for block in result.ui_blocks:
                            if len(collected_blocks) < MAX_UI_BLOCKS_PER_TURN:
                                collected_blocks.append(block)
                                await queue.put(format_sse("block", block.model_dump(mode="json")))
                        payload_json = json.dumps(
                            result.model_payload, ensure_ascii=False, separators=(",", ":")
                        )
                        payload_bytes = len(payload_json.encode("utf-8"))
                        if total_tool_payload_bytes + payload_bytes > MAX_TURN_TOOL_PAYLOAD_BYTES:
                            tool_context_exhausted = True
                            payload_json = json.dumps(
                                {
                                    "degraded": True,
                                    "reason": "context_budget",
                                    "message": "本轮工具上下文预算已满，请基于已有数据完成回答。",
                                },
                                ensure_ascii=False,
                                separators=(",", ":"),
                            )
                            total_tool_payload_bytes += len(payload_json.encode("utf-8"))
                        else:
                            total_tool_payload_bytes += payload_bytes
                        messages.append(
                            {
                                "role": "tool",
                                "tool_call_id": call.id,
                                "content": payload_json,
                            }
                        )
                    except (ToolInputError, ApiError) as tool_error:
                        duration_ms = int((time.monotonic() - started) * 1000)
                        tool_summary.append(
                            {
                                "tool": call.name,
                                "duration_ms": duration_ms,
                                "degraded": True,
                                "truncated": False,
                                "error_code": tool_error.code,
                            }
                        )
                        await queue.put(
                            format_sse(
                                "tool_end",
                                {
                                    "tool": call.name,
                                    "label": label,
                                    "duration_ms": duration_ms,
                                    "degraded": True,
                                    "truncated": False,
                                    "ok": False,
                                },
                            )
                        )
                        messages.append(
                            {
                                "role": "tool",
                                "tool_call_id": call.id,
                                "content": json.dumps(
                                    {"error": tool_error.code, "message": tool_error.message},
                                    ensure_ascii=False,
                                ),
                            }
                        )

            if final_finish_reason == "length":
                content_truncated = True

            if cancel_event.is_set() or await run_in_threadpool(
                _is_cancelled_in_db,
                session_factory,
                turn.owner_id,
                turn.assistant_message_id,
            ):
                raise asyncio.CancelledError

            final_status = "succeeded"
            saved_ok = await _save_final("succeeded")
            if not saved_ok and await run_in_threadpool(
                _is_cancelled_in_db,
                session_factory,
                turn.owner_id,
                turn.assistant_message_id,
            ):
                final_status = "cancelled"
                await _save_final("cancelled")
                await queue.put(
                    format_sse(
                        "done",
                        {
                            "message_id": str(turn.assistant_message_id),
                            "status": "cancelled",
                            "finish_reason": "cancelled",
                            "is_truncated": content_truncated,
                            "usage": _usage_payload(),
                        },
                    )
                )
                return
            await queue.put(
                format_sse(
                    "done",
                    {
                        "message_id": str(turn.assistant_message_id),
                        "status": "succeeded",
                        "finish_reason": final_finish_reason or "stop",
                        "is_truncated": content_truncated,
                        "usage": _usage_payload(),
                    },
                )
            )
        except asyncio.CancelledError:
            final_status = "cancelled"
            await _save_final("cancelled")
            await queue.put(
                format_sse(
                    "done",
                    {
                        "message_id": str(turn.assistant_message_id),
                        "status": "cancelled",
                        "finish_reason": "cancelled",
                        "is_truncated": content_truncated,
                        "usage": _usage_payload(),
                    },
                )
            )
            raise
        except ApiError as error:
            code = (
                error.code
                if error.code in {"AI_TIMEOUT", "AI_OUTPUT_INVALID", "AI_PROVIDER_ERROR"}
                else "AI_PROVIDER_ERROR"
            )
            final_status = "failed"
            final_error_code = code
            await _save_final("failed", code)
            await queue.put(
                format_sse(
                    "error",
                    {
                        "code": code,
                        "message": error.message,
                        "retryable": True,
                        "message_id": str(turn.assistant_message_id),
                    },
                )
            )
            await queue.put(
                format_sse(
                    "done",
                    {
                        "message_id": str(turn.assistant_message_id),
                        "status": "failed",
                        "error_code": code,
                        "finish_reason": "error",
                        "is_truncated": content_truncated,
                        "usage": _usage_payload(),
                    },
                )
            )
        except Exception as exc:
            logger.error(
                "AI assistant stream failed: %s conversation_id=%s message_id=%s",
                type(exc).__name__,
                turn.conversation_id,
                turn.assistant_message_id,
            )
            final_status = "failed"
            final_error_code = "AI_PROVIDER_ERROR"
            await _save_final("failed", "AI_PROVIDER_ERROR")
            await queue.put(
                format_sse(
                    "error",
                    {
                        "code": "AI_PROVIDER_ERROR",
                        "message": "AI 服务暂时不可用，请稍后重试",
                        "retryable": True,
                        "message_id": str(turn.assistant_message_id),
                    },
                )
            )
            await queue.put(
                format_sse(
                    "done",
                    {
                        "message_id": str(turn.assistant_message_id),
                        "status": "failed",
                        "error_code": "AI_PROVIDER_ERROR",
                        "finish_reason": "error",
                        "is_truncated": content_truncated,
                        "usage": _usage_payload(),
                    },
                )
            )
        finally:
            await queue.put(None)

    producer_task = asyncio.create_task(_producer())

    async def _watch_cancel() -> None:
        while not producer_task.done():
            try:
                await asyncio.wait_for(cancel_event.wait(), timeout=cancel_poll_interval)
                break
            except TimeoutError:
                if producer_task.done():
                    return
                if await run_in_threadpool(
                    _is_cancelled_in_db,
                    session_factory,
                    turn.owner_id,
                    turn.assistant_message_id,
                ):
                    cancel_event.set()
                    break
        if not producer_task.done():
            producer_task.cancel()

    cancel_watcher = asyncio.create_task(_watch_cancel())
    try:
        while True:
            try:
                frame = await asyncio.wait_for(queue.get(), timeout=heartbeat_interval)
            except TimeoutError:
                if await is_disconnected():
                    cancel_event.set()
                    break
                yield format_sse("ping", {"ts": int(clock().timestamp())})
                continue
            if frame is None:
                break
            yield frame
    except asyncio.CancelledError:
        cancel_event.set()
        if not producer_task.done():
            producer_task.cancel()
        raise
    finally:
        cancel_watcher.cancel()
        try:
            await cancel_watcher
        except asyncio.CancelledError:
            pass
        if not producer_task.done():
            producer_task.cancel()
        try:
            await producer_task
        except asyncio.CancelledError:
            pass
        if not persisted:
            await _save_final("cancelled")
        streams.unregister(turn.owner_id, turn.assistant_message_id)
