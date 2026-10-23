#!/usr/bin/env bash
# Shared helpers for Run Note operations scripts. Source this file; never run it.
# Every path is overridable through the environment so scripts can be exercised
# against a throw-away layout without touching /opt or /etc.

# ---- instance context ------------------------------------------------------------------
# Without RUNNOTE_INSTANCE this is the legacy single-instance layout (what the staging host runs),
# unchanged. With RUNNOTE_INSTANCE=NAME every value below comes from the explicit, validated file
# /etc/run-note-instances/NAME.conf (ops/instance.py); nothing falls back to a legacy default, and a
# conflicting RUNNOTE_ROOT / RUNNOTE_ETC / BACKUP_DIR / APP_USER / API_URL / WEB_URL in the
# environment is an error rather than a silent override.
RUNNOTE_INSTANCE="${RUNNOTE_INSTANCE:-}"
if [ -n "$RUNNOTE_INSTANCE" ]; then
  for _v in RUNNOTE_ROOT RUNNOTE_ETC BACKUP_DIR APP_USER API_URL WEB_URL BACKEND_ENV FRONTEND_ENV BACKUP_ENV; do
    [ -z "${!_v:-}" ] || { printf 'ERROR: %s is set in the environment but RUNNOTE_INSTANCE=%s defines it; unset it\n' "$_v" "$RUNNOTE_INSTANCE" >&2; exit 1; }
  done
  _vars="$(python3 "$(dirname "${BASH_SOURCE[0]}")/instance.py" shellvars "$RUNNOTE_INSTANCE" --dir "${RUNNOTE_INSTANCES_DIR:-/etc/run-note-instances}")" \
    || { printf 'ERROR: cannot load instance %s\n' "$RUNNOTE_INSTANCE" >&2; exit 1; }
  eval "$_vars"  # every value was validated against a strict pattern by instance.py
  unset _vars _v
else
  RUNNOTE_ROOT="${RUNNOTE_ROOT:-/opt/run-note}"
  RUNNOTE_ETC="${RUNNOTE_ETC:-/etc/run-note}"
  BACKUP_DIR="${BACKUP_DIR:-/var/backups/run-note}"
  APP_USER="${APP_USER:-runnote}"
  API_URL="${API_URL:-http://127.0.0.1:8000}"
  WEB_URL="${WEB_URL:-http://127.0.0.1:3000}"
  SERVICE_API="runnote-api"
  SERVICE_WEB="runnote-web"
fi
# shellcheck disable=SC2034 # SERVICES is used by deploy.sh and rollback.sh, which source this file
SERVICES=("$SERVICE_API" "$SERVICE_WEB")
# Written into a release directory as the very last step of deploy.sh. A directory without it
# is an unfinished build, never a release (not served, not rolled back to, not counted).
# shellcheck disable=SC2034 # used by deploy.sh and rollback.sh, which source this file
COMPLETE_MARKER=".deploy-complete"
BACKEND_ENV="${BACKEND_ENV:-$RUNNOTE_ETC/backend.env}"
FRONTEND_ENV="${FRONTEND_ENV:-$RUNNOTE_ETC/frontend.env}"
BACKUP_ENV="${BACKUP_ENV:-$RUNNOTE_ETC/backup.env}"
SMOKE_API_TIMEOUT="${SMOKE_API_TIMEOUT:-60}"
SMOKE_WEB_TIMEOUT="${SMOKE_WEB_TIMEOUT:-30}"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }

require_cmd() {
  local cmd
  for cmd in "$@"; do
    command -v "$cmd" >/dev/null 2>&1 || die "missing required command: $cmd"
  done
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  else shasum -a 256 "$1" | awk '{print $1}'; fi
}

# Wait until a URL answers 2xx. $1 URL, $2 timeout seconds.
wait_http_ok() {
  local url="$1" timeout="${2:-60}" waited=0
  while [ "$waited" -lt "$timeout" ]; do
    if curl --fail --silent --show-error --max-time 3 "$url" >/dev/null 2>&1; then return 0; fi
    sleep 2
    waited=$((waited + 2))
  done
  return 1
}

# Release identifiers are written by build-release.sh; keep the character set strict
# because they become directory names and are echoed to operators.
valid_release_id() {
  [[ "$1" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{2,80}$ ]]
}

current_release_dir() {
  if [ -L "$RUNNOTE_ROOT/current" ]; then readlink -f "$RUNNOTE_ROOT/current" 2>/dev/null || true; fi
}

# Run a command as the unprivileged application user when invoked as root.
as_app() {
  if [ "$(id -u)" -eq 0 ]; then runuser -u "$APP_USER" -- "$@"; else "$@"; fi
}

# Run a command as the PostgreSQL superuser account when invoked as root (local socket, peer auth).
as_pg() {
  if [ "$(id -u)" -eq 0 ]; then runuser -u postgres -- "$@"; else "$@"; fi
}

# In instance mode the database named by the environment must be the instance's own. Call after
# backup.env has been loaded, in every script that touches a database through PGDATABASE.
assert_instance_database() {
  [ -z "${RUNNOTE_INSTANCE:-}" ] || [ "${PGDATABASE:-}" = "$DB_NAME" ] \
    || die "instance $RUNNOTE_INSTANCE owns database '$DB_NAME', but PGDATABASE is '${PGDATABASE:-}'; refusing to touch it"
}

# Extra arguments for envfile.py check that tie an instance's env files to its own definition.
# Prints nothing in legacy mode, so legacy behaviour is exactly as before.
instance_check_args() { # $1 = backend | frontend
  [ -n "${RUNNOTE_INSTANCE:-}" ] || return 0
  case "$1" in
    backend) printf '%s\n' --expect-db-name "$DB_NAME" --expect-db-user "$DB_ROLE" --expect-origin-host "$INSTANCE_DOMAIN" ;;
    frontend) printf '%s\n' --expect-api-port "$API_PORT" ;;
  esac
}

# Re-exec the calling script once with backup.env loaded (PGDATABASE etc.) without sourcing it
# in a shell. Usage, right after sourcing this file:  load_backup_env "$0" "$@"
load_backup_env() {
  if [ -z "${RUNNOTE_BACKUP_ENV_LOADED:-}" ] && [ -f "$BACKUP_ENV" ]; then
    export RUNNOTE_BACKUP_ENV_LOADED=1
    exec python3 "$(dirname "$1")/envfile.py" exec "$BACKUP_ENV" -- "$@"
  fi
}
