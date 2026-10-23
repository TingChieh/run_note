#!/usr/bin/env bash
# Shared helpers for Run Note operations scripts. Source this file; never run it.
# Every path is overridable through the environment so scripts can be exercised
# against a throw-away layout without touching /opt or /etc.

RUNNOTE_ROOT="${RUNNOTE_ROOT:-/opt/run-note}"
RUNNOTE_ETC="${RUNNOTE_ETC:-/etc/run-note}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/run-note}"
APP_USER="${APP_USER:-runnote}"
# Written into a release directory as the very last step of deploy.sh. A directory without it
# is an unfinished build, never a release (not served, not rolled back to, not counted).
# shellcheck disable=SC2034 # used by deploy.sh and rollback.sh, which source this file
COMPLETE_MARKER=".deploy-complete"
BACKEND_ENV="${BACKEND_ENV:-$RUNNOTE_ETC/backend.env}"
FRONTEND_ENV="${FRONTEND_ENV:-$RUNNOTE_ETC/frontend.env}"
BACKUP_ENV="${BACKUP_ENV:-$RUNNOTE_ETC/backup.env}"
API_URL="${API_URL:-http://127.0.0.1:8000}"
WEB_URL="${WEB_URL:-http://127.0.0.1:3000}"
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

# Re-exec the calling script once with backup.env loaded (PGDATABASE etc.) without sourcing it
# in a shell. Usage, right after sourcing this file:  load_backup_env "$0" "$@"
load_backup_env() {
  if [ -z "${RUNNOTE_BACKUP_ENV_LOADED:-}" ] && [ -f "$BACKUP_ENV" ]; then
    export RUNNOTE_BACKUP_ENV_LOADED=1
    exec python3 "$(dirname "$1")/envfile.py" exec "$BACKUP_ENV" -- "$@"
  fi
}
