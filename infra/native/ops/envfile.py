#!/usr/bin/env python3
"""Load a systemd-style EnvironmentFile without a shell, then check it or exec a command.

Why not `source`: JSON values such as AUTH_TRUSTED_PROXIES contain quotes and brackets
that a shell would rewrite, and a sourced file executes code. Values are never printed.

  envfile.py check FILE [--kind backend|frontend] [--skip-settings]
                        [--expect-db-name N] [--expect-db-user U] [--expect-origin-host H]
                        [--expect-api-port P]
  envfile.py exec FILE -- CMD [ARGS...]
"""

import os
import stat
import sys
from urllib.parse import urlsplit

PLACEHOLDER = "CHANGE_ME"


def parse(text: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for number, raw in enumerate(text.splitlines(), 1):
        line = raw.strip()
        if not line or line[0] in "#;":
            continue
        key, sep, value = line.partition("=")
        key = key.strip()
        if not sep or not key.isidentifier():
            raise ValueError(f"line {number}: expected KEY=VALUE")
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
            value = value[1:-1]
        values[key] = value
    return values


def load(path: str) -> dict[str, str]:
    with open(path, encoding="utf-8") as handle:
        return parse(handle.read())


def mode_problems(path: str) -> list[str]:
    mode = stat.S_IMODE(os.stat(path).st_mode)
    problems = []
    if mode & stat.S_IRWXO:
        problems.append("must not be accessible by 'other' (use 0600 or 0640)")
    if mode & stat.S_IWGRP:
        problems.append("must not be group-writable")
    return problems


def check_backend(values: dict[str, str]) -> list[str]:
    problems = []
    for key, value in values.items():
        if PLACEHOLDER in value:
            problems.append(f"{key} still contains the {PLACEHOLDER} placeholder")
    if values.get("APP_ENV") != "production":
        problems.append("APP_ENV must be production")
    proxies = values.get("AUTH_TRUSTED_PROXIES", "")
    if "127.0.0.1" not in proxies:
        problems.append(
            "AUTH_TRUSTED_PROXIES must include 127.0.0.1 (Caddy peer); "
            "otherwise every visitor shares one login rate-limit bucket"
        )
    host = ""
    url = values.get("DATABASE_URL", "")
    if "@" in url:
        host = url.rsplit("@", 1)[1].split("/", 1)[0].rsplit(":", 1)[0]
    if host and host not in {"127.0.0.1", "localhost", "[::1]"}:
        problems.append("DATABASE_URL host should be loopback for the single-host layout")
    for forbidden in ("TEST_DATABASE_URL", "TEST_DATABASE_ALLOWED_TARGETS"):
        if values.get(forbidden):
            problems.append(f"{forbidden} must not be set in production")
    if any(key.startswith("PUBLIC_") for key in values):
        problems.append("secrets and server settings must never use a PUBLIC_ prefix")
    return problems


def validate_settings(values: dict[str, str]) -> list[str]:
    # Reuse the application's own validators; hide_input_in_errors keeps values out of errors.
    for key in list(os.environ):
        if key.isupper() and key in values:
            del os.environ[key]
    os.environ.update(values)
    try:
        from app.core.config import Settings

        Settings(_env_file=None)
    except Exception as error:  # noqa: BLE001 - report class and field names only
        fields = ""
        if hasattr(error, "errors"):
            fields = ", ".join(
                ".".join(str(p) for p in item.get("loc", ())) for item in error.errors()
            )
        detail = fields or "see validators"
        return [f"Settings validation failed ({type(error).__name__}: {detail})"]
    return []


def option(argv: list[str], name: str) -> str | None:
    return argv[argv.index(name) + 1] if name in argv and argv.index(name) + 1 < len(argv) else None


def instance_problems(values: dict[str, str], kind: str, argv: list[str]) -> list[str]:
    """Tie an instance's env files to its own definition, so one instance can never be pointed at
    another one's database, role, origin or API port. Only names and ports are ever echoed."""
    problems = []
    if kind == "backend":
        url = urlsplit(values.get("DATABASE_URL", "").replace("+psycopg", "", 1))
        name, user = option(argv, "--expect-db-name"), option(argv, "--expect-db-user")
        if name is not None and url.path.lstrip("/") != name:
            problems.append(
                f"DATABASE_URL must use the instance database '{name}', "
                f"not '{url.path.lstrip('/')}'"
            )
        if user is not None and (url.username or "") != user:
            problems.append(
                f"DATABASE_URL must log in as the instance role '{user}', not '{url.username}'"
            )
        host = option(argv, "--expect-origin-host")
        if host is not None and (urlsplit(values.get("SITE_ORIGIN", "")).hostname or "") != host:
            problems.append(f"SITE_ORIGIN must be https://{host}")
    elif kind == "frontend":
        port = option(argv, "--expect-api-port")
        if port is not None and urlsplit(values.get("INTERNAL_API_BASE_URL", "")).port != int(port):
            problems.append(f"INTERNAL_API_BASE_URL must point at the instance API port {port}")
    return problems


def main(argv: list[str]) -> int:
    if len(argv) < 3 or argv[1] not in {"check", "exec"}:
        print(__doc__)
        return 2
    action, path = argv[1], argv[2]
    try:
        values = load(path)
    except (OSError, ValueError) as error:
        print(f"cannot read {path}: {error}", file=sys.stderr)
        return 1
    if action == "exec":
        if "--" not in argv:
            print("exec requires -- CMD", file=sys.stderr)
            return 2
        command = argv[argv.index("--") + 1 :]
        if not command:
            print("exec requires a command after --", file=sys.stderr)
            return 2
        os.environ.update(values)
        os.execvp(command[0], command)
    kind = "backend"
    if "--kind" in argv:
        kind = argv[argv.index("--kind") + 1]
    problems = [f"file {problem}" for problem in mode_problems(path)]
    if kind == "backend":
        problems += check_backend(values)
        if not problems and "--skip-settings" not in argv:
            problems += validate_settings(values)
    elif kind == "frontend":
        if "INTERNAL_API_BASE_URL" not in values:
            problems.append("INTERNAL_API_BASE_URL is required")
        if any(key.startswith(("AI_", "AUTH_", "DATABASE_")) for key in values):
            problems.append("frontend env must not contain backend secrets")
    problems += instance_problems(values, kind, argv)
    for problem in problems:
        print(f"FAIL {path}: {problem}", file=sys.stderr)
    if not problems:
        print(f"OK   {path} ({kind})", file=sys.stderr)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
