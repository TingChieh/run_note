#!/usr/bin/env bash
# Two-instance rehearsal on a throw-away PostgreSQL cluster: the legacy single-instance layout (what
# the staging host runs) and an additional "production" instance side by side. Proves that the two
# share nothing and that a failure, backup, restore or rollback in one cannot reach the other.
#
#   ops-e2e-instances.sh RELEASE_TARBALL      (needs PG_BIN, PYTHON; optional WORK)
#
# PG_BIN  directory with initdb/pg_ctl/psql/... for PostgreSQL 18 + PostGIS installed
# PYTHON  python3.12 used to create each release's virtualenv
# Stand-ins (inside $WORK/shims, every call logged): systemctl, runuser, chown, useradd, groupadd,
# getent, caddy, and on macOS flock / mv -T. Nothing touches /opt, /etc or a real service.
# shellcheck disable=SC2012 # listing names this script generated
set -euo pipefail
tarball="${1:?usage: ops-e2e-instances.sh RELEASE_TARBALL}"
: "${PG_BIN:?}" "${PYTHON:?}"
here="$(cd "$(dirname "$0")" && pwd)"
WORK="${WORK:-$(mktemp -d)}"
rm -rf "$WORK"; mkdir -p "$WORK"; WORK="$(cd "$WORK" && pwd -P)"
port="${PG_PORT:-55442}"
L_API=18200 L_WEB=18201   # legacy ("staging") listeners
P_API=18300 P_WEB=18301   # production instance listeners
sock="$(mktemp -d /tmp/rnsock.XXXXXX)"  # unix socket paths are limited to ~100 bytes
fail() { echo "E2E FAIL: $*" >&2; exit 1; }
step() { echo "=== $*" >&2; }
expect_fail() { local d="$1"; shift; if "$@" >"$WORK/last.out" 2>&1; then cat "$WORK/last.out" >&2; fail "expected failure: $d"; fi; echo "ok (refused as designed): $d" >&2; }
cleanup() {
  for pid in ${pids:-}; do kill "$pid" 2>/dev/null || true; done
  "$PG_BIN/pg_ctl" -D "$WORK/pg" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$sock"
}
trap cleanup EXIT
pids=""

# ---- stand-ins --------------------------------------------------------------------------
mkdir -p "$WORK/shims"
for tool in systemctl chown useradd groupadd; do
  printf '#!/bin/sh\necho "%s $*" >> "%s/calls.log"\nexit 0\n' "$tool" "$WORK" > "$WORK/shims/$tool"
done
cat > "$WORK/shims/runuser" <<SH
#!/bin/sh
# runuser -u USER -- CMD...
echo "runuser \$2" >> "$WORK/calls.log"
shift 3
exec "\$@"
SH
printf '#!/bin/sh\nexit 2\n' > "$WORK/shims/getent"   # "group not found" -> groupadd is invoked
cat > "$WORK/shims/caddy" <<SH
#!/bin/sh
echo "caddy \$*" >> "$WORK/calls.log"
[ ! -e "$WORK/caddy-fail" ] || { echo "synthetic validation error" >&2; exit 1; }
exit 0
SH
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
: > "$WORK/calls.log"

# ---- throw-away cluster -----------------------------------------------------------------
"$PG_BIN/initdb" -D "$WORK/pg" -U postgres -A trust --no-locale -E UTF8 >/dev/null
"$PG_BIN/pg_ctl" -D "$WORK/pg" -l "$WORK/pg.log" -o "-h 127.0.0.1 -p $port -k $sock" -w start >/dev/null
export PGHOST=127.0.0.1 PGPORT=$port PGUSER=postgres
psql -X -qAt -d postgres -c "create role rn_legacy_role login password 'x'" -c "create database rn_legacy owner rn_legacy_role" >/dev/null
psql -X -qAt -d rn_legacy -c "create extension postgis" >/dev/null   # the administrator's job, as on the host
pgq() { psql -X -qAt -v ON_ERROR_STOP=1 "$@"; }

