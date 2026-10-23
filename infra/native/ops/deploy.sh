#!/usr/bin/env bash
# Install a release tarball on the production host and switch to it, safely.
#
#   deploy.sh [--migrate] RELEASE.tar.gz
#
# Run as root from a copy of THIS script's release (see docs/66): extract `ops/` from the tarball
# first, then run it. The flow is intentionally conservative:
#   1. validate config files        4. compare DB schema with the release's Alembic head
#   2. unpack + build the venv      5. only with --migrate: backup, restore drill, stop, migrate
#   3. (nothing live is touched)    6. switch symlink, restart, smoke test
# A schema change is never applied implicitly and never rolled back by swapping a symlink.
# A database with NO schema yet (pre-created, PostGIS only) is initialised only with an explicit
# --migrate and only if it is provably empty; there is nothing to back up, so that path skips the
# backup and drill. Any other unversioned database is refused (see schema_compat.py db-state).
set -euo pipefail
umask 022
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"
load_backup_env "$0" "$@"

migrate=0 tarball=""
while [ $# -gt 0 ]; do
  case "$1" in
    --migrate) migrate=1 ;;
    -*) die "unknown option: $1" ;;
    *) [ -z "$tarball" ] || die "only one tarball allowed"; tarball="$1" ;;
  esac
  shift
done
if [ -z "$tarball" ] || [ ! -f "$tarball" ]; then die "usage: deploy.sh [--migrate] RELEASE.tar.gz"; fi
[ "$(id -u)" -eq 0 ] || [ -n "${RUNNOTE_ALLOW_NONROOT:-}" ] || die "run as root (sudo)"
require_cmd tar curl flock "${PYTHON:-python3.12}"

SERVICES=(runnote-api runnote-web)
SYSTEMCTL="${SYSTEMCTL:-systemctl}"
KEEP_RELEASES="${KEEP_RELEASES:-5}"
PYTHON="${PYTHON:-python3.12}"
releases="$RUNNOTE_ROOT/releases"
mkdir -p "$releases"
install -d -m 700 "$BACKUP_DIR"
[ "$(id -u)" -ne 0 ] || chown postgres "$BACKUP_DIR"

# Cheap configuration guard first (no virtualenv needed), so a bad config fails in a second.
python3 "$(dirname "$0")/envfile.py" check "$BACKEND_ENV" --kind backend --skip-settings
python3 "$(dirname "$0")/envfile.py" check "$FRONTEND_ENV" --kind frontend

exec 9>"$RUNNOTE_ROOT/.deploy.lock"
flock -n 9 || die "another deploy or rollback is running"

if [ -f "$tarball.sha256" ]; then
  [ "$(awk '{print $1}' "$tarball.sha256")" = "$(sha256_of "$tarball")" ] || die "tarball checksum mismatch"
else
  log "WARNING: no $tarball.sha256 beside the tarball; integrity not verified"
fi

top="$(tar -tzf "$tarball" | sed -n '1{s#/.*##;p;}')"
id="$(tar -xzOf "$tarball" "$top/RELEASE" 2>/dev/null | sed -n 's/^id=//p' | head -1)"
[ "$id" = "$top" ] || die "RELEASE id does not match the archive's top directory"
valid_release_id "${id:-}" || die "tarball has no valid RELEASE id"
target="$releases/$id"
[ ! -e "$target" ] || die "release $id already exists; build a new one"

previous_dir="$(current_release_dir)"
cleanup_partial() { if [ -n "${partial:-}" ]; then rm -rf "$partial"; fi; }
partial="$releases/.partial-$id"
trap cleanup_partial EXIT
rm -rf "$partial"
mkdir -p "$partial"
log "unpacking $id"
tar -xzf "$tarball" -C "$partial" --strip-components=1
for required in RELEASE backend/app backend/migrations backend/requirements.lock frontend/build/index.js ops/deploy.sh; do
  [ -e "$partial/$required" ] || die "tarball missing $required"
done

log "creating virtualenv from the hashed lockfile"
"$PYTHON" -m venv "$partial/backend/.venv"
"$partial/backend/.venv/bin/python" -m pip install --quiet --disable-pip-version-check \
  --require-hashes -r "$partial/backend/requirements.lock"
PY="$partial/backend/.venv/bin/python"

log "checking configuration (values are never printed)"
"$PY" -I "$partial/ops/envfile.py" check "$FRONTEND_ENV" --kind frontend
(cd "$partial/backend" && PYTHONPATH="$partial/backend" "$PY" "$partial/ops/envfile.py" check "$BACKEND_ENV" --kind backend)

release_head="$("$PY" "$partial/ops/schema_compat.py" head "$partial/backend/migrations")"
db_state="$(cd "$partial/backend" && as_app "$PY" "$partial/ops/envfile.py" exec "$BACKEND_ENV" -- \
  "$PY" "$partial/ops/schema_compat.py" db-state)"
case "$db_state" in
  empty) db_rev=none relation=initialize ;;
  "revision "*)
    db_rev="${db_state#revision }"
    relation="$("$PY" "$partial/ops/schema_compat.py" relation "$partial/backend/migrations" "$db_rev")" ;;
  "refuse "*) die "refusing to deploy: ${db_state#refuse }" ;;
  *) die "unexpected database state: $db_state" ;;
esac
log "release head=$release_head database=$db_rev relation=$relation"

