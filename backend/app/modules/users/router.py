from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.api.dependencies import get_identity, get_session, require_auth_config, require_write
from app.core.responses import ApiResponse
from app.modules.auth.router import envelope
from app.modules.auth.service import set_cookie
from app.modules.site_settings.router import png_response, read_upload
from app.modules.users import service
from app.modules.users.schema import (
    AvatarView,
    PasswordUpdate,
    ProfileUpdate,
    StrictInput,
    UserView,
)

router = APIRouter(prefix="/api/v1/me", tags=["users"], dependencies=[Depends(require_auth_config)])


class PasswordChanged(StrictInput):
    password_changed: bool = True


@router.get("", response_model=ApiResponse[UserView])
def me(
    request: Request,
    identity: Annotated[tuple, Depends(get_identity)],
    db: Annotated[Session, Depends(get_session)],
):
    data = service.view(identity[1], request.app.state.settings)
    db.commit()
    return envelope(request, data)


@router.patch("", response_model=ApiResponse[UserView])
def update_me(
    payload: ProfileUpdate,
    request: Request,
    identity: Annotated[tuple, Depends(require_write)],
    db: Annotated[Session, Depends(get_session)],
):
    from app.modules.sharing.service import lock_owner

    user = lock_owner(db, identity[1].id)
    data = service.update_profile(user, payload, request.app.state.settings)
    db.commit()
    return envelope(request, data)


@router.patch("/password", response_model=ApiResponse[PasswordChanged])
def password(
    payload: PasswordUpdate,
    request: Request,
    response: Response,
    identity: Annotated[tuple, Depends(require_write)],
    db: Annotated[Session, Depends(get_session)],
):
    service.change_password(db, identity[1], payload, request.app.state.clock())
    db.commit()
    set_cookie(response, request.app.state.settings)
    return envelope(request, PasswordChanged())


@router.put("/avatar", response_model=ApiResponse[AvatarView])
async def upload_avatar(
    request: Request,
    identity: Annotated[tuple, Depends(require_write)],
    db: Annotated[Session, Depends(get_session)],
):
    owner = identity[1].id
    db.commit()  # Release the identity lock before reading and decoding the upload.
    raw = await read_upload(request)
    url = await run_in_threadpool(service.put_avatar, db, owner, raw)
    await run_in_threadpool(db.commit)
    return envelope(request, AvatarView(avatar_url=url))


@router.delete("/avatar", response_model=ApiResponse[AvatarView])
def delete_avatar(
    request: Request,
    identity: Annotated[tuple, Depends(require_write)],
    db: Annotated[Session, Depends(get_session)],
):
    service.remove_avatar(db, identity[1])
    db.commit()
    return envelope(request, AvatarView(avatar_url=None))


@router.get("/avatar")
def own_avatar(
    identity: Annotated[tuple, Depends(get_identity)],
    db: Annotated[Session, Depends(get_session)],
):
    data = service.avatar_bytes(db, identity[1].id)
    db.commit()
    return png_response(data)
