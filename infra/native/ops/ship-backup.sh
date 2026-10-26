#!/usr/bin/env bash
# The backup ship.py takes right before a deploy: a real restore drill, labelled ship-<release>.
#
#   RUNNOTE_INSTANCE=NAME ship-backup.sh RELEASE_ID
#
# It is not the nightly backup and must not count as one: the label gives it its own local quota
# (KEEP_SHIP) and its own off-site retention, and the nightly heartbeat is left alone. Run as
# root (or as the database account); it loads backup.env first, then drops to postgres, exactly
# like the pre-migration backup in deploy.sh.
set -euo pipefail
umask 077
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"
load_backup_env "$0" "$@"
assert_instance_database

release_id="${1:?usage: ship-backup.sh RELEASE_ID}"
[[ "$release_id" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,50}$ ]] || die "invalid release id"

# A deploy must not report success to the nightly dead-man's switch.
unset HEALTHCHECK_URL
export RESTIC_CACHE_DIR="${RESTIC_CACHE_DIR:-$BACKUP_DIR/.restic-cache}"
as_pg "$(dirname "$0")/backup.sh" --label "ship-$release_id" --drill
