from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from app.api.dependencies import get_identity, get_session, require_write
from app.core.responses import ApiResponse, ResponseMeta
from app.modules.activities import service
from app.modules.activities.schema import (
    ActivityBatchDelete,
    ActivityList,
    ActivityUpdate,
    ActivityView,
)

router = APIRouter(prefix="/api/v1/activities", tags=["activities"])


def envelope(request, data):
    return ApiResponse(data=data, meta=ResponseMeta(request_id=request.state.request_id))


@router.get("", response_model=ApiResponse[ActivityList])
def listing(
    request: Request,
    identity: Annotated[tuple, Depends(get_identity)],
    db: Annotated[Session, Depends(get_session)],
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0, le=1000000)] = 0,
    activity_date: date | None = None,
    category: Annotated[str | None, Query(max_length=30)] = None,
    activity_month: Annotated[
        str | None,
        Query(pattern=r"^([1-9][0-9]{3}|0[1-9][0-9]{2}|00[1-9][0-9]|000[1-9])-(0[1-9]|1[0-2])$"),
    ] = None,
):
    data = service.listing(
        db, identity[1].id, limit, offset, activity_date, category, activity_month
    )
    db.commit()
    return envelope(request, data)


@router.get("/categories", response_model=ApiResponse[list[str]])
def categories(
    request: Request,
    identity: Annotated[tuple, Depends(get_identity)],
    db: Annotated[Session, Depends(get_session)],
):
    data = service.categories(db, identity[1].id)
    db.commit()
    return envelope(request, data)


@router.post("/batch-delete")
def delete_activities(
    payload: ActivityBatchDelete,
    request: Request,
    identity: Annotated[tuple, Depends(require_write)],
    db: Annotated[Session, Depends(get_session)],
):
    data = service.delete_activities(db, identity[1].id, payload.ids)
    db.commit()
    return envelope(request, data)


@router.get("/{identifier}", response_model=ApiResponse[ActivityView])
def detail(
    identifier: UUID,
    request: Request,
    identity: Annotated[tuple, Depends(get_identity)],
    db: Annotated[Session, Depends(get_session)],
):
    data = service.detail(db, identity[1].id, identifier)
    db.commit()
    return envelope(request, data)


@router.patch("/{identifier}", response_model=ApiResponse[ActivityView])
def update_activity(
    identifier: UUID,
    payload: ActivityUpdate,
    request: Request,
    identity: Annotated[tuple, Depends(require_write)],
    db: Annotated[Session, Depends(get_session)],
):
    data = service.update_activity(
        db, identity[1].id, identifier, payload, request.app.state.clock()
    )
    db.commit()
    return envelope(request, data)


@router.delete("/{identifier}")
def delete_activity(
    identifier: UUID,
    request: Request,
    identity: Annotated[tuple, Depends(require_write)],
    db: Annotated[Session, Depends(get_session)],
):
    data = service.delete_activity(db, identity[1].id, identifier)
    db.commit()
    return envelope(request, data)


@router.get("/{identifier}/route")
def route(
    identifier: UUID,
    request: Request,
    identity: Annotated[tuple, Depends(get_identity)],
    db: Annotated[Session, Depends(get_session)],
):
    data = service.route(db, identity[1].id, identifier)
    db.commit()
    return envelope(request, data)
