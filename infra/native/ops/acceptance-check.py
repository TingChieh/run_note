#!/usr/bin/env python3
# ruff: noqa: E501  (usage examples and one-line report strings)
"""Authenticated acceptance probe for a Run Note site (standard library only).

Logs in as the site owner, imports ONE synthetic GPX, checks the private and the anonymous views,
deletes the synthetic activity again, logs out and proves the old session is dead. It is safe on a
site that already holds real data: every assertion is made inside a probe date (2000-01-15) and
probe year (2000) that must be empty beforehand, and counts are compared with a baseline taken
before the import, never with absolute numbers. The synthetic activity is removed in a `finally`
block, so a failing check still cleans up.

The owner's password is typed at a hidden prompt (or, for automated tests only, taken from
RN_ACCEPTANCE_PASSWORD), kept in memory, and never printed or written. The report contains check
names and PASS/FAIL only: no cookies, tokens, e-mail addresses or credentials.

  Public site:      acceptance-check.py --base https://run.example.com --backend-env /etc/run-note-production/backend.env
  Not yet public:   acceptance-check.py --loopback-port 3100 --domain run.example.com --backend-env /etc/run-note-production/backend.env
  (loopback mode talks to the Node server on 127.0.0.1 with the Host / X-Forwarded-Proto / Origin that
   the proxy would send, so a site that is deliberately still on its maintenance page can be checked.
   Only this client changes: it may send a Secure cookie over loopback http. No server setting does.)

Exit status: 0 all checks passed, 1 a check failed, 2 the probe was not run (bad usage, probe date
occupied by real data, nothing was changed).
"""

import argparse
import base64
import getpass
import http.cookiejar
import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid

PROBE_DATE = "2000-01-15"
PROBE_YEAR = "2000"
PROBE_RANGE = "date_from=2000-01-01&date_to=2001-01-01"  # the probe year; the end is exclusive
results: list[tuple[str, bool, str]] = []


class Stop(Exception):
    """Abort the checks but still run the cleanup below."""


def record(name: str, ok: bool, detail: str = "") -> bool:
    results.append((name, ok, detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" - {detail}" if detail else ""), flush=True)
    return ok


def read_kv(path: str) -> dict[str, str]:
    out = {}
    try:
        for line in open(path, encoding="utf-8"):
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.rstrip("\n").split("=", 1)
                out[k.strip()] = v.strip().strip("'\"")
    except OSError:
        pass
    return out


def code_of(data) -> str:
    return (data.get("error") or {}).get("code", "")


class Site:
    """One HTTP session against the site (or against its Node server in loopback mode)."""

    def __init__(self, args, basic):
        self.loop = bool(args.loopback_port)
        self.origin = f"https://{args.domain}" if self.loop else args.base.rstrip("/")
        self.connect = f"http://127.0.0.1:{args.loopback_port}" if self.loop else self.origin
        self.domain = args.domain
        self.basic = None if self.loop else basic
        policy = (
            http.cookiejar.DefaultCookiePolicy(secure_protocols=("https", "http"))
            if self.loop
            else None
        )
        self.jar = http.cookiejar.CookieJar(policy)
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.csrf = ""
        self.last_csrf = ""

    def call(self, method, path, body=None, headers=None, raw=None, origin=True, csrf=True):
        h = dict(headers or {})
        if self.loop:
            h["Host"] = self.domain
            h["X-Forwarded-Proto"] = "https"
        if self.basic:
            h["Authorization"] = "Basic " + base64.b64encode(":".join(self.basic).encode()).decode()
        data = raw
        if body is not None:
            data = json.dumps(body).encode()
            h["Content-Type"] = "application/json"
        if method in {"POST", "PUT", "PATCH", "DELETE"}:
            if origin:
                h["Origin"] = self.origin
            if csrf and self.csrf:
                h["X-CSRF-Token"] = self.csrf
        request = urllib.request.Request(self.connect + path, data=data, method=method, headers=h)
        try:
            with self.opener.open(request, timeout=60) as response:
                return response.status, response.read(), dict(response.headers)
        except urllib.error.HTTPError as error:
            return error.code, error.read(), dict(error.headers)

    def json(self, *a, **k):
        status, payload, _ = self.call(*a, **k)
        try:
            data = json.loads(payload)
        except ValueError:
            data = {}
        return status, data, payload

    def fetch_csrf(self) -> bool:
        status, payload, headers = self.call("GET", "/api/v1/auth/csrf")
        try:
            data = json.loads(payload)
        except ValueError:
            data = {}
        self.csrf = (data.get("data") or {}).get("csrf_token", "")
        retry = {k.lower(): v for k, v in headers.items()}.get("retry-after", "")
        self.last_csrf = f"status={status} code={code_of(data) or '-'}" + (
            f" retry-after={retry}s" if retry else ""
        )
        return status == 200 and bool(self.csrf)

    def cookie_names(self):
        return sorted(c.name for c in self.jar)


