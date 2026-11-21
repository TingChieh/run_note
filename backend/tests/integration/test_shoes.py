from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import UUID

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError

from app.modules.activities.model import Activity
from app.modules.admin_users.service import delete_many
from app.modules.shoes.model import Shoe
from app.modules.users.model import User
from tests.conftest import headers, register, upload
from tests.integration.test_mifitness_import import record, send, track
from tests.integration.test_migrations import assert_downgrade_guard
from tests.integration.test_tcx_import import upload_tcx

pytestmark = pytest.mark.integration
SHOES = "/api/v1/me/shoes"


def binding(activity_id):
    return f"/api/v1/me/activities/{activity_id}/shoe"


def create_shoe(client, **fields):
    response = client.post(
        SHOES, json={"name": "Synthetic shoe", **fields}, headers=headers(client)
    )
    assert response.status_code == 201, response.text
    return response.json()["data"]


def test_active_list_sorts_by_reminder_before_brand(clients):
    a, _, _, _ = clients
    register(a)
    below = create_shoe(a, brand="Alpha", initial_distance_m="800", replacement_distance_m="1000")
    due = create_shoe(a, brand="Zeta", initial_distance_m="1000", replacement_distance_m="1000")
    near = create_shoe(a, initial_distance_m="900", replacement_distance_m="1000")

    response = a.get(SHOES, params={"status": "active", "order": "reminder"})
    assert response.status_code == 200, response.text
    rows = response.json()["data"]["items"]
    assert [(row["id"], row["reminder"]) for row in rows] == [
        (due["id"], "due"),
        (near["id"], "near"),
        (below["id"], None),
    ]


def test_retired_list_sorts_by_retirement_date_before_brand_and_creation(clients, monkeypatch):
    a, _, _, app = clients
    now = datetime(2026, 11, 20, 15, 59, 59, tzinfo=UTC)
    monkeypatch.setattr(app.state, "clock", lambda: now)
    register(a)
    newer_retirement = create_shoe(a, brand="Zeta")
    older_retirement = create_shoe(a, brand="Alpha")

    def retire(shoe):
        response = a.patch(f"{SHOES}/{shoe['id']}", json={"retired": True}, headers=headers(a))
        assert response.status_code == 200, response.text

    retire(older_retirement)
    now += timedelta(seconds=2)
    retire(newer_retirement)

    response = a.get(SHOES, params={"status": "retired", "order": "reminder"})
    assert response.status_code == 200, response.text
    rows = response.json()["data"]["items"]
    assert [(row["id"], row["retired_on"]) for row in rows] == [
        (newer_retirement["id"], "2026-11-21"),
        (older_retirement["id"], "2026-11-20"),
    ]


def test_rebinding_moves_activity_distance_and_count_between_shoes(clients):
    a, _, _, _ = clients
    register(a)
    original = create_shoe(a)["id"]
    replacement = create_shoe(a)["id"]
    imported = upload(a)
    assert imported.status_code == 201, imported.text
    activity = imported.json()["data"]["activity"]
    path = binding(activity["id"])
    distance = Decimal(activity["distance_m"])
    assert distance > 0

    def totals(shoe_id):
        response = a.get(f"{SHOES}/{shoe_id}")
        assert response.status_code == 200, response.text
        data = response.json()["data"]
        return Decimal(data["total_distance_m"]), data["activity_count"]

    assert a.patch(path, json={"shoe_id": original}, headers=headers(a)).status_code == 200
    assert totals(original) == (distance, 1)
    assert totals(replacement) == (Decimal(0), 0)
    response = a.patch(path, json={"shoe_id": replacement}, headers=headers(a))
    assert response.status_code == 200, response.text
    assert response.json()["data"]["shoe"]["id"] == replacement
    assert totals(original) == (Decimal(0), 0)
    assert totals(replacement) == (distance, 1)


def test_other_users_cannot_access_shoes_or_bindings(clients):
    a, b, _, _ = clients
    register(a)
    register(b)
    shoe = create_shoe(a, notes="private shoe note")
    activity = upload(a).json()["data"]["activity"]["id"]
    other_activity = upload(b).json()["data"]["activity"]["id"]
    url = f"{SHOES}/{shoe['id']}"
    assert b.get(SHOES).json()["data"]["total"] == 0
    for path in (url, f"{url}/activities", binding(activity)):
        assert b.get(path).status_code == 404
    assert b.patch(url, json={"name": "Other"}, headers=headers(b)).status_code == 404
    assert b.delete(url, headers=headers(b)).status_code == 404
    for identifier in (activity, other_activity):
        response = b.patch(binding(identifier), json={"shoe_id": shoe["id"]}, headers=headers(b))
        assert response.status_code == 404
    assert a.get(url).json()["data"] == shoe
    assert a.get(binding(activity)).json()["data"]["shoe"] is None