# ---- derive extra releases from the built tarball ---------------------------------------
python3 - "$tarball" "$WORK" <<'PY'
import hashlib, os, shutil, sys, tarfile
src, work = sys.argv[1:]
def variant(new_id, bad_migration=False):
    stage = os.path.join(work, "variant")
    shutil.rmtree(stage, ignore_errors=True); os.makedirs(stage)
    with tarfile.open(src) as t: t.extractall(stage)
    top = os.listdir(stage)[0]
    new = os.path.join(stage, new_id); os.rename(os.path.join(stage, top), new)
    lines = open(os.path.join(new, "RELEASE")).read().splitlines()
    lines = [("id=" + new_id) if l.startswith("id=") else l for l in lines]
    open(os.path.join(new, "RELEASE"), "w").write("\n".join(lines) + "\n")
    if bad_migration:
        v = os.path.join(new, "backend", "migrations", "versions")
        last = sorted(f for f in os.listdir(v) if f[:4].isdigit() and f.endswith(".py"))[-1][:-3]
        open(os.path.join(v, "9999_e2e_bad.py"), "w").write(
            f'revision = "9999_e2e_bad"\ndown_revision = "{last}"\nbranch_labels = None\ndepends_on = None\n\n\n'
            'def upgrade():\n    raise RuntimeError("synthetic failure")\n\n\ndef downgrade():\n    pass\n')
    out = os.path.join(work, f"run-note-{new_id}.tar.gz")
    with tarfile.open(out, "w:gz") as t: t.add(new, arcname=new_id)
    open(out + ".sha256", "w").write(f"{hashlib.sha256(open(out, 'rb').read()).hexdigest()}  {os.path.basename(out)}\n")
variant("e2e-i-sibling")
variant("e2e-i-legacy-only")
variant("e2e-i-bad-migration", True)
PY
r1="$tarball"; r2="$WORK/run-note-e2e-i-sibling.tar.gz"; rbad="$WORK/run-note-e2e-i-bad-migration.tar.gz"
rleg="$WORK/run-note-e2e-i-legacy-only.tar.gz"
[ -f "$r1.sha256" ] || fail "tarball has no .sha256"

# ---- layout: legacy via the old environment overrides, production via an instance file ---
L="$WORK/legacy"; P="$WORK/prod"; mkdir -p "$L"/{etc,root,backups} "$WORK/instances"
conf="$WORK/instances/prod.conf"
cat > "$conf" <<CONF
INSTANCE=prod
DOMAIN=prod.example.test
ROOT=$P/opt
ETC=$P/etc
BACKUP_DIR=$P/backups
APP_USER=rn_prod
APP_GROUP=rn_prod
DB_NAME=rn_prod
DB_ROLE=rn_prod
API_PORT=$P_API
WEB_PORT=$P_WEB
SERVICE_API=runnote-prod-api
SERVICE_WEB=runnote-prod-web
SERVICE_BACKUP=runnote-prod-backup
BACKUP_ONCALENDAR=*-*-* 03:15:00 Asia/Hong_Kong
BACKUP_RANDOM_DELAY=0
CONF
export RUNNOTE_ALLOW_NONROOT=1 SMOKE_API_TIMEOUT=6 SMOKE_WEB_TIMEOUT=4 PYTHON
export RUNNOTE_INSTANCES_DIR="$WORK/instances" SYSTEMD_DIR="$WORK/systemd"; mkdir -p "$SYSTEMD_DIR"

legacy_env() { RUNNOTE_ROOT="$L/root" RUNNOTE_ETC="$L/etc" BACKUP_DIR="$L/backups" API_URL="http://127.0.0.1:$L_API" WEB_URL="http://127.0.0.1:$L_WEB" DB_OWNER=rn_legacy_role "$@"; }
prod_env() { RUNNOTE_INSTANCE=prod "$@"; }
ops_of() { local t="$1" d; d="$(mktemp -d "$WORK/ops.XXXX")"; tar -xzf "$t" -C "$d" --strip-components=1; echo "$d/ops"; }
# Every instance tool below runs from the UNPACKED RELEASE, exactly as an operator would run it.
REL_OPS="$(ops_of "$r1")"; REL_ROOT="$(dirname "$REL_OPS")"
[ -f "$REL_ROOT/infra/native/templates/api.service.in" ] || fail "the unpacked release carries no templates"
[ ! -e "$REL_OPS/templates" ] || fail "test premise: templates must not sit next to ops/ in a release"
legacy_deploy() { legacy_env "$(ops_of "$1")/deploy.sh" "${@:2}" "$1"; }
prod_deploy() { prod_env "$(ops_of "$1")/deploy.sh" "${@:2}" "$1"; }
cur() { basename "$(readlink "$1/current")"; }
rev() { pgq -d "$1" -c 'select version_num from alembic_version'; }

