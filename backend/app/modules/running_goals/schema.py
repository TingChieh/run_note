from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.modules.users.schema import StrictInput

GoalPeriod = Literal["week", "month", "year"]


class GoalUpdate(StrictInput):
    target_km: Decimal = Field(gt=0, le=100000, decimal_places=1)

    @field_validator("target_km", mode="before")
    @classmethod
    def numeric_target(cls, value):
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError("目标距离必须是数字")
        return Decimal(str(value))


class GoalsView(BaseModel):
    week: float | None = None
    month: float | None = None
    year: float | None = None


class GoalView(BaseModel):
    period: GoalPeriod
    target_km: float