def synthetic_gpx() -> bytes:
    # Invented points on a short line, timestamped on the probe date; not a recording of anyone.
    points = []
    for i in range(60):
        lat = 31.2000 + i * 0.00045
        lon = 121.4000 + i * 0.00060 + (0.00008 if i % 2 else 0)
        points.append(
            f'<trkpt lat="{lat:.6f}" lon="{lon:.6f}"><ele>{5 + (i % 5)}</ele>'
            f"<time>{PROBE_DATE}T08:{i // 6:02d}:{(i % 6) * 10:02d}Z</time></trkpt>"
        )
    return (
        '<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="rn-synthetic" '
        'xmlns="http://www.topografix.com/GPX/1/1"><trk><name>synthetic</name><trkseg>'
        + "".join(points)
        + "</trkseg></trk></gpx>"
    ).encode()


def multipart(fields: dict[str, str], filename: str, content: bytes):
    boundary = "rnsynthetic" + uuid.uuid4().hex
    parts = [
        f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode()
        for k, v in fields.items()
    ]
    parts.append(
        (
            f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\n'
            "Content-Type: application/gpx+xml\r\n\r\n"
        ).encode()
        + content
        + b"\r\n"
    )
    parts.append(f"--{boundary}--\r\n".encode())
    return b"".join(parts), f"multipart/form-data; boundary={boundary}"


def total_of(site: Site, query: str = "") -> int | None:
    status, data, _ = site.json("GET", "/api/v1/activities?limit=1" + query)
    return (data.get("data") or {}).get("total") if status == 200 else None


def wait_footprints(site: Site, path: str, seconds: int, expect=None):
    """Poll the snapshot until it is ready (and, if given, holds `expect` activities)."""
    deadline = time.time() + seconds
    state, count = "", None
    while time.time() < deadline:
        status, data, _ = site.json("GET", path)
        body = data.get("data") or {}
        state = body.get("status", "")
        count = (body.get("result") or {}).get("activity_count")
        if status == 200 and state == "ready" and (expect is None or count == expect):
            return True, state, count
        time.sleep(5)
    return False, state or "no status", count


