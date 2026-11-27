#!/usr/bin/env python3
"""Unified SemVer version source, manifest sync, drift detection, and release tag validator.

Single source of truth: repository root ``VERSION`` file.

Supported SemVer syntax:
    MAJOR.MINOR.PATCH
    MAJOR.MINOR.PATCH-(alpha|beta|rc).N

Bounds (to guarantee a strictly monotonic Android versionCode <= 2,100,000,000):
    0 <= MAJOR <= 209, 0 <= MINOR <= 99, 0 <= PATCH <= 99, 1 <= N <= 99

Monotonic Android versionCode formula:
    MAJOR * 10_000_000 + MINOR * 100_000 + PATCH * 1_000 + STAGE_CODE
    where STAGE_CODE is:
      alpha.N -> 100 + N  (101..199)
      beta.N  -> 200 + N  (201..299)
      rc.N    -> 300 + N  (301..399)
      final   -> 999

Examples:
    2.7.0-alpha.1 -> 20700101
    2.7.0-beta.1  -> 20700201
    2.7.0-rc.1    -> 20700301
    2.7.0         -> 20700999

Subcommands:
    scripts/version.py show [--json]
    scripts/version.py check
    scripts/version.py sync
    scripts/version.py set <semver>
    scripts/version.py bump <major|minor|patch|alpha|beta|rc|final> [--base X.Y.Z]
    scripts/version.py validate-tag <vX.Y.Z...> [--changelog CHANGELOG.md]
                                                [--notes-out FILE]
                                                [--github-output FILE]
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import tomllib
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

SEMVER_RE = re.compile(
    r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(alpha|beta|rc)\.([1-9]\d*))?$"
)
MAX_MAJOR = 209
MAX_MINOR = 99
MAX_PATCH = 99
MAX_PRE_NUM = 99
MAX_ANDROID_VERSION_CODE = 2_100_000_000

STAGE_OFFSET = {"alpha": 100, "beta": 200, "rc": 300}
STAGE_ORDER = {"alpha": 1, "beta": 2, "rc": 3, None: 4}

CHANGELOG_HEADING_RE = re.compile(r"^## \[([^\]]+)\](?:\s*-\s*(.+))?\s*$")
STRICT_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
MIN_MOBILE_RE = re.compile(r'^MIN_MOBILE_APP_VERSION\s*=\s*"([^"]+)"\s*$', re.MULTILINE)
PYPROJECT_VERSION_RE = re.compile(r'^(\s*version\s*=\s*")([^"]+)("\s*)$', re.MULTILINE)
GRADLE_VERSION_NAME_RE = re.compile(r'^(\s*versionName\s+")([^"]+)("\s*)$', re.MULTILINE)
GRADLE_VERSION_CODE_RE = re.compile(r"^(\s*versionCode\s+)(\d+)(\s*)$", re.MULTILINE)


@dataclass(frozen=True, order=False)
class SemVer:
    major: int
    minor: int
    patch: int
    prerelease_stage: str | None = None
    prerelease_num: int | None = None

    def __post_init__(self) -> None:
        if not (0 <= self.major <= MAX_MAJOR):
            raise ValueError(f"major version {self.major} out of supported range 0..{MAX_MAJOR}")
        if not (0 <= self.minor <= MAX_MINOR):
            raise ValueError(f"minor version {self.minor} out of supported range 0..{MAX_MINOR}")
        if not (0 <= self.patch <= MAX_PATCH):
            raise ValueError(f"patch version {self.patch} out of supported range 0..{MAX_PATCH}")
        if self.prerelease_stage is None:
            if self.prerelease_num is not None:
                raise ValueError("prerelease_num set without prerelease_stage")
        else:
            if self.prerelease_stage not in STAGE_OFFSET:
                raise ValueError(f"unsupported prerelease stage: {self.prerelease_stage!r}")
            if self.prerelease_num is None or not (1 <= self.prerelease_num <= MAX_PRE_NUM):
                raise ValueError(
                    f"prerelease number {self.prerelease_num!r} out of range 1..{MAX_PRE_NUM}"
                )

    @property
    def is_prerelease(self) -> bool:
        return self.prerelease_stage is not None

    @property
    def sort_key(self) -> tuple[int, int, int, int, int]:
        return (
            self.major,
            self.minor,
            self.patch,
            STAGE_ORDER[self.prerelease_stage],
            self.prerelease_num or 0,
        )

    @property
    def android_version_code(self) -> int:
        if self.prerelease_stage is not None and self.prerelease_num is not None:
            stage_code = STAGE_OFFSET[self.prerelease_stage] + self.prerelease_num
        else:
            stage_code = 999
        code = self.major * 10_000_000 + self.minor * 100_000 + self.patch * 1_000 + stage_code
        if code > MAX_ANDROID_VERSION_CODE:
            raise ValueError(f"versionCode {code} exceeds Android limit {MAX_ANDROID_VERSION_CODE}")
        return code

    def __str__(self) -> str:
        base = f"{self.major}.{self.minor}.{self.patch}"
        if self.prerelease_stage is not None:
            return f"{base}-{self.prerelease_stage}.{self.prerelease_num}"
        return base

    def __lt__(self, other: object) -> bool:
        if not isinstance(other, SemVer):
            return NotImplemented
        return self.sort_key < other.sort_key

    def __le__(self, other: object) -> bool:
        if not isinstance(other, SemVer):
            return NotImplemented
        return self.sort_key <= other.sort_key

    def __gt__(self, other: object) -> bool:
        if not isinstance(other, SemVer):
            return NotImplemented
        return self.sort_key > other.sort_key

    def __ge__(self, other: object) -> bool:
        if not isinstance(other, SemVer):
            return NotImplemented
        return self.sort_key >= other.sort_key


def parse_semver(raw: str) -> SemVer:
    text = raw.strip()
    match = SEMVER_RE.fullmatch(text)
    if not match:
        raise ValueError(
            f"invalid SemVer {raw!r}: expected MAJOR.MINOR.PATCH or "
            "MAJOR.MINOR.PATCH-(alpha|beta|rc).N (no leading zeros)"
        )
    major, minor, patch = int(match.group(1)), int(match.group(2)), int(match.group(3))
    stage = match.group(4)
    pre_num = int(match.group(5)) if match.group(5) is not None else None
    return SemVer(major, minor, patch, stage, pre_num)


def parse_tag(tag: str) -> SemVer:
    cleaned = tag.strip()
    if not cleaned.startswith("v"):
        raise ValueError(f"release tag {tag!r} must start with 'v' (e.g. v2.7.0 or v2.7.0-rc.1)")
    return parse_semver(cleaned[1:])


def android_version_code(version: str | SemVer) -> int:
    sv = version if isinstance(version, SemVer) else parse_semver(version)
    return sv.android_version_code


def apk_artifact_names(version: str | SemVer) -> tuple[str, str]:
    sv = version if isinstance(version, SemVer) else parse_semver(version)
    apk = f"runnote-android-v{sv}-vc{sv.android_version_code}.apk"
    return apk, f"{apk}.sha256"


def read_root_version(repo: Path = ROOT) -> SemVer:
    version_file = repo / "VERSION"
    if not version_file.is_file():
        raise RuntimeError(f"missing unified version source: {version_file}")
    lines = [
        line.strip()
        for line in version_file.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    if len(lines) != 1:
        raise RuntimeError(f"{version_file} must contain exactly one SemVer line")
    return parse_semver(lines[0])


def read_declared_versions(repo: Path = ROOT) -> dict[str, object]:
    root_sv = read_root_version(repo)

    pyproject_path = repo / "backend/pyproject.toml"
    backend_version = tomllib.loads(pyproject_path.read_text(encoding="utf-8"))["project"][
        "version"
    ]

    frontend_pkg = json.loads((repo / "frontend/package.json").read_text(encoding="utf-8"))
    frontend_version = frontend_pkg.get("version")

    android_pkg = json.loads((repo / "android/package.json").read_text(encoding="utf-8"))
    android_pkg_version = android_pkg.get("version")

    gradle_text = (repo / "android/native/app/build.gradle").read_text(encoding="utf-8")
    gradle_names = [m.group(2) for m in GRADLE_VERSION_NAME_RE.finditer(gradle_text)]
    gradle_codes = [m.group(2) for m in GRADLE_VERSION_CODE_RE.finditer(gradle_text)]

    mobile_service_path = repo / "backend/app/modules/mobile_auth/service.py"
    min_mobile = None
    if mobile_service_path.is_file():
        min_match = MIN_MOBILE_RE.search(mobile_service_path.read_text(encoding="utf-8"))
        if min_match:
            min_mobile = min_match.group(1)

    return {
        "root": str(root_sv),
        "root_semver": root_sv,
        "expected_android_code": root_sv.android_version_code,
        "backend_pyproject": backend_version,
        "frontend_package": frontend_version,
        "android_package": android_pkg_version,
        "android_gradle_names": gradle_names,
        "android_gradle_codes": gradle_codes,
        "min_mobile_app_version": min_mobile,
    }


def check_consistency(repo: Path = ROOT) -> list[str]:
    """Return a list of drift/consistency errors across all version declarations."""
    errors: list[str] = []
    try:
        info = read_declared_versions(repo)
    except Exception as exc:
        return [str(exc)]

    expected = str(info["root"])
    root_sv: SemVer = info["root_semver"]  # type: ignore[assignment]
    expected_code = str(info["expected_android_code"])

    if info["backend_pyproject"] != expected:
        errors.append(
            f"backend/pyproject.toml version is {info['backend_pyproject']!r}, "
            f"expected {expected!r}"
        )
    if info["frontend_package"] != expected:
        errors.append(
            f"frontend/package.json version is {info['frontend_package']!r}, expected {expected!r}"
        )
    if info["android_package"] != expected:
        errors.append(
            f"android/package.json version is {info['android_package']!r}, expected {expected!r}"
        )
    if info["android_gradle_names"] != [expected]:
        errors.append(
            f"android/native/app/build.gradle versionName is {info['android_gradle_names']!r}, "
            f"expected [{expected!r}]"
        )
    if info["android_gradle_codes"] != [expected_code]:
        errors.append(
            f"android/native/app/build.gradle versionCode is {info['android_gradle_codes']!r}, "
            f"expected [{expected_code!r}]"
        )

    min_mobile = info["min_mobile_app_version"]
    if min_mobile is not None:
        try:
            min_sv = parse_semver(str(min_mobile))
        except ValueError as exc:
            errors.append(f"MIN_MOBILE_APP_VERSION is invalid: {exc}")
        else:
            if root_sv < min_sv:
                errors.append(
                    f"VERSION ({expected}) is older than backend "
                    f"MIN_MOBILE_APP_VERSION ({min_mobile})"
                )
    return errors


def _replace_once(pattern: re.Pattern[str], text: str, replacement: str, label: str) -> str:
    matches = list(pattern.finditer(text))
    if len(matches) != 1:
        raise RuntimeError(f"expected exactly 1 match for {label}, found {len(matches)}")
    return pattern.sub(replacement, text, count=1)


def _update_json_version(path: Path, version: str) -> None:
    text = path.read_text(encoding="utf-8")
    updated = _replace_once(
        re.compile(r'((?:^|\{)\s*"version"\s*:\s*")([^"]+)(")', re.MULTILINE),
        text,
        rf"\g<1>{version}\g<3>",
        f"version in {path}",
    )
    path.write_text(updated, encoding="utf-8")


def sync_versions(target: SemVer, repo: Path = ROOT) -> None:
    version_str = str(target)
    code_str = str(target.android_version_code)

    (repo / "VERSION").write_text(f"{version_str}\n", encoding="utf-8")

    pyproject = repo / "backend/pyproject.toml"
    pyproject.write_text(
        _replace_once(
            PYPROJECT_VERSION_RE,
            pyproject.read_text(encoding="utf-8"),
            rf"\g<1>{version_str}\g<3>",
            "version in backend/pyproject.toml",
        ),
        encoding="utf-8",
    )

    _update_json_version(repo / "frontend/package.json", version_str)
    _update_json_version(repo / "android/package.json", version_str)

    gradle = repo / "android/native/app/build.gradle"
    gradle_text = gradle.read_text(encoding="utf-8")
    gradle_text = _replace_once(
        GRADLE_VERSION_CODE_RE,
        gradle_text,
        rf"\g<1>{code_str}\g<3>",
        "versionCode in android/native/app/build.gradle",
    )
    gradle_text = _replace_once(
        GRADLE_VERSION_NAME_RE,
        gradle_text,
        rf"\g<1>{version_str}\g<3>",
        "versionName in android/native/app/build.gradle",
    )
    gradle.write_text(gradle_text, encoding="utf-8")


def compute_bump(current: SemVer, part: str, base_override: str | None = None) -> SemVer:
    if part == "major":
        return SemVer(current.major + 1, 0, 0)
    if part == "minor":
        return SemVer(current.major, current.minor + 1, 0)
    if part == "patch":
        if current.is_prerelease:
            return SemVer(current.major, current.minor, current.patch)
        return SemVer(current.major, current.minor, current.patch + 1)
    if part == "final":
        if not current.is_prerelease:
            raise ValueError(f"{current} is already a final release (use major/minor/patch)")
        return SemVer(current.major, current.minor, current.patch)
    if part in STAGE_OFFSET:
        if base_override:
            base = parse_semver(base_override)
            if base.is_prerelease:
                raise ValueError("--base must be a final MAJOR.MINOR.PATCH version")
            candidate = SemVer(base.major, base.minor, base.patch, part, 1)
            if candidate <= current:
                raise ValueError(
                    f"bumped version {candidate} must be greater than current {current}"
                )
            return candidate
        if current.is_prerelease:
            if current.prerelease_stage == part and current.prerelease_num is not None:
                return SemVer(
                    current.major, current.minor, current.patch, part, current.prerelease_num + 1
                )
            if STAGE_ORDER[part] > STAGE_ORDER[current.prerelease_stage]:
                return SemVer(current.major, current.minor, current.patch, part, 1)
            raise ValueError(
                f"cannot move backwards from {current} to stage {part!r}; "
                "specify --base X.Y.Z for a newer base version"
            )
        return SemVer(current.major, current.minor, current.patch + 1, part, 1)
    raise ValueError(f"unknown bump part: {part!r}")


def extract_changelog_entry(changelog_path: Path, version: str) -> tuple[str, str]:
    """Validate and extract the formal release entry for ``version`` from CHANGELOG.md.

    Requires an exact heading ``## [<version>] - YYYY-MM-DD`` with a real calendar date
    and non-empty release content. Returns ``(release_date, body_markdown)``.
    """
    if not changelog_path.is_file():
        raise ValueError(f"changelog file not found: {changelog_path}")

    lines = changelog_path.read_text(encoding="utf-8").splitlines()
    matches: list[tuple[int, str]] = []
    headings: list[tuple[int, str, str]] = []

    for idx, line in enumerate(lines):
        m = CHANGELOG_HEADING_RE.match(line)
        if m:
            label = m.group(1).strip()
            rest = (m.group(2) or "").strip()
            headings.append((idx, label, rest))
            if label == version:
                matches.append((idx, rest))

    if not matches:
        raise ValueError(
            f"{changelog_path.name} has no entry for [{version}]; "
            f"add a `## [{version}] - YYYY-MM-DD` section before tagging v{version}"
        )
    if len(matches) > 1:
        raise ValueError(f"{changelog_path.name} has duplicate entries for [{version}]")

    start_idx, date_str = matches[0]
    if not STRICT_DATE_RE.fullmatch(date_str):
        raise ValueError(
            f"{changelog_path.name} heading for [{version}] must use exact ISO date "
            f"`## [{version}] - YYYY-MM-DD` (got {date_str!r})"
        )
    try:
        datetime.strptime(date_str, "%Y-%m-%d")
    except ValueError as exc:
        raise ValueError(f"invalid release date {date_str!r} in {changelog_path.name}") from exc

    end_idx = len(lines)
    for h_idx, _, _ in headings:
        if h_idx > start_idx:
            end_idx = h_idx
            break

    body_lines = lines[start_idx + 1 : end_idx]
    body = "\n".join(body_lines).strip()
    meaningful = [
        ln.strip()
        for ln in body_lines
        if ln.strip() and not ln.strip().startswith("#") and not ln.strip().startswith("<!--")
    ]
    if not meaningful:
        raise ValueError(
            f"{changelog_path.name} entry for [{version}] has no release notes content"
        )
    return date_str, body


def validate_release_tag(
    tag: str,
    *,
    repo: Path = ROOT,
    changelog: Path | None = None,
) -> dict[str, object]:
    tag_sv = parse_tag(tag)
    errors = check_consistency(repo)
    if errors:
        raise ValueError("version drift detected:\n  - " + "\n  - ".join(errors))

    root_sv = read_root_version(repo)
    if tag_sv != root_sv:
        raise ValueError(
            f"tag {tag!r} ({tag_sv}) does not match VERSION ({root_sv}); "
            "update VERSION and synced manifests before tagging"
        )

    changelog_path = changelog if changelog is not None else (repo / "CHANGELOG.md")
    release_date, notes = extract_changelog_entry(changelog_path, str(tag_sv))
    apk_name, sha256_name = apk_artifact_names(tag_sv)
    return {
        "tag": tag.strip(),
        "version": str(tag_sv),
        "version_code": tag_sv.android_version_code,
        "prerelease": tag_sv.is_prerelease,
        "release_date": release_date,
        "apk_name": apk_name,
        "sha256_name": sha256_name,
        "notes": notes,
    }


def _cmd_show(args: argparse.Namespace) -> int:
    sv = read_root_version(args.repo)
    apk_name, sha256_name = apk_artifact_names(sv)
    payload = {
        "version": str(sv),
        "tag": f"v{sv}",
        "prerelease": sv.is_prerelease,
        "android_version_code": sv.android_version_code,
        "apk_name": apk_name,
        "sha256_name": sha256_name,
    }
    if args.json:
        print(json.dumps(payload, indent=2))
    else:
        print(f"version:              {payload['version']}")
        print(f"tag:                  {payload['tag']}")
        print(f"prerelease:           {payload['prerelease']}")
        print(f"android_version_code: {payload['android_version_code']}")
        print(f"apk_name:             {payload['apk_name']}")
    return 0


def _cmd_check(args: argparse.Namespace) -> int:
    errors = check_consistency(args.repo)
    if errors:
        print("FAIL: version consistency check failed:", file=sys.stderr)
        for err in errors:
            print(f"  - {err}", file=sys.stderr)
        return 1
    sv = read_root_version(args.repo)
    print(f"OK: all version sources match {sv} (Android versionCode {sv.android_version_code})")
    return 0


def _cmd_sync(args: argparse.Namespace) -> int:
    sv = read_root_version(args.repo)
    sync_versions(sv, args.repo)
    errors = check_consistency(args.repo)
    if errors:
        for err in errors:
            print(f"ERROR: {err}", file=sys.stderr)
        return 1
    print(f"Synced all manifests to {sv} (Android versionCode {sv.android_version_code})")
    return 0


def _cmd_set(args: argparse.Namespace) -> int:
    sv = parse_semver(args.version)
    sync_versions(sv, args.repo)
    errors = check_consistency(args.repo)
    if errors:
        for err in errors:
            print(f"ERROR: {err}", file=sys.stderr)
        return 1
    print(f"Set version to {sv} (Android versionCode {sv.android_version_code})")
    return 0


def _cmd_bump(args: argparse.Namespace) -> int:
    current = read_root_version(args.repo)
    nxt = compute_bump(current, args.part, args.base)
    sync_versions(nxt, args.repo)
    errors = check_consistency(args.repo)
    if errors:
        for err in errors:
            print(f"ERROR: {err}", file=sys.stderr)
        return 1
    print(
        f"Bumped version {current} ({current.android_version_code}) -> "
        f"{nxt} ({nxt.android_version_code})"
    )
    return 0


def _cmd_validate_tag(args: argparse.Namespace) -> int:
    try:
        info = validate_release_tag(
            args.tag,
            repo=args.repo,
            changelog=args.changelog,
        )
    except ValueError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 1

    if args.notes_out:
        args.notes_out.parent.mkdir(parents=True, exist_ok=True)
        args.notes_out.write_text(f"{info['notes']}\n", encoding="utf-8")

    if args.github_output:
        lines = [
            f"tag={info['tag']}",
            f"version={info['version']}",
            f"version_code={info['version_code']}",
            f"prerelease={'true' if info['prerelease'] else 'false'}",
            f"release_date={info['release_date']}",
            f"apk_name={info['apk_name']}",
            f"sha256_name={info['sha256_name']}",
        ]
        with args.github_output.open("a", encoding="utf-8") as handle:
            handle.write("\n".join(lines) + "\n")

    print(
        f"OK: tag {info['tag']} validated "
        f"(version={info['version']}, versionCode={info['version_code']}, "
        f"prerelease={info['prerelease']}, date={info['release_date']})"
    )
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="RunNote unified version and release validator")
    parser.add_argument("--repo", type=Path, default=ROOT, help="Repository root (default: repo)")
    sub = parser.add_subparsers(dest="command", required=True)

    p_show = sub.add_parser("show", help="Show current version and Android versionCode")
    p_show.add_argument("--json", action="store_true", help="Emit JSON")
    p_show.set_defaults(func=_cmd_show)

    p_check = sub.add_parser("check", help="Fail if any version manifest has drifted from VERSION")
    p_check.set_defaults(func=_cmd_check)

    p_sync = sub.add_parser("sync", help="Sync all manifests to match root VERSION")
    p_sync.set_defaults(func=_cmd_sync)

    p_set = sub.add_parser("set", help="Set root VERSION and sync all manifests")
    p_set.add_argument("version", help="Target SemVer (e.g. 2.7.0 or 2.8.0-rc.1)")
    p_set.set_defaults(func=_cmd_set)

    p_bump = sub.add_parser("bump", help="Bump version and sync all manifests")
    p_bump.add_argument("part", choices=("major", "minor", "patch", "alpha", "beta", "rc", "final"))
    p_bump.add_argument("--base", help="Base MAJOR.MINOR.PATCH when starting a new prerelease line")
    p_bump.set_defaults(func=_cmd_bump)

    p_tag = sub.add_parser(
        "validate-tag", help="Validate release tag against VERSION and CHANGELOG"
    )
    p_tag.add_argument("tag", help="Git tag name (must start with v)")
    p_tag.add_argument("--changelog", type=Path, default=None, help="Path to CHANGELOG.md")
    p_tag.add_argument("--notes-out", type=Path, default=None, help="Write extracted notes here")
    p_tag.add_argument(
        "--github-output", type=Path, default=None, help="Append GitHub outputs here"
    )
    p_tag.set_defaults(func=_cmd_validate_tag)

    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except (ValueError, RuntimeError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
