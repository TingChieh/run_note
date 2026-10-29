import csv
import io
import logging
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import text

from tests.integration.test_gpx_import import ORIGIN, clients, headers, register  # noqa: F401

pytestmark = pytest.mark.integration
BASE = "/api/v1/me/wellbeing"
SENTINEL = "SENTINEL-私密备注-7f3a"


def today(client):
    """The account-local 'today' as the server sees it (a fresh user is in Asia/Shanghai)."""
    return datetime.now(ZoneInfo("Asia/Shanghai")).date()


def put_entry(client, day, **body):
    return client.put(f"{BASE}/days/{day}/entry", headers=headers(client), json=body)


def post(client, path, **body):
    return client.post(f"{BASE}{path}", headers=headers(client), json=body)


def dose_body(**override):
    return {
        "medication_name": "示例药物甲",
        "dose_amount": 10,
        "dose_unit": "mg",
        "taken_at": "2026-10-10T08:00:00+08:00",
        "regimen": "scheduled",
        **override,
    }


def rows(engine, sql, **params):
    with engine.connect() as db:
        return db.execute(text(sql), params).all()


def test_every_route_requires_the_signed_in_owner_and_csrf_for_writes(clients):  # noqa: F811
    a, _, _, _ = clients
    day = "2026-10-10"
    reads = [
        f"/days/{day}",
        f"/days?from={day}&to={day}",
        "/entries",
        "/medications",
        "/trends?days=7",
        f"/report?from={day}&to={day}",
        f"/report.csv?from={day}&to={day}",
    ]
    for path in reads:
        response = a.get(BASE + path)
        assert response.status_code == 401, path
        assert response.headers["cache-control"] == "no-store"
    register(a)
    uuid = uuid4()
    writes = [
        ("put", f"/days/{day}/entry", {"mood": 1}),
        ("delete", f"/days/{day}/entry", None),
        ("post", "/doses", dose_body()),
        ("patch", f"/doses/{uuid}", {"note": "x"}),
        ("delete", f"/doses/{uuid}", None),
        ("post", "/symptoms", {"entry_date": day, "symptom": "头晕", "severity": 1}),
        ("patch", f"/symptoms/{uuid}", {"severity": 2}),
        ("delete", f"/symptoms/{uuid}", None),
    ]
    token = headers(a)["X-CSRF-Token"]
    for method, path, body in writes:
        kwargs = {} if body is None else {"json": body}
        bare = getattr(a, method)(BASE + path, **kwargs)
        assert bare.status_code == 403, (method, path)
        assert bare.json()["error"]["code"] == "CSRF_FAILED"
        wrong_origin = getattr(a, method)(
            BASE + path, headers={"Origin": "https://evil.example", "X-CSRF-Token": token}, **kwargs
        )
        assert wrong_origin.status_code == 403, (method, path)
        wrong_token = getattr(a, method)(
            BASE + path, headers={"Origin": ORIGIN, "X-CSRF-Token": "x" * 40}, **kwargs
        )
        assert wrong_token.status_code == 403, (method, path)
    for method, path, body in writes:
        anonymous = getattr(a.__class__(a.app, base_url=ORIGIN), method)(
            BASE + path, **({} if body is None else {"json": body})
        )
        assert anonymous.status_code in (401, 403), (method, path)


def test_same_day_save_is_idempotent_replaces_the_record_and_keeps_unanswered_as_null(
    clients,  # noqa: F811
):
    a, _, engine, _ = clients
    owner = register(a)
    day = today(a)
    first = put_entry(a, day, mood=7, anxiety=0, energy=3, sleep_hours=6.5, note="第一次")
    assert first.status_code == 200, first.text
    assert first.json()["data"]["focus"] is None
    second = put_entry(a, day, mood=4, anxiety=0, note="第二次")
    assert second.status_code == 200
    data = second.json()["data"]
    assert (data["mood"], data["anxiety"], data["note"]) == (4, 0, "第二次")
    assert data["energy"] is None and data["sleep_hours"] is None  # replaced, never 0
    stored = rows(
        engine,
        "SELECT count(*), max(energy), max(sleep_hours), max(anxiety), max(focus) "
        "FROM wellbeing_daily_entries WHERE user_id=:u",
        u=UUID(owner),
    )
    assert stored == [(1, None, None, 0, None)]
    read = a.get(f"{BASE}/days/{day}").json()["data"]
    assert read["entry"]["mood"] == 4 and read["timezone"] == "Asia/Shanghai"
    assert read["today"] == str(day)


def test_entry_validation_rejects_bad_dates_ranges_and_never_echoes_private_text(
    clients,  # noqa: F811
    caplog,
):
    a, _, engine, _ = clients
    owner = register(a)
    day = today(a)
    assert put_entry(a, day).status_code == 422
    assert put_entry(a, day, note="   ").status_code == 422
    assert put_entry(a, day, mood=11).status_code == 422
    assert put_entry(a, day, mood=3, surprise=1).status_code == 422
    future = put_entry(a, day + timedelta(days=2), mood=3)
    assert future.status_code == 422 and future.json()["error"]["code"] == "FUTURE_DATE"
    too_old = put_entry(a, "1999-12-31", mood=3)
    assert too_old.json()["error"]["code"] == "INVALID_DATE"
    assert (
        a.put(f"{BASE}/days/not-a-date/entry", headers=headers(a), json={"mood": 1}).status_code
        == 422
    )
    with caplog.at_level(logging.DEBUG):
        leaked = put_entry(a, day, mood=99, note=SENTINEL)
        nul = put_entry(a, day, note=f"{SENTINEL}\x00")
    assert leaked.status_code == 422 and nul.status_code == 422
    assert SENTINEL not in leaked.text and SENTINEL not in nul.text
    assert SENTINEL not in caplog.text
    stored = rows(
        engine, "SELECT count(*) FROM wellbeing_daily_entries WHERE user_id=:u", u=UUID(owner)
    )
    assert stored == [(0,)]


def test_delete_entry_removes_only_the_state_and_missing_days_are_404(clients):  # noqa: F811
    a, _, _, _ = clients
    register(a)
    day = today(a)
    assert a.delete(f"{BASE}/days/{day}/entry", headers=headers(a)).status_code == 404
    put_entry(a, day, mood=2)
    taken = datetime.now(UTC).isoformat()
    assert post(a, "/doses", **dose_body(taken_at=taken)).status_code == 201
    removed = a.delete(f"{BASE}/days/{day}/entry", headers=headers(a))
    assert removed.status_code == 200 and removed.json()["data"] == {"deleted": True}
    read = a.get(f"{BASE}/days/{day}").json()["data"]
    assert read["entry"] is None and len(read["doses"]) == 1


