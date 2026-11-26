#!/usr/bin/env python3
"""Audit built Android APK permissions via `aapt2 dump permissions`.

Enforces P0 / Phase 3 minimal-permission invariants:
- No ACCESS_BACKGROUND_LOCATION
- No Health Connect WRITE_* permissions
- No broad external storage / media permissions
- Every declared uses-permission must belong to the explicit allowlist (plus app-scoped dynamic receiver permission)
"""

import argparse
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

APP_ID = "com.tingchieh.runnote"
ALLOWED_PERMISSIONS = {
    "android.permission.INTERNET",
    "android.permission.ACCESS_NETWORK_STATE",
    "android.permission.health.READ_STEPS",
    "android.permission.health.READ_DISTANCE",
    "android.permission.health.READ_ACTIVE_CALORIES_BURNED",
    "android.permission.health.READ_HEART_RATE",
    "android.permission.health.READ_RESTING_HEART_RATE",
    "android.permission.health.READ_SLEEP",
    "android.permission.ACCESS_FINE_LOCATION",
    "android.permission.ACCESS_COARSE_LOCATION",
    "android.permission.FOREGROUND_SERVICE",
    "android.permission.FOREGROUND_SERVICE_LOCATION",
    "android.permission.POST_NOTIFICATIONS",
    f"{APP_ID}.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION",
}
FORBIDDEN_PREFIXES = (
    "android.permission.health.WRITE_",
    "android.permission.READ_MEDIA_",
)
FORBIDDEN_EXACT = {
    "android.permission.ACCESS_BACKGROUND_LOCATION",
    "android.permission.READ_EXTERNAL_STORAGE",
    "android.permission.WRITE_EXTERNAL_STORAGE",
    "android.permission.MANAGE_EXTERNAL_STORAGE",
}


def find_aapt2() -> str:
    direct = shutil.which("aapt2")
    if direct:
        return direct
    sdk_root = os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT")
    if sdk_root:
        candidates = sorted(Path(sdk_root).glob("build-tools/*/aapt2"))
        if candidates:
            return str(candidates[-1])
    raise SystemExit("aapt2 not found in PATH or ANDROID_HOME/build-tools")


def parse_permissions(output: str) -> set[str]:
    return set(re.findall(r"uses-permission(?:-sdk-\d+)?:\s*name='([^']+)'", output))


def audit(apk: Path) -> int:
    if not apk.is_file():
        print(f"APK not found: {apk}", file=sys.stderr)
        return 1
    aapt2 = find_aapt2()
    done = subprocess.run(
        [aapt2, "dump", "permissions", str(apk)],
        check=True,
        capture_output=True,
        text=True,
    )
    declared = parse_permissions(done.stdout)
    if not declared:
        print("FAIL: aapt2 output contained no declared permissions (fail closed)", file=sys.stderr)
        return 1
    if "android.permission.INTERNET" not in declared:
        print(
            "FAIL: required baseline permission android.permission.INTERNET missing",
            file=sys.stderr,
        )
        return 1
    forbidden = sorted(
        p for p in declared if p in FORBIDDEN_EXACT or p.startswith(FORBIDDEN_PREFIXES)
    )
    unexpected = sorted(declared - ALLOWED_PERMISSIONS)
    print(f"Audited {apk} ({len(declared)} declared permissions)")
    for perm in sorted(declared):
        print(f"  - {perm}")
    if forbidden:
        print(f"FAIL: forbidden permissions present: {forbidden}", file=sys.stderr)
        return 1
    if unexpected:
        print(f"FAIL: unexpected permissions not in allowlist: {unexpected}", file=sys.stderr)
        return 1
    print("PASS: APK permissions match minimal allowlist")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("apk", type=Path, help="Path to built APK")
    return audit(parser.parse_args().apk)


if __name__ == "__main__":
    raise SystemExit(main())
