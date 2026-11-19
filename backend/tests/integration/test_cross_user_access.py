"""Another user's activity ids behave as if they did not exist (AGENTS.md section 4: 404, never
403, and nothing changes).

Routes are discovered from the app: a new /api/v1/activities/{identifier}... route fails here until
it has a request body in BODIES and answers 404 for a foreign id.
"""

import pytest
from fastapi.routing import APIRoute, iter_route_contexts

from tests.conftest import headers, register, upload

pytestmark = pytest.mark.integration

PREFIX = "/api/v1/activities/{identifier}"
TITLE = "A 的私人记录"
BODIES = {
    ("PATCH", PREFIX): {"title": "改名", "visibility": "public"},
    ("POST", PREFIX + "/shares"): {},
}


def activity_routes(app):
    for context in iter_route_contexts(app.routes):
        if isinstance(context.route, APIRoute) and context.path.startswith(PREFIX):
            for method in context.route.methods:
                yield method, context.path


def snapshot(client, identifier):
    base = f"/api/v1/activities/{identifier}"
    return [client.get(path).json()["data"] for path in (base, base + "/route", base + "/shares")]


def test_other_users_activity_ids_answer_404_and_change_nothing(clients):
    a, b, _, app = clients
    register(a)
    register(b)
    identifier = upload(a).json()["data"]["activity"]["id"]
    changed = a.patch(
        f"/api/v1/activities/{identifier}",
        headers=headers(a),
        json={"visibility": "unlisted", "title": TITLE},
    )
    assert changed.status_code == 200, changed.text
    link = a.post(f"/api/v1/activities/{identifier}/shares", headers=headers(a), json={})
    assert link.status_code == 201, link.text
    link_id = link.json()["data"]["link_id"]
    before = snapshot(a, identifier)

    routes = sorted(set(activity_routes(app)))
    assert len(routes) >= 7, routes
    for method, path in routes:
        url = path.replace("{identifier}", identifier).replace("{link_id}", str(link_id))
        assert "{" not in url, f"give {path} a value for its path parameter"
        options = {} if method == "GET" else {"headers": headers(b)}
        if method in {"POST", "PUT", "PATCH"}:
            assert (method, path) in BODIES, f"add a valid body for {method} {path} to BODIES"
            options["json"] = BODIES[(method, path)]
        response = b.request(method, url, **options)
        assert response.status_code == 404, (method, path, response.status_code, response.text)
        assert TITLE not in response.text

    # Ids in a request body follow the same rule as ids in the path.
    batch = b.post(
        "/api/v1/activities/batch-delete", headers=headers(b), json={"ids": [identifier]}
    )
    assert batch.status_code == 404, batch.text
    assert TITLE not in b.get("/api/v1/activities").text

    assert snapshot(a, identifier) == before
