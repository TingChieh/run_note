"""Executable form of the backend rules in AGENTS.md (sections 3, 4, 6 and 8).

No database. Each allow-list below is a frozen record of existing exceptions: a new route,
schema or migration that breaks a rule fails here, and an entry that no longer matches anything
fails too, so the lists only shrink. Fix the code instead of extending a list; if an exception is
truly intended, add it with the reason next to it.
"""

import ast
import importlib
import inspect
import re
import tokenize
import typing
from pathlib import Path

import pytest
from fastapi import APIRouter
from fastapi.routing import APIRoute, iter_route_contexts
from pydantic import BaseModel

from app.api import dependencies as deps
from app.core.config import Settings
from app.core.errors import ApiError
from app.modules.users.schema import StrictInput

BACKEND = Path(__file__).resolve().parents[2]
APP = BACKEND / "app"
MODULES = APP / "modules"
VERSIONS = BACKEND / "migrations" / "versions"

AUTH = {
    deps.get_identity,
    deps.get_read_identity,
    deps.require_write,
    deps.require_admin,
    deps.require_admin_write,
}
CSRF = {deps.require_write, deps.require_admin_write}

# Routes reachable without a session. Public data routes must use their own whitelist schemas.
ANONYMOUS_PREFIXES = (
    "/api/v1/showcase/",  # site owner / showcase-enabled users (AGENTS.md section 8)
    "/api/v1/public/",  # legacy summary sharing, visibility == "public" only
)
ANONYMOUS_ROUTES = {
    ("GET", "/api/health"),
    ("GET", "/api/v1/health/live"),
    ("GET", "/api/v1/health/ready"),
    ("GET", "/api/v1/auth/csrf"),
    ("POST", "/api/v1/auth/login"),
    ("POST", "/api/v1/auth/register"),  # always 403 REGISTRATION_DISABLED
    ("GET", "/api/v1/shared/{token}"),
    ("GET", "/api/v1/site"),
    ("GET", "/api/v1/site/images/{kind}"),
    ("GET", "/api/v1/together"),  # docs/84: opt-in participants only
    ("GET", "/api/v1/together/feed"),
}
# Anonymous routes that answer with the caller's own account rather than public data.
SELF_SERVICE = {"/api/v1/auth/csrf", "/api/v1/auth/login", "/api/v1/auth/register"}
# Pre-session writes: protected by the Origin check and rate limits instead of a CSRF token.
WRITES_WITHOUT_CSRF = {("POST", "/api/v1/auth/login"), ("POST", "/api/v1/auth/register")}
# Request bodies that are not StrictInput subclasses.
NON_STRICT_BODIES = {"ReportCreate"}  # extra="forbid"; strict only on the consent flag
# Routes that answer with bytes (images, CSV) instead of a JSON envelope.
BINARY_ROUTES = {
    ("GET", "/api/v1/me/avatar"),
    ("GET", "/api/v1/showcase/avatar"),
    ("GET", "/api/v1/showcase/users/{username}/avatar"),
    ("GET", "/api/v1/site/images/{kind}"),
    ("GET", "/api/v1/me/wellbeing/report.csv"),
    ("GET", "/api/v1/me/activities/{identifier}/diary/photos/{photo_id}"),
}
# async endpoints must hand blocking work to run_in_threadpool (AGENTS.md section 3).
ASYNC_ENDPOINTS = {
    "app.modules.gpx.router.import_gpx",
    "app.modules.tcx.router.import_tcx",
    "app.modules.mifitness.router.import_mifitness",
    "app.modules.users.router.upload_avatar",
    "app.modules.site_settings.router.upload",
    "app.modules.running_diary.router.upload_photo",
}
# Each signed-in route that addresses a resource by id (longest matching prefix) names the
# integration test proving another user's id answers 404 and changes nothing.
CROSS_USER_TESTS = {
    "/api/v1/me/activities/{identifier}/diary": (
        "test_running_diary.py::test_other_users_cannot_access_diary_or_photos"
    ),
    "/api/v1/me/footprints/exploration/{scope}/{code}": (
        "test_city_exploration.py::test_exploration_is_owner_only_and_private"
    ),
    "/api/v1/me/shoes/{identifier}": (
        "test_shoes.py::test_other_users_cannot_access_shoes_or_bindings"
    ),
    "/api/v1/me/activities/{identifier}/shoe": (
        "test_shoes.py::test_other_users_cannot_access_shoes_or_bindings"
    ),
    "/api/v1/activities/{identifier}": (
        "test_cross_user_access.py::test_other_users_activity_ids_answer_404_and_change_nothing"
    ),
    "/api/v1/routes/groups/{identifier}": (
        "test_route_groups.py::test_detail_lists_runs_newest_first_and_other_owners_get_404"
    ),
    "/api/v1/ai-reports/{identifier}": (
        "test_ai_reports.py::test_end_to_end_snapshot_isolation_and_idempotency"
    ),
    "/api/v1/me/wellbeing/days/{day}": (
        "test_wellbeing_privacy.py::test_other_user_cannot_read_or_change_journal_by_date_or_id"
    ),
    "/api/v1/me/wellbeing/doses/{identifier}": (
        "test_wellbeing.py::test_users_cannot_read_or_change_each_others_records_and_get_404_not_403"
    ),
    "/api/v1/me/wellbeing/symptoms/{identifier}": (
        "test_wellbeing.py::test_users_cannot_read_or_change_each_others_records_and_get_404_not_403"
    ),
    "/api/v1/me/wellbeing/medications/{identifier}": (
        "test_wellbeing_privacy.py::test_other_user_cannot_change_medication_stock_or_symptom_names"
    ),
    "/api/v1/me/wellbeing/symptom-names/{identifier}": (
        "test_wellbeing_privacy.py::test_other_user_cannot_change_medication_stock_or_symptom_names"
    ),
}
# Path parameters that pick from the caller's own data instead of naming a resource.
OWN_SCOPE_PARAMS = {"period"}  # /me/running-goals/{period}
# Field names that must never appear in a public (anonymous, non-self-service) response.
PRIVATE_FIELDS = {
    "diary",
    "photos",
    "rpe",
    "weather",
    "shoe",
    "shoe_id",
    "initial_distance_m",
    "replacement_distance_m",
    "email",
    "email_normalized",
    "password",
    "password_hash",
    "notes",
    "note",
    "filename",
    "original_filename",
    "raw",
    "raw_bytes",
    "token_hash",
    "csrf_token",
    "medication_name",
    "medications",
    "symptom",
    "symptoms",
    "mood",
    "anxiety",
    "is_admin",
}
# Revision ids that predate the "revision == file name" convention; renaming them would break
# databases that already record them in alembic_version.
LEGACY_REVISION_IDS = {"0001_enable_postgis": "0001_postgis"}
# Downgrades written before the "defensive downgrade" rule; they drop data unconditionally.
LEGACY_DESTRUCTIVE_DOWNGRADES = {
    "0002_auth",
    "0003_gpx_storage",
    "0004_public_sharing",
    "0005_ai_reports",
    "0006_running_goals",
}


