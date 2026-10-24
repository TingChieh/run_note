#!/usr/bin/env bash
# Encrypted off-site backup copy (restic) for one Run Note instance: one-time setup and a real
# retrieval check.
#
#   RUNNOTE_INSTANCE=NAME offsite.sh setup  [--repository REPO] [--reconfigure] [--no-drill]
#   RUNNOTE_INSTANCE=NAME offsite.sh finish [--no-drill]
#   RUNNOTE_INSTANCE=NAME offsite.sh verify [--max-age-hours N] [--no-drill]
#
# setup   Interactive, run once as root on the server (use `ssh -t`). Asks for the Cloudflare R2
#         account id, bucket and an Object Read & Write API token at hidden prompts (nothing goes
#         through argv, the environment of other processes or a chat), generates the restic
#         encryption password on the server, initialises the repository, only then writes the
#         settings into backup.env, uploads a first backup and runs `verify` on it.
#         --repository REPO  use this restic repository instead of R2 (any S3 endpoint
#                            "s3:https://host/bucket", or a local path); S3 keys are still asked
#                            for when it starts with "s3:".
# finish  Resumes a setup that created the repository but stopped before the first upload and
#         check completed; also moves a password file left in the root-only config directory to
#         where the database account can read it. Shows the password at the end.
# verify  Proves the copy is usable, not merely present: `restic check`, the newest snapshot is
#         recent, it is restored to a scratch directory, its checksum matches, and unless
#         --no-drill is given the restored dump goes through restore-drill.sh (a real restore into
#         a scratch database compared with the live one). Exit status 0 only if all of it holds.
#         Safe to run at any time and from a timer.
#
# The restic password is the only way to read the off-site copy. It is shown once at the end of
# setup; keep it in a password manager. Lose it and the off-site backups are unrecoverable.
set -euo pipefail
umask 077
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"

OPS_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_KEYS='RESTIC_REPOSITORY|RESTIC_PASSWORD_FILE|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|AWS_DEFAULT_REGION'
# Not under $RUNNOTE_ETC: that directory is closed to the postgres account, which is the account
# that runs the nightly upload and the retrieval check and must read this file.
PASSWORD_FILE="$BACKUP_DIR/restic.password"

# ask VAR "prompt" [secret]: read one answer from the terminal (hidden for secrets). Tests feed
# answers, one per line, from the file named by RUNNOTE_OFFSITE_INPUT.
open_prompts() { # fd 3 = the answers; only setup is interactive (verify also runs from a timer)
  if [ -n "${RUNNOTE_OFFSITE_INPUT:-}" ]; then
    [ -r "$RUNNOTE_OFFSITE_INPUT" ] || die "RUNNOTE_OFFSITE_INPUT is not readable"
    exec 3< "$RUNNOTE_OFFSITE_INPUT"
  else
    { exec 3< /dev/tty; } 2>/dev/null || die "no terminal for prompts (run through: ssh -t HOST ...)"
  fi
}
ask() {
  local __var="$1" __prompt="$2" __secret="${3:-}" __value=""
  if [ -z "${RUNNOTE_OFFSITE_INPUT:-}" ]; then
    printf '%s: ' "$__prompt" >&2
    if [ -n "$__secret" ]; then
      IFS= read -rs __value <&3 || true
      printf '\n' >&2
    else
      IFS= read -r __value <&3 || true
    fi
  else
    IFS= read -r __value <&3 || true
  fi
  printf -v "$__var" '%s' "$__value"
}

load_env() { # re-exec the caller once with backup.env loaded (PGDATABASE, RESTIC_*, AWS_*)
  [ -f "$BACKUP_ENV" ] || die "$BACKUP_ENV does not exist; run init-instance.sh first"
  load_backup_env "$0" "$@"
}

# Run a command as the database account with backup.env loaded. The file is read BEFORE dropping
# privileges: its directory is root-only, exactly as when systemd loads it for the nightly unit.
run_with_env_as_pg() {
  local common=("RUNNOTE_INSTANCE=${RUNNOTE_INSTANCE:-}" RUNNOTE_BACKUP_ENV_LOADED=1
    "RESTIC_CACHE_DIR=${RESTIC_CACHE_DIR:-$BACKUP_DIR/.restic-cache}")
  if [ "$(id -u)" -eq 0 ]; then
    python3 "$OPS_DIR/envfile.py" exec "$BACKUP_ENV" -- runuser -u postgres -- env "${common[@]}" "$@"
  else
    python3 "$OPS_DIR/envfile.py" exec "$BACKUP_ENV" -- env "${common[@]}" "$@"
  fi
}

