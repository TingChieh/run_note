from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from app.api.dependencies import get_identity, get_session
from app.core.responses import ApiResponse, ResponseMeta
from app.modules.activities import service
from app.modules.activities.schema import ActivityList, ActivityView

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
):
    data = service.listing(db, identity[1].id, limit, offset, activity_date)
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