def test_one_day_can_hold_many_doses_of_the_same_medicine_and_they_edit_and_delete(
    clients,  # noqa: F811
):
    a, _, engine, _ = clients
    owner = register(a)
    first = post(a, "/doses", **dose_body(taken_at="2026-10-10T08:00:00+08:00"))
    second = post(
        a,
        "/doses",
        **dose_body(taken_at="2026-10-10T20:15:00+08:00", dose_amount=12.5, note="晚间补一次"),
    )
    other = post(
        a,
        "/doses",
        **dose_body(
            medication_name="按需药乙",
            regimen="as_needed",
            dose_amount=0.5,
            dose_unit="片",
            taken_at="2026-10-10T09:00:00+08:00",
        ),
    )
    assert first.status_code == second.status_code == other.status_code == 201
    day = a.get(f"{BASE}/days/2026-10-10").json()["data"]
    assert [d["dose_amount"] for d in day["doses"]] == [10.0, 0.5, 12.5]
    assert len(day["doses"]) == 3
    dose_id = second.json()["data"]["id"]
    edited = a.patch(
        f"{BASE}/doses/{dose_id}", headers=headers(a), json={"dose_amount": 15, "note": None}
    )
    assert edited.status_code == 200
    assert edited.json()["data"]["dose_amount"] == 15.0 and edited.json()["data"]["note"] is None
    assert a.patch(f"{BASE}/doses/{dose_id}", headers=headers(a), json={}).status_code == 422
    assert (
        a.patch(f"{BASE}/doses/{dose_id}", headers=headers(a), json={"dose_unit": None}).status_code
        == 422
    )
    assert a.delete(f"{BASE}/doses/{dose_id}", headers=headers(a)).status_code == 200
    assert a.delete(f"{BASE}/doses/{dose_id}", headers=headers(a)).status_code == 404
    count = rows(
        engine,
        "SELECT count(*) FROM wellbeing_dose_events WHERE user_id=:u AND entry_date='2026-10-10'",
        u=UUID(owner),
    )
    assert count == [(2,)]
    meds = {m["name"]: m for m in a.get(f"{BASE}/medications").json()["data"]}
    assert set(meds) == {"示例药物甲", "按需药乙"}
    # A medicine used for the first time joins the list with that dose as its usual dose.
    assert meds["示例药物甲"]["dose_count"] == 1 and meds["示例药物甲"]["stock"] is None
    assert meds["按需药乙"]["regimen"] == "as_needed"


def test_dose_validation_and_future_times(clients):  # noqa: F811
    a, _, _, _ = clients
    register(a)
    for override in (
        {"dose_amount": 0},
        {"dose_amount": 100001},
        {"dose_unit": ""},
        {"medication_name": " "},
        {"regimen": "daily"},
        {"taken_at": "2026-10-10T08:00:00"},
        {"unknown": 1},
    ):
        assert post(a, "/doses", **dose_body(**override)).status_code == 422, override
    soon = (datetime.now(UTC) + timedelta(hours=2)).isoformat()
    future = post(a, "/doses", **dose_body(taken_at=soon))
    assert future.status_code == 422 and future.json()["error"]["code"] == "FUTURE_TIME"
    assert post(a, "/doses", **dose_body(taken_at="1999-01-01T00:00:00+00:00")).status_code == 422


def test_the_dose_day_follows_the_account_timezone_across_midnight(clients):  # noqa: F811
    a, _, engine, _ = clients
    owner = register(a)
    instant = "2026-10-10T16:30:00+00:00"  # 00:30 on the 11th in Shanghai, 12:30 on the 10th in NY
    shanghai = post(a, "/doses", **dose_body(taken_at=instant)).json()["data"]
    assert shanghai["entry_date"] == "2026-10-11"
    with engine.begin() as db:
        db.execute(
            text("UPDATE users SET timezone='America/New_York' WHERE id=:u"), {"u": UUID(owner)}
        )
    new_york = post(a, "/doses", **dose_body(taken_at=instant)).json()["data"]
    assert new_york["entry_date"] == "2026-10-10"
    # Moving the dose to the other side of local midnight moves its day with it.
    moved = a.patch(
        f"{BASE}/doses/{new_york['id']}",
        headers=headers(a),
        json={"taken_at": "2026-10-11T05:00:00+00:00"},
    ).json()["data"]
    assert moved["entry_date"] == "2026-10-11"
    # The earlier record keeps the day it was stored under; a timezone change never rewrites it.
    assert [d["id"] for d in a.get(f"{BASE}/days/2026-10-11").json()["data"]["doses"]] == [
        shanghai["id"],
        new_york["id"],
    ]
    far_ahead = ZoneInfo("Pacific/Kiritimati")
    with engine.begin() as db:
        db.execute(
            text("UPDATE users SET timezone='Pacific/Kiritimati' WHERE id=:u"), {"u": UUID(owner)}
        )
    assert a.get(f"{BASE}/days/2026-10-10").json()["data"]["today"] == str(
        datetime.now(far_ahead).date()
    )


def test_symptoms_create_edit_clear_optional_fields_and_delete(clients):  # noqa: F811
    a, _, _, _ = clients
    register(a)
    body = {
        "entry_date": "2026-10-10",
        "symptom": "头晕",
        "severity": 6,
        "onset_at": "2026-10-10T09:00:00+08:00",
        "duration_minutes": 45,
        "affects_daily_life": True,
    }
    created = post(a, "/symptoms", **body)
    assert created.status_code == 201, created.text
    identifier = created.json()["data"]["id"]
    cleared = a.patch(
        f"{BASE}/symptoms/{identifier}",
        headers=headers(a),
        json={
            "onset_at": None,
            "duration_minutes": None,
            "affects_daily_life": None,
            "severity": 3,
        },
    ).json()["data"]
    assert (cleared["onset_at"], cleared["duration_minutes"], cleared["severity"]) == (
        None,
        None,
        3,
    )
    assert cleared["affects_daily_life"] is None
    assert post(a, "/symptoms", **{**body, "severity": 11}).status_code == 422
    # A side effect needs no score: noted by name alone, and an old score can be cleared.
    plain = post(a, "/symptoms", entry_date="2026-10-10", symptom="口干")
    assert plain.status_code == 201 and plain.json()["data"]["severity"] is None
    unscored = a.patch(f"{BASE}/symptoms/{identifier}", headers=headers(a), json={"severity": None})
    assert unscored.status_code == 200 and unscored.json()["data"]["severity"] is None
    assert (
        a.delete(f"{BASE}/symptoms/{plain.json()['data']['id']}", headers=headers(a)).status_code
        == 200
    )
    assert post(a, "/symptoms", **{**body, "entry_date": "2999-01-01"}).status_code == 422
    assert post(a, "/symptoms", **{**body, "symptom": ""}).status_code == 422
    assert a.delete(f"{BASE}/symptoms/{identifier}", headers=headers(a)).status_code == 200
    assert a.get(f"{BASE}/days/2026-10-10").json()["data"]["symptoms"] == []


