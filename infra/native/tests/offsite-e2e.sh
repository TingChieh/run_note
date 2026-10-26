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
[ ! -e "$WORK/backups/restic.password" ] || fail "a failed init left a password file behind"

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
[ -s "$WORK/backups/restic.password" ] || fail "no password file"
[ "$(wc -c < "$WORK/backups/restic.password" | tr -d ' ')" -ge 41 ] || fail "password too short"
perm="$(python3 -c 'import os,sys;print(oct(os.stat(sys.argv[1]).st_mode & 0o777))' "$WORK/backups/restic.password")"
[ "$perm" = 0o600 ] || fail "password file mode is $perm, expected 0o600"
! grep -q "$(cat "$WORK/backups/restic.password")" "$WORK/setup.log" || fail "the password leaked into the log"
grep -q 'restore drill' "$WORK/setup.log" || fail "setup did not run the restore drill on the off-site copy"
grep -q 'off-site copy verified' "$WORK/setup.log" || fail "no verification line"

step "4. a second setup refuses to replace an existing configuration or key"
expect_fail "already configured" env RUNNOTE_OFFSITE_INPUT=/dev/null "$ops/offsite.sh" setup --repository "$WORK/other"
[ ! -e "$WORK/other" ] || fail "second setup touched another location"

step "5. verify passes; nightly backup uploads; verify sees the new snapshot"
"$ops/offsite.sh" verify || fail "verify failed on a healthy repository"
before="$(RESTIC_PASSWORD_FILE="$WORK/backups/restic.password" restic -r "$repo" snapshots --json | python3 -c 'import json,sys;print(len(json.load(sys.stdin)))')"
python3 "$ops/envfile.py" exec "$envfile" -- env RESTIC_CACHE_DIR="$WORK/cache" "$ops/backup.sh" --label nightly >/dev/null 2>&1 \
  || fail "nightly backup with off-site failed"
after="$(RESTIC_PASSWORD_FILE="$WORK/backups/restic.password" restic -r "$repo" snapshots --json | python3 -c 'import json,sys;print(len(json.load(sys.stdin)))')"
[ "$after" -gt "$before" ] || fail "nightly backup did not add a snapshot ($before -> $after)"
"$ops/offsite.sh" verify || fail "verify failed after the nightly upload"

step "5b. ship (pre-deploy) snapshots are trimmed by their own policy and never touch the nightly ones"
snap_count() { # $1 = tag
  RESTIC_PASSWORD_FILE="$WORK/backups/restic.password" restic -r "$repo" snapshots --json --tag "$1" \
    | python3 -c 'import json,sys;print(len(json.load(sys.stdin) or []))'
}
nightly_before="$(snap_count nightly)"
for n in 1 2 3 4; do
  sleep 1
  python3 "$ops/envfile.py" exec "$envfile" -- env RESTIC_CACHE_DIR="$WORK/cache" KEEP_SHIP=2 "$ops/backup.sh" --label "ship-e2e$n" >/dev/null 2>&1 \
    || fail "ship backup $n with off-site failed"
done
[ "$(snap_count ship)" = 2 ] || fail "expected 2 ship snapshots off-site, found $(snap_count ship)"
[ "$(snap_count ship-e2e4)" = 1 ] || fail "newest ship snapshot was forgotten"
[ "$(snap_count nightly)" = "$nightly_before" ] || fail "ship snapshots changed the nightly snapshots"
"$ops/offsite.sh" verify || fail "verify failed after the ship uploads"

step "5c. the nightly policy really forgets: of three same-day snapshots only the middle one goes"
# restic keeps the newest snapshot of a period and, in addition, the oldest one.
for t in "2026-03-01 08:00:00" "2026-03-01 12:00:00" "2026-03-01 20:00:00"; do
  f="$WORK/backups/rn_offsite-dup-${t//[ :]/}-nightly.dump"; printf '%s\n' "$t" > "$f"
  python3 "$ops/envfile.py" exec "$envfile" -- env RESTIC_CACHE_DIR="$WORK/cache" \
    restic backup --time "$t" --tag nightly --tag rn_offsite "$f" >/dev/null 2>&1 || fail "seeding old snapshot failed"
