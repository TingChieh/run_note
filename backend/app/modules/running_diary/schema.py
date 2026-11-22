from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, Field, StringConstraints, field_validator

from app.modules.users.schema import StrictInput

Mood = Literal["very_bad", "bad", "neutral", "good", "very_good"]
Weather = Literal["clear", "cloudy", "rain", "snow", "windy", "other"]
Rpe = Annotated[int, Field(ge=1, le=10)]
Notes = Annotated[str, StringConstraints(max_length=5000)]


class DiaryInput(StrictInput):
    mood: Mood | None = None
    rpe: Rpe | None = None
    weather: Weather | None = None
    notes: Notes | None = None

    @field_validator("notes")
    @classmethod
    def clean_notes(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if "\0" in value:
            raise ValueError("备注不能包含空字符")
        return value.strip() or None


class DiaryPhotoView(BaseModel):
    id: UUID
    width: int
    height: int


class DiaryView(BaseModel):
    mood: Mood | None
    rpe: Rpe | None
    weather: Weather | None
    notes: Notes | None
    photos: list[DiaryPhotoView]


class DiaryDetail(BaseModel):
    diary: DiaryView | None


class DiaryDeleted(BaseModel):
    deleted: Literal[True] = True