def test_users_cannot_read_or_change_each_others_records_and_get_404_not_403(clients):  # noqa: F811
    a, b, _, _ = clients
    register(a)
    register(b)
    put_entry(a, "2026-10-10", mood=8, note=SENTINEL)
    dose = post(a, "/doses", **dose_body(note=SENTINEL)).json()["data"]
    symptom = post(
        a, "/symptoms", entry_date="2026-10-10", symptom=SENTINEL[:30], severity=5
    ).json()["data"]
    for call in (
        b.patch(f"{BASE}/doses/{dose['id']}", headers=headers(b), json={"note": "改"}),
        b.delete(f"{BASE}/doses/{dose['id']}", headers=headers(b)),
        b.patch(f"{BASE}/symptoms/{symptom['id']}", headers=headers(b), json={"severity": 1}),
        b.delete(f"{BASE}/symptoms/{symptom['id']}", headers=headers(b)),
    ):
        assert call.status_code == 404
        assert call.json()["error"]["code"] == "RESOURCE_NOT_FOUND"
    assert b.delete(f"{BASE}/days/2026-10-10/entry", headers=headers(b)).status_code == 404
    assert SENTINEL not in b.get(f"{BASE}/days/2026-10-10").text
    assert b.get(f"{BASE}/days/2026-10-10").json()["data"]["entry"] is None
    for path in (
        "/entries",
        "/medications",
        "/trends?days=30",
        "/days?from=2026-10-01&to=2026-10-31",
        "/report?from=2026-10-01&to=2026-10-31",
    ):
        text_ = b.get(BASE + path).text
        assert SENTINEL not in text_ and "示例药物甲" not in text_, path
    for kind in ("entries", "doses", "symptoms"):
        body = b.get(f"{BASE}/report.csv?from=2026-10-01&to=2026-10-31&kind={kind}").content
        assert SENTINEL.encode() not in body and "示例药物甲".encode() not in body
    # Owner data is untouched by the rejected attempts.
    assert a.get(f"{BASE}/days/2026-10-10").json()["data"]["entry"]["mood"] == 8
    assert len(a.get(f"{BASE}/days/2026-10-10").json()["data"]["doses"]) == 1


def test_history_lists_filter_by_range_and_paginate_newest_first(clients):  # noqa: F811
    a, _, _, _ = clients
    register(a)
    for day in range(1, 8):
        put_entry(a, f"2026-10-0{day}", mood=day)
    page = a.get(f"{BASE}/entries?limit=3&offset=0").json()["data"]
    assert (page["total"], page["limit"], page["offset"]) == (7, 3, 0)
    assert [i["entry_date"] for i in page["items"]] == ["2026-10-07", "2026-10-06", "2026-10-05"]
    ranged = a.get(f"{BASE}/entries?from=2026-10-02&to=2026-10-04").json()["data"]
    assert [i["mood"] for i in ranged["items"]] == [4, 3, 2] and ranged["total"] == 3
    assert a.get(f"{BASE}/entries?limit=101").status_code == 422
    assert a.get(f"{BASE}/entries?limit=0").status_code == 422
    post(a, "/doses", **dose_body(taken_at="2026-10-09T08:00:00+08:00"))
    post(a, "/symptoms", entry_date="2026-10-09", symptom="头痛", severity=2)
    marks = a.get(f"{BASE}/days?from=2026-10-01&to=2026-10-31").json()["data"]
    by_day = {m["date"]: m for m in marks}
    assert by_day["2026-10-03"] == {
        "date": "2026-10-03",
        "has_entry": True,
        "dose_count": 0,
        "symptom_count": 0,
    }
    assert by_day["2026-10-09"]["has_entry"] is False and by_day["2026-10-09"]["dose_count"] == 1
    assert by_day["2026-10-09"]["symptom_count"] == 1 and "2026-10-08" not in by_day
    assert a.get(f"{BASE}/days?from=2026-10-05&to=2026-10-01").status_code == 422
    assert a.get(f"{BASE}/days?from=2025-01-01&to=2026-12-31").json()["error"]["code"] == (
        "RANGE_TOO_LARGE"
    )


def test_trends_leave_missing_days_empty_and_summarise_symptoms(clients):  # noqa: F811
    a, _, _, _ = clients
    register(a)
    end = today(a)
    put_entry(a, end, mood=0, anxiety=5, energy=6, focus=7, sleep_hours=7.5, sleep_quality=4)
    put_entry(a, end - timedelta(days=2), mood=8)
    for severity, name in ((3, "头晕"), (7, "头晕"), (4, "恶心")):
        post(
            a, "/symptoms", entry_date=str(end - timedelta(days=1)), symptom=name, severity=severity
        )
    post(a, "/symptoms", entry_date=str(end), symptom="头晕", severity=5, affects_daily_life=True)
    post(a, "/doses", **dose_body(taken_at=datetime.now(UTC).isoformat()))
    assert a.get(f"{BASE}/trends?days=90").status_code == 422  # only 7, 14 or 30 days
    assert a.get(f"{BASE}/trends?days=60").status_code == 422
    assert len(a.get(f"{BASE}/trends").json()["data"]["series"]) == 7  # the default is a week
    for days in (7, 14, 30):
        assert len(a.get(f"{BASE}/trends?days={days}").json()["data"]["series"]) == days
    data = a.get(f"{BASE}/trends?days=7").json()["data"]
    series = {p["date"]: p for p in data["series"]}
    assert data["end"] == str(end) and data["start"] == str(end - timedelta(days=6))
    assert data["recorded_days"] == 2
    assert series[str(end)]["mood"] == 0  # a real zero stays a zero
    middle = series[str(end - timedelta(days=1))]
    assert middle["mood"] is None and middle["anxiety"] is None  # no entry: never invented
    assert middle["symptom_count"] == 3 and middle["symptom_max_severity"] == 7
    assert series[str(end - timedelta(days=3))]["symptom_max_severity"] is None
    assert series[str(end - timedelta(days=2))]["sleep_hours"] is None
    assert series[str(end)]["sleep_hours"] == 7.5 and series[str(end)]["dose_count"] == 1
    stats = {s["symptom"]: s for s in data["symptoms"]}
    assert stats["头晕"] == {
        "symptom": "头晕",
        "count": 3,
        "days": 2,
        "avg_severity": 5.0,
        "max_severity": 7,
        "affects_daily_life_count": 1,
    }
    assert data["symptoms"][0]["symptom"] == "头晕"
    # Unscored side effects count, and add nothing to the severity figures.
    post(a, "/symptoms", entry_date=str(end - timedelta(days=4)), symptom="耳鸣")
    plain = a.get(f"{BASE}/trends?days=7").json()["data"]
    ringing = {s["symptom"]: s for s in plain["symptoms"]}["耳鸣"]
    assert (ringing["count"], ringing["avg_severity"], ringing["max_severity"]) == (1, None, None)
    unscored_day = {p["date"]: p for p in plain["series"]}[str(end - timedelta(days=4))]
    assert unscored_day["symptom_count"] == 1 and unscored_day["symptom_max_severity"] is None


