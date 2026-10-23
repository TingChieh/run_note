#!/usr/bin/env bash
# Exercises ops/offsite.sh against a throw-away PostgreSQL cluster and a LOCAL restic repository
# (no network, no cloud account, no real secrets). The S3/R2 transport itself is restic's; what is
# verified here is everything Run Note adds around it.
#
#   offsite-e2e.sh        (needs PG_BIN = PostgreSQL 18 + PostGIS bin dir, and restic on PATH)
set -euo pipefail

: "${PG_BIN:?}"
command -v restic >/dev/null || { echo "restic is required" >&2; exit 1; }
here="$(cd "$(dirname "$0")" && pwd)"
ops="$here/../ops"
WORK="$(mktemp -d)"
port="${PG_PORT:-55451}"
sock="$(mktemp -d /tmp/rnsock.XXXXXX)"
fail() { echo "OFFSITE E2E FAIL: $*" >&2; exit 1; }
step() { echo "=== $*" >&2; }
expect_fail() { # $1 description, rest: command. Succeeds when the command fails.
  local d="$1"; shift
  if "$@" >"$WORK/last.out" 2>&1; then cat "$WORK/last.out" >&2; fail "expected failure: $d"; fi
  echo "ok (refused as designed): $d" >&2
}
cleanup() {
  "$PG_BIN/pg_ctl" -D "$WORK/pg" -m immediate stop >/dev/null 2>&1 || true
  rm -rf -- "$sock" "$WORK"
}
trap cleanup EXIT