def test_binding_retirement_delete_and_live_total(clients):
    a, _, _, app = clients
    owner = register(a)
    response = upload(a)
    assert response.status_code == 201, response.text
    activity = response.json()["data"]["activity"]
    path = binding(activity["id"])
    assert a.get(path).json()["data"]["shoe"] is None
    assert a.post(SHOES, json={"name": "Shoe"}).status_code == 403
    assert (
        a.post(SHOES, headers=headers(a), json={"name": "Shoe", "user_id": owner}).status_code
        == 422
    )

    def data_version():
        with app.state.session_factory() as db:
            return db.get(User, UUID(owner)).activity_data_version

    version = data_version()
    shoe = create_shoe(a, initial_distance_m="900", replacement_distance_m="1000")
    shoe_id = shoe["id"]
    url = f"{SHOES}/{shoe_id}"
    assert shoe["reminder"] == "near"
    assert a.patch(path, json={"shoe_id": shoe_id}, headers=headers(a)).status_code == 200
    assert a.get(url).headers["cache-control"] == "no-store"
    changed = a.get(url).json()["data"]
    assert Decimal(changed["total_distance_m"]) == Decimal("900") + Decimal(activity["distance_m"])
    assert a.get(f"{url}/activities").json()["data"]["items"][0]["id"] == activity["id"]
    assert a.delete(url, headers=headers(a)).json()["error"]["code"] == "SHOE_IN_USE"

    retired = a.patch(url, json={"retired": True}, headers=headers(a)).json()["data"]
    assert retired["retired_on"]
    assert retired["reminder"] is None
    assert a.patch(path, json={"shoe_id": shoe_id}, headers=headers(a)).status_code == 200
    assert a.patch(path, json={"shoe_id": None}, headers=headers(a)).status_code == 200
    assert a.patch(path, json={"shoe_id": shoe_id}, headers=headers(a)).status_code == 409
    assert a.patch(url, json={"retired": False}, headers=headers(a)).status_code == 200
    assert a.patch(path, json={"shoe_id": shoe_id}, headers=headers(a)).status_code == 200
    assert data_version() == version
    assert a.delete(f"/api/v1/activities/{activity['id']}", headers=headers(a)).status_code == 200
    assert Decimal(a.get(url).json()["data"]["total_distance_m"]) == 900
    assert a.delete(url, headers=headers(a)).status_code == 200


def test_database_restricts_delete_and_cross_user_binding(clients):
    a, b, engine, _ = clients
    register(a)
    register(b)
    owned = create_shoe(a)["id"]
    foreign = create_shoe(b)["id"]
    activity = upload(a).json()["data"]["activity"]["id"]
    statement = text("UPDATE activities SET shoe_id = :shoe WHERE id = :activity")
    with pytest.raises(IntegrityError, match="fk_activities_shoe_id_shoes"), engine.begin() as db:
        db.execute(statement, {"shoe": foreign, "activity": activity})
    assert (
        a.patch(binding(activity), json={"shoe_id": owned}, headers=headers(a)).status_code == 200
    )
    with pytest.raises(IntegrityError, match="fk_activities_shoe_id_shoes"), engine.begin() as db:
        db.execute(text("DELETE FROM shoes WHERE id = :shoe"), {"shoe": owned})


def test_bulk_account_delete_rolls_back_unbinding_and_cascades_multiple_users(clients):
    admin, member, _, app = clients
    owner = register(admin)
    targets = []
    for _ in range(2):
        account = register(member)
        shoe = create_shoe(member)["id"]
        activity = upload(member).json()["data"]["activity"]["id"]
        response = member.patch(binding(activity), json={"shoe_id": shoe}, headers=headers(member))
        assert response.status_code == 200
        targets.append(tuple(map(UUID, (account, shoe, activity))))

    ids = [account for account, _, _ in targets]
    endpoint = "/api/v1/admin/users/batch-delete"
    response = admin.post(endpoint, json={"ids": [owner, *map(str, ids)]}, headers=headers(admin))
    assert response.json()["error"]["code"] == "OWNER_PROTECTED"
    with app.state.session_factory() as db:
        for _, shoe_id, activity_id in targets:
            assert db.get(Activity, activity_id).shoe_id == shoe_id
        assert delete_many(db, ids, app.state.settings)["deleted_count"] == 2
        db.rollback()
        for account, shoe_id, activity_id in targets:
            assert db.get(User, account) is not None
            assert db.get(Shoe, shoe_id) is not None
            assert db.get(Activity, activity_id).shoe_id == shoe_id

    response = admin.post(endpoint, json={"ids": list(map(str, ids))}, headers=headers(admin))
    assert response.json()["data"] == {"deleted": True, "deleted_count": 2}
    with app.state.session_factory() as db:
        assert db.get(User, UUID(owner)) is not None
        for account, shoe_id, activity_id in targets:
            assert db.get(User, account) is None
            assert db.get(Shoe, shoe_id) is None
            assert db.get(Activity, activity_id) is None


