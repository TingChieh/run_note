"""Authenticated owner-only AI assistant routes (conversations, consent, SSE messaging)."""

from typing import Annotated
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Header, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.api.dependencies import get_identity, get_session, require_write
from app.core.responses import ApiResponse
from app.modules.activities.router import envelope
from app.modules.ai_assistant import service
from app.modules.ai_assistant.orchestrator import TurnStart, stream_turn
from app.modules.ai_assistant.schema import (
    AssistantContext,
    ConsentUpdate,
    ConsentView,
    ConversationCreate,
    ConversationDeleted,
    ConversationDetail,
    ConversationList,
    ConversationUpdate,
    ConversationView,
    MessageCancelled,
    MessageCreate,
)

router = APIRouter(prefix="/api/v1/ai-assistant", tags=["AI assistant"])
DB = Annotated[Session, Depends(get_session)]
Read = Annotated[tuple, Depends(get_identity)]
Write = Annotated[tuple, Depends(require_write)]


@router.get("/context", response_model=ApiResponse[AssistantContext])
def context(request: Request, identity: Read, db: DB):
    data = service.assistant_context(
        db, identity[1].id, request.app.state.clock(), request.app.state.settings
    )
    db.commit()
    return envelope(request, data)


@router.put("/consent", response_model=ApiResponse[ConsentView])
def update_consent(payload: ConsentUpdate, request: Request, identity: Write, db: DB):
    now = request.app.state.clock()
    data = (
        service.grant_consent(db, identity[1].id, now)
        if payload.consented
        else service.revoke_consent(db, identity[1].id, now)
    )
    db.commit()
    return envelope(request, data)


@router.get("/conversations", response_model=ApiResponse[ConversationList])
def list_conversations(
    request: Request,
    identity: Read,
    db: DB,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    offset: Annotated[int, Query(ge=0, le=1000000)] = 0,
):
    data = service.list_conversations(db, identity[1].id, limit, offset)
    db.commit()
    return envelope(request, data)


@router.post("/conversations", response_model=ApiResponse[ConversationView], status_code=201)
def create_conversation(payload: ConversationCreate, request: Request, identity: Write, db: DB):
    data = service.create_conversation(db, identity[1].id, request.app.state.clock(), payload.title)
    db.commit()
    return envelope(request, data)


@router.get("/conversations/{conversation_id}", response_model=ApiResponse[ConversationDetail])
def get_conversation(
    conversation_id: UUID,
    request: Request,
    identity: Read,
    db: DB,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0, le=1000000)] = 0,
):
    data = service.conversation_detail(
        db,
        identity[1].id,
        conversation_id,
        request.app.state.clock(),
        request.app.state.settings,
        limit,
        offset,
    )
    db.commit()
    return envelope(request, data)


@router.patch("/conversations/{conversation_id}", response_model=ApiResponse[ConversationView])
def rename_conversation(
    conversation_id: UUID,
    payload: ConversationUpdate,
    request: Request,
    identity: Write,
    db: DB,
):
    fields = payload.model_dump(exclude_unset=True)
    if not fields:
        from app.core.errors import ApiError

        raise ApiError(422, "VALIDATION_ERROR", "至少需要提供一个要更新的字段")
    data = service.rename_conversation(
        db, identity[1].id, conversation_id, fields.get("title") or "", request.app.state.clock()
    )
    db.commit()
    return envelope(request, data)


@router.delete("/conversations/{conversation_id}", response_model=ApiResponse[ConversationDeleted])
def delete_conversation(conversation_id: UUID, request: Request, identity: Write, db: DB):
    data = service.delete_conversation(
        db,
        identity[1].id,
        conversation_id,
        request.app.state.clock(),
        request.app.state.settings,
    )
    db.commit()
    return envelope(request, data)


@router.post(
    "/conversations/{conversation_id}/messages/{message_id}/cancel",
    response_model=ApiResponse[MessageCancelled],
)
def cancel_message(
    conversation_id: UUID, message_id: UUID, request: Request, identity: Write, db: DB
):
    request.app.state.ai_assistant_streams.cancel(identity[1].id, message_id)
    data = service.cancel_turn(
        db, identity[1].id, conversation_id, message_id, request.app.state.clock()
    )
    db.commit()
    return envelope(request, data)


def _prepare_turn(
    db: Session,
    owner_id: UUID,
    owner_timezone: str,
    conversation_id: UUID,
    content: str,
    request_key: UUID,
    now,
    settings,
) -> TurnStart:
    """Short transaction that commits turn rows & releases locks/connection before streaming."""
    # Release auth's row lock first so begin_turn acquires advisory -> user lock in canonical order.
    db.commit()
    try:
        user_msg, assistant_msg, replayed = service.begin_turn(
            db, owner_id, conversation_id, content, request_key, now, settings
        )
        quota = service.quota_status(db, owner_id, now, settings)
        turn = TurnStart(
            owner_id=owner_id,
            timezone=owner_timezone,
            today=now.astimezone(ZoneInfo(owner_timezone)).date(),
            conversation_id=conversation_id,
            user_message_id=user_msg.id if user_msg is not None else assistant_msg.id,
            assistant_message_id=assistant_msg.id,
            user_content=content.strip(),
            remaining_messages_today=quota.remaining_messages_today,
            remaining_tokens_today=quota.remaining_tokens_today,
            replayed=replayed,
            replayed_status=assistant_msg.status if replayed else None,
            replayed_content=assistant_msg.content if replayed else None,
            replayed_blocks=list(assistant_msg.ui_blocks or []) if replayed else None,
            replayed_error_code=assistant_msg.error_code if replayed else None,
            replayed_input_tokens=assistant_msg.input_tokens if replayed else None,
            replayed_output_tokens=assistant_msg.output_tokens if replayed else None,
            replayed_cached_input_tokens=assistant_msg.cached_input_tokens if replayed else None,
        )
        db.commit()
        return turn
    except Exception:
        db.rollback()
        raise
    finally:
        # Return pooled DB connection immediately before the SSE stream starts.
        db.close()


@router.post("/conversations/{conversation_id}/messages")
async def send_message(
    conversation_id: UUID,
    payload: MessageCreate,
    request: Request,
    identity: Write,
    db: DB,
    idempotency_key: Annotated[UUID, Header()],
):
    """Stream an assistant turn over SSE after committing turn rows in a short DB transaction."""
    user = identity[1]
    owner_id, owner_timezone = user.id, user.timezone
    now = request.app.state.clock()
    turn = await run_in_threadpool(
        _prepare_turn,
        db,
        owner_id,
        owner_timezone,
        conversation_id,
        payload.content,
        idempotency_key,
        now,
        request.app.state.settings,
    )
    generator = stream_turn(
        turn,
        session_factory=request.app.state.session_factory,
        settings=request.app.state.settings,
        provider=request.app.state.ai_assistant_provider,
        clock=request.app.state.clock,
        streams=request.app.state.ai_assistant_streams,
        is_disconnected=request.is_disconnected,
    )
    return StreamingResponse(
        generator,
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-store, no-transform",
            "X-Accel-Buffering": "no",
        },
    )