python3 "$here/fake_health.py" $L_API & pids="$pids $!"
python3 "$here/fake_health.py" $L_WEB & pids="$pids $!"
python3 "$here/fake_health.py" $P_API & fake_p_api=$!; pids="$pids $fake_p_api"
python3 "$here/fake_health.py" $P_WEB & fake_p_web=$!; pids="$pids $fake_p_web"

step "1. instance definitions are valid and disjoint from the legacy layout and from each other"
python3 "$REL_OPS/instance.py" check --dir "$WORK/instances" | tee "$WORK/last.out" >&2
cp "$conf" "$WORK/instances/clash.conf"; sed -i.bak 's/^INSTANCE=prod/INSTANCE=clash/' "$WORK/instances/clash.conf"
expect_fail "a second instance that reuses prod's ports/user/database" python3 "$REL_OPS/instance.py" check --dir "$WORK/instances"
rm -f "$WORK/instances/clash.conf" "$WORK/instances/clash.conf.bak"

step "2. legacy installation: first initialisation + deploy with the old, unchanged environment overrides"
printf 'APP_ENV=production\nDATABASE_URL=postgresql+psycopg://rn_legacy_role:pw@127.0.0.1:%s/rn_legacy\nSITE_ORIGIN=https://legacy.example.test\nSITE_OWNER_EMAIL=legacy-owner@example.test\nAUTH_RATE_HASH_KEY=%s\nAUTH_TRUSTED_PROXIES=%s\n' \
  "$port" "$(python3 -c 'import secrets;print(secrets.token_urlsafe(48))')" "'[\"127.0.0.1\"]'" > "$L/etc/backend.env"
