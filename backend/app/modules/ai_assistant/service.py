"""Owner-scoped AI assistant state transitions: consent, conversations, concurrency, idempotency,
short-window rate limiting, and daily user/site quota enforcement.
"""

from datetime import UTC, datetime, timedelta
from typing import Literal
from uuid import UUID

from sqlalchemy import case, delete, func, select, text, update
from sqlalchemy.dialects.postgresql import insert

from app.core.errors import ApiError
from app.modules.ai_assistant.model import AIConversation, AIMessage, AIUserConsent
from app.modules.ai_assistant.privacy import sanitize_tool_calls_summary, sanitize_ui_blocks
from app.modules.ai_assistant.schema import (
    AssistantContext,
    ConsentView,
    ConversationDetail,
    ConversationList,
    ConversationView,
    MessageCancelled,
    MessageView,
    QuotaStatusView,
    UIBlock,
)
from app.modules.users.model import User

CONSENT_VERSION = "ai-assistant-v1"
PROMPT_VERSION = "ai-assistant-v1"
MAX_USER_MESSAGE_CHARS = 4000
MAX_ASSISTANT_CONTENT_CHARS = 16000
MAX_HISTORY_TURNS = 6
MAX_HISTORY_ITEM_CHARS = 2000

# Fixed 64-bit PostgreSQL advisory lock key serializing site-wide admission checks (~2 ms
# short transaction, released automatically on commit before any external DeepSeek call).
SITE_BUDGET_LOCK_KEY = 770020261

# Short-window anti-burst limits evaluated on ai_messages (uses ix_ai_messages_user_created).
SHORT_RATE_WINDOWS: tuple[tuple[int, int], ...] = (
    (6, 60),
    (20, 600),
)


def site_inflight_reserve(settings) -> int:
    """Estimated tokens reserved per active in-flight turn to bound concurrent site overspend."""
    return max(int(settings.ai_max_output_tokens) * 2, 4096)


