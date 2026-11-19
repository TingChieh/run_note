"""Generate the frontend's TypeScript view of the API from the FastAPI OpenAPI document.

  .venv/bin/python -m app.contract.typescript          rewrite frontend/src/lib/api/generated/api.ts
  .venv/bin/python -m app.contract.typescript --check  exit 1 when the committed file is stale

The backend schemas are the single source of truth; the generated file is committed so the
frontend can type-check without Python, and tests/unit/test_api_contract.py fails when it drifts.

Pydantic serialises every field of a response model, so properties of schemas reached from a
response are emitted as required; request-side schemas follow the schema's `required` list.
Unsupported JSON Schema constructs raise instead of degrading to `unknown` silently.
"""

import argparse
import json
import re
import sys
from pathlib import Path

from fastapi.routing import APIRoute, iter_route_contexts

from app.core.config import Settings

OUTPUT = Path(__file__).resolve().parents[3] / "frontend/src/lib/api/generated/api.ts"
# Never connected: building the app only needs a syntactically valid URL.
DUMMY_DATABASE_URL = "postgresql+psycopg://contract@127.0.0.1:1/contract_unused_test"
ENVELOPE = re.compile(r"^(app__core__responses__)?ApiResponse_")
ANNOTATIONS = {
    "title",
    "description",
    "default",
    "format",
    "minLength",
    "maxLength",
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "pattern",
    "minItems",
    "maxItems",
    "examples",
    "deprecated",
}
STRUCTURE = {
    "$ref",
    "anyOf",
    "const",
    "enum",
    "type",
    "items",
    "prefixItems",
    "properties",
    "required",
    "additionalProperties",
}
TYPES = {
    "string": "string",
    "integer": "number",
    "number": "number",
    "boolean": "boolean",
    "null": "null",
}
IDENTIFIER = re.compile(r"^[A-Za-z_$][A-Za-z0-9_$]*$")
METHODS = ("get", "post", "put", "patch", "delete")


def build_spec() -> dict:
    from app.main import create_app

    app = create_app(Settings(database_url=DUMMY_DATABASE_URL, _env_file=None))
    for context in iter_route_contexts(app.routes):
        route = context.route
        if isinstance(route, APIRoute) and (
            route.response_model_exclude_unset
            or route.response_model_exclude_none
            or route.response_model_exclude_defaults
        ):
            # Response properties are emitted as required; exclusions would make that false.
            raise SystemExit(f"{context.path}: response_model_exclude_* is not supported")
    return app.openapi()


def type_name(schema_name: str) -> str:
    match = re.fullmatch(r"app__modules__(\w+?)__\w+?__(\w+)", schema_name)
    if match:  # same class name in two modules, e.g. statistics/wellbeing Trends
        module, name = match.groups()
        return "".join(part.capitalize() for part in module.split("_")) + name
    return re.sub(r"\W", "_", schema_name)


def ref_name(ref: str) -> str:
    return ref.removeprefix("#/components/schemas/")


def literal(value) -> str:
    if isinstance(value, str):
        return "'" + value.replace("\\", "\\\\").replace("'", "\\'") + "'"
    return json.dumps(value)


def union(parts: list[str]) -> str:
    unique = list(dict.fromkeys(parts))
    return " | ".join(unique) if unique else "never"


def key(name: str) -> str:
    return name if IDENTIFIER.match(name) else literal(name)


class Emitter:
    def __init__(self, schemas: dict, output_side: set[str]):
        self.schemas = schemas
        self.output_side = output_side

    def ts(self, schema: dict, output: bool, where: str) -> str:
        unknown = set(schema) - ANNOTATIONS - STRUCTURE
        if unknown:
            raise ValueError(f"{where}: unsupported JSON Schema keywords {sorted(unknown)}")
        if "$ref" in schema:
            name = ref_name(schema["$ref"])
            if ENVELOPE.match(name):
                raise ValueError(f"{where}: envelope schemas are only valid at the response root")
            return type_name(name)
        if "anyOf" in schema:
            return union([self.ts(part, output, where) for part in schema["anyOf"]])
        if "const" in schema:
            return literal(schema["const"])
        if "enum" in schema:
            return union([literal(value) for value in schema["enum"]])
        kind = schema.get("type")
        if kind is None:
            return "unknown"
        if isinstance(kind, list):
            return union([self.ts({**schema, "type": item}, output, where) for item in kind])
        if kind == "array" and "prefixItems" in schema:
            items = [self.ts(item, output, where) for item in schema["prefixItems"]]
            return "[" + ", ".join(items) + "]"
        if kind == "array":
            item = self.ts(schema.get("items", {}), output, where)
            return f"({item})[]" if " " in item else f"{item}[]"
        if kind == "object":
            return self.object(schema, output, where)
        if kind not in TYPES:
            raise ValueError(f"{where}: unsupported type {kind!r}")
        return TYPES[kind]

    def object(self, schema: dict, output: bool, where: str) -> str:
        properties = schema.get("properties")
        extra = schema.get("additionalProperties", not properties)
        if not properties:
            if extra is False:
                return "Record<string, never>"
            value = "unknown" if extra is True else self.ts(extra, output, where)
            return f"Record<string, {value}>"
        if extra not in (False, None) and "additionalProperties" in schema:
            raise ValueError(f"{where}: properties with additionalProperties are not supported")
        required = set(schema.get("required", []))
        fields = []
        for name, value in properties.items():
            optional = "" if output or name in required else "?"
            fields.append(f"{key(name)}{optional}: {self.ts(value, output, f'{where}.{name}')}")
        return "{ " + "; ".join(fields) + " }"

    def declaration(self, name: str) -> str:
        body = self.ts(self.schemas[name], name in self.output_side, name)
        if body.startswith("{ "):
            lines = "".join(f"  {field};\n" for field in split_fields(body))
            return f"export interface {type_name(name)} {{\n{lines}}}\n"
        return f"export type {type_name(name)} = {body};\n"