def test_report_summarises_only_what_was_logged_and_reports_the_gaps(clients):  # noqa: F811
    a, _, _, _ = clients
    register(a)
    put_entry(a, "2026-10-01", mood=6, anxiety=4, sleep_hours=6.0, sleep_quality=3, note="入睡慢")
    put_entry(a, "2026-10-02", mood=4)
    put_entry(a, "2026-10-05", mood=2, anxiety=2, sleep_hours=8.0)
    for taken, amount in (
        ("2026-10-01T08:00:00+08:00", 10),
        ("2026-10-02T08:00:00+08:00", 10),
        ("2026-10-03T08:00:00+08:00", 15),
    ):
        post(a, "/doses", **dose_body(taken_at=taken, dose_amount=amount))
    post(
        a,
        "/doses",
        **dose_body(
            medication_name="按需药乙",
            regimen="as_needed",
            taken_at="2026-10-03T21:00:00+08:00",
            dose_amount=0.5,
            dose_unit="片",
        ),
    )
    post(
        a,
        "/symptoms",
        entry_date="2026-10-03",
        symptom="困倦",
        severity=6,
        onset_at="2026-10-03T22:00:00+08:00",
        affects_daily_life=True,
    )
    report = a.get(f"{BASE}/report?from=2026-10-01&to=2026-10-07").json()["data"]
    coverage = report["coverage"]
    assert coverage["days_in_range"] == 7 and coverage["days_with_entry"] == 3
    assert coverage["missing_dates"] == ["2026-10-03", "2026-10-04", "2026-10-06", "2026-10-07"]
    assert coverage["unanswered"]["energy"] == 3 and coverage["unanswered"]["mood"] == 0
    assert coverage["unanswered"]["sleep_hours"] == 1
    ratings = {r["key"]: r for r in report["ratings"]}
    assert (
        ratings["mood"]["mean"],
        ratings["mood"]["first"],
        ratings["mood"]["last"],
    ) == (
        4.0,
        6,
        2,
    )
    assert ratings["anxiety"]["answered_days"] == 2 and ratings["energy"]["mean"] is None
    assert report["sleep"]["mean_hours"] == 7.0 and report["sleep"]["answered_days"] == 2
    assert "thoughts" not in report
    assert report["notes"] == [{"date": "2026-10-01", "note": "入睡慢"}]
    meds = {m["name"]: m for m in report["medications"]}
    timeline = [(c["date"], c["dose_amount"], c["kind"]) for c in meds["示例药物甲"]["timeline"]]
    assert timeline == [("2026-10-01", 10.0, "first_in_range"), ("2026-10-03", 15.0, "changed")]
    assert meds["按需药乙"]["as_needed_count"] == 1
    assert len(report["doses"]) == 4
    (event,) = report["symptom_events"]
    assert event["preceding_dose"] == {"medication_name": "按需药乙", "minutes_before": 60}
    assert report["symptoms"][0]["symptom"] == "困倦"
    assert a.get(f"{BASE}/report?from=2026-10-05&to=2026-10-01").status_code == 422
    assert a.get(f"{BASE}/report?from=2025-01-01&to=2026-12-31").status_code == 422
    empty = a.get(f"{BASE}/report?from=2026-01-01&to=2026-01-03").json()["data"]
    assert empty["coverage"]["days_with_entry"] == 0 and empty["medications"] == []
    assert empty["sleep"]["mean_hours"] is None and empty["ratings"][0]["mean"] is None


def parse(response):
    assert response.headers["content-type"].startswith("text/csv")
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["content-disposition"].startswith("attachment;")
    assert response.content.startswith(b"\xef\xbb\xbf")
    return list(csv.reader(io.StringIO(response.content.decode("utf-8-sig"))))


def test_csv_exports_match_the_records_and_neutralise_formulas(clients):  # noqa: F811
    a, _, _, _ = clients
    register(a)
    put_entry(
        a,
        "2026-10-01",
        mood=6,
        sleep_hours=6.5,
        note="=HYPERLINK(1)",
    )
    put_entry(a, "2026-10-03", anxiety=0)
    post(
        a,
        "/doses",
        **dose_body(medication_name="+药", dose_amount=12.5, taken_at="2026-10-01T08:00:00+08:00"),
    )
    post(
        a,
        "/symptoms",
        entry_date="2026-10-01",
        symptom="头晕",
        severity=4,
        onset_at="2026-10-01T09:30:00+08:00",
        duration_minutes=30,
        affects_daily_life=False,
    )
    query = "from=2026-10-01&to=2026-10-31"
    entries = parse(a.get(f"{BASE}/report.csv?{query}"))
    assert len(entries) == 3
    header = entries[0]
    assert entries[1][0] == "2026-10-01" and entries[1][1] == "6" and entries[1][2] == ""
    assert entries[1][header.index("睡眠时长(小时)")] == "6.50"
    assert entries[1][header.index("睡眠时长(时:分)")] == "6:30"
    assert not any("自伤" in column for column in header)
    assert entries[1][-1] == "'=HYPERLINK(1)"
    assert (
        entries[2][2] == "0" and entries[2][1] == ""
    )  # an answered zero is kept, unanswered is blank
    doses = parse(a.get(f"{BASE}/report.csv?{query}&kind=doses"))
    assert doses[1][:7] == [
        "2026-10-01",
        "2026-10-01T08:00+08:00",
        "'+药",
        "",
        "12.5",
        "mg",
        "常规",
    ]
    symptoms = parse(a.get(f"{BASE}/report.csv?{query}&kind=symptoms"))
    assert symptoms[1][:6] == ["2026-10-01", "头晕", "4", "2026-10-01T09:30+08:00", "30", "否"]
    assert symptoms[1][6] == "'+药，90 分钟前"
    assert a.get(f"{BASE}/report.csv?{query}&kind=other").status_code == 422
    name = a.get(f"{BASE}/report.csv?{query}").headers["content-disposition"]
    assert "wellbeing-entries-2026-10-01_2026-10-31.csv" in name


def test_journal_writes_do_not_make_running_ai_reports_stale(clients):  # noqa: F811
    a, _, engine, _ = clients
    owner = register(a)
    version = "SELECT activity_data_version FROM users WHERE id=:u"
    before = rows(engine, version, u=UUID(owner))
    put_entry(a, today(a), mood=3)
    dose = post(a, "/doses", **dose_body()).json()["data"]
    symptom = post(a, "/symptoms", entry_date="2026-10-10", symptom="头痛", severity=1).json()[
        "data"
    ]
    a.patch(f"{BASE}/doses/{dose['id']}", headers=headers(a), json={"dose_amount": 20})
    a.delete(f"{BASE}/symptoms/{symptom['id']}", headers=headers(a))
    a.delete(f"{BASE}/doses/{dose['id']}", headers=headers(a))
    assert rows(engine, version, u=UUID(owner)) == before


