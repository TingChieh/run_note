"""The committed frontend contract must match the backend schemas (no database)."""

import pytest

from app.contract import typescript


def test_generated_frontend_contract_is_current():
    expected = typescript.render(typescript.build_spec())
    assert typescript.OUTPUT.read_text() == expected, (
        "frontend/src/lib/api/generated/api.ts is stale: run "
        "`cd backend && .venv/bin/python -m app.contract.typescript`, then `pnpm check` in "
        "frontend/ to see which frontend types no longer fit"
    )


def spec(schemas, *, body=None, data=None):
    operation = {"responses": {"200": {"content": {"application/json": {"schema": {}}}}}}
    if body:
        operation["requestBody"] = {"content": {"application/json": {"schema": body}}}
    if data:
        schemas["ApiResponse_X_"] = {
            "properties": {"data": {"anyOf": [data, {"type": "null"}]}},
            "type": "object",
        }
        operation["responses"]["200"]["content"]["application/json"]["schema"] = {
            "$ref": "#/components/schemas/ApiResponse_X_"
        }
    schemas.setdefault("ErrorInfo", {"type": "object", "properties": {"code": {"type": "string"}}})
    schemas.setdefault("ResponseMeta", {"type": "object", "properties": {}})
    return {"paths": {"/api/v1/x": {"post": operation}}, "components": {"schemas": schemas}}


def ref(name):
    return {"$ref": f"#/components/schemas/{name}"}


def test_response_fields_are_required_and_request_fields_follow_the_schema():
    schemas = {
        "Out": {
            "type": "object",
            "properties": {"flag": {"type": "boolean", "default": False}},
            "required": [],
        },
        "In": {
            "type": "object",
            "properties": {"a": {"type": "string"}, "b": {"type": "integer"}},
            "required": ["a"],
        },
    }
    text = typescript.render(spec(schemas, body=ref("In"), data=ref("Out")))
    assert "export interface Out {\n  flag: boolean;\n}" in text  # always serialised
    assert "export interface In {\n  a: string;\n  b?: number;\n}" in text
    assert "post: { body: In; response: Out };" in text
    assert "'/api/v1/x': {\n    post: [],\n  }," in text


def test_unsupported_schema_keywords_fail_instead_of_degrading():
    schemas = {"Out": {"oneOf": [{"type": "string"}, {"type": "integer"}]}}
    with pytest.raises(ValueError, match="unsupported JSON Schema keywords"):
        typescript.render(spec(schemas, data=ref("Out")))


def test_colliding_class_names_get_module_prefixes():
    assert typescript.type_name("app__modules__statistics__schema__Trends") == "StatisticsTrends"
    assert typescript.type_name("app__modules__wellbeing__schema__Trends") == "WellbeingTrends"
    assert typescript.type_name("ActivityView") == "ActivityView"


def test_fixed_length_arrays_become_tuples():
    lon_lat = {"type": "array", "prefixItems": [{"type": "number"}, {"type": "number"}]}
    schemas = {
        "Out": {
            "type": "object",
            "properties": {"at": lon_lat, "path": {"type": "array", "items": lon_lat}},
        }
    }
    text = typescript.render(spec(schemas, data=ref("Out")))
    assert "  at: [number, number];\n  path: ([number, number])[];" in text
