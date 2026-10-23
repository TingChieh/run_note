#!/usr/bin/env python3
"""Explicit configuration for running several Run Note instances on one host.

An instance is described by ONE root-owned, non-secret file, /etc/run-note-instances/NAME.conf,
that lists every name the instance uses (directories, system user and group, database and role,
ports, systemd unit names, domain, backup schedule). Nothing is derived from the instance name:
systemd's %i cannot express "unit foo, user bar, database baz", and a derivation rule that is
almost right is how one instance ends up reading another one's files.

The legacy single-instance layout (no RUNNOTE_INSTANCE) is the reserved set below. It is what the
existing staging host runs today, and it is never modified; a new instance may not reuse any of it.

  instance.py shellvars NAME [--dir DIR]          validated assignments for lib.sh (eval'd there)
  instance.py render (NAME | --legacy) --out OUT [--dir DIR] [--caddy-mode maintenance|live]
  instance.py check [--dir DIR]                   every conf in DIR is valid and disjoint
"""

import argparse
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_DIR = "/etc/run-note-instances"

REQUIRED = (
    "INSTANCE",
    "DOMAIN",
    "ROOT",
    "ETC",
    "BACKUP_DIR",
    "APP_USER",
    "APP_GROUP",
    "DB_NAME",
    "DB_ROLE",
    "API_PORT",
    "WEB_PORT",
    "SERVICE_API",
    "SERVICE_WEB",
    "SERVICE_BACKUP",
    "BACKUP_ONCALENDAR",
    "BACKUP_RANDOM_DELAY",
)

# What the existing (staging) installation uses. Reserved: no instance may collide with it.
LEGACY = {
    "INSTANCE": "legacy",
    "DOMAIN": "legacy.invalid",
    "ROOT": "/opt/run-note",
    "ETC": "/etc/run-note",
    "BACKUP_DIR": "/var/backups/run-note",
    "APP_USER": "runnote",
    "APP_GROUP": "runnote",
    "DB_NAME": "runnote",
    "DB_ROLE": "runnote",
    "API_PORT": "8000",
    "WEB_PORT": "3000",
    "SERVICE_API": "runnote-api",
    "SERVICE_WEB": "runnote-web",
    "SERVICE_BACKUP": "runnote-backup",
    "BACKUP_ONCALENDAR": "*-*-* 03:15:00",
    "BACKUP_RANDOM_DELAY": "15min",
}
LEGACY_EXTRA_RESERVED_DATABASES = {"runnote_rehearsal"}

NAME_RE = re.compile(r"^[a-z][a-z0-9-]{1,30}$")
IDENT_RE = re.compile(r"^[a-z_][a-z0-9_]{0,30}$")
UNIT_RE = re.compile(r"^[a-z][a-z0-9-]{2,40}$")
HOST_RE = re.compile(r"^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$")
PATH_RE = re.compile(r"^/[A-Za-z0-9._/-]+$")
CAL_RE = re.compile(r"^[A-Za-z0-9*:/_.,+ -]{3,64}$")
DELAY_RE = re.compile(r"^[0-9]{1,5}(s|min|h)?$")


# Everything render() reads. A usable template directory must contain all of them.
TEMPLATE_FILES = (
    "api.service.in",
    "web.service.in",
    "backup.service.in",
    "backup.timer.in",
    "caddy-maintenance.in",
    "caddy-live.in",
)


class ConfigError(Exception):
    pass


def template_candidates(here: Path = HERE) -> list[Path]:
    """The two supported layouts, resolved from this file's own location (never the working
    directory, never an absolute host path):

    * repository : infra/native/ops/instance.py   -> infra/native/templates
    * release    : <release>/ops/instance.py      -> <release>/infra/native/templates
    """
    return [here.parent / "templates", here.parent / "infra" / "native" / "templates"]


def find_templates(here: Path = HERE) -> Path:
    candidates = template_candidates(here)
    for directory in candidates:
        if all((directory / name).is_file() for name in TEMPLATE_FILES):
            return directory
    detail = []
    for directory in candidates:
        missing = [name for name in TEMPLATE_FILES if not (directory / name).is_file()]
        detail.append(
            f"{directory} (missing: {', '.join(missing)})"
            if directory.is_dir()
            else f"{directory} (not a directory)"
        )
    raise ConfigError(
        "no complete template directory next to this script; looked in: " + "; ".join(detail)
    )