def test_no_public_owner_or_ai_surface_exposes_the_journal(clients):  # noqa: F811
    a, _, engine, _ = clients
    owner = register(a)
    put_entry(a, "2026-10-10", mood=9, note=SENTINEL)
    post(a, "/doses", **dose_body(medication_name=SENTINEL[:40], note=SENTINEL))
    post(a, "/symptoms", entry_date="2026-10-10", symptom=SENTINEL[:30], severity=9)
    with engine.connect() as db:
        username = db.execute(
            text("SELECT username FROM users WHERE id=:u"), {"u": UUID(owner)}
        ).scalar()
    year = datetime.now(UTC).year
    owner_views = [
        "/api/v1/showcase/profile",
        "/api/v1/showcase/activities",
        "/api/v1/showcase/statistics/summary",
        f"/api/v1/showcase/statistics/records?year={year}",
        "/api/v1/showcase/statistics/streaks",
        "/api/v1/showcase/ai-reports",
        "/api/v1/showcase/footprints/all",
        "/api/v1/activities",
        "/api/v1/ai-reports/context",
        "/api/v1/ai-reports",
        "/api/v1/me/running-goals",
        "/api/v1/auth/session",
        "/api/v1/me",
        f"/api/v1/public/users/{username}",
        f"/api/v1/showcase/users/{username}/profile",
        f"/api/v1/showcase/users/{username}/activities",
    ]
    for client in (a, a.__class__(a.app, base_url=ORIGIN)):
        for path in owner_views:
            response = client.get(path)
            assert SENTINEL not in response.text, (path, response.status_code)
            assert "wellbeing" not in response.text.lower() or "wellbeing" not in path
    anonymous = a.__class__(a.app, base_url=ORIGIN)
    assert anonymous.get(f"/api/v1/showcase/users/{username}/wellbeing").status_code == 404
    assert anonymous.get("/api/v1/showcase/wellbeing").status_code == 404
    assert anonymous.get(f"/api/v1/public/users/{username}/wellbeing").status_code == 404


def test_deleting_an_account_removes_its_diary(clients):  # noqa: F811
    a, _, engine, _ = clients
    owner = register(a)
    put_entry(a, "2026-10-10", mood=1)
    post(a, "/doses", **dose_body())
    post(a, "/symptoms", entry_date="2026-10-10", symptom="头痛", severity=1)
    tables = ("wellbeing_daily_entries", "wellbeing_dose_events", "wellbeing_symptom_events")
    with engine.begin() as db:
        db.execute(text("DELETE FROM auth_sessions WHERE user_id=:u"), {"u": UUID(owner)})
        db.execute(text("DELETE FROM users WHERE id=:u"), {"u": UUID(owner)})
    for table in tables:
        assert rows(engine, f"SELECT count(*) FROM {table} WHERE user_id=:u", u=UUID(owner)) == [
            (0,)
        ]


def test_a_stale_editor_gets_409_instead_of_overwriting_a_newer_save(clients):  # noqa: F811
    a, _, _, _ = clients
    register(a)
    day = today(a)
    # Loaded an empty day, then someone else saved first.
    assert put_entry(a, day, mood=1, based_on=None).status_code == 200
    again = put_entry(a, day, mood=2, based_on=None)
    assert again.status_code == 409 and again.json()["error"]["code"] == "ENTRY_CHANGED"
    version = a.get(f"{BASE}/days/{day}").json()["data"]["entry"]["updated_at"]
    assert put_entry(a, day, mood=3, based_on=version).status_code == 200
    stale = put_entry(a, day, mood=4, based_on=version)
    assert stale.status_code == 409
    assert a.get(f"{BASE}/days/{day}").json()["data"]["entry"]["mood"] == 3
    # A day deleted elsewhere is also a conflict, not a silent re-create.
    latest = a.get(f"{BASE}/days/{day}").json()["data"]["entry"]["updated_at"]
    a.delete(f"{BASE}/days/{day}/entry", headers=headers(a))
    assert put_entry(a, day, mood=5, based_on=latest).status_code == 409
    # Omitting the guard keeps the plain idempotent upsert.
    assert put_entry(a, day, mood=5).status_code == 200
    assert put_entry(a, day, mood=5, based_on="nonsense").status_code == 422


def med_body(**override):
    return {
        "name": "米那普仑",
        "pills_per_box": 28,
        "strength_amount": 12.5,
        "strength_unit": "mg",
        "default_pills": 1,
        **override,
    }


def stock(client, med_id):
    listing = client.get(f"{BASE}/medications").json()["data"]
    return next(m for m in listing if m["id"] == med_id)["stock"]


def test_medicine_list_is_managed_once_and_keeps_history_independent(clients):  # noqa: F811
    a, b, engine, _ = clients
    owner = register(a)
    register(b)
    made = post(a, "/medications", **med_body(name=" 米那普仑 "))
    assert made.status_code == 201, made.text
    med = made.json()["data"]
    assert med["name"] == "米那普仑" and med["count_unit"] == "颗" and med["pills_per_box"] == 28
    assert (med["strength_amount"], med["strength_unit"], med["default_pills"]) == (12.5, "mg", 1.0)
    assert med["dose_count"] == 0 and med["stock"] is None and med["regimen"] == "scheduled"
    assert post(a, "/medications", name="奥沙西泮", regimen="as_needed").status_code == 201
    dup = post(a, "/medications", name="米那普仑")
    assert dup.status_code == 409 and dup.json()["error"]["code"] == "MEDICATION_EXISTS"
    assert post(a, "/medications", name="Mi").status_code == 201
    assert post(a, "/medications", name="MI").status_code == 409  # not case sensitive
    for bad in (
        {"name": "x", "strength_amount": 5},  # amount without a unit
        {"name": "x", "pills_per_box": 0},
        {"name": "x", "default_pills": 0},
        {"name": " "},
        {"name": "x", "regimen": "daily"},
        {"name": "x", "default_amount": 5},  # the old field is gone
    ):
        assert post(a, "/medications", **bad).status_code == 422, bad
    # A dose logged for a listed medicine joins no second entry and is counted.
    post(a, "/doses", **dose_body(medication_name="米那普仑", dose_amount=25))
    listing = a.get(f"{BASE}/medications").json()["data"]
    assert [m["name"] for m in listing].count("米那普仑") == 1
    assert next(m for m in listing if m["name"] == "米那普仑")["dose_count"] == 1
    assert listing[0]["name"] == "米那普仑"  # most recently taken first
    # Editing, renaming and clearing optional fields.
    patched = a.patch(
        f"{BASE}/medications/{med['id']}", headers=headers(a), json={"default_pills": 2}
    )
    assert patched.json()["data"]["default_pills"] == 2.0
    assert (
        a.patch(f"{BASE}/medications/{med['id']}", headers=headers(a), json={}).status_code == 422
    )
    for bad in ({"name": None}, {"strength_amount": None}, {"strength_unit": None}):
        # Leaving an amount without a unit (or the reverse) is refused.
        assert (
            a.patch(f"{BASE}/medications/{med['id']}", headers=headers(a), json=bad).status_code
            == 422
        ), bad
    clash = a.patch(
        f"{BASE}/medications/{med['id']}", headers=headers(a), json={"name": "奥沙西泮"}
    )
    assert clash.status_code == 409
    cleared = a.patch(
        f"{BASE}/medications/{med['id']}",
        headers=headers(a),
        json={"strength_amount": None, "strength_unit": None, "default_pills": None},
    )
    assert cleared.json()["data"]["strength_amount"] is None
    renamed = a.patch(
        f"{BASE}/medications/{med['id']}", headers=headers(a), json={"name": "米那普仑片"}
    )
    assert renamed.json()["data"]["name"] == "米那普仑片"
    # Renaming or removing the entry never rewrites logged doses.
    assert "米那普仑" in {
        d["medication_name"] for d in a.get(f"{BASE}/days/2026-10-10").json()["data"]["doses"]
    }
    assert a.delete(f"{BASE}/medications/{med['id']}", headers=headers(a)).status_code == 200
    assert a.delete(f"{BASE}/medications/{med['id']}", headers=headers(a)).status_code == 404
    kept = a.get(f"{BASE}/days/2026-10-10").json()["data"]["doses"]
    assert "米那普仑" in {d["medication_name"] for d in kept}
    assert all(d["medication_id"] is None for d in kept if d["medication_name"] == "米那普仑")
    # The other account sees none of it and cannot change it.
    assert b.get(f"{BASE}/medications").json()["data"] == []
    other = post(a, "/medications", name="私有药物").json()["data"]
    for call in (
        b.patch(f"{BASE}/medications/{other['id']}", headers=headers(b), json={"name": "x"}),
        b.delete(f"{BASE}/medications/{other['id']}", headers=headers(b)),
        b.post(f"{BASE}/medications/{other['id']}/stock", headers=headers(b), json={"pills": 5}),
        b.post(
            f"{BASE}/medications/{other['id']}/stock/count", headers=headers(b), json={"pills": 5}
        ),
    ):
        assert call.status_code == 404
    assert post(b, "/medications", name="私有药物").status_code == 201  # unique per account only
    count = rows(
        engine, "SELECT count(*) FROM wellbeing_medications WHERE user_id=:u", u=UUID(owner)
    )
    assert count == [(3,)]


