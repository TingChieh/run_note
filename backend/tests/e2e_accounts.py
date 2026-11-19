"""Synthetic accounts for real-backend browser tests (frontend/playwright.config.ts).

  .venv/bin/python -m tests.e2e_accounts                  provision the site owner described by
                                                          RUNNOTE_E2E_OWNER (JSON: email, username,
                                                          password)
  .venv/bin/python -m tests.e2e_accounts expire-session   expire the session whose cookie value is
                                                          in RUNNOTE_TEST_SESSION

Both read TEST_DATABASE_URL and TEST_DATABASE_ALLOWED_TARGETS from the process environment.

Only an allow-listed *_test database at the current migration head is accepted, checked against
the live connection before anything is written. The registration API stays closed: like
tests/conftest.py, the owner is inserted offline; every other account a test needs is created by
that owner through the real admin API. Provisioning is idempotent: an existing owner is left
unchanged. Never prints the connection URL or the password.
"""

import argparse
import json
import os
import sys

from sqlalchemy import create_engine, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.core.security import hash_password, token_hash
from app.db.schema import get_expected_revision
from app.modules.users.model import User


def checked_target(url: str, allowed: str) -> str:
    target = make_url(url)
    if target.drivername != "postgresql+psycopg" or target.query:
        raise SystemExit("e2e accounts: TEST_DATABASE_URL must be a plain postgresql+psycopg URL")
    if not (target.database or "").endswith("_test"):
        raise SystemExit("e2e accounts: the database name must end with _test")
    identity = f"{(target.host or '').lower()}:{target.port or 5432}/{target.database}"
    if identity not in {value.strip() for value in allowed.split(",")}:
        raise SystemExit("e2e accounts: target is not listed in TEST_DATABASE_ALLOWED_TARGETS")
    return identity


def provision(db: Session) -> None:
    owner = json.loads(os.environ["RUNNOTE_E2E_OWNER"])
    email = owner["email"].strip().lower()
    if db.scalar(select(User.id).where(User.email_normalized == email)) is None:
        db.add(
            User(
                email_normalized=email,
                username=owner["username"],
                display_name="E2E 站主",
                password_hash=hash_password(owner["password"]),
                is_active=True,
                timezone="Asia/Shanghai",
            )
        )
        db.commit()


def expire_session(db: Session) -> None:
    expired = db.execute(
        text(
            "UPDATE auth_sessions SET expires_at = now() - interval '1 second' "
            "WHERE token_hash = :h"
        ),
        {"h": token_hash(os.environ["RUNNOTE_TEST_SESSION"])},
    )
    if expired.rowcount != 1:
        raise SystemExit("e2e accounts: no session matches RUNNOTE_TEST_SESSION")
    db.commit()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "action", nargs="?", default="provision", choices=["provision", "expire-session"]
    )
    action = parser.parse_args(argv).action
    url = os.environ.get("TEST_DATABASE_URL", "")
    identity = checked_target(url, os.environ.get("TEST_DATABASE_ALLOWED_TARGETS", ""))
    target = make_url(url)
    engine = create_engine(url, hide_parameters=True, connect_args={"connect_timeout": 3})
    try:
        with Session(engine) as db:
            database, port = db.execute(text("SELECT current_database(), inet_server_port()")).one()
            if database != target.database or port != (target.port or 5432):
                raise SystemExit("e2e accounts: connected database does not match the target")
            revisions = db.scalars(text("SELECT version_num FROM alembic_version")).all()
            if revisions != [get_expected_revision()]:
                raise SystemExit(
                    f"e2e accounts: {identity} is not at the migration head; run "
                    "`DATABASE_URL=$TEST_DATABASE_URL .venv/bin/alembic upgrade head`"
                )
            (provision if action == "provision" else expire_session)(db)
    finally:
        engine.dispose()
    print(f"e2e accounts: {action} done in {identity}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
