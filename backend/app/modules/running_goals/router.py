from typing import Annotated

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.api.dependencies import get_identity, get_session, require_auth_config, require_write
from app.core.responses import ApiResponse
from app.modules.auth.router import envelope
from app.modules.running_goals.model import RunningGoal
from app.modules.running_goals.schema import GoalPeriod, GoalsView, GoalUpdate, GoalView

router = APIRouter(
    prefix="/api/v1/me/running-goals",
    tags=["running-goals"],
    dependencies=[Depends(require_auth_config)],
)


@router.get("", response_model=ApiResponse[GoalsView])
def read_goals(
    request: Request,
    identity: Annotated[tuple, Depends(get_identity)],
    db: Annotated[Session, Depends(get_session)],
):
    rows = db.scalars(select(RunningGoal).where(RunningGoal.user_id == identity[1].id)).all()
    data = GoalsView(**{row.period: float(row.target_km) for row in rows})
    db.commit()
    return envelope(request, data)


@router.put("/{period}", response_model=ApiResponse[GoalView])
def save_goal(
    period: GoalPeriod,
    payload: GoalUpdate,
    request: Request,
    identity: Annotated[tuple, Depends(require_write)],
    db: Annotated[Session, Depends(get_session)],
):
    statement = insert(RunningGoal).values(
        user_id=identity[1].id, period=period, target_km=payload.target_km
    )
    saved = db.scalar(
        statement.on_conflict_do_update(
            index_elements=[RunningGoal.user_id, RunningGoal.period],
            set_={"target_km": statement.excluded.target_km},
        ).returning(RunningGoal.target_km)
    )
    db.commit()
    return envelope(request, GoalView(period=period, target_km=float(saved)))
