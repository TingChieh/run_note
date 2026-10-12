from pathlib import Path
from typing import Literal

from pydantic import SecretStr, field_validator, model_validator
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
    site_origin: str = "http://localhost:5173"
    auth_rate_hash_key: SecretStr | None = None
    auth_trusted_proxies: tuple[str, ...] = ()

    @field_validator("site_origin")
    @classmethod
    def validate_site_origin(cls, value):
        from urllib.parse import urlsplit

        try:
            url = urlsplit(value)
            port = url.port
        except ValueError:
            raise ValueError("SITE_ORIGIN must be an exact HTTP(S) origin") from None
        if (
            url.scheme not in {"http", "https"}
            or not url.hostname
            or url.username
            or url.password
            or url.path
            or url.query
            or url.fragment
            or value != f"{url.scheme}://{url.netloc}"
            or (port is not None and port == 0)
        ):
            raise ValueError("SITE_ORIGIN must be an exact HTTP(S) origin")
        return value

    @field_validator("auth_rate_hash_key")
    @classmethod
    def validate_rate_key(cls, value):
        if value is not None and len(value.get_secret_value().encode()) < 32:
            raise ValueError("AUTH_RATE_HASH_KEY requires at least 32 bytes")
        return value

    @field_validator("auth_trusted_proxies")
    @classmethod
    def validate_proxies(cls, value):
        from ipaddress import ip_address

        return tuple(str(ip_address(item)) for item in value)

    @model_validator(mode="after")
    def production_auth_config(self):
        if self.app_env == "production" and (
            not self.site_origin.startswith("https://") or self.auth_rate_hash_key is None
        ):
            raise ValueError("Production requires HTTPS SITE_ORIGIN and AUTH_RATE_HASH_KEY")
        return self

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
