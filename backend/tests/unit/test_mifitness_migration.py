"""Offline PostgreSQL DDL contracts and destructive-downgrade refusal; no live DB."""

import importlib.util
from io import StringIO
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import CheckConstraint, ForeignKeyConstraint, UniqueConstraint

from app.models import Base

FIELDS = {
    "max_heart_rate_bpm",
    "min_heart_rate_bpm",
    "avg_cadence_spm",
    "max_cadence_spm",
    "vo2_max_ml_kg_min",
    "training_load",
    "aerobic_training_effect",
    "anaerobic_training_effect",
}


def migration():
    source = Path(__file__).parents[2] / "migrations/versions/0009_mifitness_imports.py"
    assert source.exists(), "Mi Fitness migration must exist"
    spec = importlib.util.spec_from_file_location("mifitness_migration", source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_model_and_offline_upgrade_enforce_provenance_and_nullable_metrics():
    module = migration()
    assert module.down_revision == "0008_activity_labels"
    output = StringIO()
    context = MigrationContext.configure(
        url="postgresql://",
        opts={
            "as_sql": True,
            "output_buffer": output,
            "target_metadata": Base.metadata,
        },
    )
    with Operations.context(context):
        module.upgrade()
    sql = output.getvalue()
    assert "CREATE TABLE mifitness_imports" in sql
    assert "source IN ('gpx','manual','tcx','mifitness')" in sql
    table = Base.metadata.tables["mifitness_imports"]
    for constraint in table.constraints:
        if constraint.name:
            assert constraint.name in sql
    assert any(
        isinstance(item, UniqueConstraint)
        and {column.name for column in item.columns} == {"user_id", "record_fingerprint"}
        for item in table.constraints
    )
    assert any(
        isinstance(item, ForeignKeyConstraint)
        and {column.name for column in item.columns} == {"activity_id", "user_id"}
        and item.ondelete == "CASCADE"
        for item in table.constraints
    )
    assert any(
        fk.target_fullname == "users.id" and fk.ondelete == "CASCADE"
        for fk in table.c.user_id.foreign_keys
    )
    for field in FIELDS:
        column = Base.metadata.tables["activities"].c[field]
        assert column.nullable
        assert f"ADD COLUMN {field}" in sql
    for index in table.indexes:
        assert index.name in sql
    assert "ck_mifitness_imports_ck_" not in sql
    assert "raw_gpx IS NULL" in sql and "raw_gpx IS NOT NULL" in sql
    assert "canonical_sha256 IS NULL" in sql
    raw_presence = next(
        c for c in table.constraints if c.name == "ck_mifitness_imports_raw_presence"
    )
    assert "canonical_sha256 IS NOT NULL" not in str(raw_presence.sqltext)
    assert table.c.canonical_sha256.nullable
    assert "octet_length(raw_gpx) = byte_size" in sql
    assert any(
        isinstance(c, CheckConstraint) and "route_distance_m" in str(c.sqltext)
        for c in table.constraints
    )


def test_private_view_new_metrics_default_to_none_for_legacy_payloads():
    from app.modules.activities.schema import ActivityView

    for field in FIELDS:
        assert field in ActivityView.model_fields
        assert ActivityView.model_fields[field].default is None


@pytest.mark.parametrize("has_data", [True, False])
def test_downgrade_checks_all_new_metrics_before_any_destructive_ddl(monkeypatch, has_data):
    module = migration()
    queries = []
    mutations = []

    class Result:
        def first(self):
            return (1,) if has_data else None

    class Connection:
        def execute(self, query):
            queries.append(str(query))
            return Result()

    monkeypatch.setattr(module.op, "get_bind", lambda: Connection())
    monkeypatch.setattr(module.op, "f", lambda name: name)
    for name in ("drop_table", "drop_constraint", "drop_column", "create_check_constraint"):
        monkeypatch.setattr(
            module.op, name, lambda *args, _name=name, **kwargs: mutations.append(_name)
        )
    if has_data:
        with pytest.raises(RuntimeError):
            module.downgrade()
        assert not mutations
    else:
        module.downgrade()
        assert "drop_table" in mutations
    assert all(field in " ".join(queries) for field in FIELDS)
    assert "mifitness_imports" in " ".join(queries)
    assert "source='mifitness'" in " ".join(queries)
