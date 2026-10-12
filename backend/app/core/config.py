from pathlib import Path
from typing import Literal

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import make_url
from sqlalchemy.exc import ArgumentError

ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=ROOT / ".env", extra="ignore", hide_input_in_errors=True
    )

    app_env: Literal["development", "test", "production"] = "development"
    database_url: str

    @field_validator("database_url")
    @classmethod
    def validate_database_url(cls, value: str) -> str:
        try:
            url = make_url(value)
        except ArgumentError:
            raise ValueError("DATABASE_URL must be a PostgreSQL psycopg URL") from None
        if url.drivername != "postgresql+psycopg" or not all(
            [url.host, url.username, url.database]
        ):
            raise ValueError("DATABASE_URL requires postgresql+psycopg, host, user and database")
        return value


class IntegrationSettings(Settings):
    """Opt-in configuration for destructive-capable integration fixtures."""

    test_database_url: str | None = None
    test_database_allowed_targets: str = ""

    @model_validator(mode="after")
    def validate_test_target(self) -> "IntegrationSettings":
        if not self.test_database_url:
            return self
        self.validate_database_url(self.test_database_url)
        development = make_url(self.database_url)
        target = make_url(self.test_database_url)
        if development.query or target.query:
            raise ValueError(
                "Integration database URLs must not contain connection query overrides"
            )
        if not (target.database or "").endswith("_test"):
            raise ValueError("Integration database name must end with _test")
        # A different name is mandatory even with aliases, another role or port.
        if target.database == development.database:
            raise ValueError("Integration database name must differ from DATABASE_URL")
        host = (target.host or "").lower()
        if ":" in host:
            host = f"[{host}]"
        identity = f"{host}:{target.port or 5432}/{target.database}"
        allowed = {value.strip() for value in self.test_database_allowed_targets.split(",")}
        if identity not in allowed:
            raise ValueError(
                "Integration database target requires explicit TEST_DATABASE_ALLOWED_TARGETS"
            )
        return self
