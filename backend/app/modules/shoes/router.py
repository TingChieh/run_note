from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from app.api.dependencies import get_read_identity, get_session, require_write
from app.core.responses import ApiResponse
from app.modules.auth.router import envelope
from app.modules.shoes import service
from app.modules.shoes.schema import (
    ShoeActivities,
    ShoeBinding,
    ShoeBindingPatch,
    ShoeDeleted,
    ShoeInput,
    ShoeList,
    ShoePatch,
    ShoeView,
)

router = APIRouter(prefix="/api/v1/me", tags=["shoes"])
Read = Annotated[tuple, Depends(get_read_identity)]
Write = Annotated[tuple, Depends(require_write)]
DB = Annotated[Session, Depends(get_session)]
Limit = Annotated[int, Query(ge=1, le=100)]
Offset = Annotated[int, Query(ge=0, le=1000000)]


@router.get("/shoes", response_model=ApiResponse[ShoeList])
def listing(
    request: Request,
    identity: Read,
    db: DB,
    status: Literal["active", "retired"] = "active",
    order: Literal["reminder", "name"] = "reminder",
    limit: Limit = 20,
    offset: Offset = 0,
):
    return envelope(request, service.listing(db, identity[1].id, status, order, limit, offset))


@router.post("/shoes", response_model=ApiResponse[ShoeView], status_code=201)
def create(payload: ShoeInput, request: Request, identity: Write, db: DB):
    data = service.create(db, identity[1].id, payload)
    db.commit()
    return envelope(request, data)


@router.get("/shoes/{identifier}", response_model=ApiResponse[ShoeView])
def detail(identifier: UUID, request: Request, identity: Read, db: DB):
    return envelope(request, service.detail(db, identity[1].id, identifier))


@router.patch("/shoes/{identifier}", response_model=ApiResponse[ShoeView])
def update(identifier: UUID, payload: ShoePatch, request: Request, identity: Write, db: DB):
    data = service.update(db, identity[1].id, identifier, payload, request.app.state.clock())
    db.commit()
    return envelope(request, data)


@router.delete("/shoes/{identifier}", response_model=ApiResponse[ShoeDeleted])
def delete(identifier: UUID, request: Request, identity: Write, db: DB):
    service.delete(db, identity[1].id, identifier)
    db.commit()
    return envelope(request, ShoeDeleted())


@router.get("/shoes/{identifier}/activities", response_model=ApiResponse[ShoeActivities])
def activities(
    identifier: UUID,
    request: Request,
    identity: Read,
    db: DB,
    limit: Limit = 20,
    offset: Offset = 0,
):
    return envelope(request, service.activities(db, identity[1].id, identifier, limit, offset))


@router.get("/activities/{identifier}/shoe", response_model=ApiResponse[ShoeBinding])
def binding(identifier: UUID, request: Request, identity: Read, db: DB):
    return envelope(request, service.binding(db, identity[1].id, identifier))


@router.patch("/activities/{identifier}/shoe", response_model=ApiResponse[ShoeBinding])
def bind(identifier: UUID, payload: ShoeBindingPatch, request: Request, identity: Write, db: DB):
    data = service.bind(db, identity[1].id, identifier, payload.shoe_id)
    db.commit()
    return envelope(request, data)
