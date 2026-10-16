from datetime import datetime
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class StrictInput(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


def valid_timezone(value: str) -> str:
    try:
        ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError):
        raise ValueError("Valid IANA timezone required") from None
    return value


class UserView(BaseModel):
    id: UUID
    email: str
    username: str
    display_name: str
    timezone: str
    bio: str
    profile_is_public: bool
    is_admin: bool
    showcase_enabled: bool
    created_at: datetime


class ProfileUpdate(StrictInput):
    bio: str = Field(default=None, max_length=500)
    profile_is_public: bool = Field(default=None)
    display_name: str = Field(default=None, min_length=1, max_length=80)
    timezone: str = Field(default=None, min_length=1, max_length=64)

    @field_validator("timezone")
    @classmethod
    def timezone_valid(cls, value):
        return valid_timezone(value)

    @model_validator(mode="after")
    def require_changes(self):
        if not self.model_fields_set:
            raise ValueError("At least one allowed field required")
        return self


class PasswordUpdate(StrictInput):
    current_password: str = Field(min_length=12, max_length=128)
    new_password: str = Field(min_length=12, max_length=128)
