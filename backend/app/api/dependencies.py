from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.orm import Session


def get_session(request: Request) -> Iterator[Session]:
    with request.app.state.session_factory() as session:
        yield session


def require_auth_config(request: Request) -> None:
    from app.core.errors import ApiError

    if request.app.state.settings.auth_rate_hash_key is None:
        raise ApiError(503, "AUTH_UNAVAILABLE", "认证配置未就绪")


def get_identity(request: Request, session: Annotated[Session, Depends(get_session)]):
    from app.modules.auth.service import require_identity

    require_auth_config(request)
    return require_identity(session, request, request.app.state.clock())


def get_read_identity(request: Request, session: Annotated[Session, Depends(get_session)]):
    """Identity for routes that only read: a shared lock on the user row.

    Use it only where the handler never locks the users row exclusively afterwards (lock_owner,
    lock_user, ...): two readers holding FOR SHARE that both upgrade would deadlock.
    """
    from app.modules.auth.service import require_identity

    require_auth_config(request)
    return require_identity(session, request, request.app.state.clock(), shared=True)


def require_write(request: Request, identity: Annotated[tuple, Depends(get_identity)]):
    from app.core.security import check_csrf

    check_csrf(request.headers, request.app.state.settings.site_origin, identity[0])
    return identity


def require_admin(request: Request, identity: Annotated[tuple, Depends(get_identity)]):
    from app.core.errors import ApiError
    from app.modules.users.service import is_admin

    if not is_admin(identity[1], request.app.state.settings):
        raise ApiError(403, "ADMIN_REQUIRED", "仅站主可管理账号")
    return identity


def require_admin_write(request: Request, identity: Annotated[tuple, Depends(require_admin)]):
    from app.core.security import check_csrf

    check_csrf(request.headers, request.app.state.settings.site_origin, identity[0])
    return identity