def python_files(root: Path):
    return sorted(path for path in root.rglob("*.py") if "__pycache__" not in path.parts)


def parse(path: Path) -> ast.Module:
    return ast.parse(path.read_text(), filename=str(path))


def rel(path: Path) -> str:
    return str(path.relative_to(BACKEND))


def mentions(root: Path, name: str) -> list[str]:
    """Places under root that use or import `name`."""
    return [
        f"{rel(path)}:{node.lineno}"
        for path in python_files(root)
        for node in ast.walk(parse(path))
        if (isinstance(node, ast.Name) and node.id == name)
        or (isinstance(node, ast.ImportFrom) and any(a.name == name for a in node.names))
    ]


@pytest.fixture(scope="module")
def routes():
    from app.main import create_app

    url = "postgresql+psycopg://arch@127.0.0.1:1/arch_unused_test"  # never connected
    app = create_app(Settings(database_url=url, _env_file=None))
    found = []
    for context in iter_route_contexts(app.routes):
        if isinstance(context.route, APIRoute):
            for method in sorted(context.route.methods):
                found.append((method, context.path, context.route))
    assert len(found) > 100
    return found


def dependency_calls(dependant, found=None):
    found = set() if found is None else found
    for sub in dependant.dependencies:
        found.add(sub.call)
        dependency_calls(sub, found)
    return found


def anonymous(path: str, method: str) -> bool:
    return path.startswith(ANONYMOUS_PREFIXES) or (method, path) in ANONYMOUS_ROUTES


def models_in(annotation, seen):
    if isinstance(annotation, type) and issubclass(annotation, BaseModel):
        if annotation not in seen:
            seen.add(annotation)
            for field in annotation.model_fields.values():
                models_in(field.annotation, seen)
    for arg in typing.get_args(annotation):
        models_in(arg, seen)
    return seen