mkdir -p "$WORK"/{shims,etc,backups}
printf '#!/bin/sh\nexit 0\n' > "$WORK/shims/chown"
printf '#!/bin/sh\nshift 3\nexec "$@"\n' > "$WORK/shims/runuser"
chmod +x "$WORK"/shims/*
export PATH="$WORK/shims:$PG_BIN:$PATH"

"$PG_BIN/initdb" -D "$WORK/pg" -U postgres -A trust --no-locale -E UTF8 >/dev/null
"$PG_BIN/pg_ctl" -D "$WORK/pg" -l "$WORK/pg.log" -o "-h 127.0.0.1 -p $port -k $sock" -w start >/dev/null
export PGHOST=127.0.0.1 PGPORT=$port PGUSER=postgres
createdb rn_offsite
psql -X -q -d rn_offsite <<'SQL'
create extension postgis;
create table alembic_version (version_num text primary key);
insert into alembic_version values ('0013_backfill_distance_category');
create table activities (id int primary key, note text);
insert into activities select g, 'synthetic ' || g from generate_series(1, 50) g;
SQL

export RUNNOTE_ETC="$WORK/etc" BACKUP_DIR="$WORK/backups" RUNNOTE_OFFSITE_ALLOW_NONROOT=1
envfile="$WORK/etc/backup.env"
reset_env() { printf 'PGDATABASE=rn_offsite\nPGHOST=127.0.0.1\nPGPORT=%s\nPGUSER=postgres\n' "$port" > "$envfile"; chmod 640 "$envfile"; }
reset_env
repo="$WORK/repo"

step "1. setup refuses when it cannot prompt"
expect_fail "no terminal and no answers" env -u RUNNOTE_OFFSITE_INPUT "$ops/offsite.sh" setup --repository "$repo" </dev/null

step "2. a failed init leaves the configuration untouched"
: > "$WORK/blocker"
expect_fail "repository location that cannot exist" env RUNNOTE_OFFSITE_INPUT=/dev/null \
  "$ops/offsite.sh" setup --repository "$WORK/blocker/sub"
! grep -q '^RESTIC_REPOSITORY=' "$envfile" || fail "a failed setup wrote the repository setting"
[ ! -e "$WORK/etc/restic.password" ] || fail "a failed init left a password file behind"

step "3. setup: init, first backup, off-site retrieval check with a real restore drill"
reset_env
printf 'unrelated=kept\n' >> "$envfile"
printf '\n' > "$WORK/answers"  # the final "saved it" prompt is skipped without a terminal
RUNNOTE_OFFSITE_INPUT="$WORK/answers" "$ops/offsite.sh" setup --repository "$repo" 2>"$WORK/setup.log" \
  || { cat "$WORK/setup.log" >&2; fail "setup failed"; }
grep -q "^RESTIC_REPOSITORY=$repo\$" "$envfile" || fail "repository not written"
grep -q '^RESTIC_PASSWORD_FILE=' "$envfile" || fail "password file not referenced"
grep -q '^unrelated=kept$' "$envfile" || fail "existing settings were lost"
grep -q '^PGDATABASE=rn_offsite$' "$envfile" || fail "PGDATABASE was lost"
[ -s "$WORK/etc/restic.password" ] || fail "no password file"
[ "$(wc -c < "$WORK/etc/restic.password" | tr -d ' ')" -ge 41 ] || fail "password too short"
perm="$(python3 -c 'import os,sys;print(oct(os.stat(sys.argv[1]).st_mode & 0o777))' "$WORK/etc/restic.password")"
[ "$perm" = 0o640 ] || fail "password file mode is $perm, expected 0o640"
! grep -q "$(cat "$WORK/etc/restic.password")" "$WORK/setup.log" || fail "the password leaked into the log"
grep -q 'restore drill' "$WORK/setup.log" || fail "setup did not run the restore drill on the off-site copy"
grep -q 'off-site copy verified' "$WORK/setup.log" || fail "no verification line"

step "4. a second setup refuses to replace an existing configuration or key"
expect_fail "already configured" env RUNNOTE_OFFSITE_INPUT=/dev/null "$ops/offsite.sh" setup --repository "$WORK/other"
[ ! -e "$WORK/other" ] || fail "second setup touched another location"

step "5. verify passes; nightly backup uploads; verify sees the new snapshot"
"$ops/offsite.sh" verify || fail "verify failed on a healthy repository"
before="$(RESTIC_PASSWORD_FILE="$WORK/etc/restic.password" restic -r "$repo" snapshots --json | python3 -c 'import json,sys;print(len(json.load(sys.stdin)))')"
python3 "$ops/envfile.py" exec "$envfile" -- env RESTIC_CACHE_DIR="$WORK/cache" "$ops/backup.sh" --label nightly >/dev/null 2>&1 \
  || fail "nightly backup with off-site failed"
after="$(RESTIC_PASSWORD_FILE="$WORK/etc/restic.password" restic -r "$repo" snapshots --json | python3 -c 'import json,sys;print(len(json.load(sys.stdin)))')"
[ "$after" -gt "$before" ] || fail "nightly backup did not add a snapshot ($before -> $after)"
"$ops/offsite.sh" verify || fail "verify failed after the nightly upload"

step "6. verify catches a damaged copy and a stale or empty repository"
cp -R "$repo" "$WORK/repo.good"
chmod -R u+w "$repo"
find "$repo/data" -type f -exec sh -c ': > "$1"' _ {} \;
expect_fail "emptied data packs" "$ops/offsite.sh" verify
chmod -R u+w "$repo"; rm -rf -- "$repo"; mv "$WORK/repo.good" "$repo"
"$ops/offsite.sh" verify || fail "verify did not recover after restoring the repository"
python3 - "$envfile" "$WORK/repo.empty" <<'PY'
import re, sys
path, repo = sys.argv[1:3]
text = re.sub(r"^RESTIC_REPOSITORY=.*$", "RESTIC_REPOSITORY=" + repo, open(path).read(), flags=re.M)
open(path, "w").write(text)
PY
RESTIC_PASSWORD_FILE="$WORK/etc/restic.password" restic init -r "$WORK/repo.empty" >/dev/null
expect_fail "repository with no snapshot" "$ops/offsite.sh" verify
grep -q 'no snapshot' "$WORK/last.out" || fail "empty repository not reported as such"

echo "=== ALL OFFSITE E2E STEPS PASSED" >&2
