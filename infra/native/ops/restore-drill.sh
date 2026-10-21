#!/usr/bin/env bash
# Prove a pg_dump archive really restores: load it into a scratch database and compare it with
# the live database. Listing the archive (pg_restore --list) is NOT a restore test and is never
# accepted as one here.
#
#   restore-drill.sh DUMP [--strict-counts] [--keep]
#
# Connection comes from the standard PG* variables; PGDATABASE names the LIVE database.
# Run as a PostgreSQL superuser (the scratch restore needs CREATE EXTENSION postgis).
# --strict-counts : every table's row count must equal the live database (use only when
#                   nothing writes to the live database, e.g. services stopped for a deploy).
# --keep          : leave the scratch database for inspection.
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"

strict=0 keep=0 dump=""
while [ $# -gt 0 ]; do
  case "$1" in
    --strict-counts) strict=1 ;;
    --keep) keep=1 ;;
    -*) die "unknown option: $1" ;;
    *) [ -z "$dump" ] || die "only one dump file allowed"; dump="$1" ;;
  esac
  shift
done
[ -n "$dump" ] && [ -f "$dump" ] || die "usage: restore-drill.sh DUMP [--strict-counts] [--keep]"
require_cmd psql pg_restore createdb dropdb
: "${PGDATABASE:?PGDATABASE must name the live database}"
live="$PGDATABASE"

# Integrity of the file itself, when a checksum sits beside it.
if [ -f "$dump.sha256" ]; then
  [ "$(awk '{print $1}' "$dump.sha256")" = "$(sha256_of "$dump")" ] || die "checksum mismatch for $dump"
fi

scratch="runnote_drill_$(date -u +%Y%m%d%H%M%S)_$$"
[[ "$scratch" =~ ^[a-z0-9_]+$ ]] || die "unsafe scratch name"
cleanup() {
  if [ "$keep" -eq 0 ]; then dropdb --if-exists "$scratch" >/dev/null 2>&1 || true
  else log "scratch database kept: $scratch"; fi
}
trap cleanup EXIT

q_live() { PGDATABASE="$live" psql -X -qAt -v ON_ERROR_STOP=1 -c "$1"; }
q_scratch() { PGDATABASE="$scratch" psql -X -qAt -v ON_ERROR_STOP=1 -c "$1"; }

log "restoring $(basename "$dump") into scratch database $scratch"
createdb "$scratch"
pg_restore --no-owner --no-privileges --exit-on-error --dbname="$scratch" "$dump"

fail=0
bad() { log "DRILL FAIL: $*"; fail=1; }

# 1. Schema revision matches the live database.
live_rev="$(q_live "SELECT string_agg(version_num, ',') FROM alembic_version")"
rest_rev="$(q_scratch "SELECT string_agg(version_num, ',') FROM alembic_version")"
[ -n "$rest_rev" ] || bad "restored database has no alembic revision"
[ "$live_rev" = "$rest_rev" ] || bad "revision differs: live=$live_rev restored=$rest_rev"

# 2. PostGIS actually works in the restored copy.
q_scratch "SELECT PostGIS_Version()" >/dev/null || bad "PostGIS unavailable in restored database"

# 3. Same tables and index counts as the live database.
tables_sql="SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY 1"
live_tables="$(q_live "$tables_sql")"
rest_tables="$(q_scratch "$tables_sql")"
[ "$live_tables" = "$rest_tables" ] || bad "table sets differ between live and restored databases"
index_sql="SELECT tablename||':'||count(*) FROM pg_indexes WHERE schemaname='public' GROUP BY tablename ORDER BY 1"
[ "$(q_live "$index_sql")" = "$(q_scratch "$index_sql")" ] || bad "index sets differ between live and restored databases"

# 4. Row counts per table.
total=0
while IFS= read -r table; do
  [ -n "$table" ] || continue
  [[ "$table" =~ ^[a-z0-9_]+$ ]] || { bad "unexpected table name"; continue; }
  live_n="$(q_live "SELECT count(*) FROM public.\"$table\"")"
  rest_n="$(q_scratch "SELECT count(*) FROM public.\"$table\"")"
  total=$((total + rest_n))
  if [ "$strict" -eq 1 ] && [ "$live_n" != "$rest_n" ]; then
    bad "row count differs in $table: live=$live_n restored=$rest_n"
  elif [ "$live_n" != "$rest_n" ]; then
    log "note: $table live=$live_n restored=$rest_n (live changed after the dump; allowed without --strict-counts)"
  fi
done <<< "$rest_tables"

# 5. Spatial columns must be queryable through their indexes' operators.
while IFS='|' read -r table column; do
  [ -n "$table" ] || continue
  [[ "$table" =~ ^[a-z0-9_]+$ && "$column" =~ ^[a-z0-9_]+$ ]] || continue
  q_scratch "SELECT count(*) FROM public.\"$table\" WHERE \"$column\" IS NOT NULL AND NOT ST_IsEmpty(\"$column\")" >/dev/null \
    || bad "spatial query failed on $table.$column"
done <<< "$(q_scratch "SELECT f_table_name||'|'||f_geometry_column FROM geometry_columns WHERE f_table_schema='public'")"

if [ "$fail" -ne 0 ]; then die "restore drill FAILED for $dump"; fi
log "DRILL OK: $(basename "$dump") restored; revision=$rest_rev; tables=$(printf '%s\n' "$rest_tables" | grep -c .); rows=$total"
