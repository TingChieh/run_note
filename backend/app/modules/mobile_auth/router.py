from typing import Annotated

from fastapi import APIRouter, Body, Depends, Request
from sqlalchemy.orm import Session

from app.api.dependencies import get_session, require_auth_config, require_write
from app.core.errors import ApiError
from app.core.responses import ApiResponse
from app.modules.auth.model import MobileSession
from app.modules.auth.rate_limit import client_ip, consume
from app.modules.auth.router import envelope
from app.modules.auth.schema import LogoutView
from app.modules.mobile_auth import service
from app.modules.mobile_auth.schema import (
    ClientCapabilitiesView,
    MobileAuthView,
    MobileLoginInput,
    MobileLogoutInput,
    MobileRefreshInput,
)
from app.modules.users.service import view

client_router = APIRouter(prefix="/api/v1/client", tags=["client"])
router = APIRouter(
    prefix="/api/v1/mobile/auth",
    tags=["mobile-auth"],
    dependencies=[Depends(require_auth_config)],
)


def _auth_view(request: Request, issued: service.IssuedMobileSession) -> MobileAuthView:
    return MobileAuthView(
        access_token=issued.access_token,
        access_expires_at=issued.row.access_expires_at,
        refresh_token=issued.refresh_token,
        refresh_expires_at=issued.row.refresh_expires_at,
        user=view(issued.user, request.app.state.settings),
    )


@client_router.get("/capabilities", response_model=ApiResponse[ClientCapabilitiesView])
def client_capabilities(request: Request):
    return envelope(request, service.capabilities())


@router.post("/login", response_model=ApiResponse[MobileAuthView])
def mobile_login(
    payload: MobileLoginInput,
    request: Request,
    db: Annotated[Session, Depends(get_session)],
):
    now = request.app.state.clock()
    # Release the request session before the independent rate-limit counter transaction.
    db.rollback()
    consume(request.app, [("login-account", payload.email), ("login-ip", client_ip(request))], now)
    now = request.app.state.clock()
    issued = service.login_mobile(db, payload, now, request.app.state.settings.site_owner_email)
    db.commit()
    return envelope(request, _auth_view(request, issued))


@router.post("/refresh", response_model=ApiResponse[MobileAuthView])
def mobile_refresh(
    payload: MobileRefreshInput,
    request: Request,
    db: Annotated[Session, Depends(get_session)],
):
    now = request.app.state.clock()
    # Release the request session before the independent rate-limit counter transaction.
    db.rollback()
    consume(request.app, [("mobile-refresh-ip", client_ip(request))], now)
    now = request.app.state.clock()
    result = service.refresh_mobile(db, payload, now, request.app.state.settings.site_owner_email)
    if result.replay_detected or result.issued is None:
        db.commit()
        raise ApiError(401, "INVALID_REFRESH_TOKEN", "登录已过期，请重新登录")
    db.commit()
    return envelope(request, _auth_view(request, result.issued))


@router.post("/logout", response_model=ApiResponse[LogoutView])
def mobile_logout(
    request: Request,
    identity: Annotated[tuple, Depends(require_write)],
    db: Annotated[Session, Depends(get_session)],
    payload: Annotated[MobileLogoutInput | None, Body()] = None,
):
    if not isinstance(identity[0], MobileSession):
        raise ApiError(401, "AUTH_REQUIRED", "请使用移动端会话令牌")
    service.logout_mobile(
        db,
        identity[0],
        identity[1],
        request.app.state.clock(),
        revoke_all_devices=bool(payload and payload.revoke_all_devices),
    )
    db.commit()
    return envelope(request, LogoutView())
