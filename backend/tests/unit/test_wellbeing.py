import importlib.util
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from io import StringIO
from pathlib import Path
from types import SimpleNamespace

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from pydantic import ValidationError

from app.modules.wellbeing import report
from app.modules.wellbeing.schema import (
    DoseInput,
    DosePatch,
    EntryInput,
    SymptomInput,
    SymptomPatch,
)

APP = Path(__file__).parents[2] / "app"
DOSE = {
    "medication_name": "示例药物",
    "dose_amount": 12.5,
    "dose_unit": "mg",
    "taken_at": "2026-10-29T08:30:00+08:00",
    "regimen": "scheduled",
}


def test_migration_ddl_matches_models_and_downgrade_refuses_real_data(monkeypatch):
    from app.models import Base

    source = Path(__file__).parents[2] / "migrations/versions/0017_wellbeing_journal.py"
    spec = importlib.util.spec_from_file_location("wellbeing_migration", source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert module.down_revision == "0016_place_titles"
    output = StringIO()
    context = MigrationContext.configure(
        url="postgresql://",
        opts={"as_sql": True, "output_buffer": output, "target_metadata": Base.metadata},
    )
    with Operations.context(context):
        module.upgrade()
    sql = output.getvalue()
    later = {"pills", "medication_id", "mood", "dose_id"}  # added or renamed by a later migration
    for name in module.TABLES:
        assert f"CREATE TABLE {name}" in sql
        columns = Base.metadata.tables[name].columns
        assert all(column.name in sql for column in columns if column.name not in later)
    assert "uq_wellbeing_daily_entries_user_date" in sql

    dropped = []
    has_rows = SimpleNamespace(execute=lambda _: SimpleNamespace(scalar=lambda: True))
    monkeypatch.setattr(module.op, "get_bind", lambda: has_rows)
    monkeypatch.setattr(module.op, "drop_table", lambda name: dropped.append(name))
    with pytest.raises(RuntimeError, match="wellbeing"):
        module.downgrade()
    assert dropped == []
    empty = SimpleNamespace(execute=lambda _: SimpleNamespace(scalar=lambda: False))
    monkeypatch.setattr(module.op, "get_bind", lambda: empty)
    module.downgrade()
    assert dropped == list(module.TABLES)


def test_every_rating_is_optional_and_bounded_but_something_must_be_answered():
    assert EntryInput.model_validate({"mood": 0}).anxiety is None
    assert EntryInput.model_validate({"note": "只写备注"}).mood is None
    for bad in (11, -1, True, 3.5, "5"):
        with pytest.raises(ValidationError):
            EntryInput.model_validate({"mood": bad})
    for empty in ({}, {"note": "   "}, {"mood": None}):
        with pytest.raises(ValidationError):
            EntryInput.model_validate(empty)
    with pytest.raises(ValidationError):
        EntryInput.model_validate({"mood": 1, "mystery": 1})
    with pytest.raises(ValidationError):
        EntryInput.model_validate({"mood": 1, "self_harm_thoughts": "none"})  # item removed


def test_sleep_hours_keep_two_decimals_so_whole_minutes_are_exact():
    assert EntryInput.model_validate({"sleep_hours": 7.5}).sleep_hours == Decimal("7.5")
    assert EntryInput.model_validate({"sleep_hours": 7.42}).sleep_hours == Decimal("7.42")
    assert round(float(Decimal("7.42")) * 60) == 445  # 7 h 25 min round-trips
    assert EntryInput.model_validate({"sleep_hours": 0}).sleep_hours == Decimal("0")
    for bad in (24.1, -0.5, 7.255, "7", True):
        with pytest.raises(ValidationError):
            EntryInput.model_validate({"sleep_hours": bad})


def test_text_rejects_nul_and_oversized_values_and_blank_notes_become_null():
    with pytest.raises(ValidationError):
        EntryInput.model_validate({"note": "a\x00b"})
    with pytest.raises(ValidationError):
        EntryInput.model_validate({"note": "x" * 2001})
    assert EntryInput.model_validate({"mood": 1, "note": "  \n "}).note is None
    assert EntryInput.model_validate({"note": "多行\n备注"}).note == "多行\n备注"
    with pytest.raises(ValidationError):
        DoseInput.model_validate({**DOSE, "medication_name": "a\nb"})
    with pytest.raises(ValidationError):
        DoseInput.model_validate({**DOSE, "medication_name": "x" * 81})


def test_dose_requires_real_amount_unit_and_a_timezone_aware_time():
    dose = DoseInput.model_validate(DOSE)
    assert dose.dose_amount == Decimal("12.5")
    assert dose.taken_at.utcoffset() == timedelta(hours=8)
    for override in (
        {"dose_amount": 0},
        {"dose_amount": -1},
        {"dose_amount": 100001},
        {"dose_amount": 1.2345},
        {"dose_amount": "5"},
        {"dose_amount": True},
        {"dose_unit": " "},
        {"dose_unit": "x" * 17},
        {"regimen": "sometimes"},
        {"taken_at": "2026-10-29T08:30:00"},
        {"taken_at": 1780000000},
        {"taken_at": "not-a-time"},
        {"note": "n" * 501},
    ):
        with pytest.raises(ValidationError):
            DoseInput.model_validate({**DOSE, **override})


def test_patches_need_a_field_and_cannot_null_required_ones():
    assert DosePatch.model_validate({"note": None}).note is None
    assert DosePatch.model_validate({"dose_amount": 5}).model_fields_set == {"dose_amount"}
    for bad in ({}, {"medication_name": None}, {"taken_at": None}, {"regimen": None}):
        with pytest.raises(ValidationError):
            DosePatch.model_validate(bad)
    assert SymptomPatch.model_validate({"duration_minutes": None}).duration_minutes is None
    # A severity is optional: it can be left out or cleared, but the date and name cannot.
    assert SymptomPatch.model_validate({"severity": None}).severity is None
    for bad in ({}, {"entry_date": None}, {"symptom": None}):
        with pytest.raises(ValidationError):
            SymptomPatch.model_validate(bad)


def test_symptom_input_validates_severity_duration_and_date_text():
    symptom = SymptomInput.model_validate(
        {"entry_date": "2026-10-29", "symptom": "头晕", "severity": 4, "duration_minutes": 90}
    )
    assert symptom.entry_date == date(2026, 10, 29)
    assert symptom.onset_at is None and symptom.affects_daily_life is None
    for override in (
        {"severity": 11},
        {"severity": -1},
        {"duration_minutes": 0},
        {"duration_minutes": 10081},
        {"entry_date": "2026-13-01"},
        {"symptom": ""},
        {"affects_daily_life": "yes"},
    ):
        with pytest.raises(ValidationError):
            SymptomInput.model_validate(
                {"entry_date": "2026-10-29", "symptom": "头晕", "severity": 4, **override}
            )


def test_csv_neutralises_spreadsheet_formulas_and_keeps_chinese_readable():
    for hostile in ("=1+1", "+SUM(A1)", "-2", "@cmd", "\tx", "\rx"):
        assert report.safe_cell(hostile) == "'" + hostile
    assert report.safe_cell("普通备注") == "普通备注"
    assert report.safe_cell(None) == ""
    assert report.safe_cell(0) == "0"
    data = report.render_csv([["日期", "备注"], ["2026-10-29", 'a,"b"\nc']])
    assert data.startswith(b"\xef\xbb\xbf")
    assert data.decode("utf-8-sig") == '日期,备注\r\n2026-10-29,"a,""b""\nc"\r\n'


def dose(day, hour, name, amount, unit="mg", regimen="scheduled"):
    taken = datetime(2026, 10, day, hour, tzinfo=UTC)
    return SimpleNamespace(
        medication_name=name,
        pills=None,
        dose_amount=Decimal(amount),
        dose_unit=unit,
        regimen=regimen,
        taken_at=taken,
        entry_date=taken.date(),
    )


def test_medication_timeline_marks_only_real_changes_and_counts_regimens():
    doses = [
        dose(1, 8, "甲", "10"),
        dose(1, 20, "乙", "5", regimen="as_needed"),
        dose(2, 8, "甲", "10"),
        dose(3, 8, "甲", "15"),
        dose(4, 8, "甲", "15", unit="ml"),
    ]
    stats = {item.name: item for item in report._medications(doses)}
    first = stats["甲"]
    assert [(c.date.day, c.dose_amount, c.dose_unit, c.kind) for c in first.timeline] == [
        (1, 10.0, "mg", "first_in_range"),
        (3, 15.0, "mg", "changed"),
        (4, 15.0, "ml", "changed"),
    ]
    assert first.dose_count == 4 and first.scheduled_count == 4
    assert stats["乙"].as_needed_count == 1 and len(stats["乙"].timeline) == 1


def test_preceding_dose_is_a_time_order_fact_within_one_day_only():
    doses = [dose(1, 8, "甲", "10"), dose(1, 12, "乙", "5")]

    def event(hour, day=1):
        return SimpleNamespace(onset_at=datetime(2026, 10, day, hour, 30, tzinfo=UTC))

    nearest = report._preceding(event(13), doses)
    assert (nearest.medication_name, nearest.minutes_before) == ("乙", 90)
    assert report._preceding(event(7), doses) is None  # nothing was taken before it
    assert report._preceding(event(9, day=3), doses) is None  # outside the 24 hour window
    assert report._preceding(SimpleNamespace(onset_at=None), doses) is None


def test_rating_and_week_summaries_skip_unanswered_values_instead_of_counting_zero():
    def entry(day, **values):
        base = dict.fromkeys(report.RATING_FIELDS)
        return SimpleNamespace(entry_date=date(2026, 10, day), **{**base, **values})

    entries = [entry(26, mood=2), entry(27), entry(28, mood=6, anxiety=4)]
    mood = next(item for item in report._rating_stats(entries) if item.key == "mood")
    assert (mood.answered_days, mood.mean, mood.min, mood.max, mood.first, mood.last) == (
        2,
        4.0,
        2,
        6,
        2,
        6,
    )
    empty = next(item for item in report._rating_stats(entries) if item.key == "energy")
    assert empty.answered_days == 0 and empty.mean is None
    (week,) = report._weekly(entries)
    assert week.week_start == date(2026, 10, 26) and week.entries == 3
    assert week.mood_mean == 4.0 and week.anxiety_mean == 4.0


def test_wellbeing_routes_are_private_and_nothing_else_reads_the_journal():
    from app.main import create_app
    from app.modules.wellbeing.router import router

    paths = create_app().openapi()["paths"]
    mine = [path for path in paths if "wellbeing" in path]
    assert len(mine) >= 10
    assert all(path.startswith("/api/v1/me/wellbeing") for path in mine)
    for route in router.routes:
        names = {d.call.__name__ for d in route.dependant.dependencies}
        assert names & {"get_read_identity", "require_write"}, route.path
        if route.methods - {"GET", "HEAD"}:
            assert "require_write" in names, route.path
    allowed = {"wellbeing", "models", "main.py"}
    for source in APP.rglob("*.py"):
        relative = source.relative_to(APP)
        if relative.parts[0] == "modules" and relative.parts[1] == "wellbeing":
            continue
        if relative.parts[0] in allowed or relative.name in allowed:
            continue
        assert "wellbeing" not in source.read_text(), relative


def test_medication_migration_matches_model_and_refuses_to_drop_the_list(monkeypatch):
    from app.models import Base

    source = Path(__file__).parents[2] / "migrations/versions/0018_wellbeing_medications.py"
    spec = importlib.util.spec_from_file_location("wellbeing_medications_migration", source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert module.down_revision == "0017_wellbeing_journal"
    output = StringIO()
    context = MigrationContext.configure(
        url="postgresql://",
        opts={"as_sql": True, "output_buffer": output, "target_metadata": Base.metadata},
    )
    with Operations.context(context):
        module.upgrade()
    sql = output.getvalue()
    assert "CREATE TABLE wellbeing_medications" in sql
    assert all(name in sql for name in ("name", "default_amount", "default_unit", "regimen"))
    assert "CREATE UNIQUE INDEX uq_wellbeing_medications_user_name" in sql and "lower(name)" in sql
    dropped = []
    monkeypatch.setattr(
        module.op,
        "get_bind",
        lambda: SimpleNamespace(execute=lambda _: SimpleNamespace(scalar=lambda: True)),
    )
    monkeypatch.setattr(module.op, "drop_table", lambda name: dropped.append(name))
    with pytest.raises(RuntimeError, match="medication"):
        module.downgrade()
    assert dropped == []


def test_medication_input_validates_box_strength_and_pill_counts():
    from app.modules.wellbeing.schema import MedicationInput, MedicationPatch

    ok = MedicationInput.model_validate(
        {
            "name": " 药 ",
            "pills_per_box": 28,
            "strength_amount": 12.5,
            "strength_unit": "mg",
            "default_pills": 0.5,
        }
    )
    assert ok.name == "药" and ok.count_unit == "颗" and ok.regimen == "scheduled"
    assert ok.default_pills == Decimal("0.5") and ok.strength_amount == Decimal("12.5")
    assert MedicationInput.model_validate({"name": "药"}).pills_per_box is None
    for bad in (
        {"name": "药", "strength_amount": 5},  # amount without a unit
        {"name": "药", "strength_unit": "mg"},  # unit without an amount
        {"name": "药", "pills_per_box": 0},
        {"name": "药", "pills_per_box": 10001},
        {"name": "药", "pills_per_box": 2.5},
        {"name": "药", "default_pills": 0},
        {"name": "药", "default_pills": 1001},
        {"name": "药", "default_pills": 1.234},
        {"name": "药", "count_unit": ""},
        {"name": "药", "count_unit": "123456789"},
        {"name": "a\nb"},
        {"name": "药", "regimen": "x"},
        {"name": "药", "default_amount": 5, "default_unit": "mg"},  # replaced by the strength pair
    ):
        with pytest.raises(ValidationError):
            MedicationInput.model_validate(bad)
    # Side effects: trimmed, de-duplicated in any case, at most 20, no control characters.
    names = [" 恶心 ", "出汗", "恶心", "OUT", "out"]
    named = MedicationInput.model_validate({"name": "药", "side_effects": names})
    assert named.side_effects == ["恶心", "出汗", "OUT"]
    assert MedicationInput.model_validate({"name": "药"}).side_effects == []
    for bad in (
        {"name": "药", "side_effects": ["a"] * 0 + [str(i) for i in range(21)]},
        {"name": "药", "side_effects": [""]},
        {"name": "药", "side_effects": ["x" * 41]},
        {"name": "药", "side_effects": ["a\nb"]},
        {"name": "药", "side_effects": "恶心"},
        {"name": "药", "strength_amount": 1, "strength_unit": "m\x00g"},
        {"name": "药", "count_unit": "颗\n"},
    ):
        with pytest.raises(ValidationError):
            MedicationInput.model_validate(bad)
    assert MedicationPatch.model_validate({"side_effects": []}).side_effects == []
    assert MedicationPatch.model_validate({"default_pills": None}).default_pills is None
    for bad in (
        {},
        {"name": None},
        {"regimen": None},
        {"count_unit": None},
        {"side_effects": None},
    ):
        with pytest.raises(ValidationError):
            MedicationPatch.model_validate(bad)


def test_doses_need_pills_or_a_complete_amount_and_batches_need_ordered_times():
    from app.modules.wellbeing.schema import BatchDoseInput, CountInput, RestockInput

    base = {"medication_name": "药", "taken_at": "2026-10-10T08:00:00+08:00"}
    assert DoseInput.model_validate({**base, "pills": 1.5}).pills == Decimal("1.5")
    assert DoseInput.model_validate({**base, "dose_amount": 5, "dose_unit": "mg"}).pills is None
    for bad in (
        base,
        {**base, "dose_amount": 5},
        {**base, "dose_unit": "mg"},
        {**base, "pills": 0},
        {**base, "pills": 1001},
        {**base, "pills": 1.234},
    ):
        with pytest.raises(ValidationError):
            DoseInput.model_validate(bad)
    batch = {
        "medication_id": "11111111-1111-4111-8111-111111111111",
        "start_date": "2026-10-01",
        "end_date": "2026-10-07",
        "times": ["08:00", "20:30"],
    }
    assert BatchDoseInput.model_validate(batch).pills is None
    for bad in (
        {**batch, "end_date": "2026-09-30"},
        {**batch, "times": []},
        {**batch, "times": ["08:00", "08:00"]},
        {**batch, "times": ["8:00"]},
        {**batch, "times": ["24:00"]},
        {**batch, "times": ["08:60"]},
        {**batch, "times": ["08:00"] * 7},
        {**batch, "medication_id": "nope"},
    ):
        with pytest.raises(ValidationError):
            BatchDoseInput.model_validate(bad)
    assert RestockInput.model_validate({"boxes": 2}).pills == Decimal(0)
    assert RestockInput.model_validate({"pills": 3.5}).boxes == 0
    for bad in ({}, {"boxes": 0, "pills": 0}, {"boxes": -1}, {"pills": 1.234}):
        with pytest.raises(ValidationError):
            RestockInput.model_validate(bad)
    assert CountInput.model_validate({}).boxes == 0  # an empty shelf is a valid count


def test_symptom_name_migration_drops_the_thoughts_item_and_refuses_to_drop_the_list(monkeypatch):
    from app.models import Base

    source = Path(__file__).parents[2] / "migrations/versions/0019_wellbeing_symptom_names.py"
    spec = importlib.util.spec_from_file_location("wellbeing_symptom_names_migration", source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert module.down_revision == "0018_wellbeing_medications"
    output = StringIO()
    context = MigrationContext.configure(
        url="postgresql://",
        opts={"as_sql": True, "output_buffer": output, "target_metadata": Base.metadata},
    )
    with Operations.context(context):
        module.upgrade()
    sql = output.getvalue()
    assert "CREATE TABLE wellbeing_symptom_names" in sql
    assert "DROP COLUMN self_harm_thoughts" in sql
    assert "self_harm_thoughts" not in Base.metadata.tables["wellbeing_daily_entries"].columns
    dropped = []
    monkeypatch.setattr(
        module.op,
        "get_bind",
        lambda: SimpleNamespace(execute=lambda _: SimpleNamespace(scalar=lambda: True)),
    )
    monkeypatch.setattr(module.op, "drop_table", lambda name: dropped.append(name))
    with pytest.raises(RuntimeError, match="side-effect"):
        module.downgrade()
    assert dropped == []


def test_sleep_migration_widens_the_column_and_refuses_to_round_recorded_durations(monkeypatch):
    source = Path(__file__).parents[2] / "migrations/versions/0020_wellbeing_sleep_minutes.py"
    spec = importlib.util.spec_from_file_location("wellbeing_sleep_migration", source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert module.down_revision == "0019_wellbeing_symptom_names"
    calls = []
    monkeypatch.setattr(module.op, "alter_column", lambda *args, **kwargs: calls.append(kwargs))
    module.upgrade()
    assert calls[0]["type_"].precision == 4 and calls[0]["type_"].scale == 2
    monkeypatch.setattr(
        module.op,
        "get_bind",
        lambda: SimpleNamespace(execute=lambda _: SimpleNamespace(scalar=lambda: True)),
    )
    calls.clear()
    with pytest.raises(RuntimeError, match="sleep"):
        module.downgrade()
    assert calls == []


def test_stock_migration_adds_the_ledger_and_refuses_to_drop_stock_data(monkeypatch):
    from app.models import Base

    source = Path(__file__).parents[2] / "migrations/versions/0021_wellbeing_medication_stock.py"
    spec = importlib.util.spec_from_file_location("wellbeing_stock_migration", source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert module.down_revision == "0020_wellbeing_sleep_minutes"
    output = StringIO()
    context = MigrationContext.configure(
        url="postgresql://",
        opts={"as_sql": True, "output_buffer": output, "target_metadata": Base.metadata},
    )
    with Operations.context(context):
        module.upgrade()
    sql = output.getvalue()
    assert "CREATE TABLE wellbeing_stock_movements" in sql
    for column in (
        "pills_per_box",
        "strength_amount",
        "default_pills",
        "count_unit",
        "medication_id",
    ):
        assert column in sql
    assert "DROP COLUMN default_amount" in sql
    # Only complete amount + unit pairs become a strength.
    assert "default_amount IS NOT NULL AND default_unit IS NOT NULL" in sql
    stock = Base.metadata.tables["wellbeing_stock_movements"]
    assert {c.name for c in stock.columns} >= {"user_id", "medication_id", "kind", "pills"}
    dropped = []
    monkeypatch.setattr(
        module.op,
        "get_bind",
        lambda: SimpleNamespace(execute=lambda _: SimpleNamespace(scalar=lambda: True)),
    )
    monkeypatch.setattr(module.op, "drop_table", lambda name: dropped.append(name))
    with pytest.raises(RuntimeError, match="stock"):
        module.downgrade()
    assert dropped == []


def test_side_effect_migration_adds_the_column_and_refuses_to_drop_noted_side_effects(monkeypatch):
    source = Path(__file__).parents[2] / "migrations/versions/0022_wellbeing_med_side_effects.py"
    spec = importlib.util.spec_from_file_location("wellbeing_side_effects_migration", source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert module.down_revision == "0021_wellbeing_medication_stock"
    calls = []
    monkeypatch.setattr(
        module.op, "add_column", lambda table, column: calls.append((table, column.name))
    )
    monkeypatch.setattr(
        module.op, "create_check_constraint", lambda *args, **kwargs: calls.append(args[0])
    )
    module.upgrade()
    assert calls == [("wellbeing_medications", "side_effects"), "side_effects_count"]
    dropped = []
    monkeypatch.setattr(
        module.op,
        "get_bind",
        lambda: SimpleNamespace(execute=lambda _: SimpleNamespace(scalar=lambda: True)),
    )
    monkeypatch.setattr(module.op, "drop_column", lambda *args: dropped.append(args))
    with pytest.raises(RuntimeError, match="side effects"):
        module.downgrade()
    assert dropped == []


def test_symptom_input_needs_no_severity():
    assert (
        SymptomInput.model_validate({"entry_date": "2026-10-29", "symptom": "头晕"}).severity
        is None
    )


def test_severity_migration_is_linear_short_and_refuses_to_invent_scores():
    source = Path(__file__).parents[2] / "migrations/versions/0024_wellbeing_severity_null.py"
    spec = importlib.util.spec_from_file_location("wellbeing_severity_migration", source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert module.down_revision == "0023_wellbeing_mood_rename"
    assert len(module.revision) <= 32  # alembic_version.version_num is varchar(32)
    text = source.read_text()
    assert "RuntimeError" in text and "severity IS NULL" in text


def test_effect_dose_migration_backfills_only_unambiguous_days():
    source = Path(__file__).parents[2] / "migrations/versions/0025_wellbeing_effect_dose.py"
    spec = importlib.util.spec_from_file_location("wellbeing_effect_dose_migration", source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert module.down_revision == "0024_wellbeing_severity_null"
    assert len(module.revision) <= 32  # alembic_version.version_num is varchar(32)
    text = source.read_text()
    assert ") = 1" in text  # only a day with exactly one dose is linked automatically
    assert "RuntimeError" in text and "dose_id IS NOT NULL" in text


def test_symptom_input_may_name_its_dose():
    assert (
        SymptomInput.model_validate({"entry_date": "2026-10-29", "symptom": "头晕"}).dose_id is None
    )


def test_mood_migration_renames_and_flips_the_scale_and_downgrade_flips_it_back():
    source = Path(__file__).parents[2] / "migrations/versions/0023_wellbeing_mood_rename.py"
    spec = importlib.util.spec_from_file_location("wellbeing_mood_migration", source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert module.down_revision == "0022_wellbeing_med_side_effects"
    assert len(module.revision) <= 32  # alembic_version.version_num is varchar(32)
    for name, direction in (("upgrade", "up"), ("downgrade", "down")):
        output = StringIO()
        context = MigrationContext.configure(
            url="postgresql://", opts={"as_sql": True, "output_buffer": output}
        )
        with Operations.context(context):
            getattr(module, name)()
        sql = output.getvalue()
        assert "SET mood = 10 - mood WHERE mood IS NOT NULL" in sql
        if direction == "up":
            assert "RENAME mood_low TO mood" in sql
            assert "TO ck_wellbeing_daily_entries_mood_range" in sql
        else:
            assert "RENAME mood TO mood_low" in sql
            assert "TO ck_wellbeing_daily_entries_mood_low_range" in sql