def test_stock_is_a_ledger_that_follows_doses_restocks_and_counts(clients):  # noqa: F811
    a, b, _, _ = clients
    register(a)
    register(b)
    med = post(a, "/medications", **med_body()).json()["data"]
    path = f"/medications/{med['id']}"
    assert stock(a, med["id"]) is None
    # "I have 2 boxes and 5 loose pills" = a count of 61 (28 per box).
    counted = post(a, f"{path}/stock/count", boxes=2, pills=5).json()["data"]["stock"]
    assert (counted["pills"], counted["boxes"], counted["loose_pills"]) == (61.0, 2, 5.0)
    assert counted["avg_daily_pills"] is None and counted["days_left"] is None
    # Each dose logged by pills takes from the stock; half a pill is fine.
    now = datetime.now(UTC)
    first = post(
        a,
        "/doses",
        medication_name="米那普仑",
        medication_id=med["id"],
        pills=1,
        taken_at=(now - timedelta(hours=2)).isoformat(),
    ).json()["data"]
    half = post(
        a,
        "/doses",
        medication_name="米那普仑",
        medication_id=med["id"],
        pills=0.5,
        taken_at=(now - timedelta(hours=1)).isoformat(),
    ).json()["data"]
    assert first["pills"] == 1.0 and first["dose_amount"] == 12.5 and first["dose_unit"] == "mg"
    assert half["dose_amount"] == 6.25 and half["medication_id"] == med["id"]
    after = stock(a, med["id"])
    assert (after["pills"], after["boxes"], after["loose_pills"]) == (59.5, 2, 3.5)
    assert after["avg_daily_pills"] == round(1.5 / 14, 2)
    assert after["days_left"] == round(59.5 / (1.5 / 14), 1)
    # Editing a dose corrects the stock by itself; so does deleting one.
    assert (
        a.patch(f"{BASE}/doses/{half['id']}", headers=headers(a), json={"pills": 2}).json()["data"][
            "dose_amount"
        ]
        == 25.0
    )
    assert stock(a, med["id"])["pills"] == 58.0
    assert a.delete(f"{BASE}/doses/{first['id']}", headers=headers(a)).status_code == 200
    assert stock(a, med["id"])["pills"] == 59.0
    # Restock by boxes and loose pills.
    restocked = post(a, f"{path}/stock", boxes=1, pills=2).json()["data"]["stock"]
    assert (
        restocked["pills"] == 89.0 and restocked["boxes"] == 3 and restocked["loose_pills"] == 5.0
    )
    # A count sets the real number on the shelf; the ledger keeps the difference.
    recounted = post(a, f"{path}/stock/count", boxes=1, pills=0).json()["data"]["stock"]
    assert recounted["pills"] == 28.0
    assert post(a, f"{path}/stock/count").json()["data"]["stock"]["pills"] == 0.0
    assert stock(a, med["id"])["days_left"] == 0.0
    # Running out is shown, not forbidden: logging more than is left still works.
    over = post(
        a,
        "/doses",
        medication_name="米那普仑",
        medication_id=med["id"],
        pills=3,
        taken_at=(now - timedelta(minutes=5)).isoformat(),
    )
    assert over.status_code == 201 and stock(a, med["id"])["pills"] == -3.0
    # Validation: boxes need a box size; an empty restock is meaningless; bad ids are 404.
    loose = post(a, "/medications", name="散装药").json()["data"]
    no_box = post(a, f"/medications/{loose['id']}/stock", boxes=1)
    assert no_box.status_code == 422 and no_box.json()["error"]["code"] == "NO_BOX_SIZE"
    assert post(a, f"/medications/{loose['id']}/stock", pills=10).status_code == 200
    assert post(a, f"{path}/stock").status_code == 422
    assert post(a, f"{path}/stock", boxes=0, pills=0).status_code == 422
    assert post(a, f"{path}/stock", pills=1.234).status_code == 422
    assert post(a, f"/medications/{uuid4()}/stock", pills=1).status_code == 404
    # The other account's doses and stock are separate.
    assert b.get(f"{BASE}/medications").json()["data"] == []
    # Doses with a medication id that is not yours are refused.
    foreign = post(
        b,
        "/doses",
        medication_name="x",
        medication_id=med["id"],
        pills=1,
        taken_at=(now - timedelta(minutes=5)).isoformat(),
    )
    assert foreign.status_code == 404