restic_env_defaults() {
  export RESTIC_CACHE_DIR="${RESTIC_CACHE_DIR:-$BACKUP_DIR/.restic-cache}"
  mkdir -p "$RESTIC_CACHE_DIR"
}

# ---- verify ----------------------------------------------------------------------------
cmd_verify() {
  local max_age=36 drill=1
  while [ $# -gt 0 ]; do
    case "$1" in
      --max-age-hours) max_age="${2:?--max-age-hours needs a value}"; shift ;;
      --no-drill) drill=0 ;;
      *) die "unknown option: $1" ;;
    esac
    shift
  done
  [[ "$max_age" =~ ^[0-9]{1,5}$ ]] || die "--max-age-hours must be a whole number"
  # Needs the database account (restore drill) and read access to the password file: postgres.
  if [ "$(id -u)" -eq 0 ]; then
    local again=(verify --max-age-hours "$max_age")
    [ "$drill" -eq 1 ] || again+=(--no-drill)
    run_with_env_as_pg "$0" "${again[@]}"
    exit $?
  fi
  load_env verify "$@"
  : "${RESTIC_REPOSITORY:?off-site is not configured (RESTIC_REPOSITORY is empty in backup.env)}"
  : "${PGDATABASE:?PGDATABASE must be set}"
  assert_instance_database
  require_cmd restic python3
  restic_env_defaults

  log "checking the repository structure"
  restic check >&2 || die "restic check failed"

  local listing count newest age_h
  listing="$(restic snapshots --json --tag "$PGDATABASE")" || die "cannot list snapshots"
  read -r count newest < <(printf '%s' "$listing" | python3 -c '
import json, sys
from datetime import datetime
snaps = json.load(sys.stdin)
newest = max((datetime.fromisoformat(s["time"].replace("Z", "+00:00")).timestamp() for s in snaps), default=0)
print(len(snaps), int(newest))')
  [ "$count" -gt 0 ] || die "the off-site repository holds no snapshot for $PGDATABASE"
  age_h=$(( ($(date +%s) - newest) / 3600 ))
  log "$count snapshot(s) for $PGDATABASE, newest is ${age_h}h old"
  [ "$age_h" -le "$max_age" ] || die "newest off-site snapshot is ${age_h}h old (limit ${max_age}h): uploads are not happening"

  mkdir -p "$BACKUP_DIR"
  local scratch
  scratch="$(mktemp -d "$BACKUP_DIR/.offsite-verify.XXXXXX")"
  # shellcheck disable=SC2064 # expand now: the path is fixed
  trap "rm -rf -- '$scratch'" EXIT
  log "restoring the newest snapshot from off-site"
  restic restore latest --tag "$PGDATABASE" --target "$scratch" >&2 || die "restore from off-site failed"

  local dump sums n=0
  while IFS= read -r dump; do
    n=$((n + 1))
    sums="$dump.sha256"
    [ -f "$sums" ] || die "restored $(basename "$dump") has no checksum file"
    [ "$(awk '{print $1}' "$sums")" = "$(sha256_of "$dump")" ] \
      || die "restored $(basename "$dump") does not match its recorded checksum"
    pg_restore --list "$dump" | grep -q 'TABLE DATA public alembic_version' \
      || die "restored $(basename "$dump") is not a Run Note archive"
    if [ "$drill" -eq 1 ]; then
      log "restore drill on the off-site copy $(basename "$dump")"
      "$OPS_DIR/restore-drill.sh" "$dump" || die "restore drill failed on the off-site copy"
    fi
  done < <(find "$scratch" -type f -name '*.dump' | sort)
  [ "$n" -gt 0 ] || die "the newest snapshot contains no dump file"
  log "off-site copy verified ($n dump, drill=$([ "$drill" -eq 1 ] && echo yes || echo skipped))"
}