done
old_day() { RESTIC_PASSWORD_FILE="$WORK/backups/restic.password" restic -r "$repo" snapshots --json --tag nightly \
  | python3 -c 'import json,sys;print(" ".join(sorted(s["time"][11:13] for s in json.load(sys.stdin) if s["time"].startswith("2026-03-01"))))'; }
[ "$(old_day)" = "08 12 20" ] || fail "seeding did not create the 3 same-day snapshots: $(old_day)"
python3 "$ops/envfile.py" exec "$envfile" -- env RESTIC_CACHE_DIR="$WORK/cache" "$ops/backup.sh" --label nightly >/dev/null 2>&1 \
  || fail "nightly backup failed"
[ "$(old_day)" = "08 20" ] || fail "nightly policy left: $(old_day) (expected 08 20: the middle duplicate forgotten)"

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
RESTIC_PASSWORD_FILE="$WORK/backups/restic.password" restic init -r "$WORK/repo.empty" >/dev/null
expect_fail "repository with no snapshot" "$ops/offsite.sh" verify
grep -q 'no snapshot' "$WORK/last.out" || fail "empty repository not reported as such"

step "7. finish: a password file left in the root-only config directory is moved where postgres can read it"
python3 - "$envfile" "$repo" <<'PY'
import re, sys
path, repo = sys.argv[1:3]
text = re.sub(r"^RESTIC_REPOSITORY=.*$", "RESTIC_REPOSITORY=" + repo, open(path).read(), flags=re.M)
open(path, "w").write(text)
PY
mv "$WORK/backups/restic.password" "$WORK/etc/restic.password"
python3 - "$envfile" "$WORK/etc/restic.password" <<'PY'
import re, sys
path, pw = sys.argv[1:3]
text = re.sub(r"^RESTIC_PASSWORD_FILE=.*$", "RESTIC_PASSWORD_FILE=" + pw, open(path).read(), flags=re.M)
open(path, "w").write(text)
PY
printf '\n' > "$WORK/answers"
RUNNOTE_OFFSITE_INPUT="$WORK/answers" "$ops/offsite.sh" finish 2>"$WORK/finish.log" \
  || { cat "$WORK/finish.log" >&2; fail "finish failed"; }
[ -s "$WORK/backups/restic.password" ] || fail "finish did not move the password file"
[ ! -e "$WORK/etc/restic.password" ] || fail "the old password file is still in the config directory"
grep -q "^RESTIC_PASSWORD_FILE=$WORK/backups/restic.password\$" "$envfile" || fail "backup.env still points at the old password file"
grep -q 'off-site copy verified' "$WORK/finish.log" || fail "finish did not verify"
"$ops/offsite.sh" verify || fail "verify failed after finish"

step "8. verify as the database account does not need to see backup.env (root loaded it already)"
# As root, backup.env is read first and the check then runs as postgres, whose view of the root-only
# directory makes the file invisible. Reproduce that: the settings come from the environment and
# the file does not exist.
python3 - "$envfile" "$repo" <<'PY'
import re, sys
path, repo = sys.argv[1:3]
text = re.sub(r"^RESTIC_REPOSITORY=.*$", "RESTIC_REPOSITORY=" + repo, open(path).read(), flags=re.M)
open(path, "w").write(text)
PY
env RUNNOTE_BACKUP_ENV_LOADED=1 BACKUP_ENV="$WORK/etc/invisible.env" PGDATABASE=rn_offsite \
  RESTIC_REPOSITORY="$repo" RESTIC_PASSWORD_FILE="$WORK/backups/restic.password" \
  "$ops/offsite.sh" verify --no-drill > "$WORK/invisible.log" 2>&1 \
  || { cat "$WORK/invisible.log" >&2; fail "verify needed to see backup.env after it was already loaded"; }
! grep -q 'does not exist' "$WORK/invisible.log" || fail "verify still checks for backup.env"

echo "=== ALL OFFSITE E2E STEPS PASSED" >&2
