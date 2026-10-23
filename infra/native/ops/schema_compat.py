#!/usr/bin/env python3
"""Decide whether a release and a database schema can run together.

The application demands an exact match: /api/health/ready returns 503 and the footprint
worker idles unless alembic_version == the release's single head (app/db/schema.py,
modules/health/service.py). So "compatible" means `same`; everything else needs an
explicit action, never an assumption that swapping a symlink is safe.

  schema_compat.py head MIGRATIONS_DIR            -> prints the release head
  schema_compat.py db-revision                    -> DB revision from DATABASE_URL (`none`)
  schema_compat.py db-state                       -> empty | revision <rev> | refuse <reason>
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


# Extensions an administrator is expected to have pre-created (PostGIS is not a trusted
# extension, so the application role cannot create it; docs/66). Anything else is unexpected.
ALLOWED_EXTENSIONS = frozenset({"plpgsql", "postgis"})

_NOT_EXTENSION_MEMBER = (
    "NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = '{catalog}'::regclass"
    " AND d.objid = {alias}.oid AND d.deptype = 'e')"
)

FOREIGN_OBJECT_QUERIES = {
    "relation": """SELECT n.nspname || '.' || c.relname FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg\\_%'
          AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f', 'c') AND """
    + _NOT_EXTENSION_MEMBER.format(catalog="pg_class", alias="c")
    # A composite type's pg_class row is only internally tied to its pg_type; the extension
    # membership (e.g. PostGIS geometry_dump, valid_detail) is recorded on that type.
    + " AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_type'::regclass"
    " AND d.objid = c.reltype AND d.deptype = 'e')" + " ORDER BY 1 LIMIT 10",
    "function": """SELECT n.nspname || '.' || p.proname FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg\\_%'
          AND """
    + _NOT_EXTENSION_MEMBER.format(catalog="pg_proc", alias="p")
    + " ORDER BY 1 LIMIT 10",
    "type": """SELECT n.nspname || '.' || t.typname FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg\\_%'
          AND t.typtype IN ('b', 'e', 'd', 'r', 'm') AND t.typcategory <> 'A' AND """
    + _NOT_EXTENSION_MEMBER.format(catalog="pg_type", alias="t")
    + " ORDER BY 1 LIMIT 10",
    "schema": """SELECT n.nspname FROM pg_namespace n
        WHERE n.nspname NOT IN ('public', 'pg_catalog', 'information_schema')
          AND n.nspname NOT LIKE 'pg\\_%' AND """
    + _NOT_EXTENSION_MEMBER.format(catalog="pg_namespace", alias="n")
    + " ORDER BY 1 LIMIT 10",
}


def classify_state(facts: dict) -> str:
    """Pure decision from observed facts (unit-testable; see tests/test_ops.py).

    facts: version_table (bool), version_rows (list[str]), extensions (list[str]),
    foreign (dict kind -> list of object names outside extensions), large_objects (int).
    An unversioned database counts as `empty` only when nothing but the pre-created PostGIS
    extension exists. Absence of alembic_version alone is never enough: that is also what a
    restored dump, a foreign database or a half-initialised one looks like."""
    rows = facts["version_rows"]
    if facts["version_table"]:
        if len(rows) == 1:
            return f"revision {rows[0]}"
        if not rows:
            return "refuse alembic_version exists but has no row (migration state is unknown)"
        return "refuse alembic_version holds more than one row"
    unexpected = sorted(set(facts["extensions"]) - ALLOWED_EXTENSIONS)
    if unexpected:
        return "refuse unexpected extension(s): " + ", ".join(unexpected)
    found = [f"{kind} {name}" for kind, names in facts["foreign"].items() for name in names]
    if facts["large_objects"]:
        found.append(f"{facts['large_objects']} large object(s)")
    if found:
        return "refuse database has no alembic_version but contains objects: " + "; ".join(
            found[:5]
        )
    return "empty"


def db_state() -> str:
    import os

    from sqlalchemy import create_engine, text

    engine = create_engine(os.environ["DATABASE_URL"], connect_args={"connect_timeout": 5})
    try:
        with engine.connect() as connection:
            version_table = connection.execute(
                text("SELECT to_regclass('alembic_version') IS NOT NULL")
            ).scalar_one()
            rows = []
            if version_table:
                rows = [
                    r[0]
                    for r in connection.execute(text("SELECT version_num FROM alembic_version"))
                ]
            extensions = [
                r[0] for r in connection.execute(text("SELECT extname FROM pg_extension"))
            ]
            foreign = {
                kind: [r[0] for r in connection.execute(text(query))]
                for kind, query in FOREIGN_OBJECT_QUERIES.items()
            }
            large_objects = connection.execute(
                text("SELECT count(*) FROM pg_largeobject_metadata")
            ).scalar_one()
    finally:
        engine.dispose()
    return classify_state(
        {
            "version_table": bool(version_table),
            "version_rows": rows,
            "extensions": extensions,
            "foreign": foreign,
            "large_objects": large_objects,
        }
    )


def main(argv: list[str]) -> int:
    command = argv[1] if len(argv) > 1 else ""
    if command == "head" and len(argv) == 3:
        print(head_of(Path(argv[2])))
    elif command == "db-revision" and len(argv) == 2:
        print(db_revision())
    elif command == "db-state" and len(argv) == 2:
        print(db_state())
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
