from datetime import date
from typing import Annotated, Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from app.api.dependencies import get_read_identity, get_session
from app.core.responses import ApiResponse
from app.modules.activities.router import envelope
from app.modules.statistics import service
from app.modules.statistics.schema import Calendar, Summary, Trends
from app.modules.statistics.streaks import read_streaks

router = APIRouter(prefix="/api/v1/statistics", tags=["statistics"])
Identity = Annotated[tuple, Depends(get_read_identity)]
Database = Annotated[Session, Depends(get_session)]


@router.get("/streaks")
def streaks(request: Request, identity: Identity, db: Database):
    today = request.app.state.clock().astimezone(ZoneInfo(identity[1].timezone)).date()
    data = read_streaks(db, identity[1].id, today)
    db.commit()
    return envelope(request, data)


@router.get("/calendar", response_model=ApiResponse[Calendar])
def calendar(
    request: Request,
    identity: Identity,
    db: Database,
    year: Annotated[int, Query(ge=1900, le=2100)],
    metric: Literal["distance", "count"] = "distance",
):
    data = service.calendar(db, identity[1].id, year, metric)
    db.commit()
    return envelope(request, data)


@router.get("/summary", response_model=ApiResponse[Summary])
def summary(
    request: Request,
    identity: Identity,
    db: Database,
    date_from: date | None = None,
    date_to: date | None = None,
):
    data = service.summary(db, identity[1].id, date_from, date_to)
    db.commit()
    return envelope(request, data)


@router.get("/trends", response_model=ApiResponse[Trends])
def trends(
    request: Request,
    identity: Identity,
    db: Database,
    date_from: date,
    date_to: date,
    period: Literal["week", "month", "year"] = "week",
):
    data = service.trends(db, identity[1].id, date_from, date_to, period)
    db.commit()
    return envelope(request, data)
