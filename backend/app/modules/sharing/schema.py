from datetime import date, datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from app.modules.statistics.schema import Summary
from app.modules.users.schema import StrictInput


class PublicAuthor(BaseModel):
    username: str
    display_name: str


class PublicProfile(PublicAuthor):
    bio: str
    summary: Summary


class PublicActivity(BaseModel):
    id: UUID
    title: str
    activity_date: date
    distance_m: Decimal
    elapsed_seconds: Decimal | None
    avg_pace_seconds_per_km: Decimal | None
    author: PublicAuthor
    has_shared_route: Literal[False] = False


class PublicActivityList(BaseModel):
    items: list[PublicActivity]
    total: int
    limit: int
    offset: int


class ShareCreate(StrictInput):
    expires_at: datetime | None = None

    @field_validator("expires_at", mode="before")
    @classmethod
    def parse_expiry(cls, value):
        if value is None or isinstance(value, datetime):
            return value
        if not isinstance(value, str):
            raise ValueError("ISO timestamp required")
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            raise ValueError("ISO timestamp required") from None


class ShareView(BaseModel):
    link_id: UUID
    created_at: datetime
    expires_at: datetime | None
    revoked_at: datetime | None
    status: Literal["active", "expired", "revoked"]


class ShareCreated(BaseModel):
    link_id: UUID
    share_url: str
    expires_at: datetime | None


class ShareList(BaseModel):
    items: list[ShareView] = Field(default_factory=list)