def test_a_dose_resolves_its_medicine_by_id_or_name_and_converts_pills(clients):  # noqa: F811
    a, _, engine, _ = clients
    owner = register(a)
    taken = (datetime.now(UTC) - timedelta(minutes=30)).isoformat()
    # An unknown name joins the list; pills alone is a valid dose with no milligrams.
    by_name = post(a, "/doses", medication_name="新药", pills=2, taken_at=taken).json()["data"]
    assert (
        by_name["pills"] == 2.0 and by_name["dose_amount"] is None and by_name["dose_unit"] is None
    )
    listing = {m["name"]: m for m in a.get(f"{BASE}/medications").json()["data"]}
    assert listing["新药"]["default_pills"] == 2.0 and listing["新药"]["stock"] is None
    # The name finds the listed medicine again, in any case, so stock is tracked for it.
    post(a, f"/medications/{listing['新药']['id']}/stock", pills=10)
    again = post(a, "/doses", medication_name="新药".upper(), pills=1, taken_at=taken).json()[
        "data"
    ]
    assert again["medication_id"] == listing["新药"]["id"]
    assert stock(a, listing["新药"]["id"])["pills"] == 7.0
    # By id the listed name wins; a strength converts pills into milligrams.
    med = post(a, "/medications", **med_body(name="有规格")).json()["data"]
    by_id = post(
        a, "/doses", medication_name="随便写", medication_id=med["id"], pills=1.5, taken_at=taken
    )
    assert by_id.json()["data"]["medication_name"] == "有规格"
    assert by_id.json()["data"]["dose_amount"] == 18.75
    # An explicit amount is kept as given; legacy amount-only doses still work.
    explicit = post(
        a,
        "/doses",
        medication_name="有规格",
        pills=1,
        dose_amount=10,
        dose_unit="mg",
        taken_at=taken,
    )
    assert explicit.json()["data"]["dose_amount"] == 10.0
    legacy = post(a, "/doses", **dose_body(medication_name="旧式", taken_at=taken)).json()["data"]
    assert legacy["pills"] is None and legacy["dose_amount"] == 10.0
    for bad in (
        {"medication_name": "无量", "taken_at": taken},
        {"medication_name": "半截", "dose_amount": 5, "taken_at": taken},
        {"medication_name": "太多", "pills": 1001, "taken_at": taken},
    ):
        assert post(a, "/doses", **bad).status_code == 422, bad
    count = rows(
        engine, "SELECT count(*) FROM wellbeing_medications WHERE user_id=:u", u=UUID(owner)
    )
    # 新药, 有规格 and 旧式; the made-up name sent together with an id never became a medicine.
    assert count == [(3,)]


def test_editing_a_dose_can_send_its_medicine_and_relink_it(clients):  # noqa: F811
    a, b, _, _ = clients
    register(a)
    register(b)
    taken = (datetime.now(UTC) - timedelta(minutes=30)).isoformat()
    first = post(a, "/medications", **med_body(name="甲药")).json()["data"]
    second = post(a, "/medications", **med_body(name="乙药", strength_amount=5)).json()["data"]
    foreign = post(b, "/medications", **med_body(name="别人的药")).json()["data"]
    dose = post(
        a, "/doses", medication_name="甲药", medication_id=first["id"], pills=2, taken_at=taken
    ).json()["data"]
    path = f"{BASE}/doses/{dose['id']}"
    # The editor sends the whole dose, link included: the same link is accepted.
    same = a.patch(
        path,
        headers=headers(a),
        json={
            "medication_name": "甲药",
            "medication_id": first["id"],
            "pills": 3,
            "taken_at": taken,
            "regimen": "scheduled",
            "note": "饭后",
        },
    )
    assert same.status_code == 200, same.text
    assert (
        same.json()["data"]["medication_id"] == first["id"] and same.json()["data"]["pills"] == 3.0
    )
    # Another of the user's medicines relinks it, and the milligrams follow the new strength.
    moved = a.patch(
        path,
        headers=headers(a),
        json={"medication_name": "乙药", "medication_id": second["id"], "pills": 2},
    ).json()["data"]
    assert moved["medication_id"] == second["id"] and moved["dose_amount"] == 10.0
    # Someone else's medicine is a 404, never a link.
    stolen = a.patch(path, headers=headers(a), json={"medication_id": foreign["id"]})
    assert stolen.status_code == 404
    assert (
        a.get(f"{BASE}/days/{dose['entry_date']}").json()["data"]["doses"][0]["medication_id"]
        == second["id"]
    )
    # An unknown field is still refused.
    assert a.patch(path, headers=headers(a), json={"surprise": 1}).status_code == 422


def test_batch_back_fill_creates_each_time_on_each_day_once(clients):  # noqa: F811
    a, b, engine, _ = clients
    owner = register(a)
    register(b)
    med = post(a, "/medications", **med_body(default_pills=1)).json()["data"]
    post(a, f"/medications/{med['id']}/stock/count", boxes=1, pills=0)
    body = {
        "medication_id": med["id"],
        "start_date": "2026-10-01",
        "end_date": "2026-10-07",
        "times": ["08:00", "20:30"],
    }
    made = post(a, "/doses/batch", **body)
    assert made.status_code == 201, made.text
    assert made.json()["data"] == {"created": 14, "skipped_existing": 0, "skipped_future": 0}
    # The same request again adds nothing: back-filling is safe to repeat.
    assert post(a, "/doses/batch", **body).json()["data"] == {
        "created": 0,
        "skipped_existing": 14,
        "skipped_future": 0,
    }
    day = a.get(f"{BASE}/days/2026-10-03").json()["data"]["doses"]
    assert [d["taken_at"][11:16] for d in day] == [
        "00:00",
        "12:30",
    ]  # 08:00/20:30 in Shanghai, as UTC
    assert all(
        d["pills"] == 1.0 and d["medication_name"] == "米那普仑" and d["dose_amount"] == 12.5
        for d in day
    )
    assert stock(a, med["id"])["pills"] == 14.0  # 28 - 14 pills
    # A larger pill count and a note; extra times are added to days that already have some.
    more = post(
        a, "/doses/batch", **{**body, "pills": 2, "times": ["08:00", "13:00"], "note": "补录"}
    )
    assert more.json()["data"] == {"created": 7, "skipped_existing": 7, "skipped_future": 0}
    # Future times are skipped, not recorded.
    today_local = datetime.now(ZoneInfo("Asia/Shanghai")).date()
    future = post(
        a,
        "/doses/batch",
        medication_id=med["id"],
        start_date=str(today_local),
        end_date=str(today_local),
        times=["23:59"],
    )
    now_local = datetime.now(ZoneInfo("Asia/Shanghai"))
    if now_local.hour * 60 + now_local.minute < 23 * 60 + 49:
        assert future.json()["data"] == {"created": 0, "skipped_existing": 0, "skipped_future": 1}
    # Limits and ownership.
    assert post(a, "/doses/batch", **{**body, "end_date": "2999-01-01"}).status_code == 422
    assert (
        post(a, "/doses/batch", **{**body, "start_date": "2025-01-01"}).json()["error"]["code"]
        == "RANGE_TOO_LARGE"
    )
    too_many = post(
        a,
        "/doses/batch",
        **{
            **body,
            "start_date": "2026-01-01",
            "end_date": "2026-10-07",
            "times": ["01:00", "02:00", "03:00", "04:00", "05:00", "06:00"],
        },
    )
    assert too_many.status_code == 422
    assert post(a, "/doses/batch", **{**body, "end_date": "2026-09-30"}).status_code == 422
    assert post(b, "/doses/batch", **body).status_code == 404
    unknown = post(a, "/doses/batch", **{**body, "medication_id": str(uuid4())})
    assert unknown.status_code == 404
    # No pill count anywhere is refused with a clear code.
    bare = post(a, "/medications", name="没设颗数").json()["data"]
    refused = post(a, "/doses/batch", **{**body, "medication_id": bare["id"]})
    assert refused.status_code == 422 and refused.json()["error"]["code"] == "NO_PILL_COUNT"
    assert (
        post(a, "/doses/batch", **{**body, "medication_id": bare["id"], "pills": 1}).status_code
        == 201
    )
    total = rows(
        engine,
        "SELECT count(*) FROM wellbeing_dose_events WHERE user_id=:u AND medication_id=:m",
        u=UUID(owner),
        m=UUID(med["id"]),
    )
    assert total == [(21,)]


