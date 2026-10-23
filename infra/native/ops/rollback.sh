#!/usr/bin/env bash
# Return to another installed release. Swapping the symlink is only done when the database schema
# already matches that release; otherwise the database must be restored first, explicitly.
#
#   rollback.sh [RELEASE_ID|previous]                       # schema must already match
#   rollback.sh [RELEASE_ID|previous] --restore-db DUMP     # restore a pre-migration backup
#
# Why: the application requires alembic_version == its own head exactly (readiness returns 503
# and the footprint worker idles otherwise), and downgrades refuse to run on real data. So going
# back across a migration means returning to the data as it was BEFORE that migration, which
# loses every write made since. Prefer fixing forward unless the new release corrupted data.
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"
load_backup_env "$0" "$@"
assert_instance_database

target_arg="previous" dump=""
while [ $# -gt 0 ]; do
  case "$1" in
    --restore-db) dump="${2:?--restore-db needs a dump file}"; shift ;;
    -*) die "unknown option: $1" ;;
    *) target_arg="$1" ;;
  esac
  shift
done
[ "$(id -u)" -eq 0 ] || [ -n "${RUNNOTE_ALLOW_NONROOT:-}" ] || die "run as root (sudo)"
require_cmd curl flock
SYSTEMCTL="${SYSTEMCTL:-systemctl}"
releases="$RUNNOTE_ROOT/releases"

exec 9>"$RUNNOTE_ROOT/.deploy.lock"
flock -n 9 || die "another deploy or rollback is running"

if [ "$target_arg" = previous ]; then
  [ -L "$RUNNOTE_ROOT/previous" ] || die "no previous release recorded"
  target="$(readlink -f "$RUNNOTE_ROOT/previous")"
else
  valid_release_id "$target_arg" || die "invalid release id"
  target="$releases/$target_arg"
fi
[ -d "$target/backend/migrations" ] || die "release not found: $target"
[ -e "$target/$COMPLETE_MARKER" ] || die "$target is not a completed release (no $COMPLETE_MARKER marker); refusing to switch to it"
current="$(current_release_dir)"
[ "$target" != "$current" ] || die "already on $(basename "$target")"
PY="$target/backend/.venv/bin/python"
[ -x "$PY" ] || die "release has no virtualenv"

db_rev="$(cd "$target/backend" && as_app "$PY" "$target/ops/envfile.py" exec "$BACKEND_ENV" -- \
  "$PY" "$target/ops/schema_compat.py" db-revision)"
relation="$("$PY" "$target/ops/schema_compat.py" relation "$target/backend/migrations" "$db_rev")"
log "target=$(basename "$target") database=$db_rev relation=$relation"

switch_and_start() {
  ln -sfn "$target" "$RUNNOTE_ROOT/.current.new"
  mv -T "$RUNNOTE_ROOT/.current.new" "$RUNNOTE_ROOT/current"
  [ -z "$current" ] || { ln -sfn "$current" "$RUNNOTE_ROOT/.previous.new"; mv -T "$RUNNOTE_ROOT/.previous.new" "$RUNNOTE_ROOT/previous"; }
  for unit in "${SERVICES[@]}"; do "$SYSTEMCTL" restart "$unit"; done
  wait_http_ok "$API_URL/api/v1/health/ready" "$SMOKE_API_TIMEOUT" || die "release did not become ready; see journalctl -u runnote-api"
  wait_http_ok "$WEB_URL/api/health" "$SMOKE_WEB_TIMEOUT" || die "Node proxy cannot reach the API"
  log "rollback complete: serving $(basename "$target")"
}

if [ "$relation" = same ]; then
  [ -z "$dump" ] || die "database already matches the target; --restore-db would discard data for nothing"
  switch_and_start
  exit 0
fi

[ -n "$dump" ] || die "the database schema ($db_rev) does not match $(basename "$target"). Swapping the symlink would leave readiness at 503. Options: fix forward with a new release, or re-run with --restore-db <pre-migration dump> (discards all writes since that backup)"
[ -f "$dump" ] || die "dump not found: $dump"
[ "$(awk '{print $1}' "$dump.sha256" 2>/dev/null)" = "$(sha256_of "$dump")" ] || die "dump checksum missing or wrong"
: "${PGDATABASE:?PGDATABASE (live database name) must be set}"
require_cmd psql pg_restore createdb

log "THIS WILL REPLACE database '$PGDATABASE' with $(basename "$dump"). Everything written since is lost."
log "The current database is kept renamed as a safety copy."
printf 'Type the database name (%s) to continue: ' "$PGDATABASE" >&2
read -r answer
[ "$answer" = "$PGDATABASE" ] || die "confirmation did not match; nothing changed"

stamp="$(date -u +%Y%m%d%H%M%S)"
safety="${PGDATABASE}_pre_rollback_$stamp"
staging="${PGDATABASE}_restore_$stamp"
owner="${DB_OWNER:-${DB_ROLE:-$APP_USER}}"

# Build and verify the replacement FIRST, beside the live database; only then swap names.
log "restoring into staging database $staging (live database untouched)"
as_pg createdb "$staging"
if ! as_pg pg_restore --no-owner --no-privileges --exit-on-error --dbname="$staging" "$dump"; then
  as_pg dropdb --if-exists "$staging"; die "restore failed; nothing changed"
fi
# Restore as the superuser (CREATE EXTENSION postgis needs it), then hand ownership to the app role.
if ! as_pg psql -X -v ON_ERROR_STOP=1 -d "$staging" <<SQL
DO \$\$ DECLARE r record; BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> 'spatial_ref_sys' LOOP
    EXECUTE format('ALTER TABLE public.%I OWNER TO %I', r.tablename, '$owner');
  END LOOP;
  FOR r IN SELECT sequencename FROM pg_sequences WHERE schemaname='public' LOOP
    EXECUTE format('ALTER SEQUENCE public.%I OWNER TO %I', r.sequencename, '$owner');
  END LOOP;
END \$\$;
SQL
then
  as_pg dropdb --if-exists "$staging"; die "could not hand ownership to role $owner; nothing changed"
fi
staged_rev="$(as_pg psql -X -qAt -d "$staging" -c 'SELECT version_num FROM alembic_version')"
if [ "$("$PY" "$target/ops/schema_compat.py" relation "$target/backend/migrations" "$staged_rev")" != same ]; then
  as_pg dropdb --if-exists "$staging"; die "dump is at $staged_rev, which does not match the target release; nothing changed"
fi

log "swapping databases (services stopped)"
for unit in "${SERVICES[@]}"; do "$SYSTEMCTL" stop "$unit" || true; done
as_pg psql -X -v ON_ERROR_STOP=1 -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ('$PGDATABASE','$staging') AND pid <> pg_backend_pid()" >/dev/null
as_pg psql -X -v ON_ERROR_STOP=1 -d postgres -c "ALTER DATABASE \"$PGDATABASE\" RENAME TO \"$safety\""
if ! as_pg psql -X -v ON_ERROR_STOP=1 -d postgres -c "ALTER DATABASE \"$staging\" RENAME TO \"$PGDATABASE\""; then
  as_pg psql -X -d postgres -c "ALTER DATABASE \"$safety\" RENAME TO \"$PGDATABASE\"" || true
  die "swap failed; original database restored under its own name"
fi
log "previous database preserved as $safety"
switch_and_start