def lock_user(db, owner_id: UUID) -> User:
    user = db.scalar(
        select(User)
        .where(User.id == owner_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if user is None:
        raise ApiError(404, "RESOURCE_NOT_FOUND", "用户不存在")
    return user


def _utc_day_bounds(now: datetime) -> tuple[datetime, datetime]:
    start = now.astimezone(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
    return start, start + timedelta(days=1)


def get_consent(db, owner_id: UUID) -> ConsentView:
    row = db.get(AIUserConsent, owner_id)
    consented = (
        row is not None and row.revoked_at is None and row.consent_version == CONSENT_VERSION
    )
    return ConsentView(
        consented=consented,
        consent_version=row.consent_version if row else None,
        required_version=CONSENT_VERSION,
        consented_at=row.consented_at if row else None,
        revoked_at=row.revoked_at if row else None,
    )


def grant_consent(db, owner_id: UUID, now: datetime) -> ConsentView:
    statement = insert(AIUserConsent).values(
        user_id=owner_id,
        consent_version=CONSENT_VERSION,
        consented_at=now,
        revoked_at=None,
    )
    db.execute(
        statement.on_conflict_do_update(
            index_elements=[AIUserConsent.user_id],
            set_={
                "consent_version": CONSENT_VERSION,
                "consented_at": now,
                "revoked_at": None,
            },
        )
    )
    db.flush()
    return get_consent(db, owner_id)


def revoke_consent(db, owner_id: UUID, now: datetime) -> ConsentView:
    row = db.get(AIUserConsent, owner_id)
    if row is not None and row.revoked_at is None:
        row.revoked_at = max(now, row.consented_at)
        db.flush()
    return get_consent(db, owner_id)


def require_consent(db, owner_id: UUID) -> None:
    if not get_consent(db, owner_id).consented:
        raise ApiError(
            403,
            "AI_CONSENT_REQUIRED",
            "请先阅读并同意 AI 助手数据使用说明后再提问",
        )


def recover_stale_messages(db, owner_id: UUID, now: datetime, settings) -> None:
    cutoff = now - timedelta(seconds=settings.ai_stream_total_timeout_seconds + 60)
    db.execute(
        update(AIMessage)
        .where(
            AIMessage.user_id == owner_id,
            AIMessage.status.in_(("pending", "streaming")),
            AIMessage.created_at <= cutoff,
        )
        .values(status="failed", error_code="AI_TIMEOUT", finished_at=now)
    )
    purge_before = now - timedelta(days=30)
    db.execute(
        delete(AIMessage).where(AIMessage.user_id == owner_id, AIMessage.deleted_at <= purge_before)
    )
    db.execute(
        delete(AIConversation).where(
            AIConversation.user_id == owner_id, AIConversation.deleted_at <= purge_before
        )
    )


def recover_global_stale_messages(db, now: datetime, settings) -> None:
    """Reap stale active assistant messages site-wide so dead workers cannot pin site reserve."""
    cutoff = now - timedelta(seconds=settings.ai_stream_total_timeout_seconds + 60)
    db.execute(
        update(AIMessage)
        .where(
            AIMessage.role == "assistant",
            AIMessage.status.in_(("pending", "streaming")),
            AIMessage.created_at <= cutoff,
        )
        .values(status="failed", error_code="AI_TIMEOUT", finished_at=now)
    )


def quota_status(db, owner_id: UUID, now: datetime, settings) -> QuotaStatusView:
    start, end = _utc_day_bounds(now)
    # Deleting conversations does not refund quota: count every assistant turn started today.
    user_messages, user_tokens = db.execute(
        select(
            func.count(),
            func.coalesce(
                func.sum(
                    func.coalesce(AIMessage.input_tokens, 0)
                    + func.coalesce(AIMessage.output_tokens, 0)
                ),
                0,
            ),
        )
        .select_from(AIMessage)
        .where(
            AIMessage.user_id == owner_id,
            AIMessage.role == "assistant",
            AIMessage.created_at >= start,
            AIMessage.created_at < end,
        )
    ).one()
    site_tokens, site_active = db.execute(
        select(
            func.coalesce(
                func.sum(
                    func.coalesce(AIMessage.input_tokens, 0)
                    + func.coalesce(AIMessage.output_tokens, 0)
                ),
                0,
            ),
            func.count().filter(AIMessage.status.in_(("pending", "streaming"))),
        )
        .select_from(AIMessage)
        .where(
            AIMessage.role == "assistant",
            AIMessage.created_at >= start,
            AIMessage.created_at < end,
        )
    ).one()
    messages_today = int(user_messages or 0)
    tokens_today = int(user_tokens or 0)
    site_tokens_today = int(site_tokens or 0)
    reserved_site_tokens = int(site_active or 0) * site_inflight_reserve(settings)
    return QuotaStatusView(
        daily_message_limit=settings.ai_daily_message_limit,
        messages_today=messages_today,
        remaining_messages_today=max(0, settings.ai_daily_message_limit - messages_today),
        daily_token_budget=settings.ai_daily_token_budget,
        tokens_today=tokens_today,
        remaining_tokens_today=max(0, settings.ai_daily_token_budget - tokens_today),
        site_daily_token_budget=settings.ai_site_daily_token_budget,
        site_tokens_today=site_tokens_today,
        site_budget_exhausted=(
            site_tokens_today + reserved_site_tokens >= settings.ai_site_daily_token_budget
        ),
    )


def assistant_context(db, owner_id: UUID, now: datetime, settings) -> AssistantContext:
    lock_user(db, owner_id)
    recover_stale_messages(db, owner_id, now, settings)
    return AssistantContext(
        configured=settings.ai_configured,
        enabled=settings.ai_assistant_enabled,
        model=settings.ai_model,
        consent=get_consent(db, owner_id),
        quota=quota_status(db, owner_id, now, settings),
    )


def _conversation_view(row: AIConversation) -> ConversationView:
    return ConversationView(
        id=row.id,
        title=row.title,
        created_at=row.created_at,
        updated_at=row.updated_at,
        last_message_at=row.last_message_at,
    )


def message_view(row: AIMessage, current_data_version: int) -> MessageView:
    return MessageView(
        id=row.id,
        conversation_id=row.conversation_id,
        role=row.role,
        status=row.status,
        content=row.content,
        tool_calls_summary=row.tool_calls_summary or [],
        ui_blocks=[UIBlock.model_validate(b) for b in (row.ui_blocks or [])],
        model=row.model,
        prompt_version=row.prompt_version,
        error_code=row.error_code,
        input_tokens=row.input_tokens,
        output_tokens=row.output_tokens,
        cached_input_tokens=row.cached_input_tokens,
        created_at=row.created_at,
        finished_at=row.finished_at,
        is_stale=row.source_data_version != current_data_version,
    )


def owned_conversation(db, owner_id: UUID, conversation_id: UUID) -> AIConversation:
    row = db.scalar(
        select(AIConversation).where(
            AIConversation.id == conversation_id,
            AIConversation.user_id == owner_id,
            AIConversation.deleted_at.is_(None),
        )
    )
    if row is None:
        raise ApiError(404, "RESOURCE_NOT_FOUND", "会话不存在")
    return row


def owned_message(db, owner_id: UUID, message_id: UUID) -> AIMessage:
    row = db.scalar(
        select(AIMessage).where(
            AIMessage.id == message_id,
            AIMessage.user_id == owner_id,
            AIMessage.deleted_at.is_(None),
        )
    )
    if row is None:
        raise ApiError(404, "RESOURCE_NOT_FOUND", "消息不存在")
    return row


def create_conversation(db, owner_id: UUID, now: datetime, title: str = "") -> ConversationView:
    cleaned = title.strip()[:120]
    row = AIConversation(
        user_id=owner_id,
        title=cleaned,
        created_at=now,
        updated_at=now,
        last_message_at=now,
    )
    db.add(row)
    db.flush()
    return _conversation_view(row)


def list_conversations(db, owner_id: UUID, limit: int = 20, offset: int = 0) -> ConversationList:
    filters = (AIConversation.user_id == owner_id, AIConversation.deleted_at.is_(None))
    total = int(db.scalar(select(func.count()).select_from(AIConversation).where(*filters)) or 0)
    rows = db.scalars(
        select(AIConversation)
        .where(*filters)
        .order_by(AIConversation.last_message_at.desc(), AIConversation.id.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    return ConversationList(
        items=[_conversation_view(row) for row in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


def rename_conversation(
    db, owner_id: UUID, conversation_id: UUID, title: str, now: datetime
) -> ConversationView:
    cleaned = title.strip()[:120]
    if not cleaned:
        raise ApiError(422, "VALIDATION_ERROR", "会话标题不能为空")
    conv = owned_conversation(db, owner_id, conversation_id)
    conv.title = cleaned
    conv.updated_at = now
    db.flush()
    return _conversation_view(conv)


def conversation_detail(
    db,
    owner_id: UUID,
    conversation_id: UUID,
    now: datetime,
    settings,
    limit: int = 50,
    offset: int = 0,
) -> ConversationDetail:
    user = lock_user(db, owner_id)
    recover_stale_messages(db, owner_id, now, settings)
    conv = owned_conversation(db, owner_id, conversation_id)
    filters = (
        AIMessage.conversation_id == conv.id,
        AIMessage.user_id == owner_id,
        AIMessage.deleted_at.is_(None),
    )
    total = int(db.scalar(select(func.count()).select_from(AIMessage).where(*filters)) or 0)
    role_rank = case((AIMessage.role == "user", 0), else_=1)
    rows = db.scalars(
        select(AIMessage)
        .where(*filters)
        .order_by(AIMessage.created_at.asc(), role_rank.asc(), AIMessage.id.asc())
        .limit(limit)
        .offset(offset)
    ).all()
    return ConversationDetail(
        conversation=_conversation_view(conv),
        messages=[message_view(row, user.activity_data_version) for row in rows],
        total_messages=total,
        limit=limit,
        offset=offset,
    )


def recent_history_messages(
    db,
    owner_id: UUID,
    conversation_id: UUID,
    *,
    exclude_message_ids: tuple[UUID, ...] = (),
    max_turns: int = MAX_HISTORY_TURNS,
) -> list[dict[str, str]]:
    """Load the latest `max_turns` succeeded user/assistant messages in chronological order."""
    filters = [
        AIMessage.conversation_id == conversation_id,
        AIMessage.user_id == owner_id,
        AIMessage.deleted_at.is_(None),
        AIMessage.status == "succeeded",
        AIMessage.content.is_not(None),
    ]
    if exclude_message_ids:
        filters.append(AIMessage.id.not_in(exclude_message_ids))
    role_rank = case((AIMessage.role == "user", 0), else_=1)
    rows = db.scalars(
        select(AIMessage)
        .where(*filters)
        .order_by(AIMessage.created_at.desc(), role_rank.desc(), AIMessage.id.desc())
        .limit(max_turns * 2)
    ).all()
    rows.reverse()
    return [
        {"role": row.role, "content": (row.content or "")[:MAX_HISTORY_ITEM_CHARS]}
        for row in rows
        if (row.content or "").strip()
    ]


def delete_conversation(
    db, owner_id: UUID, conversation_id: UUID, now: datetime, settings
) -> dict[str, bool]:
    lock_user(db, owner_id)
    recover_stale_messages(db, owner_id, now, settings)
    conv = owned_conversation(db, owner_id, conversation_id)
    active = db.scalar(
        select(AIMessage.id).where(
            AIMessage.conversation_id == conv.id,
            AIMessage.user_id == owner_id,
            AIMessage.status.in_(("pending", "streaming")),
        )
    )
    if active is not None:
        raise ApiError(409, "AI_IN_PROGRESS", "生成中的会话暂不能删除")
    db.execute(
        update(AIMessage)
        .where(
            AIMessage.conversation_id == conv.id,
            AIMessage.user_id == owner_id,
            AIMessage.deleted_at.is_(None),
        )
        .values(deleted_at=now, content=None, tool_calls_summary=[], ui_blocks=[])
    )
    conv.deleted_at = now
    conv.title = ""
    db.flush()
    return {"deleted": True}


def _check_short_rate_limits(db, owner_id: UUID, now: datetime) -> None:
    for limit, seconds in SHORT_RATE_WINDOWS:
        window_start = now - timedelta(seconds=seconds)
        count, oldest = db.execute(
            select(func.count(), func.min(AIMessage.created_at))
            .select_from(AIMessage)
            .where(
                AIMessage.user_id == owner_id,
                AIMessage.role == "assistant",
                AIMessage.created_at >= window_start,
            )
        ).one()
        if int(count or 0) >= limit:
            retry_after = (
                max(1, int((oldest + timedelta(seconds=seconds) - now).total_seconds()) + 1)
                if oldest is not None
                else seconds
            )
            raise ApiError(
                429,
                "AI_RATE_LIMITED",
                "提问过于频繁，请稍后再试",
                retry_after=retry_after,
            )


def begin_turn(
    db,
    owner_id: UUID,
    conversation_id: UUID,
    user_content: str,
    request_key: UUID,
    now: datetime,
    settings,
) -> tuple[AIMessage, AIMessage, bool]:
    """Atomically validate consent, idempotency, rate limits, concurrency, and user/site quotas.

    Caller commits immediately to release the advisory/user locks and DB connection before calling
    DeepSeek.
    """
    cleaned = user_content.strip()
    if not cleaned or len(cleaned) > MAX_USER_MESSAGE_CHARS:
        raise ApiError(422, "VALIDATION_ERROR", f"提问内容需在 1–{MAX_USER_MESSAGE_CHARS} 字之间")

    # Consistent lock order (advisory lock before user row lock) prevents cross-user deadlocks
    # while bounding concurrent admission near the site daily token ceiling.
    db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": SITE_BUDGET_LOCK_KEY})
    user = lock_user(db, owner_id)
    recover_stale_messages(db, owner_id, now, settings)
    recover_global_stale_messages(db, now, settings)
    conv = owned_conversation(db, owner_id, conversation_id)

    existing_assistant = db.scalar(
        select(AIMessage).where(
            AIMessage.user_id == owner_id,
            AIMessage.role == "assistant",
            AIMessage.request_key == request_key,
        )
    )
    if existing_assistant is not None:
        if existing_assistant.conversation_id != conv.id:
            raise ApiError(409, "IDEMPOTENCY_CONFLICT", "该请求标识已用于其他会话")
        if existing_assistant.deleted_at is not None:
            raise ApiError(409, "MESSAGE_DELETED", "该请求对应的消息已删除，请发起新提问")
        if existing_assistant.status in ("pending", "streaming"):
            raise ApiError(
                409,
                "AI_IN_PROGRESS",
                "回复正在生成，请稍后查看会话记录",
                retry_after=2,
                details=[{"message_id": str(existing_assistant.id)}],
            )
        existing_user = db.scalar(
            select(AIMessage).where(
                AIMessage.user_id == owner_id,
                AIMessage.role == "user",
                AIMessage.request_key == request_key,
            )
        )
        return existing_user, existing_assistant, True

    if not settings.ai_assistant_enabled:
        raise ApiError(503, "AI_ASSISTANT_DISABLED", "AI 助手暂未开启")
    if not settings.ai_configured:
        raise ApiError(503, "AI_NOT_CONFIGURED", "AI 服务尚未配置，运动记录和统计仍可使用")
    require_consent(db, owner_id)

    active = db.scalar(
        select(AIMessage.id).where(
            AIMessage.user_id == owner_id,
            AIMessage.role == "assistant",
            AIMessage.status.in_(("pending", "streaming")),
        )
    )
    if active is not None:
        raise ApiError(
            409,
            "AI_IN_PROGRESS",
            "已有回复正在生成，请等待完成后再提问",
            retry_after=2,
            details=[{"message_id": str(active)}],
        )

    _check_short_rate_limits(db, owner_id, now)

    quota = quota_status(db, owner_id, now, settings)
    _, boundary = _utc_day_bounds(now)
    seconds_until_reset = max(1, int((boundary - now).total_seconds()))
    if quota.messages_today >= quota.daily_message_limit:
        raise ApiError(
            429,
            "AI_QUOTA_EXCEEDED",
            "今日提问次数已达上限（按 UTC 日期计算）",
            retry_after=seconds_until_reset,
        )
    if quota.tokens_today >= quota.daily_token_budget:
        raise ApiError(
            429,
            "AI_QUOTA_EXCEEDED",
            "今日个人 AI 额度已用完（按 UTC 日期计算）",
            retry_after=seconds_until_reset,
        )
    if quota.site_budget_exhausted:
        raise ApiError(
            503,
            "AI_BUDGET_EXHAUSTED",
            "今日站点 AI 额度已达上限，将于明日恢复",
            retry_after=seconds_until_reset,
        )

    user_msg = AIMessage(
        conversation_id=conv.id,
        user_id=owner_id,
        request_key=request_key,
        role="user",
        status="succeeded",
        content=cleaned,
        tool_calls_summary=[],
        ui_blocks=[],
        source_data_version=user.activity_data_version,
        created_at=now,
        finished_at=now,
    )
    assistant_msg = AIMessage(
        conversation_id=conv.id,
        user_id=owner_id,
        request_key=request_key,
        role="assistant",
        status="pending",
        content=None,
        tool_calls_summary=[],
        ui_blocks=[],
        model=settings.ai_model,
        prompt_version=PROMPT_VERSION,
        source_data_version=user.activity_data_version,
        created_at=now,
        finished_at=None,
    )
    db.add_all([user_msg, assistant_msg])
    if not conv.title:
        conv.title = cleaned[:40]
    conv.last_message_at = now
    conv.updated_at = now
    db.flush()
    return user_msg, assistant_msg, False


def mark_streaming(db, owner_id: UUID, assistant_message_id: UUID) -> bool:
    updated = db.scalar(
        update(AIMessage)
        .where(
            AIMessage.id == assistant_message_id,
            AIMessage.user_id == owner_id,
            AIMessage.role == "assistant",
            AIMessage.status == "pending",
        )
        .values(status="streaming")
        .returning(AIMessage.id)
    )
    return updated is not None


def cancel_turn(
    db, owner_id: UUID, conversation_id: UUID, message_id: UUID, now: datetime
) -> MessageCancelled:
    owned_conversation(db, owner_id, conversation_id)
    msg = db.scalar(
        select(AIMessage).where(
            AIMessage.id == message_id,
            AIMessage.conversation_id == conversation_id,
            AIMessage.user_id == owner_id,
            AIMessage.role == "assistant",
            AIMessage.deleted_at.is_(None),
        )
    )
    if msg is None:
        raise ApiError(404, "RESOURCE_NOT_FOUND", "消息不存在")
    if msg.status not in ("pending", "streaming"):
        return MessageCancelled(cancelled=False, status=msg.status)
    updated = db.scalar(
        update(AIMessage)
        .where(
            AIMessage.id == message_id,
            AIMessage.user_id == owner_id,
            AIMessage.status.in_(("pending", "streaming")),
        )
        .values(status="cancelled", finished_at=now)
        .returning(AIMessage.status)
    )
    if updated is None:
        db.refresh(msg)
        return MessageCancelled(cancelled=False, status=msg.status)
    return MessageCancelled(cancelled=True, status="cancelled")


def finish_turn(
    db,
    owner_id: UUID,
    assistant_message_id: UUID,
    status: Literal["succeeded", "failed", "cancelled"],
    *,
    finished_at: datetime,
    content: str | None = None,
    tool_calls_summary: list[dict] | None = None,
    ui_blocks: list[UIBlock] | None = None,
    error_code: str | None = None,
    input_tokens: int | None = None,
    output_tokens: int | None = None,
    cached_input_tokens: int | None = None,
) -> bool:
    safe_content = content[:MAX_ASSISTANT_CONTENT_CHARS] if content is not None else None
    safe_summary = sanitize_tool_calls_summary(tool_calls_summary)
    serialized_blocks = sanitize_ui_blocks(
        [UIBlock.model_validate(block).model_dump(mode="json") for block in (ui_blocks or [])]
    )
    updated = db.scalar(
        update(AIMessage)
        .where(
            AIMessage.id == assistant_message_id,
            AIMessage.user_id == owner_id,
            AIMessage.role == "assistant",
            AIMessage.status.in_(("pending", "streaming")),
        )
        .values(
            status=status,
            content=safe_content,
            tool_calls_summary=safe_summary,
            ui_blocks=serialized_blocks,
            error_code=error_code,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cached_input_tokens=cached_input_tokens,
            finished_at=finished_at,
        )
        .returning(AIMessage.id)
    )
    if updated is not None:
        return True
    if status == "cancelled":
        # Preserve accumulated partial output/blocks/tokens when cancel_turn flipped status first.
        backfilled = db.scalar(
            update(AIMessage)
            .where(
                AIMessage.id == assistant_message_id,
                AIMessage.user_id == owner_id,
                AIMessage.role == "assistant",
                AIMessage.status == "cancelled",
                AIMessage.deleted_at.is_(None),
                AIMessage.content.is_(None),
                AIMessage.input_tokens.is_(None),
            )
            .values(
                content=safe_content,
                tool_calls_summary=safe_summary,
                ui_blocks=serialized_blocks,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                cached_input_tokens=cached_input_tokens,
            )
            .returning(AIMessage.id)
        )
        return backfilled is not None
    return False
