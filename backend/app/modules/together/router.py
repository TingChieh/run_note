from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy.orm import Session

from app.api.dependencies import get_session
from app.core.responses import ApiResponse
from app.modules.auth.router import envelope
from app.modules.together.schema import FeedPage, TogetherView
from app.modules.together.service import feed, overview

router = APIRouter(prefix="/api/v1/together", tags=["together"])


@router.get("", response_model=ApiResponse[TogetherView])
def together(
    request: Request,
    response: Response,
    db: Annotated[Session, Depends(get_session)],
    period: Literal["week", "month", "year"] = "week",
):
    response.headers["Cache-Control"] = "no-store"
    data = overview(db, request.app.state.settings, request.app.state.clock(), period)
    db.commit()
    return envelope(request, data)


@router.get("/feed", response_model=ApiResponse[FeedPage])
def together_feed(
    request: Request,
    response: Response,
    db: Annotated[Session, Depends(get_session)],
    before: str | None = None,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
):
    response.headers["Cache-Control"] = "no-store"
    data = feed(db, request.app.state.settings, before, limit)
    db.commit()
    return envelope(request, data)