def test_every_module_router_is_included_in_the_app(routes):
    served = {route.endpoint for _, _, route in routes}
    missing = []
    for path in sorted(MODULES.glob("*/router.py")):
        module = importlib.import_module(f"app.modules.{path.parent.name}.router")
        for name, value in vars(module).items():
            if isinstance(value, APIRouter):
                missing += [
                    f"{module.__name__}.{name} {sorted(r.methods)} {r.path}"
                    for r in value.routes
                    if isinstance(r, APIRoute) and r.endpoint not in served
                ]
    assert not missing, f"routers not registered with include_router in app/main.py: {missing}"


def test_every_mapped_model_is_registered_in_app_models():
    import app.models as registry

    missing = []
    for path in sorted(MODULES.glob("*/model.py")):
        module = importlib.import_module(f"app.modules.{path.parent.name}.model")
        for name, value in vars(module).items():
            if (
                isinstance(value, type)
                and value.__module__ == module.__name__
                and hasattr(value, "__tablename__")
                and getattr(registry, name, None) is not value
            ):
                missing.append(f"{module.__name__}.{name}")
    assert not missing, f"import these in app/models/__init__.py: {missing}"


def test_app_startup_imports_the_model_registry():
    # A side-effect import: lint auto-fixes see it as unused and would delete it.
    imports = [
        alias.name
        for node in parse(APP / "main.py").body
        if isinstance(node, ast.Import)
        for alias in node.names
    ]
    assert "app.models" in imports, "app/main.py must `import app.models` (ORM metadata)"


def test_module_packages_do_no_auto_registration():
    def docstring(node):
        return isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant)

    busy = [
        rel(p)
        for p in MODULES.glob("*/__init__.py")
        if any(not docstring(node) for node in parse(p).body)
    ]
    assert not busy, f"module __init__.py files must stay empty (a docstring is fine): {busy}"


def test_business_code_reads_time_from_the_app_clock():
    banned = {("datetime", "now"), ("datetime", "utcnow"), ("datetime", "today"), ("date", "today")}
    found = []
    for path in python_files(APP):
        if rel(path) == "app/core/security.py":  # utc_now, the clock installed on app.state
            continue
        for node in ast.walk(parse(path)):
            if (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Attribute)
                and isinstance(node.func.value, ast.Name)
                and (node.func.value.id, node.func.attr) in banned
            ):
                found.append(f"{rel(path)}:{node.lineno}")
    assert not found, f"use request.app.state.clock() instead: {found}"


def test_models_do_not_use_orm_relationships():
    found = mentions(APP, "relationship")
    assert not found, f"join explicitly in queries instead of relationship(): {found}"


def test_envelope_is_defined_once_per_known_module():
    defined = sorted(
        rel(path)
        for path in python_files(APP)
        for node in parse(path).body
        if isinstance(node, ast.FunctionDef) and node.name == "envelope"
    )
    assert defined == ["app/modules/activities/router.py", "app/modules/auth/router.py"]


def test_patch_handlers_never_use_exclude_none():
    found = [
        f"{rel(path)}:{node.lineno}"
        for path in python_files(APP)
        for node in ast.walk(parse(path))
        if isinstance(node, ast.keyword) and node.arg == "exclude_none"
    ]
    assert not found, f"use model_dump(exclude_unset=True) for PATCH: {found}"


def api_error_calls():
    for path in python_files(APP):
        for node in ast.walk(parse(path)):
            if isinstance(node, ast.Call) and getattr(node.func, "id", None) == "ApiError":
                yield path, node


def test_error_codes_are_upper_snake_case():
    bad = []
    for path, call in api_error_calls():
        if len(call.args) >= 2 and isinstance(call.args[1], ast.Constant):
            if not re.fullmatch(r"[A-Z][A-Z0-9_]+", call.args[1].value):
                bad.append(f"{rel(path)}:{call.lineno} {call.args[1].value!r}")
    assert not bad


def test_error_detail_keys_survive_the_allow_list():
    keys = set()
    for _, call in api_error_calls():
        for keyword in call.keywords:
            if keyword.arg == "details":
                for node in ast.walk(keyword.value):
                    if isinstance(node, ast.Dict):
                        keys |= {k.value for k in node.keys if isinstance(k, ast.Constant)}
    assert keys, "expected at least one ApiError(details=...) call"
    dropped = sorted(k for k in keys if not ApiError(400, "X", "x", details=[{k: "v"}]).details[0])
    assert not dropped, f"add to `allowed` in ApiError.__init__ (app/core/errors.py): {dropped}"