def split_fields(body: str) -> list[str]:
    """Split the top level of an inline object type, leaving nested objects intact."""
    inner, parts, depth, start = body[2:-2], [], 0, 0
    for index, char in enumerate(inner):
        if char in "{(<":
            depth += 1
        elif char in "})>":
            depth -= 1
        elif char == ";" and depth == 0 and inner[index : index + 2] == "; ":
            parts.append(inner[start:index])
            start = index + 2
    parts.append(inner[start:])
    return [part for part in parts if part]


def refs(schema, found: set[str]) -> set[str]:
    if isinstance(schema, dict):
        if "$ref" in schema:
            found.add(ref_name(schema["$ref"]))
        for value in schema.values():
            refs(value, found)
    elif isinstance(schema, list):
        for value in schema:
            refs(value, found)
    return found


def closure(names: set[str], schemas: dict) -> set[str]:
    seen, stack = set(), list(names)
    while stack:
        name = stack.pop()
        if name not in seen:
            seen.add(name)
            stack.extend(refs(schemas[name], set()) - seen)
    return seen


def success(operation: dict) -> dict:
    codes = sorted(code for code in operation.get("responses", {}) if code.startswith("2"))
    if not codes:
        return {}
    content = operation["responses"][codes[0]].get("content", {})
    return content.get("application/json", {}).get("schema", {})


def response_data(schema: dict, schemas: dict) -> dict | None:
    """The `data` schema of an enveloped response, or None when the route has no model."""
    if "$ref" not in schema or not ENVELOPE.match(ref_name(schema["$ref"])):
        return None
    data = schemas[ref_name(schema["$ref"])]["properties"]["data"]
    members = [part for part in data.get("anyOf", [data]) if part.get("type") != "null"]
    return members[0] if len(members) == 1 else {"anyOf": members}


def render(spec: dict) -> str:
    schemas = spec["components"]["schemas"]
    operations, input_roots, output_roots = [], set(), set()
    for path, item in sorted(spec["paths"].items()):
        for method in METHODS:
            if method not in item:
                continue
            operation = item[method]
            body = (
                operation.get("requestBody", {})
                .get("content", {})
                .get("application/json", {})
                .get("schema")
            )
            data = response_data(success(operation), schemas)
            query = sorted(p["name"] for p in operation.get("parameters", []) if p["in"] == "query")
            operations.append((path, method, body, data, query))
            input_roots |= refs(body, set()) if body else set()
            output_roots |= refs(data, set()) if data else set()
    output_side = closure(output_roots, schemas)
    input_side = closure(input_roots, schemas)
    both = output_side & input_side
    if both:
        raise ValueError(f"schemas used both as request and response: {sorted(both)}")
    emitter = Emitter(schemas, output_side)
    emitted = sorted(output_side | input_side | {"ErrorInfo", "ResponseMeta"}, key=type_name)

    out = [
        "// Generated by `backend/.venv/bin/python -m app.contract.typescript` from the FastAPI",
        "// OpenAPI document. Do not edit: change the backend schema and regenerate.",
        "",
    ]
    out += [emitter.declaration(name) for name in emitted]
    out.append(
        "export interface ApiEnvelope<T> {\n  data: T | null;\n  error: ErrorInfo | null;\n"
        "  meta: ResponseMeta;\n}\n"
    )
    out.append("export interface ApiOperations {")
    current = None
    for path, method, body, data, _ in operations:
        if path != current:
            if current is not None:
                out.append("  };")
            out.append(f"  {literal(path)}: {{")
            current = path
        response = emitter.ts(data, True, f"{method} {path}") if data else "unknown"
        request = emitter.ts(body, False, f"{method} {path} body") if body else "never"
        out.append(f"    {method}: {{ body: {request}; response: {response} }};")
    out += ["  };", "}", ""]
    out.append(
        "export type ApiPath = keyof ApiOperations;\n"
        "export type ResponseData<P extends ApiPath, M extends keyof ApiOperations[P]> =\n"
        "  ApiOperations[P][M] extends { response: infer R } ? R : never;\n"
        "export type RequestBody<P extends ApiPath, M extends keyof ApiOperations[P]> =\n"
        "  ApiOperations[P][M] extends { body: infer B } ? B : never;\n"
    )
    out.append("/** Each operation's accepted query parameter names (runtime drift checks). */")
    out.append("export const API_OPERATIONS = {")
    current = None
    for path, method, _, _, query in operations:
        if path != current:
            if current is not None:
                out.append("  },")
            out.append(f"  {literal(path)}: {{")
            current = path
        out.append(f"    {method}: [{', '.join(literal(name) for name in query)}],")
    out += ["  },", "} as const satisfies Record<string, Record<string, readonly string[]>>;", ""]
    return "\n".join(out)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true", help="fail when the file is stale")
    args = parser.parse_args(argv)
    text = render(build_spec())
    if args.check:
        if not OUTPUT.exists() or OUTPUT.read_text() != text:
            command = "cd backend && .venv/bin/python -m app.contract.typescript"
            print(f"{OUTPUT} is stale; run `{command}`", file=sys.stderr)
            return 1
        return 0
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(text)
    print(f"wrote {OUTPUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