case "$relation" in
  same) [ "$migrate" -eq 0 ] || log "database already at head; --migrate has nothing to do" ;;
  initialize) [ "$migrate" -eq 1 ] || die "the database is empty (no schema yet). First initialisation must be requested explicitly: re-run with --migrate" ;;
  behind) [ "$migrate" -eq 1 ] || die "database is behind this release; the schema must change first. Review the migrations, then re-run with --migrate (a verified backup is taken first)" ;;
  ahead|unknown) die "database revision $db_rev is newer than (or foreign to) this release. Deploying older code onto a newer schema is a rollback: use rollback.sh and its database-restore procedure" ;;
  *) die "unexpected relation: $relation" ;;
esac

backup_file=""
if [ "$relation" = initialize ]; then
  log "first initialisation of an empty database: no data exists, so no backup or restore drill"
  for unit in "${SERVICES[@]}"; do "$SYSTEMCTL" stop "$unit" || true; done
  # Re-check with the services stopped: nothing may have appeared since the first look.
  recheck="$(cd "$partial/backend" && as_app "$PY" "$partial/ops/envfile.py" exec "$BACKEND_ENV" -- \
    "$PY" "$partial/ops/schema_compat.py" db-state)"
  [ "$recheck" = empty ] || die "database changed since it was inspected ($recheck); refusing to initialise. Nothing was migrated"
  log "applying migrations (single step, not per worker)"
  if ! (cd "$partial/backend" && as_app "$PY" "$partial/ops/envfile.py" exec "$BACKEND_ENV" -- "$PY" -m alembic upgrade head); then
    die "first initialisation failed. Services are stopped. Inspect the database state with schema_compat.py db-state before retrying"
  fi
  after="$(cd "$partial/backend" && as_app "$PY" "$partial/ops/envfile.py" exec "$BACKEND_ENV" -- \
    "$PY" "$partial/ops/schema_compat.py" db-revision)"
  [ "$after" = "$release_head" ] || die "after initialisation the database is at '$after', expected $release_head"
elif [ "$relation" = behind ]; then
  log "stopping services for a write-free backup and migration"
  for unit in "${SERVICES[@]}"; do "$SYSTEMCTL" stop "$unit" || true; done
  log "taking pre-migration backup and running a real restore drill"
  backup_file="$(as_pg "$partial/ops/backup.sh" --label "pre-$id" --drill --strict-counts)" \
    || die "pre-migration backup or restore drill failed; nothing was migrated. Services are stopped: restart them with 'systemctl start ${SERVICES[*]}'"
  log "applying migrations (single step, not per worker)"
  if ! (cd "$partial/backend" && as_app "$PY" "$partial/ops/envfile.py" exec "$BACKEND_ENV" -- "$PY" -m alembic upgrade head); then
    die "migration failed. Services are stopped. Backup: $backup_file. Inspect 'alembic current'; restore per docs/66 if needed"
  fi
fi

mv "$partial" "$target"
partial=""
chown -R root:root "$target"
chmod -R go-w "$target"

ln -sfn "$target" "$RUNNOTE_ROOT/.current.new"
[ -z "$previous_dir" ] || ln -sfn "$previous_dir" "$RUNNOTE_ROOT/.previous.new"
mv -T "$RUNNOTE_ROOT/.current.new" "$RUNNOTE_ROOT/current"
[ -z "$previous_dir" ] || mv -T "$RUNNOTE_ROOT/.previous.new" "$RUNNOTE_ROOT/previous"
log "current -> $id"

for unit in "${SERVICES[@]}"; do "$SYSTEMCTL" restart "$unit"; done
if wait_http_ok "$API_URL/api/v1/health/ready" "$SMOKE_API_TIMEOUT" && wait_http_ok "$WEB_URL/api/health" "$SMOKE_WEB_TIMEOUT"; then
  log "smoke test passed (API ready and Node proxy reaches it)"
else
  log "SMOKE TEST FAILED for $id"
  if [ -n "$previous_dir" ] && [ "$relation" = same ]; then
    log "schema unchanged, so automatically returning to $(basename "$previous_dir")"
    ln -sfn "$previous_dir" "$RUNNOTE_ROOT/.current.new" && mv -T "$RUNNOTE_ROOT/.current.new" "$RUNNOTE_ROOT/current"
    for unit in "${SERVICES[@]}"; do "$SYSTEMCTL" restart "$unit"; done
    if wait_http_ok "$API_URL/api/v1/health/ready" "$SMOKE_API_TIMEOUT"; then log "previous release is serving again"
    else log "previous release is NOT healthy; investigate with journalctl -u runnote-api"; fi
  else
    log "the schema was migrated (or there is no previous release); not rolling back automatically."
    log "Fix forward, or follow the database-restore rollback in docs/66. Pre-migration backup: ${backup_file:-none}"
  fi
  exit 1
fi

# Retention: keep the newest KEEP_RELEASES, never current or previous.
keep_current="$(readlink -f "$RUNNOTE_ROOT/current")"
keep_previous="$(readlink -f "$RUNNOTE_ROOT/previous" 2>/dev/null || true)"
# shellcheck disable=SC2012 # directory names are validated release ids
ls -1dt "$releases"/*/ 2>/dev/null | sed 's:/$::' | awk -v keep="$KEEP_RELEASES" 'NR>keep' | while IFS= read -r old; do
  [ "$old" = "$keep_current" ] || [ "$old" = "$keep_previous" ] || { log "removing old release $(basename "$old")"; rm -rf "$old"; }
done
log "deploy complete: $id"
