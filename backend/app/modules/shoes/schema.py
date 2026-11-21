import re
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

from pydantic import AfterValidator, BaseModel, BeforeValidator, Field, model_validator

from app.modules.users.schema import StrictInput


def trim(value):
    return value.strip() if isinstance(value, str) else value


def optional_text(value):
    value = trim(value)
    return None if value == "" else value


def iso_date(value):
    if not isinstance(value, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
        raise ValueError("Expected an ISO calendar date")
    return date.fromisoformat(value)


def positive(value):
    if Decimal(value) <= 0:
        raise ValueError("Replacement distance must be positive")
    return value


Name = Annotated[str, BeforeValidator(trim), Field(min_length=1, max_length=80)]
Label = Annotated[str | None, Field(max_length=60), BeforeValidator(optional_text)]
Notes = Annotated[str | None, Field(max_length=1000), BeforeValidator(optional_text)]
Day = Annotated[date, BeforeValidator(iso_date)]
Meters = Annotated[str, Field(pattern=r"^[0-9]{1,9}(\.[0-9]{1,3})?$", max_length=13)]
Replacement = Annotated[Meters, AfterValidator(positive)]
Identifier = Annotated[UUID, Field(strict=False)]
Reminder = Literal["near", "due"]


class ShoeInput(StrictInput):
    name: Name
    brand: Label = None
    model: Label = None
    notes: Notes = None
    purchased_on: Day | None = None
    initial_distance_m: Meters = "0"
    replacement_distance_m: Replacement | None = None


class ShoePatch(ShoeInput):
    name: Name = None
    initial_distance_m: Meters = None
    retired: bool = None

    @model_validator(mode="after")
    def require_changes(self):
        if not self.model_fields_set:
            raise ValueError("At least one allowed field required")
        return self


class ShoeBindingPatch(StrictInput):
    shoe_id: Identifier | None


class ShoeRef(BaseModel):
    id: UUID
    name: str
    retired_on: date | None


class ShoeView(ShoeRef):
    brand: str | None
    model: str | None
    notes: str | None
    purchased_on: date | None
    initial_distance_m: Decimal
    replacement_distance_m: Decimal | None
    activity_distance_m: Decimal
    total_distance_m: Decimal
    activity_count: int
    reminder: Reminder | None
    remaining_distance_m: Decimal | None
    created_at: datetime
    updated_at: datetime


class ShoeList(BaseModel):
    items: list[ShoeView]
    total: int
    limit: int
    offset: int


class ShoeActivity(BaseModel):
    id: UUID
    title: str
    activity_date: date
    distance_m: Decimal


class ShoeActivities(BaseModel):
    items: list[ShoeActivity]
    total: int
    limit: int
    offset: int


class ShoeBinding(BaseModel):
    shoe: ShoeRef | None


class ShoeDeleted(BaseModel):
    deleted: Literal[True] = True