printf 'INTERNAL_API_BASE_URL=http://127.0.0.1:%s\n' "$L_API" > "$L/etc/frontend.env"
printf 'PGDATABASE=rn_legacy\nPGHOST=127.0.0.1\nPGPORT=%s\nPGUSER=postgres\n' "$port" > "$L/etc/backup.env"
chmod 600 "$L"/etc/*.env
legacy_deploy "$r1" --migrate
legacy_deploy "$rleg"   # a release id that exists ONLY under the legacy root
legacy_head="$(rev rn_legacy)"; legacy_release="$(cur "$L/root")"
[ "$legacy_release" = e2e-i-legacy-only ] || fail "legacy-only release is not current"
[ -n "$legacy_head" ] || fail "legacy database was not initialised"
grep -q "restart runnote-api" "$WORK/calls.log" || fail "legacy services were not restarted by their legacy names"

step "3. init-instance.sh creates production: user, directories, role, database, env files, units; nothing started"
# A damaged release (a template missing) must be refused before ANYTHING is created.
broken="$(mktemp -d "$WORK/broken.XXXX")"; cp -R "$REL_ROOT/." "$broken/"; rm "$broken/infra/native/templates/web.service.in"
: > "$WORK/calls.log"
expect_fail "init-instance from a release whose template is missing" "$broken/ops/init-instance.sh" prod --owner-email owner@example.test
grep -q "web.service.in" "$WORK/last.out" || fail "the missing template is not named"
grep -q "nothing was created" "$WORK/last.out" || fail "preflight refusal message missing"
if grep -qE "useradd|groupadd|chown" "$WORK/calls.log"; then fail "the refused init already created users or changed ownership"; fi
if [ -e "$P" ]; then fail "the refused init already created directories"; fi
[ -z "$(pgq -d postgres -c "select 1 from pg_roles where rolname='rn_prod' union all select 1 from pg_database where datname='rn_prod'")" ] || fail "the refused init already created database objects"
rm -rf "$broken"
# the same tool, run from the unpacked release, with a path error in the instance definition
expect_fail "init-instance for an instance that has no definition" env RUNNOTE_INSTANCES_DIR="$WORK/no-such-dir" "$REL_OPS/init-instance.sh" prod --owner-email owner@example.test
[ ! -e "$P" ] || fail "init created directories for an unknown instance"
: > "$WORK/calls.log"
"$REL_OPS/init-instance.sh" prod --owner-email owner@example.test 2>&1 | tee "$WORK/init.out" >&2
for secret in "$(sed -n 's/^AUTH_RATE_HASH_KEY=//p' "$P/etc/backend.env")" "$(sed -n 's#^DATABASE_URL=postgresql+psycopg://[^:]*:\([^@]*\)@.*#\1#p' "$P/etc/backend.env")"; do
  [ -n "$secret" ] || fail "could not read a generated secret back"
  if grep -qF -- "$secret" "$WORK/init.out" "$WORK/calls.log"; then fail "a generated secret leaked into output or the command log"; fi
done
grep -q "groupadd --system rn_prod" "$WORK/calls.log" || fail "system group was not created"
grep -q "useradd --system --gid rn_prod .* rn_prod" "$WORK/calls.log" || fail "system user was not created"
grep -q "chown root:rn_prod $P/etc" "$WORK/calls.log" || fail "etc directory not handed to the instance group"
grep -qE "chown root:rn_prod .*backend.env" "$WORK/calls.log" || fail "backend.env not handed to the instance group"
grep -q "chown root:postgres .*backup.env" "$WORK/calls.log" || fail "backup.env not handed to postgres"
if grep -q "systemctl enable\|systemctl start\|systemctl restart" "$WORK/calls.log"; then fail "init-instance must not enable or start anything"; fi
mode() { python3 -c 'import os,stat,sys;print(oct(stat.S_IMODE(os.stat(sys.argv[1]).st_mode))[2:])' "$1"; }
[ "$(mode "$P/etc")" = 750 ] || fail "etc directory mode is $(mode "$P/etc"), want 750"
for f in backend frontend backup; do
  if [ "$(mode "$P/etc/$f.env")" != 640 ]; then fail "$f.env mode is not 640"; fi
done
[ "$(mode "$P/backups")" = 700 ] || fail "backup directory mode is not 700"
[ "$(mode "$P/opt")" = 755 ] || fail "instance root mode is not 755"
for u in runnote-prod-api.service runnote-prod-web.service runnote-prod-backup.service runnote-prod-backup.timer; do
  [ -f "$SYSTEMD_DIR/$u" ] || fail "unit $u not installed"
done
python3 "$REL_OPS/envfile.py" check "$P/etc/backend.env" --kind backend --skip-settings --expect-db-name rn_prod --expect-db-user rn_prod --expect-origin-host prod.example.test >&2
python3 "$REL_OPS/envfile.py" check "$P/etc/frontend.env" --kind frontend --expect-api-port "$P_API" >&2
grep -c . "$P/etc/backend.env" >/dev/null
[ "$(pgq -d postgres -c "select rolsuper::text||rolcreatedb::text||rolcreaterole::text from pg_roles where rolname='rn_prod'")" = "falsefalsefalse" ] || fail "application role has extra privileges"
[ "$(pgq -d rn_prod -c "select extname from pg_extension where extname='postgis'")" = postgis ] || fail "PostGIS not installed by the administrator"
secret_a="$(sed -n 's/^AUTH_RATE_HASH_KEY=//p' "$L/etc/backend.env")"; secret_b="$(sed -n 's/^AUTH_RATE_HASH_KEY=//p' "$P/etc/backend.env")"
if [ -z "$secret_b" ] || [ "$secret_a" = "$secret_b" ]; then fail "the instances share an AUTH_RATE_HASH_KEY"; fi
unset secret_a secret_b

step "3b. init-instance.sh refuses to run over anything that exists"
expect_fail "second init over existing env files" "$REL_OPS/init-instance.sh" prod --owner-email owner@example.test
grep -q "already exists" "$WORK/last.out" || fail "refusal reason missing"
rm -f "$P"/etc/*.env
expect_fail "init when the role/database already exist" "$REL_OPS/init-instance.sh" prod --owner-email owner@example.test
grep -q "already exists" "$WORK/last.out" || fail "role/database refusal reason missing"
# put the original files back is impossible (secrets were never kept); recreate the instance cleanly
pgq -d postgres -c "drop database rn_prod" -c "drop role rn_prod" >/dev/null
rm -rf "${P:?}/etc" "${P:?}/backups" "${P:?}/opt"
"$REL_OPS/init-instance.sh" prod --owner-email owner@example.test >/dev/null 2>&1

step "4. PostgreSQL boundary: each role reaches only its own database"
role_of() { sed -n 's#^DATABASE_URL=postgresql+psycopg://\([^:]*\):.*#\1#p' "$1"; }
[ "$(role_of "$P/etc/backend.env")" = rn_prod ] || fail "prod env does not use the prod role"
expect_fail "legacy role connecting to the production database" psql -X -qAt -U rn_legacy_role -d rn_prod -c "select 1"
grep -qi "permission denied" "$WORK/last.out" || fail "expected a permission error"
# the legacy database keeps PostgreSQL's default (PUBLIC may connect) but its tables are the owner's
expect_fail "production role reading legacy tables" psql -X -qAt -U rn_prod -d rn_legacy -c "select count(*) from users"
grep -qi "permission denied" "$WORK/last.out" || fail "expected a permission error on legacy tables"
expect_fail "production role creating objects in the legacy database" psql -X -qAt -U rn_prod -d rn_legacy -c "create table intruder(i int)"

step "5. env files are tied to their own instance: another instance's database/port is refused before anything changes"
cp "$P/etc/backend.env" "$WORK/backend.env.good"; cp "$P/etc/frontend.env" "$WORK/frontend.env.good"
sed "s#/rn_prod\$#/rn_legacy#" "$WORK/backend.env.good" > "$P/etc/backend.env"; chmod 640 "$P/etc/backend.env"
expect_fail "production env pointing at the legacy database" prod_deploy "$r1" --migrate
grep -q "instance database" "$WORK/last.out" || fail "refusal reason missing"
if [ -n "$(ls "$P/opt/releases")" ] || [ -e "$P/opt/current" ]; then fail "something was installed"; fi
cp "$WORK/backend.env.good" "$P/etc/backend.env"; chmod 640 "$P/etc/backend.env"
printf 'INTERNAL_API_BASE_URL=http://127.0.0.1:%s\n' "$L_API" > "$P/etc/frontend.env"; chmod 640 "$P/etc/frontend.env"
expect_fail "production frontend pointing at the legacy API port" prod_deploy "$r1" --migrate
grep -q "API port" "$WORK/last.out" || fail "port refusal reason missing"
cp "$WORK/frontend.env.good" "$P/etc/frontend.env"; chmod 640 "$P/etc/frontend.env"
expect_fail "a different instance in the environment overrides" env RUNNOTE_INSTANCE=prod RUNNOTE_ROOT="$L/root" "$(ops_of "$r1")/deploy.sh" "$r1"
grep -q "RUNNOTE_ROOT" "$WORK/last.out" || fail "override refusal reason missing"
expect_fail "backup of the legacy database in the production context" env RUNNOTE_INSTANCE=prod PGDATABASE=rn_legacy "$(ops_of "$r1")/backup.sh" --label probe
grep -q "owns database" "$WORK/last.out" || fail "database guard reason missing"
[ -z "$(ls "$P/backups")" ] || fail "a backup file was written despite the guard"

step "6. first production deployment: provably empty database, explicit --migrate, no backup, only its own services"
legacy_before="$(cur "$L/root")|$(rev rn_legacy)"
: > "$WORK/calls.log"
prod_deploy "$r1" --migrate
[ "$(rev rn_prod)" = "$(rev rn_legacy)" ] || fail "production not at head"
[ -n "$(cur "$P/opt")" ] || fail "no production release"
[ -z "$(ls -A "$P/backups")" ] || fail "first initialisation must not back anything up"
if grep -E "(stop|restart) runnote-(api|web)\$" "$WORK/calls.log" >/dev/null; then fail "the legacy services were touched by a production deploy"; fi
if ! grep -q "restart runnote-prod-api" "$WORK/calls.log" || ! grep -q "restart runnote-prod-web" "$WORK/calls.log"; then fail "production services were not restarted by their own names"; fi
[ "$legacy_before" = "$(cur "$L/root")|$(rev rn_legacy)" ] || fail "legacy state changed during a production deploy"
only_release() { local d n=0; for d in "$1"/releases/*/; do n=$((n + 1)); done; [ "$n" -eq "$2" ] || fail "$1 holds $n releases, expected $2"; }
only_release "$L/root" 2
only_release "$P/opt" 1
# The same tarball was installed twice: same release id, two physically separate directories.
[ "$(readlink "$L/root/current")" != "$(readlink "$P/opt/current")" ] || fail "release directories are not isolated"
case "$(readlink "$P/opt/current")" in "$P/opt/releases/"*) ;; *) fail "production current points outside its own root" ;; esac
case "$(readlink "$L/root/current")" in "$L/root/releases/"*) ;; *) fail "legacy current points outside its own root" ;; esac
head -1 "$P/opt/current/backend/.venv/bin/uvicorn" | grep -qF "$P/opt/releases/" || fail "production venv is not rooted in its own release directory"