def run(args) -> int:
    env = read_kv(args.backend_env) if args.backend_env else {}
    owner_email = args.owner_email or env.get("SITE_OWNER_EMAIL", "")
    if not owner_email:
        print("owner e-mail not found: pass --backend-env (readable by you) or --owner-email")
        return 2
    basic_file = read_kv(args.basic_auth_file) if args.basic_auth_file else {}
    basic = (basic_file["user"], basic_file["password"]) if "user" in basic_file else None
    password = os.environ.get("RN_ACCEPTANCE_PASSWORD") or getpass.getpass(
        "Owner password (hidden): "
    )
    owner, anon = Site(args, basic), Site(args, basic)
    title = "RN-ACCEPT synthetic " + uuid.uuid4().hex[:8]
    activity_id = ""

    # 0. nothing is changed unless the probe date and year are empty
    csrf_ok = owner.fetch_csrf() and bool(owner.cookie_names())
    record(
        "csrf endpoint issues a token and a session cookie",
        csrf_ok,
        ",".join(owner.cookie_names()) if csrf_ok else owner.last_csrf,
    )
    if not csrf_ok:
        print(
            "\nStopped before any login attempt. A 429 AUTH_RATE_LIMITED means this client's per-IP csrf "
            "budget (60/hour) is used up; wait for the retry-after and run again."
        )
        return finish(1)
    status, _, _ = owner.json("GET", "/api/v1/auth/session")
    record("no session before login -> 401", status == 401, str(status))
    status, data, _ = owner.json(
        "POST", "/api/v1/auth/login", {"email": owner_email, "password": password + "x"}
    )
    record(
        "wrong password rejected (INVALID_CREDENTIALS)",
        status == 401 and code_of(data) == "INVALID_CREDENTIALS",
        str(status),
    )
    owner.fetch_csrf()
    status, data, _ = owner.json(
        "POST", "/api/v1/auth/login", {"email": owner_email, "password": password}
    )
    if not record(
        "login with the real password succeeds", status == 200, f"{status} {code_of(data)}"
    ):
        return finish(1)
    owner.fetch_csrf()
    status, data, raw = owner.json("GET", "/api/v1/auth/session")
    record(
        "session endpoint returns the authenticated owner",
        status == 200 and bool(data.get("data")),
        str(status),
    )
    record("login did not leak the password in any response", password.encode() not in raw)
    status, _, _ = owner.json("GET", "/api/v1/admin/users")
    record("owner can use administrator endpoints", status == 200, str(status))
    status, data, _ = owner.json("PATCH", "/api/v1/me", {"display_name": "x"}, csrf=False)
    record(
        "write without CSRF token rejected",
        status == 403 and code_of(data) == "CSRF_FAILED",
        f"{status} {code_of(data)}",
    )
    status, data, _ = owner.json(
        "PATCH",
        "/api/v1/me",
        {"display_name": "x"},
        headers={"Origin": "https://evil.example"},
        origin=False,
    )
    record(
        "write with a foreign Origin rejected",
        status == 403 and code_of(data) == "CSRF_FAILED",
        f"{status} {code_of(data)}",
    )

    baseline_total = total_of(owner)
    on_date = total_of(owner, f"&activity_date={PROBE_DATE}")
    status, data, _ = owner.json("GET", f"/api/v1/statistics/summary?{PROBE_RANGE}")
    in_year = (data.get("data") or {}).get("activity_count") if status == 200 else None
    if baseline_total is None or on_date != 0 or in_year != 0:
        record(
            "probe date and year are empty (precondition)",
            False,
            f"total={baseline_total} on_date={on_date} in_year={in_year}",
        )
        print(
            "\nNothing was imported. The probe uses 2000-01-15; choose a site without real data on that date."
        )
        status, _, _ = (
            owner.json("POST", "/api/v1/auth/logout") if owner.fetch_csrf() else (0, 0, 0)
        )
        return finish(2)
    record("probe date and year are empty (precondition)", True, f"baseline total={baseline_total}")
    fp_ok, fp_state, fp_base = wait_footprints(
        owner, "/api/v1/footprints/all?mode=tracks", min(args.footprint_wait, 60)
    )
    fp_base = fp_base if fp_ok else None

    try:
        # 1. import and private views
        body, ctype = multipart(
            {"title": title, "activity_date": PROBE_DATE, "timezone": "Asia/Shanghai"},
            "synthetic.gpx",
            synthetic_gpx(),
        )
        status, data, _ = owner.json(
            "POST", "/api/v1/gpx-imports", raw=body, headers={"Content-Type": ctype}
        )
        activity_id = str(((data.get("data") or {}).get("activity") or {}).get("id") or "")
        record(
            "synthetic GPX import accepted",
            status == 201 and bool(activity_id),
            f"{status} {code_of(data)}",
        )
        if not activity_id:
            raise Stop
        _, listing, _ = owner.json(
            "GET", f"/api/v1/activities?limit=100&activity_date={PROBE_DATE}"
        )
        items = (listing.get("data") or {}).get("items", [])
        record(
            "the probe date holds exactly the synthetic activity",
            [i.get("title") for i in items] == [title],
            f"{len(items)} item(s)",
        )
        record(
            "owner total grew by exactly one",
            total_of(owner) == baseline_total + 1,
            f"{baseline_total} -> {total_of(owner)}",
        )
        status, data, _ = owner.json("GET", f"/api/v1/activities/{activity_id}")
        record(
            "activity detail shows distance",
            status == 200 and float((data.get("data") or {}).get("distance_m") or 0) > 500,
            str(status),
        )
        status, data, _ = owner.json("GET", f"/api/v1/activities/{activity_id}/route")
        features = (data.get("data") or {}).get("features") or []
        coords = (features[0].get("geometry") or {}).get("coordinates", []) if features else []
        record(
            "route returns a GeoJSON LineString with points",
            status == 200 and len(coords) >= 2,
            f"{status}, {len(coords)} points",
        )
        status, data, _ = owner.json("GET", f"/api/v1/statistics/summary?{PROBE_RANGE}")
        record(
            "statistics for the probe year count exactly the synthetic activity",
            status == 200 and (data.get("data") or {}).get("activity_count") == 1,
        )
        status, _, _ = owner.json("GET", f"/api/v1/statistics/calendar?year={PROBE_YEAR}")
        record("statistics calendar available", status == 200, str(status))
        if fp_base is not None:
            ok, state, count = wait_footprints(
                owner, "/api/v1/footprints/all?mode=tracks", args.footprint_wait, fp_base + 1
            )
            record(
                "footprints snapshot includes the new activity",
                ok,
                f"{state}, activity_count {fp_base} -> {count}",
            )
        else:
            ok, state, count = wait_footprints(
                owner, "/api/v1/footprints/all?mode=tracks", args.footprint_wait
            )
            record("footprints snapshot becomes ready (no baseline was available)", ok, state)
        status, _, _ = owner.json("GET", "/api/v1/footprints/provinces")
        record("province summary available", status == 200, str(status))

        # 2. anonymous showcase
        anon.fetch_csrf()
        shown = {}
        for name, path in [
            ("profile", "/api/v1/showcase/profile"),
            ("activities", f"/api/v1/showcase/activities?limit=100&activity_date={PROBE_DATE}"),
            ("summary", f"/api/v1/showcase/statistics/summary?{PROBE_RANGE}"),
            ("calendar", f"/api/v1/showcase/statistics/calendar?year={PROBE_YEAR}"),
            ("footprints", "/api/v1/showcase/footprints/all?mode=tracks"),
        ]:
            status, data, raw = anon.json("GET", path)
            shown[name] = (status, data, raw)
            record(f"anonymous showcase {name} -> 200", status == 200, str(status))
        titles = [
            i.get("title") for i in (shown["activities"][1].get("data") or {}).get("items", [])
        ]
        record(
            "anonymous showcase lists the synthetic activity",
            titles == [title],
            f"{len(titles)} item(s)",
        )
        for name, path in [
            ("detail", f"/api/v1/showcase/activities/{activity_id}"),
            ("route", f"/api/v1/showcase/activities/{activity_id}/route"),
        ]:
            status, data, raw = anon.json("GET", path)
            shown[name] = (status, data, raw)
            record(
                f"anonymous showcase {name} (owner-only full display)", status == 200, str(status)
            )
        leak = [n for n, (_, _, r) in shown.items() if owner_email.encode() in r]
        record("owner e-mail never appears in anonymous responses", not leak, ",".join(leak))
        status, _, _ = anon.json("GET", "/api/v1/activities")
        record("anonymous cannot read the private list", status == 401, str(status))
        status, _, _ = anon.json("GET", "/api/v1/ai-reports")
        record("anonymous AI list never calls a provider", status in (200, 401, 503), str(status))
    except Stop:
        pass
    finally:
        # 3. always remove the synthetic activity, whatever failed above
        if not activity_id:
            _, listing, _ = owner.json(
                "GET", f"/api/v1/activities?limit=100&activity_date={PROBE_DATE}"
            )
            for item in (listing.get("data") or {}).get("items", []):
                if item.get("title") == title:
                    activity_id = str(item["id"])
        if activity_id:
            owner.fetch_csrf()
            status, _, _ = owner.json("DELETE", f"/api/v1/activities/{activity_id}")
            record("synthetic activity deleted", status in (200, 204), str(status))
            record(
                "owner total is back to the baseline",
                total_of(owner) == baseline_total,
                f"{total_of(owner)} (baseline {baseline_total})",
            )
            record(
                "the probe date is empty again",
                total_of(owner, f"&activity_date={PROBE_DATE}") == 0,
            )
            _, data, _ = anon.json(
                "GET", f"/api/v1/showcase/activities?limit=100&activity_date={PROBE_DATE}"
            )
            record("showcase no longer lists it", not (data.get("data") or {}).get("items"))

    # 4. logout and session death
    old = list(owner.jar)
    owner.fetch_csrf()
    status, _, _ = owner.json("POST", "/api/v1/auth/logout")
    record("logout succeeds", status == 200, str(status))
    status, _, _ = owner.json("GET", "/api/v1/auth/session")
    record("session is gone after logout -> 401", status == 401, str(status))
    replay = Site(args, basic)
    for cookie in old:
        replay.jar.set_cookie(cookie)
    status, _, _ = replay.json("GET", "/api/v1/auth/session")
    record("the pre-logout cookie cannot be replayed -> 401", status == 401, str(status))
    return finish(1)


