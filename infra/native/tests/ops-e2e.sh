#!/usr/bin/env bash
# End-to-end rehearsal of build -> deploy -> migrate -> rollback -> restore against a THROW-AWAY
# PostgreSQL cluster in a temp directory. Never touches /opt, /etc, systemd or any real database.
#
#   ops-e2e.sh RELEASE_TARBALL           (needs PG_BIN, PYTHON; optional WORK)
#
# PG_BIN  directory with initdb/pg_ctl/psql/... for PostgreSQL 18 + PostGIS installed
# PYTHON  python3.12 used to create each release's virtualenv (network or pip cache needed)
# Stand-ins (all inside $WORK/shims): systemctl, runuser, chown, and on macOS flock/mv -T.
# shellcheck disable=SC2012 # listing names this script generated
set -euo pipefail
tarball="${1:?usage: ops-e2e.sh RELEASE_TARBALL}"
: "${PG_BIN:?}" "${PYTHON:?}"
here="$(cd "$(dirname "$0")" && pwd)"
# The rehearsal's "old" schema is the head minus the newest migration; both revisions are read from
# the migration files so a new migration never needs a change here.
read -r HEAD_REV OLD_REV < <(python3 - "$here/../../../backend/migrations/versions" <<'PY'
import re, sys
from pathlib import Path
files = sorted(p for p in Path(sys.argv[1]).glob("[0-9][0-9][0-9][0-9]_*.py"))
def field(path, name):
    return re.search(rf'^{name}\s*=\s*"([^"]+)"', path.read_text(), re.M).group(1)
print(field(files[-1], "revision"), field(files[-1], "down_revision"))
PY
)
[ -n "$HEAD_REV" ] && [ -n "$OLD_REV" ] || { echo "cannot derive migration revisions" >&2; exit 1; }
WORK="${WORK:-$(mktemp -d)}"
port="${PG_PORT:-55441}" api_port=18000 web_port=18001
rm -rf "$WORK"; mkdir -p "$WORK"/{shims,etc,root,backups}
sock="$(mktemp -d /tmp/rnsock.XXXXXX)"  # unix socket paths are limited to ~100 bytes
fail() { echo "E2E FAIL: $*" >&2; exit 1; }
step() { echo "=== $*" >&2; }
expect_fail() { # $1 description, rest: command. Succeeds when the command fails.
  local d="$1"; shift
  if "$@" >"$WORK/last.out" 2>&1; then cat "$WORK/last.out" >&2; fail "expected failure: $d"; fi
  echo "ok (refused as designed): $d" >&2
}
cleanup() {
  [ -z "${fake_api:-}" ] || kill "$fake_api" 2>/dev/null || true
  [ -z "${fake_web:-}" ] || kill "$fake_web" 2>/dev/null || true
  "$PG_BIN/pg_ctl" -D "$WORK/pg" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$sock"
}
trap cleanup EXIT

# ---- stand-ins -------------------------------------------------------------------------
printf '#!/bin/sh\nexit 0\n' > "$WORK/shims/systemctl"
printf '#!/bin/sh\nexit 0\n' > "$WORK/shims/chown"
printf '#!/bin/sh\n# runuser -u USER -- CMD...\nshift 3\nexec "$@"\n' > "$WORK/shims/runuser"
if [ "$(uname)" = Darwin ]; then
  printf '#!/bin/sh\nexit 0\n' > "$WORK/shims/flock"
  cat > "$WORK/shims/mv" <<'SH'