def parse_conf(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for number, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            raise ConfigError(f"{path.name}:{number}: expected KEY=VALUE")
        key, value = line.split("=", 1)
        key, value = key.strip(), value.strip()
        if key not in REQUIRED:
            raise ConfigError(f"{path.name}:{number}: unknown key {key}")
        if key in values:
            raise ConfigError(f"{path.name}:{number}: duplicate key {key}")
        values[key] = value
    return values


def validate(values: dict[str, str], expected_name: str | None = None) -> dict[str, str]:
    missing = [key for key in REQUIRED if not values.get(key)]
    if missing:
        raise ConfigError("missing required key(s): " + ", ".join(missing))

    def need(key, pattern):
        if not pattern.match(values[key]):
            raise ConfigError(f"{key} has an invalid value")

    need("INSTANCE", NAME_RE)
    if expected_name is not None and values["INSTANCE"] != expected_name:
        raise ConfigError(
            f"INSTANCE={values['INSTANCE']} does not match the file name {expected_name}"
        )
    need("DOMAIN", HOST_RE)
    for key in ("ROOT", "ETC", "BACKUP_DIR"):
        need(key, PATH_RE)
        if ".." in values[key].split("/") or values[key].endswith("/"):
            raise ConfigError(f"{key} must be a normalised absolute path")
    for key in ("APP_USER", "APP_GROUP", "DB_NAME", "DB_ROLE"):
        need(key, IDENT_RE)
    for key in ("SERVICE_API", "SERVICE_WEB", "SERVICE_BACKUP"):
        need(key, UNIT_RE)
    need("BACKUP_ONCALENDAR", CAL_RE)
    need("BACKUP_RANDOM_DELAY", DELAY_RE)
    for key in ("API_PORT", "WEB_PORT"):
        if not values[key].isdigit() or not 1024 <= int(values[key]) <= 65535:
            raise ConfigError(f"{key} must be a port between 1024 and 65535")
    if values["API_PORT"] == values["WEB_PORT"]:
        raise ConfigError("API_PORT and WEB_PORT must differ")
    if len({values["SERVICE_API"], values["SERVICE_WEB"], values["SERVICE_BACKUP"]}) != 3:
        raise ConfigError("service names must be distinct")
    paths = [values["ROOT"], values["ETC"], values["BACKUP_DIR"]]
    for i, a in enumerate(paths):
        for b in paths[i + 1 :]:
            if a == b or a.startswith(b + "/") or b.startswith(a + "/"):
                raise ConfigError("ROOT, ETC and BACKUP_DIR must not be equal or nested")
    return values


def disjoint(a: dict[str, str], b: dict[str, str], a_name: str, b_name: str) -> None:
    """Two installations must share nothing that could let one reach the other."""

    def nested(x, y):
        return x == y or x.startswith(y + "/") or y.startswith(x + "/")

    for key in ("ROOT", "ETC", "BACKUP_DIR"):
        if nested(a[key], b[key]):
            raise ConfigError(f"{a_name} and {b_name} overlap on {key}")
    for key in (
        "APP_USER",
        "APP_GROUP",
        "DB_ROLE",
        "API_PORT",
        "WEB_PORT",
        "SERVICE_API",
        "SERVICE_WEB",
        "SERVICE_BACKUP",
    ):
        if a[key] == b[key]:
            raise ConfigError(f"{a_name} and {b_name} share {key}")
    if a["DB_NAME"] == b["DB_NAME"]:
        raise ConfigError(f"{a_name} and {b_name} share DB_NAME")
    ports = {a["API_PORT"], a["WEB_PORT"]} & {b["API_PORT"], b["WEB_PORT"]}
    if ports:
        raise ConfigError(f"{a_name} and {b_name} share a port")
    if a["DOMAIN"] == b["DOMAIN"]:
        raise ConfigError(f"{a_name} and {b_name} share DOMAIN")


def load(name: str, directory: Path) -> dict[str, str]:
    if not NAME_RE.match(name):
        raise ConfigError("invalid instance name")
    path = directory / f"{name}.conf"
    if not path.is_file():
        raise ConfigError(f"no such instance: {path}")
    values = validate(parse_conf(path), name)
    if values["INSTANCE"] == "legacy":
        raise ConfigError("'legacy' is reserved for the existing single-instance layout")
    disjoint(values, LEGACY, name, "the legacy installation")
    if values["DB_NAME"] in LEGACY_EXTRA_RESERVED_DATABASES:
        raise ConfigError("DB_NAME collides with an existing staging database")
    for other in sorted(directory.glob("*.conf")):
        if other.stem == name:
            continue
        disjoint(values, validate(parse_conf(other), other.stem), name, other.stem)
    return values


def shellvars(values: dict[str, str]) -> str:
    """Assignments for lib.sh. Every value already matched a strict pattern (no quotes, no
    whitespace except inside BACKUP_ONCALENDAR, which lib.sh does not use)."""
    out = {
        "RUNNOTE_ROOT": values["ROOT"],
        "RUNNOTE_ETC": values["ETC"],
        "BACKUP_DIR": values["BACKUP_DIR"],
        "APP_USER": values["APP_USER"],
        "APP_GROUP": values["APP_GROUP"],
        "DB_NAME": values["DB_NAME"],
        "DB_ROLE": values["DB_ROLE"],
        "API_PORT": values["API_PORT"],
        "WEB_PORT": values["WEB_PORT"],
        "API_URL": f"http://127.0.0.1:{values['API_PORT']}",
        "WEB_URL": f"http://127.0.0.1:{values['WEB_PORT']}",
        "SERVICE_API": values["SERVICE_API"],
        "SERVICE_WEB": values["SERVICE_WEB"],
        "SERVICE_BACKUP": values["SERVICE_BACKUP"],
        "INSTANCE_DOMAIN": values["DOMAIN"],
        "INSTANCE_NAME": values["INSTANCE"],
    }
    return "\n".join(f"{key}='{value}'" for key, value in out.items())


def render_template(text: str, values: dict[str, str], instance: bool) -> str:
    lines = []
    for line in text.splitlines():
        if line.startswith("#@instance# "):
            if not instance:
                continue
            line = line[len("#@instance# ") :]
        lines.append(line)
    out = "\n".join(lines) + "\n"
    for key, value in values.items():
        out = out.replace(f"@@{key}@@", value)
    leftover = re.findall(r"@@[A-Z_]+@@", out)
    if leftover:
        raise ConfigError("unresolved placeholder(s): " + ", ".join(sorted(set(leftover))))
    return out


def render(
    values: dict[str, str],
    out: Path,
    instance: bool,
    caddy_mode: str | None,
    templates: Path | None = None,
) -> list[Path]:
    templates = templates if templates is not None else find_templates()
    plan = {
        "api.service.in": f"{values['SERVICE_API']}.service",
        "web.service.in": f"{values['SERVICE_WEB']}.service",
        "backup.service.in": f"{values['SERVICE_BACKUP']}.service",
        "backup.timer.in": f"{values['SERVICE_BACKUP']}.timer",
    }
    if caddy_mode:
        if caddy_mode not in {"maintenance", "live"}:
            raise ConfigError("caddy mode must be maintenance or live")
        plan[f"caddy-{caddy_mode}.in"] = f"{values['INSTANCE']}.caddy"
    out.mkdir(parents=True, exist_ok=True)
    written = []
    for template, target in plan.items():
        text = (templates / template).read_text(encoding="utf-8")
        path = out / target
        path.write_text(render_template(text, values, instance), encoding="utf-8")
        written.append(path)
    return written


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawTextHelpFormatter
    )
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("shellvars")
    p.add_argument("name")
    p.add_argument("--dir", default=DEFAULT_DIR)
    p = sub.add_parser("render")
    p.add_argument("name", nargs="?")
    p.add_argument("--legacy", action="store_true")
    p.add_argument("--out", required=True)
    p.add_argument("--dir", default=DEFAULT_DIR)
    p.add_argument("--caddy-mode", choices=["maintenance", "live"])
    p = sub.add_parser("check")
    p.add_argument("--dir", default=DEFAULT_DIR)
    args = parser.parse_args(argv)
    try:
        if args.command == "shellvars":
            print(shellvars(load(args.name, Path(args.dir))))
        elif args.command == "render":
            if args.legacy == bool(args.name):
                raise ConfigError("give either an instance name or --legacy")
            if args.legacy and args.caddy_mode:
                raise ConfigError("the legacy site block lives in the Caddyfile itself")
            values = dict(LEGACY) if args.legacy else load(args.name, Path(args.dir))
            for path in render(values, Path(args.out), not args.legacy, args.caddy_mode):
                print(path)
        else:
            names = sorted(p.stem for p in Path(args.dir).glob("*.conf"))
            for name in names:
                load(name, Path(args.dir))
            print(
                f"{len(names)} instance(s) valid and disjoint from each other "
                "and from the legacy layout"
            )
    except (ConfigError, OSError) as error:
        print(f"instance.py: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
