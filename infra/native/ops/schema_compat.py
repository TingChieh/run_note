#!/usr/bin/env python3
"""Decide whether a release and a database schema can run together.

The application demands an exact match: /api/health/ready returns 503 and the footprint
worker idles unless alembic_version == the release's single head (app/db/schema.py,
modules/health/service.py). So "compatible" means `same`; everything else needs an
explicit action, never an assumption that swapping a symlink is safe.

  schema_compat.py head MIGRATIONS_DIR            -> prints the release head
  schema_compat.py db-revision                    -> DB revision from DATABASE_URL (`none`)
  schema_compat.py relation MIGRATIONS_DIR DBREV  -> same | behind | ahead | unknown
"""

import sys
from pathlib import Path


def script_for(migrations: Path):
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    config = Config()
    config.set_main_option("script_location", str(migrations))
    return ScriptDirectory.from_config(config)


def head_of(migrations: Path) -> str:
    heads = script_for(migrations).get_heads()
    if len(heads) != 1:
        raise SystemExit(f"release must have exactly one Alembic head, found {len(heads)}")
    return heads[0]


def relation(migrations: Path, db_revision: str) -> str:
    """same: identical. behind: DB is an ancestor of the release (upgrade needed).
    ahead: DB is newer than the release (a rollback past a migration). unknown: not in chain."""
    script = script_for(migrations)
    head = head_of(migrations)
    if db_revision == "none":
        return "behind"
    chain = [revision.revision for revision in script.walk_revisions()]  # head -> base
    if db_revision not in chain:
        return "unknown"
    return "same" if db_revision == head else "behind"


def db_revision() -> str:
    import os

    from sqlalchemy import create_engine, text
    from sqlalchemy.exc import ProgrammingError

    engine = create_engine(os.environ["DATABASE_URL"], connect_args={"connect_timeout": 5})
    try:
        with engine.connect() as connection:
            try:
                rows = connection.execute(text("SELECT version_num FROM alembic_version")).all()
            except ProgrammingError:
                return "none"
    finally:
        engine.dispose()
    if not rows:
        return "none"
    if len(rows) != 1:
        raise SystemExit("alembic_version holds more than one row")
    return rows[0][0]


def main(argv: list[str]) -> int:
    command = argv[1] if len(argv) > 1 else ""
    if command == "head" and len(argv) == 3:
        print(head_of(Path(argv[2])))
    elif command == "db-revision" and len(argv) == 2:
        print(db_revision())
    elif command == "relation" and len(argv) == 4:
        migrations, revision = Path(argv[2]), argv[3]
        script = script_for(migrations)
        chain = [r.revision for r in script.walk_revisions()]
        if revision != "none" and revision not in chain:
            # A revision this release has never heard of: the database is ahead (or foreign).
            print("ahead")
        else:
            print(relation(migrations, revision))
    else:
        print(__doc__)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