def test_report_and_csv_carry_pill_counts(clients):  # noqa: F811
    a, _, _, _ = clients
    register(a)
    med = post(a, "/medications", **med_body()).json()["data"]
    post(
        a,
        "/doses",
        medication_name="米那普仑",
        medication_id=med["id"],
        pills=1,
        taken_at="2026-10-01T08:00:00+08:00",
    )
    post(
        a,
        "/doses",
        medication_name="米那普仑",
        medication_id=med["id"],
        pills=1.5,
        taken_at="2026-10-02T08:00:00+08:00",
    )
    report = a.get(f"{BASE}/report?from=2026-10-01&to=2026-10-07").json()["data"]
    (stat,) = report["medications"]
    assert stat["total_pills"] == 2.5 and stat["dose_count"] == 2
    assert [c["pills"] for c in stat["timeline"]] == [
        1.0,
        1.5,
    ]  # a different pill count is a change
    doses = parse(a.get(f"{BASE}/report.csv?from=2026-10-01&to=2026-10-07&kind=doses"))
    assert doses[0][3] == "颗数" and [row[3] for row in doses[1:]] == ["1", "1.5"]
    assert [row[4] for row in doses[1:]] == ["12.5", "18.75"] and doses[1][5] == "mg"


def test_side_effect_names_are_listed_once_and_managed_like_medicines(clients):  # noqa: F811
    a, b, _, _ = clients
    register(a)
    register(b)
    made = post(a, "/symptom-names", name=" 口干 ")
    assert made.status_code == 201 and made.json()["data"]["name"] == "口干"
    dup = post(a, "/symptom-names", name="口干")
    assert dup.status_code == 409 and dup.json()["error"]["code"] == "SYMPTOM_NAME_EXISTS"
    assert post(a, "/symptom-names", name="").status_code == 422
    assert post(a, "/symptom-names", name="x" * 41).status_code == 422
    # A side effect logged under a new name joins the list; a listed one is not added twice.
    post(a, "/symptoms", entry_date="2026-10-10", symptom="头晕", severity=3)
    post(a, "/symptoms", entry_date="2026-10-11", symptom="头晕", severity=5)
    post(a, "/symptoms", entry_date="2026-10-11", symptom="口干", severity=2)
    names = {n["name"]: n for n in a.get(f"{BASE}/symptom-names").json()["data"]}
    assert set(names) == {"口干", "头晕"}
    assert names["头晕"]["event_count"] == 2 and names["口干"]["event_count"] == 1
    # Removing a name never rewrites logged side effects.
    assert (
        a.delete(f"{BASE}/symptom-names/{names['头晕']['id']}", headers=headers(a)).status_code
        == 200
    )
    assert (
        a.delete(f"{BASE}/symptom-names/{names['头晕']['id']}", headers=headers(a)).status_code
        == 404
    )
    assert len(a.get(f"{BASE}/days/2026-10-11").json()["data"]["symptoms"]) == 2
    # Private to the account.
    assert b.get(f"{BASE}/symptom-names").json()["data"] == []
    assert (
        b.delete(f"{BASE}/symptom-names/{names['口干']['id']}", headers=headers(b)).status_code
        == 404
    )
    assert post(b, "/symptom-names", name="口干").status_code == 201


def test_sleep_duration_keeps_whole_minutes_exactly(clients):  # noqa: F811
    a, _, _, _ = clients
    register(a)
    for hours, minutes in ((7.42, 445), (0.08, 5), (8.0, 480), (23.98, 1439), (0, 0)):
        saved = put_entry(a, "2026-10-12", sleep_hours=hours).json()["data"]["sleep_hours"]
        assert round(saved * 60) == minutes, (hours, saved)
    assert put_entry(a, "2026-10-12", sleep_hours=7.255).status_code == 422
    put_entry(a, "2026-10-13", sleep_hours=7.42)
    csv_text = a.get(f"{BASE}/report.csv?from=2026-10-13&to=2026-10-13").content.decode("utf-8-sig")
    assert "7.42,7:25" in csv_text
    report = a.get(f"{BASE}/report?from=2026-10-13&to=2026-10-13").json()["data"]["sleep"]
    assert report["mean_hours"] == 7.42


def test_a_medicine_carries_its_own_side_effects(clients):  # noqa: F811
    a, b, _, _ = clients
    register(a)
    register(b)
    made = post(a, "/medications", name="米那普仑", side_effects=[" 恶心 ", "出汗", "恶心"])
    assert made.status_code == 201, made.text
    med = made.json()["data"]
    assert med["side_effects"] == ["恶心", "出汗"]
    assert post(a, "/medications", name="没写").json()["data"]["side_effects"] == []
    patched = a.patch(
        f"{BASE}/medications/{med['id']}",
        headers=headers(a),
        json={"side_effects": ["头晕", "出汗"]},
    )
    assert patched.json()["data"]["side_effects"] == ["头晕", "出汗"]
    # Other edits leave the list alone; an empty list clears it.
    kept = a.patch(f"{BASE}/medications/{med['id']}", headers=headers(a), json={"default_pills": 1})
    assert kept.json()["data"]["side_effects"] == ["头晕", "出汗"]
    cleared = a.patch(
        f"{BASE}/medications/{med['id']}", headers=headers(a), json={"side_effects": []}
    )
    assert cleared.json()["data"]["side_effects"] == []
    for bad in (
        {"side_effects": [str(i) for i in range(21)]},
        {"side_effects": ["a\u0000b"]},
        {"side_effects": [""]},
        {"side_effects": None},
        {"side_effects": "恶心"},
    ):
        r = a.patch(f"{BASE}/medications/{med['id']}", headers=headers(a), json=bad)
        assert r.status_code == 422, bad
    assert (
        post(a, "/medications", name="太多", side_effects=[str(i) for i in range(21)]).status_code
        == 422
    )
    # Private to the account.
    listing = b.get(f"{BASE}/medications").json()["data"]
    assert listing == []
