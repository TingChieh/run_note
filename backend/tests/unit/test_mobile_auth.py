"""Unit tests for mobile authentication primitives, schemas, capabilities, and guards."""

import runpy
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.core.config import Settings
from app.core.security import mobile_access_valid, mobile_refresh_valid, new_token, token_hash
from app.main import create_app
from app.modules.auth.service import extract_bearer_token, has_session_cookie
from app.modules.mobile_auth.schema import (
    MobileLoginInput,
    MobileLogoutInput,
    MobileRefreshInput,
)
from app.modules.version.service import app_version

BACKEND = Path(__file__).resolve().parents[2]
DUMMY_DB = "postgresql+psycopg://unit@127.0.0.1:1/mobile_unit_unused_test"


def _request(headers=None, cookies=None, app_env="test"):
    return SimpleNamespace(
        headers={k.lower(): v for k, v in (headers or {}).items()},
        cookies=cookies or {},
        app=SimpleNamespace(state=SimpleNamespace(settings=SimpleNamespace(app_env=app_env))),
    )


def test_client_capabilities_contract_is_public_and_accurate():
    app = create_app(Settings(database_url=DUMMY_DB, app_env="test", _env_file=None))
    with TestClient(app) as client:
        response = client.get("/api/v1/client/capabilities")
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert "set-cookie" not in response.headers
    payload = response.json()
    assert payload["error"] is None
    data = payload["data"]
    assert data == {
        "server_version": app_version(),
        "mobile_api_version": 1,
        "min_mobile_app_version": "2.6.0",
        "features": [
            "mobile_auth_v1",
            "activities_sync_v1",
            "gpx_idempotency_v1",
        ],
    }


def test_no_mobile_registration_route_exists():
    app = create_app(Settings(database_url=DUMMY_DB, app_env="test", _env_file=None))
    paths = set(app.openapi()["paths"])
    assert "/api/v1/mobile/auth/login" in paths
    assert "/api/v1/mobile/auth/refresh" in paths
    assert "/api/v1/mobile/auth/logout" in paths
    assert "/api/v1/mobile/auth/register" not in paths


def test_mobile_token_validity_boundaries():
    now = datetime(2026, 11, 26, 12, 0, tzinfo=UTC)
    active = SimpleNamespace(
        revoked_at=None,
        rotated_at=None,
        access_expires_at=now + timedelta(minutes=30),
        refresh_expires_at=now + timedelta(days=90),
    )
    assert mobile_access_valid(active, now) is True
    assert mobile_refresh_valid(active, now) is True
    # Exact expiry instant is invalid.
    assert mobile_access_valid(active, now + timedelta(minutes=30)) is False
    assert mobile_refresh_valid(active, now + timedelta(minutes=30)) is True
    assert mobile_refresh_valid(active, now + timedelta(days=90)) is False

    rotated = SimpleNamespace(**{**active.__dict__, "rotated_at": now})
    assert mobile_access_valid(rotated, now) is False
    assert mobile_refresh_valid(rotated, now) is False

    revoked = SimpleNamespace(**{**active.__dict__, "revoked_at": now})
    assert mobile_access_valid(revoked, now) is False
    assert mobile_refresh_valid(revoked, now) is False

    assert mobile_access_valid(None, now) is False
    assert mobile_refresh_valid(None, now) is False


def test_opaque_tokens_are_256_bit_and_sha256_hashed():
    raw = new_token()
    assert len(raw) >= 43
    digest = token_hash(raw)
    assert len(digest) == 64
    assert digest != raw
    assert all(ch in "0123456789abcdef" for ch in digest)


@pytest.mark.parametrize(
    "header,expected",
    [
        (None, (False, None)),
        ("", (False, None)),
        ("   ", (False, None)),
        ("Basic dXNlcjpwYXNz", (False, None)),
        ("Bearer", (True, None)),
        ("Bearer   ", (True, None)),
        ("Bearer tok with space", (True, None)),
        ("Bearer " + "x" * 129, (True, None)),
        ("Bearer abc123", (True, "abc123")),
        ("bearer  xyz-789 ", (True, "xyz-789")),
    ],
)
def test_extract_bearer_token_edge_cases(header, expected):
    headers = {"authorization": header} if header is not None else {}
    assert extract_bearer_token(_request(headers=headers)) == expected


def test_has_session_cookie_respects_environment_cookie_name():
    assert has_session_cookie(_request(cookies={"run_session": "abc"}, app_env="test")) is True
    assert (
        has_session_cookie(_request(cookies={"__Host-run_session": "abc"}, app_env="test")) is False
    )
    assert (
        has_session_cookie(_request(cookies={"__Host-run_session": "abc"}, app_env="production"))
        is True
    )
    assert (
        has_session_cookie(_request(cookies={"run_session": "abc"}, app_env="production")) is False
    )


def test_mobile_auth_schemas_enforce_strict_inputs():
    parsed = MobileLoginInput(
        email=" Runner@Example.COM ",
        password="a valid long password",
        device_label="  Pixel 9  ",
        client_version=" 2.6.0 ",
    )
    assert parsed.email == "runner@example.com"
    assert parsed.device_label == "Pixel 9"
    assert parsed.client_version == "2.6.0"

    with pytest.raises(ValidationError):
        MobileLoginInput(
            email="runner@example.com", password="a valid long password", extra_field=1
        )
    with pytest.raises(ValidationError):
        MobileLoginInput(
            email="runner@example.com",
            password="a valid long password",
            device_label="bad\nlabel",
        )
    with pytest.raises(ValidationError):
        MobileRefreshInput(refresh_token="token with space")
    with pytest.raises(ValidationError):
        MobileRefreshInput(refresh_token="ok-token", unknown=True)
    with pytest.raises(ValidationError):
        MobileLogoutInput(revoke_all_devices="yes")  # strict=True rejects string for bool


def test_migration_0035_downgrade_refuses_when_mobile_data_exists():
    migration = runpy.run_path(str(BACKEND / "migrations" / "versions" / "0035_mobile_sessions.py"))
    fake_conn = mock.Mock()
    fake_conn.execute.side_effect = [
        mock.Mock(scalar=mock.Mock(return_value=True)),
        mock.Mock(scalar=mock.Mock(return_value=False)),
    ]
    with (
        mock.patch.object(migration["op"], "get_bind", return_value=fake_conn),
        pytest.raises(RuntimeError, match="Refusing to downgrade 0035_mobile_sessions"),
    ):
        migration["downgrade"]()
