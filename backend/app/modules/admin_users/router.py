from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from app.api.dependencies import get_session, require_admin, require_admin_write
from app.core.responses import ApiResponse
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
DB = Annotated[Session, Depends(get_session)]
Read = Annotated[tuple, Depends(require_admin)]
Write = Annotated[tuple, Depends(require_admin_write)]


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