def test_private_wellbeing_module_is_not_imported_elsewhere():
    allowed = {"app/main.py", "app/models/__init__.py"}
    found = []
    for path in python_files(APP):
        if rel(path).startswith("app/modules/wellbeing/") or rel(path) in allowed:
            continue
        for node in ast.walk(parse(path)):
            names = (
                [node.module or ""]
                if isinstance(node, ast.ImportFrom)
                else [a.name for a in node.names]
                if isinstance(node, ast.Import)
                else []
            )
            found += [f"{rel(path)}:{node.lineno}" for n in names if "wellbeing" in n]
    assert not found, f"wellbeing data must not reach other modules (AGENTS.md section 8): {found}"


def test_wellbeing_writes_do_not_lock_the_owner():
    assert not mentions(MODULES / "wellbeing", "lock_owner")


def comments(path: Path):
    with path.open("rb") as handle:
        for token in tokenize.tokenize(handle.readline):
            if token.type == tokenize.COMMENT:
                yield token.start[0], token.string


def test_markers_name_an_issue_and_suppressions_say_why():
    """AGENTS.md "注释": a TODO/FIXME/HACK/XXX links a tracked issue (`TODO(#12)`), and a noqa
    states its reason after the codes. Unneeded noqa comments already fail ruff (RUF100)."""
    marker = re.compile(r"\b(TODO|FIXME|HACK|XXX)\b(?!\(#\d+\))")
    bare_noqa = re.compile(r"#\s*noqa(:\s*[A-Z0-9, ]+)?\s*$")
    roots = [APP, BACKEND / "migrations", BACKEND / "tests", BACKEND.parent / "scripts"]
    found = [
        f"{path.relative_to(BACKEND.parent)}:{line}: {text}"
        for root in roots
        for path in python_files(root)
        for line, text in comments(path)
        if marker.search(text) or bare_noqa.search(text)
    ]
    assert not found, f"link an issue, fix the cause, or explain the suppression: {found}"


def test_only_listed_routes_are_reachable_without_a_session(routes):
    unexpected = [
        f"{method} {path}"
        for method, path, route in routes
        if not dependency_calls(route.dependant) & AUTH and not anonymous(path, method)
    ]
    assert not unexpected, (
        "add an identity dependency, or if the route is public by design list it in "
        f"ANONYMOUS_ROUTES with a privacy test: {unexpected}"
    )
    authenticated = [
        f"{method} {path}"
        for method, path, route in routes
        if dependency_calls(route.dependant) & AUTH and (method, path) in ANONYMOUS_ROUTES
    ]
    assert not authenticated, f"stale ANONYMOUS_ROUTES entries: {authenticated}"


def test_every_write_requires_a_csrf_checked_identity(routes):
    missing = [
        f"{method} {path}"
        for method, path, route in routes
        if method != "GET"
        and (method, path) not in WRITES_WITHOUT_CSRF
        and not dependency_calls(route.dependant) & CSRF
    ]
    assert not missing, f"use require_write / require_admin_write: {missing}"


def test_admin_routes_require_the_site_owner(routes):
    missing = [
        f"{method} {path}"
        for method, path, route in routes
        if (
            path.startswith("/api/v1/admin/")
            or (path.startswith("/api/v1/site") and method != "GET")
        )
        and deps.require_admin not in dependency_calls(route.dependant)
    ]
    assert not missing, f"use require_admin / require_admin_write: {missing}"


def test_every_id_route_names_its_cross_user_test(routes):
    integration = BACKEND / "tests" / "integration"
    uncovered, broken = [], []
    for method, path, route in routes:
        calls = dependency_calls(route.dependant)
        params = set(re.findall(r"\{(\w+)\}", path))
        if not calls & AUTH or deps.require_admin in calls or params <= OWN_SCOPE_PARAMS:
            continue
        prefixes = [p for p in CROSS_USER_TESTS if path == p or path.startswith(p + "/")]
        if not prefixes:
            uncovered.append(f"{method} {path}")
    for reference in set(CROSS_USER_TESTS.values()):
        file, name = reference.split("::")
        tree = parse(integration / file)
        if not any(isinstance(n, ast.FunctionDef) and n.name == name for n in tree.body):
            broken.append(reference)
    assert not uncovered, (
        "write an integration test where another user's id answers 404 and changes nothing, "
        f"then list it in CROSS_USER_TESTS: {uncovered}"
    )
    assert not broken, f"CROSS_USER_TESTS points at missing tests: {broken}"