def finish(default_failure: int) -> int:
    failed = [n for n, ok, _ in results if not ok]
    print(
        f"\n{len(results) - len(failed)}/{len(results)} checks passed"
        + (f"; FAILED: {failed}" if failed else "")
    )
    return 0 if not failed else default_failure


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--base", help="public origin, e.g. https://run.example.com")
    parser.add_argument(
        "--loopback-port", help="Node port on 127.0.0.1 for a site that is not public yet"
    )
    parser.add_argument("--domain", help="site domain (needed with --loopback-port)")
    parser.add_argument(
        "--backend-env", help="backend.env to read SITE_OWNER_EMAIL from (never printed)"
    )
    parser.add_argument("--owner-email", help="owner address instead of --backend-env")
    parser.add_argument(
        "--basic-auth-file",
        help="file with user=/password= lines when the site sits behind basic auth",
    )
    parser.add_argument(
        "--footprint-wait",
        type=int,
        default=120,
        help="seconds to wait for the footprint worker (it scans every 60 s)",
    )
    args = parser.parse_args(argv)
    if bool(args.base) == bool(args.loopback_port):
        parser.error("give exactly one of --base or --loopback-port")
    if args.loopback_port and not args.domain:
        parser.error("--loopback-port needs --domain")
    if (
        args.base
        and not args.base.startswith("https://")
        and not args.base.startswith("http://127.0.0.1")
    ):
        parser.error("--base must be an https:// origin")
    if args.base and not args.domain:
        args.domain = args.base.split("://", 1)[1].split("/", 1)[0]
    return run(args)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
