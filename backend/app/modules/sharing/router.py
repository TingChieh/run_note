from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from app.api.dependencies import get_identity, get_session, require_write
from app.core.responses import ApiResponse
from app.modules.activities.router import envelope
from app.modules.sharing import service
from app.modules.sharing.schema import (
    PublicActivity,
    PublicActivityList,
    PublicProfile,
    ShareCreate,
    ShareCreated,
    ShareList,
)
from app.modules.statistics import service as statistics
from app.modules.statistics.schema import Calendar

router = APIRouter(prefix="/api/v1", tags=["sharing"])
DB = Annotated[Session, Depends(get_session)]
Write = Annotated[tuple, Depends(require_write)]
Read = Annotated[tuple, Depends(get_identity)]


@router.post(
    "/activities/{identifier}/shares", status_code=201, response_model=ApiResponse[ShareCreated]
)
def create_share(identifier: UUID, payload: ShareCreate, request: Request, identity: Write, db: DB):
    data = service.create_link(
        db,
        identity[1].id,
        identifier,
        payload,
        request.app.state.clock(),
        request.app.state.settings.site_origin,
    )
    db.commit()
    return envelope(request, data)


@router.get("/activities/{identifier}/shares", response_model=ApiResponse[ShareList])
def shares(identifier: UUID, request: Request, identity: Read, db: DB):
    data = service.links(db, identity[1].id, identifier, request.app.state.clock())
    db.commit()
    return envelope(request, data)


@router.delete("/activities/{identifier}/shares/{link_id}")
def revoke(identifier: UUID, link_id: UUID, request: Request, identity: Write, db: DB):
    data = service.revoke(db, identity[1].id, identifier, link_id, request.app.state.clock())
    db.commit()
    return envelope(request, data)


@router.get("/public/users/{username}", response_model=ApiResponse[PublicProfile])
def profile(username: str, request: Request, db: DB):
    data = service.profile(db, username)
    db.commit()
    return envelope(request, data)


@router.get("/public/users/{username}/calendar", response_model=ApiResponse[Calendar])
def calendar(
    username: str,
    request: Request,
    db: DB,
    year: Annotated[int, Query(ge=1900, le=2100)],
    metric: str = "distance",
):
    if metric not in {"distance", "count"}:
        from app.core.errors import ApiError

        raise ApiError(422, "VALIDATION_ERROR", "请选择距离或次数")
    user = service.profile_user(db, username)
    data = statistics.calendar(db, user.id, year, metric, public_only=True)
    db.commit()
    return envelope(request, data)


@router.get("/public/users/{username}/activities", response_model=ApiResponse[PublicActivityList])
def activities(
    username: str,
    request: Request,
    db: DB,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0, le=1000000)] = 0,
    activity_date: date | None = None,
):
    data = service.public_listing(db, username, limit, offset, activity_date)
    db.commit()
    return envelope(request, data)


@router.get("/public/activities/{identifier}", response_model=ApiResponse[PublicActivity])
def activity(identifier: UUID, request: Request, db: DB):
    data = service.public_activity(db, identifier)
    db.commit()
    return envelope(request, data)


@router.get("/shared/{token}", response_model=ApiResponse[PublicActivity])
def shared(token: str, request: Request, db: DB):
    data = service.shared(db, token, request.app.state.clock())
    db.commit()
    return envelope(request, data)