# ---- setup -----------------------------------------------------------------------------
write_env() { # replace the managed keys in backup.env, keep everything else, keep owner and mode
  local tmp
  tmp="$(mktemp "$BACKUP_ENV.XXXXXX")"
  { grep -Ev "^($ENV_KEYS)=" "$BACKUP_ENV" || true; } > "$tmp"
  {
    printf 'RESTIC_REPOSITORY=%s\n' "$1"
    printf 'RESTIC_PASSWORD_FILE=%s\n' "$PASSWORD_FILE"
    if [ -n "${2:-}" ]; then
      printf 'AWS_ACCESS_KEY_ID=%s\n' "$2"
      printf 'AWS_SECRET_ACCESS_KEY=%s\n' "$3"
      printf 'AWS_DEFAULT_REGION=auto\n'
    fi
  } >> "$tmp"
  chmod 0640 "$tmp"
  if [ "$(id -u)" -eq 0 ]; then chown root:postgres "$tmp"; fi
  mv -f "$tmp" "$BACKUP_ENV"
}

cmd_setup() {
  local repo="" reconfigure=0 drill_flag=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --repository) repo="${2:?--repository needs a value}"; shift ;;
      --reconfigure) reconfigure=1 ;;
      --no-drill) drill_flag="--no-drill" ;;
      *) die "unknown option: $1" ;;
    esac
    shift
  done
  [ "$(id -u)" -eq 0 ] || [ -n "${RUNNOTE_OFFSITE_ALLOW_NONROOT:-}" ] || die "run setup as root"
  [ -f "$BACKUP_ENV" ] || die "$BACKUP_ENV does not exist; run init-instance.sh first"
  require_cmd restic python3
  open_prompts
  if grep -Eq '^RESTIC_REPOSITORY=.' "$BACKUP_ENV" && [ "$reconfigure" -ne 1 ]; then
    die "off-site is already configured in $BACKUP_ENV (use verify; --reconfigure only to point at a NEW empty repository)"
  fi

  local db
  db="$(sed -n 's/^PGDATABASE=//p' "$BACKUP_ENV" | tail -n 1)"
  [ -n "$db" ] || die "PGDATABASE is missing in $BACKUP_ENV"
  PGDATABASE="$db" assert_instance_database

  local key_id="" key_secret=""
  if [ -z "$repo" ]; then
    local account bucket
    ask account "Cloudflare account id (32 hex characters)"
    [[ "$account" =~ ^[0-9a-f]{32}$ ]] || die "that is not a Cloudflare account id"
    ask bucket "R2 bucket name"
    [[ "$bucket" =~ ^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$ ]] || die "invalid bucket name"
    repo="s3:https://$account.r2.cloudflarestorage.com/$bucket/${RUNNOTE_INSTANCE:-run-note}"
  fi
  case "$repo" in
    s3:*)
      ask key_id "R2 access key id" secret
      ask key_secret "R2 secret access key" secret
      if [ -z "$key_id" ] || [ -z "$key_secret" ]; then die "both the access key id and the secret are required"; fi
      export AWS_ACCESS_KEY_ID="$key_id" AWS_SECRET_ACCESS_KEY="$key_secret" AWS_DEFAULT_REGION=auto
      ;;
  esac

  # The password protects every off-site copy; an existing file means an existing repository.
  if [ -e "$PASSWORD_FILE" ] && [ "$reconfigure" -ne 1 ]; then
    die "$PASSWORD_FILE already exists; refusing to replace the key of an existing repository"
  fi
  local created_password=0
  if [ ! -e "$PASSWORD_FILE" ]; then
    created_password=1
    local pw
    pw="$(head -c 48 /dev/urandom | base64 | tr -d '\n=+/' | cut -c1-40)"
    [ "${#pw}" -eq 40 ] || die "could not generate a password"
    mkdir -p "$BACKUP_DIR"
    ( umask 077; printf '%s\n' "$pw" > "$PASSWORD_FILE.new" )
    if [ "$(id -u)" -eq 0 ]; then chown postgres "$PASSWORD_FILE.new"; fi
    mv "$PASSWORD_FILE.new" "$PASSWORD_FILE"
    unset pw
  fi

  export RESTIC_REPOSITORY="$repo" RESTIC_PASSWORD_FILE="$PASSWORD_FILE"
  export RESTIC_CACHE_DIR="$BACKUP_DIR/.restic-cache"
  mkdir -p "$RESTIC_CACHE_DIR"
  if [ "$(id -u)" -eq 0 ]; then chown -R postgres "$RESTIC_CACHE_DIR"; fi

  log "initialising the encrypted repository"
  if ! restic init >&2; then
    [ "$created_password" -eq 0 ] || rm -f -- "$PASSWORD_FILE"
    die "restic init failed (wrong credentials, or a repository already exists there?). Nothing was saved."
  fi

  write_env "$repo" "$key_id" "$key_secret"
  unset key_id key_secret AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY

  finish_first_upload "$drill_flag"
}

