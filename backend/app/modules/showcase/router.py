from datetime import date
from typing import Annotated, Literal
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from app.api.dependencies import get_session
from app.core.errors import ApiError
from app.core.responses import ApiResponse
from app.modules.activities import service as activities
from app.modules.activities.router import envelope
from app.modules.footprints.provinces import province_summary
from app.modules.footprints.schema import AllFootprintView
from app.modules.footprints.service import footprints
from app.modules.footprints.snapshot import read_all_footprints
from app.modules.running_goals.schema import GoalsView
from app.modules.showcase import service
from app.modules.showcase.schema import (
    ShowcaseActivity,
    ShowcaseActivityList,
    ShowcaseProfile,
    ShowcaseReport,
    ShowcaseReportList,
)
from app.modules.statistics import service as statistics
from app.modules.statistics.schema import Calendar, Summary, Trends
from app.modules.statistics.streaks import read_streaks
from app.modules.users.model import User

DB = Annotated[Session, Depends(get_session)]


def reject_owner_override(request: Request):
    if set(request.query_params) & {"owner", "user_id", "email", "username"}:
        raise ApiError(422, "VALIDATION_ERROR", "展示查询包含不支持的参数")


def get_site_owner(request: Request, db: DB):
    username = request.path_params.get("username")
    if username is not None:
        return service.named_owner(db, request.app.state.settings, username)
    return service.site_owner(db, request.app.state.settings)


Owner = Annotated[User, Depends(get_site_owner)]
router = APIRouter(
    prefix="/api/v1/showcase", tags=["showcase"], dependencies=[Depends(reject_owner_override)]
)


@router.get("/profile", response_model=ApiResponse[ShowcaseProfile])
def profile(request: Request, owner: Owner):
    return envelope(
        request, ShowcaseProfile(display_name=owner.display_name, timezone=owner.timezone)
    )


@router.get("/activities", response_model=ApiResponse[ShowcaseActivityList])
def listing(
    request: Request,
    db: DB,
    owner: Owner,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0, le=1000000)] = 0,
    activity_date: date | None = None,
    category: Annotated[str | None, Query(max_length=30)] = None,
    activity_month: Annotated[
        str | None,
        Query(pattern=r"^([1-9][0-9]{3}|0[1-9][0-9]{2}|00[1-9][0-9]|000[1-9])-(0[1-9]|1[0-2])$"),
    ] = None,
):
    return envelope(
        request,
        service.activity_list(db, owner.id, limit, offset, activity_date, category, activity_month),
    )


@router.get("/activities/categories", response_model=ApiResponse[list[str]])
def categories(request: Request, db: DB, owner: Owner):
    return envelope(request, activities.categories(db, owner.id))


@router.get("/activities/{identifier}", response_model=ApiResponse[ShowcaseActivity])
def activity(identifier: UUID, request: Request, db: DB, owner: Owner):
    return envelope(request, service.activity_detail(db, owner.id, identifier))


@router.get("/activities/{identifier}/route", response_model=ApiResponse[dict])
def route(identifier: UUID, request: Request, db: DB, owner: Owner):
    return envelope(request, service.route_view(activities.route(db, owner.id, identifier)))


@router.get("/statistics/summary", response_model=ApiResponse[Summary])
def summary(
    request: Request,
    db: DB,
    owner: Owner,
    date_from: date | None = None,
    date_to: date | None = None,
):
    return envelope(request, statistics.summary(db, owner.id, date_from, date_to))


@router.get("/statistics/calendar", response_model=ApiResponse[Calendar])
def calendar(
    request: Request,
    db: DB,
    owner: Owner,
    year: Annotated[int, Query(ge=1900, le=2100)],
    metric: Literal["distance", "count"] = "distance",
):
    return envelope(request, statistics.calendar(db, owner.id, year, metric))


@router.get("/statistics/trends", response_model=ApiResponse[Trends])
def trends(
    request: Request,
    db: DB,
    owner: Owner,
    date_from: date,
    date_to: date,
    period: Literal["week", "month", "year"] = "week",
):
    return envelope(request, statistics.trends(db, owner.id, date_from, date_to, period))


@router.get("/statistics/streaks", response_model=ApiResponse[dict])
def streaks(request: Request, db: DB, owner: Owner):
    today = request.app.state.clock().astimezone(ZoneInfo(owner.timezone)).date()
    return envelope(request, read_streaks(db, owner.id, today))


@router.get("/running-goals", response_model=ApiResponse[GoalsView])
def goals(request: Request, db: DB, owner: Owner):
    return envelope(request, service.goals(db, owner.id))


@router.get("/footprints/all", response_model=ApiResponse[AllFootprintView])
def all_footprints(
    request: Request, db: DB, owner: Owner, mode: Literal["tracks", "heatmap"] = "tracks"
):
    result = read_all_footprints(db, owner.id, mode)
    if result["result"] is not None:
        result["result"] = service.footprint_view(result["result"])
    return envelope(request, result)


@router.get("/footprints/provinces", response_model=ApiResponse[dict])
def provinces(
    request: Request,
    db: DB,
    owner: Owner,
    year: Annotated[int | None, Query(ge=1900, le=2100)] = None,
):
    return envelope(request, province_summary(db, owner.id, year))


@router.get("/footprints", response_model=ApiResponse[dict])
def footprint_range(
    request: Request,
    db: DB,
    owner: Owner,
    date_from: date,
    date_to: date,
    mode: Literal["tracks", "heatmap"] = "tracks",
):
    return envelope(
        request, service.footprint_view(footprints(db, owner.id, date_from, date_to, mode))
    )


@router.get("/ai-reports", response_model=ApiResponse[ShowcaseReportList])
def reports(
    request: Request,
    db: DB,
    owner: Owner,
    limit: Annotated[int, Query(ge=1, le=50)] = 10,
    offset: Annotated[int, Query(ge=0, le=1000000)] = 0,
):
    return envelope(request, service.reports(db, owner, limit, offset))


@router.get("/ai-reports/{identifier}", response_model=ApiResponse[ShowcaseReport])
def report(identifier: UUID, request: Request, db: DB, owner: Owner):
    return envelope(request, service.report_detail(db, owner, identifier))


# Reuse the exact handlers, response models, query validation and public allowlists.
# Resolution is request-local; every direct resource route rechecks the named account.
named_router = APIRouter(
    prefix="/api/v1/showcase/users/{username}",
    tags=["showcase"],
    dependencies=[Depends(reject_owner_override)],
)
for existing_route in router.routes:
    named_router.add_api_route(
        existing_route.path.removeprefix("/api/v1/showcase"),
        existing_route.endpoint,
        methods=existing_route.methods,
        response_model=existing_route.response_model,
        name=f"named_{existing_route.name}",
    )