def test_request_bodies_reject_unknown_fields(routes):
    bad = []
    for method, path, route in routes:
        if route.body_field is None:
            continue
        annotation = route.body_field.field_info.annotation
        candidates = (annotation, *typing.get_args(annotation))
        for model in [a for a in candidates if isinstance(a, type) and a is not type(None)]:
            if model.__name__ in NON_STRICT_BODIES:
                assert model.model_config.get("extra") == "forbid"
            elif not issubclass(model, StrictInput):
                bad.append(f"{method} {path} {model.__name__}")
    assert not bad, f"request bodies must inherit StrictInput: {bad}"


def untyped(route) -> bool:
    if route.response_model is None:
        return True
    data = route.response_model.model_fields.get("data")
    annotation = data.annotation if data else None
    return any(a is dict or typing.get_origin(a) is dict for a in typing.get_args(annotation))


def test_json_routes_declare_a_typed_response_model(routes):
    untyped_routes = {(m, p) for m, p, route in routes if untyped(route)}
    new = untyped_routes - BINARY_ROUTES
    assert not new, f"declare response_model=ApiResponse[<model>] (not dict): {new}"
    assert not BINARY_ROUTES - untyped_routes, (
        f"stale BINARY_ROUTES: {BINARY_ROUTES - untyped_routes}"
    )


def test_async_endpoints_are_reviewed_upload_handlers(routes):
    found = {
        f"{route.endpoint.__module__}.{route.endpoint.__name__}"
        for _, _, route in routes
        if inspect.iscoroutinefunction(route.endpoint)
    }
    assert found == ASYNC_ENDPOINTS, (
        "use `def` (FastAPI runs it in the thread pool); async handlers must offload blocking work "
        f"with run_in_threadpool. new: {sorted(found - ASYNC_ENDPOINTS)}, "
        f"stale: {sorted(ASYNC_ENDPOINTS - found)}"
    )


def test_public_responses_never_carry_private_fields(routes):
    from app.modules.wellbeing import schema as wellbeing_schema

    journal = {v for v in vars(wellbeing_schema).values() if isinstance(v, type)}
    leaks, checked = [], 0
    for method, path, route in routes:
        if not anonymous(path, method) or path in SELF_SERVICE or route.response_model is None:
            continue
        checked += 1
        for model in models_in(route.response_model, set()):
            if model in journal:
                leaks.append(f"{method} {path}: wellbeing schema {model.__name__}")
            leaks += [
                f"{method} {path}: {model.__name__}.{name}"
                for name in model.model_fields
                if name in PRIVATE_FIELDS
            ]
    assert checked > 30
    assert not leaks, f"public responses need their own whitelist schema: {leaks}"


def migrations():
    found = []
    for path in sorted(VERSIONS.glob("*.py")):
        values = {}
        downgrade = None
        for node in parse(path).body:
            if isinstance(node, ast.Assign) and isinstance(node.value, ast.Constant):
                for target in node.targets:
                    if isinstance(target, ast.Name):
                        values[target.id] = node.value.value
            if isinstance(node, ast.FunctionDef) and node.name == "downgrade":
                downgrade = ast.get_source_segment(path.read_text(), node)
        found.append((path.stem, values, downgrade or ""))
    return found


def test_migrations_are_named_and_chained_in_order():
    previous = None
    for index, (stem, values, _) in enumerate(migrations(), start=1):
        assert re.fullmatch(r"\d{4}_[a-z0-9_]+", stem), stem
        assert int(stem[:4]) == index, f"{stem}: expected sequence number {index:04d}"
        revision = LEGACY_REVISION_IDS.get(stem, stem)
        assert values.get("revision") == revision, f"{stem}: revision must equal the file name"
        assert values.get("down_revision") == previous, f"{stem}: down_revision must be {previous}"
        previous = revision


def test_destructive_downgrades_refuse_to_drop_data():
    destructive = re.compile(r"drop_table|drop_column|DROP TABLE|DROP COLUMN", re.I)
    unguarded = {
        stem
        for stem, _, downgrade in migrations()
        if destructive.search(downgrade) and "RuntimeError" not in downgrade
    }
    assert unguarded == LEGACY_DESTRUCTIVE_DOWNGRADES, (
        "a downgrade that drops tables/columns must raise RuntimeError while data exists: "
        f"{sorted(unguarded - LEGACY_DESTRUCTIVE_DOWNGRADES)}"
    )
