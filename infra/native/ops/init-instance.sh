#!/usr/bin/env bash
# Create everything ONE additional instance needs, once, without starting or exposing anything:
# system user + group, directories with their modes, database role + database (+PostGIS), the three
# environment files with freshly generated secrets, and the systemd units (installed, not enabled).
#
#   init-instance.sh NAME --owner-email ADDRESS
#
# Run as root after /etc/run-note-instances/NAME.conf exists (see instances/production.conf.example).
# It refuses to run over anything that already exists, never prints a secret, and never touches the
# legacy installation or another instance. Starting the services, creating the site owner and
# putting the domain on the proxy are separate, explicit steps (docs/66).
set -euo pipefail
umask 077

name="" owner_email=""
while [ $# -gt 0 ]; do
  case "$1" in
    --owner-email) owner_email="${2:?--owner-email needs a value}"; shift ;;
    -*) printf 'ERROR: unknown option: %s\n' "$1" >&2; exit 1 ;;
    *) [ -z "$name" ] || { echo "ERROR: only one instance name allowed" >&2; exit 1; }; name="$1" ;;
  esac
  shift
done
[ -n "$name" ] || { echo "usage: init-instance.sh NAME --owner-email ADDRESS" >&2; exit 1; }
export RUNNOTE_INSTANCE="$name"
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"

[ "$(id -u)" -eq 0 ] || [ -n "${RUNNOTE_ALLOW_NONROOT:-}" ] || die "run as root (sudo)"
[[ "$owner_email" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || die "--owner-email must be a plain e-mail address"
require_cmd python3 psql openssl
SYSTEMCTL="${SYSTEMCTL:-systemctl}"
SYSTEMD_DIR="${SYSTEMD_DIR:-/etc/systemd/system}"
here="$(cd "$(dirname "$0")" && pwd)"

# ---- refuse to run over anything that exists --------------------------------------------
for f in backend.env frontend.env backup.env; do
  [ ! -e "$RUNNOTE_ETC/$f" ] || die "$RUNNOTE_ETC/$f already exists; this script only creates, it never overwrites"
done
pg() { as_pg psql -X -qAt -v ON_ERROR_STOP=1 "$@"; }
[ -z "$(pg -d postgres -c "SELECT 1 FROM pg_roles WHERE rolname = '$DB_ROLE'")" ] || die "database role $DB_ROLE already exists"
[ -z "$(pg -d postgres -c "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'")" ] || die "database $DB_NAME already exists"

# ---- secrets live in memory until the files are written ---------------------------------
db_password="$(openssl rand -hex 24)"
rate_key="$(openssl rand -base64 48)"

# ---- operating-system identity and directories ------------------------------------------
getent group "$APP_GROUP" >/dev/null || groupadd --system "$APP_GROUP"
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --gid "$APP_GROUP" --home-dir "$RUNNOTE_ROOT" --no-create-home --shell /usr/sbin/nologin "$APP_USER"
install -d -m 0755 "$RUNNOTE_ROOT" "$RUNNOTE_ROOT/releases"; chown root:root "$RUNNOTE_ROOT" "$RUNNOTE_ROOT/releases"
# 0750 root:<group>: only this instance's user can even enter its configuration directory.
install -d -m 0750 "$RUNNOTE_ETC"; chown "root:$APP_GROUP" "$RUNNOTE_ETC"
install -d -m 0700 "$BACKUP_DIR"; chown postgres "$BACKUP_DIR"

# ---- database: its own role, its own database, nobody else may connect ------------------
printf "CREATE ROLE %s LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '%s';\n" "$DB_ROLE" "$db_password" | pg -d postgres
pg -d postgres -c "CREATE DATABASE $DB_NAME OWNER $DB_ROLE TEMPLATE template0 ENCODING 'UTF8'"
pg -d postgres -c "REVOKE ALL ON DATABASE $DB_NAME FROM PUBLIC"
pg -d postgres -c "GRANT CONNECT, TEMPORARY ON DATABASE $DB_NAME TO $DB_ROLE"
# PostGIS is not a trusted extension: the administrator installs it, never the application role.
pg -d "$DB_NAME" -c "CREATE EXTENSION postgis"

# ---- environment files ------------------------------------------------------------------
{
  echo "APP_ENV=production"
  echo "DATABASE_URL=postgresql+psycopg://$DB_ROLE:$db_password@127.0.0.1:${PGPORT:-5432}/$DB_NAME"
  echo "SITE_ORIGIN=https://$INSTANCE_DOMAIN"
  echo "SITE_OWNER_EMAIL=$owner_email"
  echo "AUTH_RATE_HASH_KEY=$rate_key"
  echo "AUTH_TRUSTED_PROXIES='[\"127.0.0.1\"]'"
} > "$BACKEND_ENV"
printf 'INTERNAL_API_BASE_URL=%s\n' "$API_URL" > "$FRONTEND_ENV"
printf 'PGDATABASE=%s\n' "$DB_NAME" > "$BACKUP_ENV"
chown "root:$APP_GROUP" "$BACKEND_ENV" "$FRONTEND_ENV"; chmod 0640 "$BACKEND_ENV" "$FRONTEND_ENV"
chown root:postgres "$BACKUP_ENV"; chmod 0640 "$BACKUP_ENV"
unset db_password rate_key

# ---- systemd units: installed, deliberately NOT enabled or started ----------------------
python3 "$here/instance.py" render "$name" --out "$SYSTEMD_DIR" ${RUNNOTE_INSTANCES_DIR:+--dir "$RUNNOTE_INSTANCES_DIR"} >/dev/null
chmod 0644 "$SYSTEMD_DIR/$SERVICE_API.service" "$SYSTEMD_DIR/$SERVICE_WEB.service" "$SYSTEMD_DIR/$SERVICE_BACKUP.service" "$SYSTEMD_DIR/$SERVICE_BACKUP.timer"
"$SYSTEMCTL" daemon-reload

log "instance '$name' created: user=$APP_USER database=$DB_NAME ports=$API_PORT/$WEB_PORT (no secret was printed)"
log "NOT started, NOT enabled, NOT on the proxy. Next: deploy.sh, create the site owner, set-site-mode.sh (docs/66)"
