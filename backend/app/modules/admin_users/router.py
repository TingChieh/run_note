from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from app.api.dependencies import get_session, require_admin, require_admin_write
from app.core.responses import ApiResponse
from app.modules.activities import service as activities
from app.modules.activities.schema import ActivityList, ActivityView
from app.modules.admin_users import service
from app.modules.admin_users.schema import (
    AdminUser,
    AdminUserList,
    PasswordReset,
    PasswordResetResult,
    UserBatchDelete,
    UserBatchDeleteResult,
    UserCreate,
    UserPatch,
)
from app.modules.auth.router import envelope

router = APIRouter(prefix="/api/v1/admin/users", tags=["admin-users"])
activity_router = APIRouter(prefix="/api/v1/admin/activities", tags=["admin-users"])
DB = Annotated[Session, Depends(get_session)]
Read = Annotated[tuple, Depends(require_admin)]
Write = Annotated[tuple, Depends(require_admin_write)]


@activity_router.get("/{activity_id}/owner")
def activity_owner(activity_id: UUID, request: Request, db: DB, identity: Read):
    data = service.activity_owner(db, activity_id)
    db.commit()
    return envelope(request, data)


@router.get("/{user_id}", response_model=ApiResponse[AdminUser])
def get_user(user_id: UUID, request: Request, db: DB, identity: Read):
    data = service.admin_view(service.read_user(db, user_id), request.app.state.settings)
    db.commit()
    return envelope(request, data)


@router.get("/{user_id}/activities", response_model=ApiResponse[ActivityList])
def activities_listing(
    user_id: UUID,
    request: Request,
    db: DB,
    identity: Read,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0, le=1000000)] = 0,
    activity_date: date | None = None,
    category: Annotated[str | None, Query(max_length=30)] = None,
    activity_month: Annotated[
        str | None,
        Query(pattern=r"^([1-9][0-9]{3}|0[1-9][0-9]{2}|00[1-9][0-9]|000[1-9])-(0[1-9]|1[0-2])$"),
    ] = None,
):
    service.read_user(db, user_id)
    data = activities.listing(db, user_id, limit, offset, activity_date, category, activity_month)
    db.commit()
    return envelope(request, data)


@router.get("/{user_id}/activities/{activity_id}", response_model=ApiResponse[ActivityView])
def activity_detail(user_id: UUID, activity_id: UUID, request: Request, db: DB, identity: Read):
    service.read_user(db, user_id)
    data = activities.detail(db, user_id, activity_id)
    db.commit()
    return envelope(request, data)


@router.get("/{user_id}/activities/{activity_id}/route")
def activity_route(user_id: UUID, activity_id: UUID, request: Request, db: DB, identity: Read):
    service.read_user(db, user_id)
    data = activities.route(db, user_id, activity_id)
    db.commit()
    return envelope(request, data)


@router.get("", response_model=ApiResponse[AdminUserList])
def listing(
    request: Request,
    db: DB,
    identity: Read,
    search: Annotated[str, Query(max_length=254)] = "",
    is_active: bool | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0, le=1000000)] = 0,
):
    data = service.listing(db, request.app.state.settings, search, is_active, limit, offset)
    db.commit()
    return envelope(request, data)


@router.post("", status_code=201, response_model=ApiResponse[AdminUser])
def create(payload: UserCreate, request: Request, db: DB, identity: Write):
    data = service.create(db, payload, request.app.state.settings)
    db.commit()
    return envelope(request, data)


@router.post("/batch-delete", response_model=ApiResponse[UserBatchDeleteResult])
def batch_delete(payload: UserBatchDelete, request: Request, db: DB, identity: Write):
    data = service.delete_many(db, payload.ids, request.app.state.settings)
    db.commit()
    return envelope(request, data)


@router.patch("/{identifier}", response_model=ApiResponse[AdminUser])
def patch(identifier: UUID, payload: UserPatch, request: Request, db: DB, identity: Write):
    data = service.patch(
        db, identifier, payload, request.app.state.settings, request.app.state.clock()
    )
    db.commit()
    return envelope(request, data)


@router.post("/{identifier}/reset-password", response_model=ApiResponse[PasswordResetResult])
def reset(identifier: UUID, payload: PasswordReset, request: Request, db: DB, identity: Write):
    data = service.reset_password(
        db, identifier, payload, request.app.state.settings, request.app.state.clock()
    )
    db.commit()
    return envelope(request, data)