step "7. the installed production release runs for real on ITS ports; legacy listeners are untouched"
kill "$fake_p_api" "$fake_p_web" 2>/dev/null || true; wait "$fake_p_api" "$fake_p_web" 2>/dev/null || true
(cd "$P/opt/current/backend" && exec python3 "$P/opt/current/ops/envfile.py" exec "$P/etc/backend.env" -- \
  "$P/opt/current/backend/.venv/bin/uvicorn" app.main:create_app --factory --host 127.0.0.1 --port $P_API --workers 1 --no-proxy-headers >"$WORK/prod-api.log" 2>&1) & p1=$!; pids="$pids $p1"
(cd "$P/opt/current/frontend" && exec env INTERNAL_API_BASE_URL="http://127.0.0.1:$P_API" HOST=127.0.0.1 PORT=$P_WEB \
  PROTOCOL_HEADER=x-forwarded-proto BODY_SIZE_LIMIT=11M NODE_ENV=production node build/index.js >"$WORK/prod-web.log" 2>&1) & p2=$!; pids="$pids $p2"
waited=0
until curl -fsS --max-time 3 "http://127.0.0.1:$P_API/api/v1/health/ready" >"$WORK/ready.json" 2>/dev/null && curl -fsS --max-time 3 "http://127.0.0.1:$P_WEB/api/health" >/dev/null 2>&1; do
  sleep 1; waited=$((waited + 1)); [ "$waited" -le 45 ] || { tail -5 "$WORK/prod-api.log" >&2; fail "production release did not become ready on its own ports"; }
