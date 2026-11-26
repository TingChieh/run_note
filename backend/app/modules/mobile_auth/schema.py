from datetime import datetime
from typing import Literal

from pydantic import Field, field_validator

from app.modules.auth.schema import LoginInput
from app.modules.users.schema import StrictInput, UserView


def _clean_metadata(value: object) -> str:
    if not isinstance(value, str):
        raise ValueError("Must be a string")
    cleaned = value.strip()
    if any(ord(ch) < 0x20 or ord(ch) == 0x7F for ch in cleaned):
        raise ValueError("Control characters are not allowed")
    return cleaned


class ClientCapabilitiesView(StrictInput):
    server_version: str
    mobile_api_version: int
    min_mobile_app_version: str
    features: list[str]


class MobileLoginInput(LoginInput):
    device_label: str = Field(default="", max_length=80)
    client_version: str = Field(default="", max_length=32)

    @field_validator("device_label", "client_version", mode="before")
    @classmethod
    def normalize_metadata(cls, value: object) -> str:
        return _clean_metadata(value)


class MobileRefreshInput(StrictInput):
    refresh_token: str = Field(min_length=1, max_length=128)
    client_version: str | None = Field(default=None, max_length=32)

    @field_validator("refresh_token", mode="before")
    @classmethod
    def validate_refresh_token(cls, value: object) -> str:
        if not isinstance(value, str):
            raise ValueError("Refresh token must be a string")
        cleaned = value.strip()
        if not cleaned or any(ch.isspace() for ch in cleaned):
            raise ValueError("Refresh token must not contain whitespace")
        return cleaned

    @field_validator("client_version", mode="before")
    @classmethod
    def normalize_client_version(cls, value: object) -> str | None:
        if value is None:
            return None
        return _clean_metadata(value)


class MobileLogoutInput(StrictInput):
    revoke_all_devices: bool = False


class MobileAuthView(StrictInput):
    token_type: Literal["Bearer"] = "Bearer"
    access_token: str
    access_expires_at: datetime
    refresh_token: str
    refresh_expires_at: datetime
    user: UserView
