import pytest


def test_release_head_follows_complete_chain():
    from app.db.schema import get_expected_revision

    assert get_expected_revision() == "0024_wellbeing_severity_null"


@pytest.mark.parametrize("revisions", [[], [("a", None), ("b", None)]])
def test_release_rejects_missing_or_multiple_heads(tmp_path, revisions):
    from app.db.schema import get_expected_revision

    versions = tmp_path / "versions"
    versions.mkdir()
    for revision, parent in revisions:
        (versions / f"{revision}.py").write_text(
            f"revision = {revision!r}\ndown_revision = {parent!r}\n"
        )
    with pytest.raises(RuntimeError, match="unique Alembic head"):
        get_expected_revision(tmp_path)


def test_model_registry_and_autogenerate_preserve_unmanaged_tables():
    from app import models
    from app.db.schema import include_name

    expected = {
        "users",
        "activity_share_links",
        "ai_reports",
        "running_goals",
        "auth_sessions",
        "auth_rate_buckets",
        "activities",
        "gpx_imports",
        "tcx_imports",
        "mifitness_imports",
        "activity_segments",
        "activity_points",
        "activity_province_caches",
        "footprint_activity_caches",
        "footprint_snapshots",
        "site_settings",
        "site_images",
        "user_avatars",
        "route_fingerprints",
        "route_groups",
        "route_group_members",
        "place_features",
        "activity_place_names",
        "wellbeing_daily_entries",
        "wellbeing_dose_events",
        "wellbeing_symptom_events",
        "wellbeing_medications",
        "wellbeing_symptom_names",
        "wellbeing_stock_movements",
    }
    assert set(models.Base.metadata.tables) == expected
    assert include_name("users", "table", {})
    assert not include_name("spatial_ref_sys", "table", {})
    assert not include_name("legacy_sentinel", "table", {})
    assert not include_name("other_schema", "schema", {})
    assert include_name(None, "schema", {})


def test_revision_discovery_does_not_depend_on_working_directory(tmp_path, monkeypatch):
    from app.db.schema import get_expected_revision

    monkeypatch.chdir(tmp_path)
    assert get_expected_revision() == "0024_wellbeing_severity_null"