# First upload, retrieval check, and the one-time display of the password.
finish_first_upload() { # $1 = "" or --no-drill
  log "uploading a first backup"
  run_with_env_as_pg "$OPS_DIR/backup.sh" --label pre-offsite >&2 \
    || die "first backup failed; the repository is configured, rerun: offsite.sh finish"

  "$0" verify ${1:+"$1"}

  if [ -t 2 ]; then
    {
      printf '\n==== SAVE THIS NOW: the restic encryption password ====\n'
      cat "$PASSWORD_FILE"
      printf '==== Without it the off-site backups cannot be read. Store it in a password manager. ====\n'
    } >&2
    ask _ack "Press Enter once you have saved it"
  else
    log "password not displayed (no terminal); it is in $PASSWORD_FILE"
  fi
  log "off-site backup is configured and verified; nightly backups now upload automatically"
}

replace_env_key() { # $1 key, $2 value
  local tmp
  tmp="$(mktemp "$BACKUP_ENV.XXXXXX")"
  { grep -Ev "^$1=" "$BACKUP_ENV" || true; } > "$tmp"
  printf '%s=%s\n' "$1" "$2" >> "$tmp"
  chmod 0640 "$tmp"
  if [ "$(id -u)" -eq 0 ]; then chown root:postgres "$tmp"; fi
  mv -f "$tmp" "$BACKUP_ENV"
}

# Resume after a setup that created the repository but stopped before the first upload finished
# (or move an older installation's password file to where the database account can read it).
cmd_finish() {
  local drill_flag=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --no-drill) drill_flag="--no-drill" ;;
      *) die "unknown option: $1" ;;
    esac
    shift
  done
  [ "$(id -u)" -eq 0 ] || [ -n "${RUNNOTE_OFFSITE_ALLOW_NONROOT:-}" ] || die "run finish as root"
  [ -f "$BACKUP_ENV" ] || die "$BACKUP_ENV does not exist"
  grep -Eq '^RESTIC_REPOSITORY=.' "$BACKUP_ENV" || die "off-site is not configured; run setup"
  open_prompts
  local current
  current="$(sed -n 's/^RESTIC_PASSWORD_FILE=//p' "$BACKUP_ENV" | tail -n 1)"
  [ -n "$current" ] && [ -f "$current" ] || die "the password file named in backup.env is missing"
  if [ "$current" != "$PASSWORD_FILE" ]; then
    [ ! -e "$PASSWORD_FILE" ] || die "$PASSWORD_FILE already exists; not replacing it"
    mkdir -p "$BACKUP_DIR"
    ( umask 077; cat "$current" > "$PASSWORD_FILE.new" )
    if [ "$(id -u)" -eq 0 ]; then chown postgres "$PASSWORD_FILE.new"; fi
    mv "$PASSWORD_FILE.new" "$PASSWORD_FILE"
    replace_env_key RESTIC_PASSWORD_FILE "$PASSWORD_FILE"
    rm -f -- "$current"
    log "moved the password file to $PASSWORD_FILE"
  fi
  mkdir -p "$BACKUP_DIR/.restic-cache"
  if [ "$(id -u)" -eq 0 ]; then chown -R postgres "$BACKUP_DIR/.restic-cache"; fi
  finish_first_upload "$drill_flag"
}

case "${1:-}" in
  setup) shift; cmd_setup "$@" ;;
  verify) shift; cmd_verify "$@" ;;
  finish) shift; cmd_finish "$@" ;;
  *) die "usage: offsite.sh setup|finish|verify [options] (see the header of this file)" ;;
esac
