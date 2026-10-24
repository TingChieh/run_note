from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from app.api.dependencies import get_identity, get_session
from app.core.errors import ApiError
from app.core.responses import ApiResponse
from app.modules.activities.router import envelope
from app.modules.route_groups import service
from app.modules.route_groups.schema import RouteGroupDetail, RouteGroupList

router = APIRouter(prefix="/api/v1/routes", tags=["routes"])


@router.get("/groups", response_model=ApiResponse[RouteGroupList])
def list_groups(
    request: Request,
    identity: Annotated[tuple, Depends(get_identity)],
    db: Annotated[Session, Depends(get_session)],
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0, le=1000000)] = 0,
    sort: Literal["count", "recent", "distance"] = "count",
):
    if set(request.query_params) - {"limit", "offset", "sort"}:
        raise ApiError(422, "VALIDATION_ERROR", "路线查询包含不支持的参数")
    return envelope(request, service.list_groups(db, identity[1].id, limit, offset, sort))


@router.get("/groups/{identifier}", response_model=ApiResponse[RouteGroupDetail])
def group_detail(
    identifier: UUID,
    request: Request,
    identity: Annotated[tuple, Depends(get_identity)],
    db: Annotated[Session, Depends(get_session)],
):
    return envelope(request, service.group_detail(db, identity[1].id, identifier))
