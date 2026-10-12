from typing import Annotated

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.api.dependencies import get_session
from app.core.responses import ApiResponse, ResponseMeta
from app.modules.health.schema import LiveStatus, ReadyStatus
from app.modules.health.service import check_readiness

router = APIRouter(tags=["health"])


@router.get("/api/v1/health/live", response_model=ApiResponse[LiveStatus])
def live(request: Request):
    return ApiResponse(data=LiveStatus(), meta=ResponseMeta(request_id=request.state.request_id))


@router.get("/api/health", response_model=ApiResponse[ReadyStatus])
@router.get("/api/v1/health/ready", response_model=ApiResponse[ReadyStatus])
def ready(request: Request, session: Annotated[Session, Depends(get_session)]):
    return ApiResponse(
        data=check_readiness(session), meta=ResponseMeta(request_id=request.state.request_id)
    )
