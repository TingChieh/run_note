#!/usr/bin/env python3
"""Check the configured owner; create a missing owner only through an explicit offline action."""

import argparse
import getpass
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from pydantic import ValidationError
from sqlalchemy import create_engine, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.security import hash_password
from app.db.schema import get_expected_revision
from app.modules.auth.schema import RegisterInput
from app.modules.users.model import User


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["status", "create"])
    parser.add_argument("--username", default="runner")
    args = parser.parse_args()
    settings = Settings()
    target = make_url(settings.database_url)
    # Never print the connection URL, password, hashes or credentials.
    label = f"{target.host}:{target.port or 5432}/{target.database}"
    engine = create_engine(settings.database_url, hide_parameters=True)
    try:
        with Session(engine) as db:
            if db.scalars(text("SELECT version_num FROM alembic_version")).all() != [
                get_expected_revision()
            ]:
                raise SystemExit("Schema is not current; no changes made")
            owner = db.scalar(
                select(User.id).where(User.email_normalized == settings.site_owner_email)
            )
            if owner is not None:
                if args.action == "create":
                    raise SystemExit("Configured owner already exists; no password or data changed")
                print(f"Owner ready at {label}; no changes made")
                return
            if args.action == "status":
                raise SystemExit(f"Configured owner missing at {label}; no changes made")
            if not sys.stdin.isatty():
                raise SystemExit("Creation requires an interactive terminal; no changes made")
            if (
                input(f"Create the configured owner at {label}? Type the database name: ")
                != target.database
            ):
                raise SystemExit("Cancelled; no changes made")
            password = getpass.getpass("New administrator password (12-128 characters): ")
            if password != getpass.getpass("Repeat password: "):
                raise SystemExit("Passwords differ; no changes made")
            try:
                payload = RegisterInput(
                    email=settings.site_owner_email,
                    username=args.username,
                    password=password,
                )
            except ValidationError:
                raise SystemExit("Invalid username or password; no changes made") from None
            if db.scalar(select(User.id).where(User.username == payload.username)) is not None:
                raise SystemExit("Username already exists; choose another; no changes made")
            db.add(
                User(
                    email_normalized=payload.email,
                    username=payload.username,
                    display_name=payload.username,
                    timezone=payload.timezone,
                    password_hash=hash_password(payload.password),
                )
            )
            db.commit()
            print("Configured owner created; no existing accounts or records changed")
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
