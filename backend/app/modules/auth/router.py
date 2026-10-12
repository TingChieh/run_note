from typing import Annotated

from fastapi import APIRouter, Body, Depends, Request, Response
from sqlalchemy.orm import Session

from app.api.dependencies import get_identity, get_session, require_auth_config, require_write
from app.core.responses import ApiResponse, ResponseMeta
from app.core.security import check_csrf
from app.modules.auth import service
from app.modules.auth.rate_limit import client_ip, consume
from app.modules.auth.schema import (
    AuthView,
    CsrfView,
    LoginInput,
    LogoutView,
    RegisterInput,
    SessionView,
)
from app.modules.users.schema import StrictInput
from app.modules.users.service import view

router = APIRouter(
    prefix="/api/v1/auth", tags=["auth"], dependencies=[Depends(require_auth_config)]
)


def envelope(request, data):
    return ApiResponse(data=data, meta=ResponseMeta(request_id=request.state.request_id))


@router.get("/csrf", response_model=ApiResponse[CsrfView])
def csrf(request: Request, response: Response, db: Annotated[Session, Depends(get_session)]):
    now = request.app.state.clock()
    row = service.find_session(db, request, now)
    if row is None:
        # Release the read connection before the independent counter transaction.
        db.rollback()
        consume(request.app, [("csrf-ip", client_ip(request))], now)
        row, token = service.rotate(db, None, None, now)
        db.commit()
        service.set_cookie(response, request.app.state.settings, token, anonymous=True)
    return envelope(request, CsrfView(csrf_token=row.csrf_token))


def preauth(request, db, subjects):
    now = request.app.state.clock()
    old = service.find_session(db, request, now)
    check_csrf(request.headers, request.app.state.settings.site_origin, old)
    # A request must not hold one pool slot while waiting for a second slot.
    db.rollback()
    consume(request.app, subjects, now)
    now = request.app.state.clock()
    old = service.find_session(db, request, now)
    check_csrf(request.headers, request.app.state.settings.site_origin, old)
    return old, now


@router.post("/register", status_code=201, response_model=ApiResponse[AuthView])
def register(
    payload: RegisterInput,
    request: Request,
    response: Response,
    db: Annotated[Session, Depends(get_session)],
):
    old, now = preauth(request, db, [("register-ip", client_ip(request))])
    user, row, token = service.register(db, old, payload, now)
    db.commit()
    service.set_cookie(response, request.app.state.settings, token)
    return envelope(request, AuthView(user=view(user), csrf_token=row.csrf_token))


@router.post("/login", response_model=ApiResponse[AuthView])
def login(
    payload: LoginInput,
    request: Request,
    response: Response,
    db: Annotated[Session, Depends(get_session)],
):
    old, now = preauth(
        request, db, [("login-account", payload.email), ("login-ip", client_ip(request))]
    )
    user, row, token = service.login(db, old, payload, now)
    db.commit()
    service.set_cookie(response, request.app.state.settings, token)
    return envelope(request, AuthView(user=view(user), csrf_token=row.csrf_token))


@router.get("/session", response_model=ApiResponse[SessionView])
def session_info(
    request: Request,
    identity: Annotated[tuple, Depends(get_identity)],
    db: Annotated[Session, Depends(get_session)],
):
    data = SessionView(user=view(identity[1]))
    db.commit()
    return envelope(request, data)


@router.post("/logout", response_model=ApiResponse[LogoutView])
def logout(
    request: Request,
    response: Response,
    identity: Annotated[tuple, Depends(require_write)],
    db: Annotated[Session, Depends(get_session)],
    payload: Annotated[StrictInput | None, Body()] = None,
):
    identity[0].revoked_at = request.app.state.clock()
    db.commit()
    service.set_cookie(response, request.app.state.settings)
    return envelope(request, LogoutView())