def test_all_import_sources_enrichment_and_manual_zero_count_once(clients):
    a, _, _, app = clients
    owner = register(a)
    responses = [
        upload(a, raw=track(namespace=True)),
        upload_tcx(a),
        send(
            a,
            record(
                start_time=record()["source_time"] + 3600, end_time=record()["source_time"] + 4200
            )
            | {"source_time": record()["source_time"] + 3600},
        ),
    ]
    assert all(response.status_code == 201 for response in responses), [
        response.json() for response in responses
    ]
    activities = [response.json()["data"]["activity"] for response in responses]
    assert activities[2]["has_route"] is False
    with app.state.session_factory() as db:
        template = db.scalar(select(Activity).where(Activity.id == UUID(activities[2]["id"])))
        manual = Activity(
            user_id=UUID(owner),
            title="Zero distance",
            activity_date=template.activity_date,
            source="manual",
            date_source="manual",
            timezone="UTC",
            distance_m=Decimal(0),
            temporal_quality="manual",
            quality_summary={},
            metrics_version="manual",
        )
        db.add(manual)
        db.commit()
        activities.append({"id": str(manual.id), "distance_m": "0"})

    shoe_id = create_shoe(a)["id"]
    url = f"{SHOES}/{shoe_id}"
    for activity in activities:
        path = binding(activity["id"])
        assert a.get(path).json()["data"]["shoe"] is None
        assert a.patch(path, json={"shoe_id": shoe_id}, headers=headers(a)).status_code == 200
    enriched = send(a, raw=track(), enrich_activity_id=activities[0]["id"])
    assert enriched.status_code == 201, enriched.text
    result = a.get(url).json()["data"]
    assert result["activity_count"] == 4
    assert Decimal(result["activity_distance_m"]) == sum(
        Decimal(activity["distance_m"]) for activity in activities
    )
    assert a.get(f"{url}/activities?limit=2&offset=2").json()["data"]["total"] == 4


@pytest.mark.parametrize(
    ("distance", "expected"),
    [("899.999", None), ("900", "near"), ("999.999", "near"), ("1000", "due")],
)
def test_exact_reminder_boundaries(clients, distance, expected):
    a, _, _, _ = clients
    register(a)
    assert (
        create_shoe(a, initial_distance_m=distance, replacement_distance_m="1000")["reminder"]
        == expected
    )


def test_downgrade_rejects_existing_shoes(clients):
    a, _, engine, _ = clients
    register(a)
    shoe = create_shoe(a)
    assert_downgrade_guard(
        engine, "0031_shoes", "Refusing to drop shoes or existing activity bindings"
    )
    assert a.get(f"{SHOES}/{shoe['id']}").json()["data"] == shoe


def test_public_views_shares_and_ai_do_not_include_bound_shoes(clients):
    client, visitor, _, app = clients
    register(client)
    visitor.app.state.settings.site_owner_email = app.state.settings.site_owner_email
    identifier = upload(client).json()["data"]["activity"]["id"]
    shoe = create_shoe(client, name="Unique synthetic shoe", notes="Unique synthetic shoe note")
    result = client.patch(
        binding(identifier), json={"shoe_id": shoe["id"]}, headers=headers(client)
    )
    assert result.status_code == 200
    private_path = f"/api/v1/activities/{identifier}"
    response = client.patch(private_path, json={"visibility": "public"}, headers=headers(client))
    assert response.status_code == 200
    share = client.post(f"{private_path}/shares", json={}, headers=headers(client))
    assert share.status_code == 201
    token = share.json()["data"]["share_url"].rsplit("/", 1)[1]
    username = client.get("/api/v1/me").json()["data"]["username"]
    for response in (
        visitor.get(f"/api/v1/showcase/activities/{identifier}"),
        visitor.get(f"/api/v1/showcase/users/{username}/activities/{identifier}"),
        visitor.get(f"/api/v1/public/activities/{identifier}"),
        visitor.get(f"/api/v1/shared/{token}"),
        client.get("/api/v1/ai-reports/context"),
    ):
        assert response.status_code == 200, response.text
        assert "shoe_id" not in response.text
        assert shoe["id"] not in response.text
        assert "Unique synthetic shoe" not in response.text