#!/bin/sh
if [ "$1" = "-T" ]; then exec python3 -c 'import os,sys; os.replace(sys.argv[1], sys.argv[2])' "$2" "$3"; fi
exec /bin/mv "$@"
SH
fi
chmod +x "$WORK"/shims/*
export PATH="$WORK/shims:$PG_BIN:$PATH"

# ---- throw-away database ---------------------------------------------------------------
"$PG_BIN/initdb" -D "$WORK/pg" -U postgres -A trust --no-locale -E UTF8 >/dev/null
"$PG_BIN/pg_ctl" -D "$WORK/pg" -l "$WORK/pg.log" -o "-h 127.0.0.1 -p $port -k $sock" -w start >/dev/null
export PGHOST=127.0.0.1 PGPORT=$port PGUSER=postgres
createdb rn_e2e
dburl="postgresql+psycopg://postgres:pw@127.0.0.1:$port/rn_e2e"

# ---- derive an older release (without the newest migration) and a same-schema sibling from the built tarball --
python3 - "$tarball" "$WORK" <<'PY'
import os, shutil, sys, tarfile
src, work = sys.argv[1:]
def variant(new_id, drop_last_migration, bad_migration=False):
    stage = os.path.join(work, "variant")
    shutil.rmtree(stage, ignore_errors=True); os.makedirs(stage)
    with tarfile.open(src) as t: t.extractall(stage)
    top = os.listdir(stage)[0]
    new = os.path.join(stage, new_id); os.rename(os.path.join(stage, top), new)
    with open(os.path.join(new, "RELEASE")) as f: lines = f.read().splitlines()
    lines = [("id=" + new_id) if l.startswith("id=") else l for l in lines]
    open(os.path.join(new, "RELEASE"), "w").write("\n".join(lines) + "\n")
    if drop_last_migration:
        v = os.path.join(new, "backend", "migrations", "versions")
        last = sorted(f for f in os.listdir(v) if f[:4].isdigit() and f.endswith(".py"))[-1]
        os.remove(os.path.join(v, last))
    if bad_migration:
        v = os.path.join(new, "backend", "migrations", "versions")
        last = sorted(f for f in os.listdir(v) if f[:4].isdigit() and f.endswith(".py"))[-1][:-3]
        body = (
            f'revision = "9999_e2e_bad"\ndown_revision = "{last}"\nbranch_labels = None\n'
            'depends_on = None\n\n\ndef upgrade():\n    raise RuntimeError("synthetic failure")\n'
            "\n\ndef downgrade():\n    pass\n"
        )
        open(os.path.join(v, "9999_e2e_bad.py"), "w").write(body)
    out = os.path.join(work, f"run-note-{new_id}.tar.gz")
    with tarfile.open(out, "w:gz") as t: t.add(new, arcname=new_id)
    import hashlib
    h = hashlib.sha256(open(out, "rb").read()).hexdigest()
    open(out + ".sha256", "w").write(f"{h}  {os.path.basename(out)}\n")
variant("e2e-r0-old-schema", True)
variant("e2e-r1-sibling", False)
variant("e2e-r3-old-sibling", True)
variant("e2e-r4-bad-migration", False, True)
PY
r0="$WORK/run-note-e2e-r0-old-schema.tar.gz"; r1="$tarball"; r2="$WORK/run-note-e2e-r1-sibling.tar.gz"
r3="$WORK/run-note-e2e-r3-old-sibling.tar.gz"
r4="$WORK/run-note-e2e-r4-bad-migration.tar.gz"
[ -f "$r1.sha256" ] || fail "tarball has no .sha256"

# ---- config files ----------------------------------------------------------------------
cat > "$WORK/etc/backend.env" <<ENV
APP_ENV=production
DATABASE_URL=$dburl
SITE_ORIGIN=https://run.example.test
SITE_OWNER_EMAIL=owner@example.test
AUTH_RATE_HASH_KEY=$(python3 -c 'import secrets;print(secrets.token_urlsafe(48))')
AUTH_TRUSTED_PROXIES='["127.0.0.1"]'
ENV
printf 'INTERNAL_API_BASE_URL=http://127.0.0.1:%s\n' "$api_port" > "$WORK/etc/frontend.env"
printf 'PGDATABASE=rn_e2e\nPGHOST=127.0.0.1\nPGPORT=%s\nPGUSER=postgres\n' "$port" > "$WORK/etc/backup.env"
chmod 600 "$WORK"/etc/*.env

export DB_OWNER=postgres  # the throw-away cluster has no `runnote` role
export RUNNOTE_ALLOW_NONROOT=1 RUNNOTE_ROOT="$WORK/root" RUNNOTE_ETC="$WORK/etc" BACKUP_DIR="$WORK/backups"
export API_URL="http://127.0.0.1:$api_port" WEB_URL="http://127.0.0.1:$web_port"
export SMOKE_API_TIMEOUT=6 SMOKE_WEB_TIMEOUT=4 PYTHON
python3 "$here/fake_health.py" $api_port & fake_api=$!
python3 "$here/fake_health.py" $web_port & fake_web=$!

ops_of() { # extract a tarball's ops/ so we run ITS deploy.sh, as an operator would
  local t="$1" d; d="$(mktemp -d "$WORK/ops.XXXX")"; tar -xzf "$t" -C "$d" --strip-components=1 --include='*/ops/*' 2>/dev/null \
    || tar -xzf "$t" -C "$d" --strip-components=1
  echo "$d/ops"
}
deploy() { "$(ops_of "$1")/deploy.sh" "${@:2}" "$1"; }

step "0. configuration guard: missing AUTH_TRUSTED_PROXIES is refused before anything is installed"
cp "$WORK/etc/backend.env" "$WORK/backend.env.good"
grep -v AUTH_TRUSTED_PROXIES "$WORK/backend.env.good" > "$WORK/etc/backend.env"; chmod 600 "$WORK/etc/backend.env"
expect_fail "deploy with unsafe config" deploy "$r0"
grep -q AUTH_TRUSTED_PROXIES "$WORK/last.out" || fail "refusal did not name AUTH_TRUSTED_PROXIES"
[ ! -e "$WORK/root/current" ] || fail "something was installed despite bad config"
cp "$WORK/backend.env.good" "$WORK/etc/backend.env"; chmod 600 "$WORK/etc/backend.env"

step "1. database at the OLD revision with some data"
(cd "$here/../../../backend" && DATABASE_URL="$dburl" "$PYTHON" -m venv "$WORK/mig-venv" >/dev/null \
  && "$WORK/mig-venv/bin/pip" install -q --require-hashes -r requirements.lock \
  && DATABASE_URL="$dburl" "$WORK/mig-venv/bin/python" -m alembic upgrade "$OLD_REV" 2>&1 | tail -1)
psql -X -qAt -d rn_e2e -c "insert into users(id,email_normalized,username,password_hash,display_name) values (gen_random_uuid(),'seed@example.test','seed','x','Seed')" >/dev/null
rev() { psql -X -qAt -d rn_e2e -c 'select version_num from alembic_version'; }
[ "$(rev)" = "$OLD_REV" ] || fail "setup revision wrong: $(rev)"

step "I. first initialisation of a database that has no schema yet (separate root/etc/backups)"
INIT="$WORK/init"; mkdir -p "$INIT"
init_db() { # $1 database; leaves a pre-created PostGIS-only database and its own config
  dropdb --if-exists "$1"; createdb "$1"; psql -X -qAt -d "$1" -c "create extension postgis" >/dev/null
  rm -rf "${INIT:?}/etc" "${INIT:?}/root" "${INIT:?}/backups"; mkdir -p "$INIT/etc" "$INIT/root" "$INIT/backups"
  sed "s#/rn_e2e\$#/$1#" "$WORK/etc/backend.env" > "$INIT/etc/backend.env"
  cp "$WORK/etc/frontend.env" "$INIT/etc/frontend.env"
  printf 'PGDATABASE=%s\nPGHOST=127.0.0.1\nPGPORT=%s\nPGUSER=postgres\n' "$1" "$port" > "$INIT/etc/backup.env"
  chmod 600 "$INIT"/etc/*.env
}
init_deploy() { RUNNOTE_ROOT="$INIT/root" RUNNOTE_ETC="$INIT/etc" BACKUP_DIR="$INIT/backups" deploy "$@"; }
user_tables() { psql -X -qAt -d "$1" -c "select count(*) from pg_tables where schemaname='public' and tablename<>'spatial_ref_sys'"; }
has_version_table() { psql -X -qAt -d "$1" -c "select to_regclass('alembic_version') is not null"; }
no_backups() { [ -z "$(ls -A "$INIT/backups")" ] || fail "a backup/drill ran although there was nothing to protect"; }
untouched() { [ "$(has_version_table "$1")" = "$2" ] || fail "$1: alembic_version presence changed"; [ ! -e "$INIT/root/current" ] || fail "a release was installed"; }

# A virtualenv is not relocatable: its console scripts name the interpreter by absolute path. The
# release must therefore be built where it stays. Check the shebang and, below, run the real thing.
assert_final_path_venv() { # $1 root
  local rel real shebang
  rel="$(readlink "$1/current")"; real="$(cd "$rel" && pwd -P)"
  shebang="$(head -1 "$rel/backend/.venv/bin/uvicorn")"
  [ "$shebang" = "#!$real/backend/.venv/bin/python" ] || [ "$shebang" = "#!$rel/backend/.venv/bin/python" ] \
    || fail "uvicorn shebang does not name the final release path: $shebang"
  case "$shebang" in *.partial*) fail "uvicorn shebang still names a staging directory" ;; esac
  [ -e "$rel/.deploy-complete" ] || fail "installed release has no completion marker"
  for staged in "$1"/releases/.partial*; do [ ! -e "$staged" ] || fail "staging directory left behind: $staged"; done
}
real_stack_check() { # $1 root, $2 etc: start the INSTALLED uvicorn and node exactly as the systemd units do
  local root="$1" etc="$2" ap=18010 wp=18011 api web waited
  (cd "$root/current/backend" && exec python3 "$root/current/ops/envfile.py" exec "$etc/backend.env" -- \
    "$root/current/backend/.venv/bin/uvicorn" app.main:create_app --factory --host 127.0.0.1 --port $ap \
    --workers 1 --no-proxy-headers --no-server-header >"$WORK/real-api.log" 2>&1) & api=$!
  (cd "$root/current/frontend" && exec env INTERNAL_API_BASE_URL="http://127.0.0.1:$ap" HOST=127.0.0.1 PORT=$wp \
    PROTOCOL_HEADER=x-forwarded-proto BODY_SIZE_LIMIT=11M NODE_ENV=production node build/index.js \
    >"$WORK/real-web.log" 2>&1) & web=$!
  waited=0
  until curl -fsS --max-time 3 "http://127.0.0.1:$ap/api/v1/health/ready" >/dev/null 2>&1 \
    && curl -fsS --max-time 3 "http://127.0.0.1:$wp/api/health" >/dev/null 2>&1; do
    sleep 1; waited=$((waited + 1))
    if [ "$waited" -gt 45 ]; then
      kill "$api" "$web" 2>/dev/null || true; tail -5 "$WORK/real-api.log" "$WORK/real-web.log" >&2
      fail "the installed release did not become ready when started from its final path"
    fi
  done
  kill "$api" "$web" 2>/dev/null || true; wait "$api" "$web" 2>/dev/null || true
  echo "ok: installed uvicorn + node started from the final release path; /api/v1/health/ready and the Node proxy answered" >&2
}

init_db rn_init
expect_fail "empty database without --migrate" init_deploy "$r1"
grep -q "re-run with --migrate" "$WORK/last.out" || fail "refusal reason missing"
[ "$(user_tables rn_init)" = 0 ] || fail "schema created without --migrate"; untouched rn_init f; no_backups

init_db rn_init
psql -X -qAt -d rn_init -c "create table leftover(i int)" >/dev/null
expect_fail "unversioned database with an application table" init_deploy "$r1" --migrate
grep -q "contains objects" "$WORK/last.out" || fail "refusal reason missing"
[ "$(user_tables rn_init)" = 1 ] || fail "existing table was touched"; untouched rn_init f; no_backups

init_db rn_init
psql -X -qAt -d rn_init -c "create table alembic_version(version_num varchar(32) not null primary key)" >/dev/null
expect_fail "alembic_version without a row (half-initialised)" init_deploy "$r1" --migrate
grep -q "has no row" "$WORK/last.out" || fail "refusal reason missing"
[ "$(psql -X -qAt -d rn_init -c 'select count(*) from alembic_version')" = 0 ] || fail "alembic_version was touched"
[ ! -e "$INIT/root/current" ] || fail "a release was installed"; no_backups

init_db rn_init
psql -X -qAt -d rn_init -c "create extension pg_trgm" >/dev/null
expect_fail "unexpected extension" init_deploy "$r1" --migrate
grep -q "unexpected extension" "$WORK/last.out" || fail "refusal reason missing"
untouched rn_init f; no_backups

init_db rn_init
expect_fail "first initialisation whose migration fails" init_deploy "$r4" --migrate
grep -q "first initialisation failed" "$WORK/last.out" || fail "failure message missing"
[ "$(user_tables rn_init)" = 0 ] || fail "a failed first initialisation left tables behind"
untouched rn_init f; no_backups
[ -z "$(ls -A "$INIT/root/releases")" ] || fail "a failed deploy left a half-built release directory behind"
echo "ok: the failed attempt was rolled back (transactional DDL); the database is still empty" >&2

# The same database, retried with a good release: this is the real first deployment.
init_deploy "$r1" --migrate
[ "$(psql -X -qAt -d rn_init -c 'select version_num from alembic_version')" = "$HEAD_REV" ] || fail "not at head after first initialisation"
[ -L "$INIT/root/current" ] || fail "current not set after first initialisation"
no_backups
echo "ok: first initialisation migrated to head without any backup or restore drill" >&2
assert_final_path_venv "$INIT/root"
real_stack_check "$INIT/root" "$INIT/etc"

# An interrupted build (no completion marker) is not a release: it is neither deployed over,
# nor rolled back to, and it is never deleted automatically.
mkdir -p "$INIT/root/releases/e2e-r1-sibling/backend/migrations"
expect_fail "deploy over a never-completed release directory" init_deploy "$r2"
grep -q "never completed" "$WORK/last.out" || fail "refusal reason missing"
[ -d "$INIT/root/releases/e2e-r1-sibling" ] || fail "the unfinished directory was deleted automatically"
expect_fail "rollback to a never-completed release directory" env RUNNOTE_ROOT="$INIT/root" RUNNOTE_ETC="$INIT/etc" BACKUP_DIR="$INIT/backups" "$(ops_of "$r1")/rollback.sh" e2e-r1-sibling
grep -q "not a completed release" "$WORK/last.out" || fail "rollback refusal reason missing"
rm -rf "$INIT/root/releases/e2e-r1-sibling"

# Once initialised it is an ordinary database: a same-schema deploy needs no --migrate, no backup.
init_deploy "$r2"
no_backups
dropdb --if-exists rn_init

step "2. deploy old-schema release R0 (schema matches -> allowed, no migration)"
deploy "$r0"
[ "$(basename "$(readlink "$WORK/root/current")")" = e2e-r0-old-schema ] || fail "current not R0"

step "3. deploy R1 (needs migration) WITHOUT --migrate is refused and changes nothing"
expect_fail "behind without --migrate" deploy "$r1"
[ "$(rev)" = "$OLD_REV" ] || fail "database changed without --migrate"
[ "$(basename "$(readlink "$WORK/root/current")")" = e2e-r0-old-schema ] || fail "current moved"

step "4. deploy R1 --migrate: backup + REAL restore drill + migration + switch"
deploy "$r1" --migrate
[ "$(rev)" = "$HEAD_REV" ] || fail "not migrated: $(rev)"
pre="$(ls "$WORK"/backups/*-pre-*.dump | head -1)"; [ -s "$pre" ] || fail "no pre-migration dump"
[ -f "$pre.sha256" ] || fail "no checksum"
current_id="$(basename "$(readlink "$WORK/root/current")")"
[ "$current_id" != e2e-r0-old-schema ] || fail "current did not move to R1"
assert_final_path_venv "$WORK/root"

step "5. same-schema redeploy (R1 sibling): no migration, no backup"
before="$(ls "$WORK"/backups/*.dump | wc -l | tr -d ' ')"
deploy "$r2"
[ "$(ls "$WORK"/backups/*.dump | wc -l | tr -d ' ')" = "$before" ] || fail "unexpected backup on same-schema deploy"
rollback_to() { "$(ops_of "$r1")/rollback.sh" "$@"; }

step "6. rollback to the previous release (schema matches) just switches"
rollback_to previous
[ "$(basename "$(readlink "$WORK/root/current")")" = "$current_id" ] || fail "rollback previous did not return to R1"

step "7. rollback across the migration is REFUSED without a database restore"
expect_fail "rollback to R0 over a newer schema" rollback_to e2e-r0-old-schema
grep -q "does not match" "$WORK/last.out" || fail "refusal reason missing"
[ "$(rev)" = "$HEAD_REV" ] || fail "refused rollback still changed the database"

step "8. rollback to R0 WITH restore of the pre-migration dump"
psql -X -qAt -d rn_e2e -c "insert into users(id,email_normalized,username,password_hash,display_name) values (gen_random_uuid(),'late@example.test','late','x','Late')" >/dev/null
printf 'rn_e2e\n' | rollback_to e2e-r0-old-schema --restore-db "$pre"
[ "$(rev)" = "$OLD_REV" ] || fail "restore did not return to the old revision: $(rev)"
[ "$(basename "$(readlink "$WORK/root/current")")" = e2e-r0-old-schema ] || fail "current not R0 after restore"
[ "$(psql -X -qAt -d rn_e2e -c "select count(*) from users where username='late'")" = 0 ] || fail "post-backup write should be gone"
safety="$(psql -X -qAt -d postgres -c "select datname from pg_database where datname like 'rn_e2e_pre_rollback_%'")"
[ -n "$safety" ] || fail "safety copy of the replaced database is missing"
[ "$(psql -X -qAt -d "$safety" -c "select count(*) from users where username='late'")" = 1 ] || fail "safety copy lost the late write"
echo "ok: write after backup is discarded in live DB but preserved in $safety" >&2

step "9. failed smoke test on a same-schema deploy returns to the previous release automatically"
kill "$fake_api" "$fake_web"; wait "$fake_api" "$fake_web" 2>/dev/null || true; fake_api="" fake_web=""
expect_fail "smoke failure" deploy "$r3"
grep -q "automatically returning" "$WORK/last.out" || fail "no automatic return logged"
[ "$(basename "$(readlink "$WORK/root/current")")" = e2e-r0-old-schema ] || fail "did not return to previous release"

step "ALL OPS E2E STEPS PASSED"
# A passing run leaves nothing behind (each release has its own virtualenv, ~1 GB per run). A failing
# run keeps $WORK for diagnosis; set KEEP_WORK=1 to keep it on success as well.
if [ -z "${KEEP_WORK:-}" ]; then rm -rf "${WORK:?}"; fi