done
grep -q '"database":"connected"' "$WORK/ready.json" || fail "production API is not talking to its database"
[ "$(curl -s "http://127.0.0.1:$L_API/api/v1/health/ready")" = "{}" ] || fail "legacy listener changed"
echo "ok: production API/Node answer on $P_API/$P_WEB with a connected database; legacy listeners $L_API/$L_WEB are the independent ones" >&2

step "8. a failing production migration leaves legacy completely alone"
before_legacy="$(cur "$L/root")|$(rev rn_legacy)|$(ls "$L/backups" | wc -l | tr -d ' ')"
: > "$WORK/calls.log"
expect_fail "production deploy with a failing migration" prod_deploy "$rbad" --migrate
grep -q "migration failed" "$WORK/last.out" || fail "failure message missing"
ls "$P/backups"/*-pre-*.dump >/dev/null 2>&1 || fail "no pre-migration backup in the production backup directory"
[ "$before_legacy" = "$(cur "$L/root")|$(rev rn_legacy)|$(ls "$L/backups" | wc -l | tr -d ' ')" ] || fail "legacy changed because production failed"
if grep -E "(stop|restart) runnote-(api|web)\$" "$WORK/calls.log" >/dev/null; then fail "legacy services were stopped by a production failure"; fi
[ "$(rev rn_prod)" = "$(rev rn_legacy)" ] || fail "failed migration left production at an unexpected revision"
for d in "$P"/backups/*; do case "$d" in "$L"*) fail "backup leaked into legacy" ;; esac; done

step "9. backup + restore drill per instance, each into its own directory"
prod_backup_file="$(env RUNNOTE_INSTANCE=prod PGDATABASE=rn_prod "$(ops_of "$r1")/backup.sh" --label nightly --drill 2>"$WORK/b.err")" || { cat "$WORK/b.err" >&2; fail "production backup failed"; }
case "$prod_backup_file" in "$P/backups/rn_prod-"*) ;; *) fail "production backup was written outside its directory: $prod_backup_file" ;; esac
legacy_backup_file="$(legacy_env env PGDATABASE=rn_legacy "$(ops_of "$r1")/backup.sh" --label nightly --drill 2>"$WORK/b.err")" || { cat "$WORK/b.err" >&2; fail "legacy backup failed"; }
case "$legacy_backup_file" in "$L/backups/rn_legacy-"*) ;; *) fail "legacy backup was written outside its directory: $legacy_backup_file" ;; esac
expect_fail "restore drill of a production dump against the legacy database" env RUNNOTE_INSTANCE=prod PGDATABASE=rn_legacy "$(ops_of "$r1")/restore-drill.sh" "$prod_backup_file"
grep -q "owns database" "$WORK/last.out" || fail "drill guard reason missing"
[ -z "$(psql -X -qAt -d postgres -c "select datname from pg_database where datname like 'runnote_drill_%'")" ] || fail "a scratch drill database was left behind"

step "10. rollback is per instance: production switches within its own releases, legacy ids are unknown to it"
prod_deploy "$r2"                       # same schema, no migration
prod_a="$(cur "$P/opt")"
prod_env "$(ops_of "$r1")/rollback.sh" previous
[ "$(cur "$P/opt")" != "$prod_a" ] || fail "rollback did not switch the production release"
expect_fail "production rollback to a release that only exists under the legacy root" prod_env "$(ops_of "$r1")/rollback.sh" "$legacy_release"
grep -q "release not found" "$WORK/last.out" || fail "refusal reason missing"
[ "$legacy_before" = "$(cur "$L/root")|$(rev rn_legacy)" ] || fail "legacy changed during production rollback"

step "11. set-site-mode: maintenance first; live only when released and the owner exists; validation failure restores"
export CADDY_SITES_DIR="$WORK/caddy/sites.d" CADDYFILE="$WORK/caddy/Caddyfile" RUNNOTE_DOMAIN=staging.example.test
mkdir -p "$WORK/caddy"
# the main Caddyfile as installed on a host: the shipped one, with /etc/caddy pointed at the sandbox
sed "s#/etc/caddy/#$WORK/caddy/#g" "$REL_ROOT/infra/native/Caddyfile" > "$CADDYFILE"
printf 'legacy.example.test {\n\trespond "old"\n}\n' > "$WORK/caddy/Caddyfile.old"   # a Caddyfile from before multi-instance
CADDYFILE="$WORK/caddy/Caddyfile.old" expect_fail "set-site-mode against a Caddyfile that never imports instance sites" "$REL_OPS/set-site-mode.sh" prod maintenance
grep -q "not the current Run Note Caddyfile" "$WORK/last.out" || fail "Caddyfile refusal reason missing"
[ ! -e "$CADDY_SITES_DIR/prod.caddy" ] || fail "a site file was written despite the refusal"
"$REL_OPS/set-site-mode.sh" prod maintenance
if ! grep -q "503" "$CADDY_SITES_DIR/prod.caddy" || grep -q reverse_proxy "$CADDY_SITES_DIR/prod.caddy"; then fail "maintenance site is wrong"; fi
if ! grep -q "caddy validate" "$WORK/calls.log" || ! grep -q "reload caddy" "$WORK/calls.log"; then fail "site mode must validate then reload"; fi
expect_fail "going live before the site owner exists" "$REL_OPS/set-site-mode.sh" prod live
grep -q "owner of prod does not exist" "$WORK/last.out" || fail "owner refusal reason missing"
grep -q "503" "$CADDY_SITES_DIR/prod.caddy" || fail "a refused go-live changed the site file"
# the production API from step 7 is still listening; create the SYNTHETIC owner row the way the offline script would
pgq -d rn_prod -c "insert into users(id,email_normalized,username,password_hash,display_name) values (gen_random_uuid(),'owner@example.test','owner','x','Owner')" >/dev/null
: > "$WORK/calls.log"; touch "$WORK/caddy-fail"
expect_fail "go-live whose generated site does not validate" "$REL_OPS/set-site-mode.sh" prod live
if ! grep -q "503" "$CADDY_SITES_DIR/prod.caddy" || grep -q "reload caddy" "$WORK/calls.log"; then fail "validation failure must restore the maintenance site and not reload"; fi
rm -f "$WORK/caddy-fail"
"$REL_OPS/set-site-mode.sh" prod live
grep -q "import runnote_app $P_API $P_WEB" "$CADDY_SITES_DIR/prod.caddy" || fail "live site does not proxy the production ports"
grep -q "basic_auth" "$CADDY_SITES_DIR/prod.caddy" && fail "production must not use basic auth"
"$REL_OPS/set-site-mode.sh" prod maintenance   # back to the safe state at any time
grep -q "503" "$CADDY_SITES_DIR/prod.caddy" || fail "could not return to maintenance"

step "ALL MULTI-INSTANCE E2E STEPS PASSED"
# A passing run leaves nothing behind (each release has its own virtualenv, ~1 GB per run). A failing
# run keeps $WORK for diagnosis; set KEEP_WORK=1 to keep it on success as well.
if [ -z "${KEEP_WORK:-}" ]; then rm -rf "${WORK:?}"; fi
