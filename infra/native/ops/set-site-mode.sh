#!/usr/bin/env bash
# Put an instance's domain behind the proxy as a maintenance page, or release it to the application.
#
#   set-site-mode.sh NAME maintenance|live
#
# `maintenance` is always allowed (it is the safe state). `live` is refused unless the instance is
# actually ready: a completed release is current, the API and the Node proxy answer, and the
# configured site owner exists (the public showcase has nothing to show without one, and it fails
# closed with 503). The generated site file is validated together with the whole Caddyfile before
# anything is reloaded; on a validation error the previous file is restored.
set -euo pipefail
name="${1:-}" mode="${2:-}"
if [ -z "$name" ] || { [ "$mode" != maintenance ] && [ "$mode" != live ]; }; then
  echo "usage: set-site-mode.sh NAME maintenance|live" >&2; exit 1
fi
export RUNNOTE_INSTANCE="$name"
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"
[ "$(id -u)" -eq 0 ] || [ -n "${RUNNOTE_ALLOW_NONROOT:-}" ] || die "run as root (sudo)"
SYSTEMCTL="${SYSTEMCTL:-systemctl}"
CADDY="${CADDY:-caddy}"
CADDYFILE="${CADDYFILE:-/etc/caddy/Caddyfile}"
SITES_DIR="${CADDY_SITES_DIR:-/etc/caddy/sites.d}"
here="$(cd "$(dirname "$0")" && pwd)"
require_cmd python3 "$CADDY"

if [ "$mode" = live ]; then
  release="$(current_release_dir)"
  if [ -z "$release" ] || [ ! -e "$release/$COMPLETE_MARKER" ]; then die "no completed release is current for $name; deploy first"; fi
  wait_http_ok "$API_URL/api/v1/health/ready" 10 || die "the API of $name is not ready on $API_URL"
  wait_http_ok "$WEB_URL/api/health" 10 || die "the Node proxy of $name is not answering on $WEB_URL"
  owner_out="$(cd "$release/backend" && as_app "$release/backend/.venv/bin/python" "$release/ops/envfile.py" exec "$BACKEND_ENV" -- \
    "$release/backend/.venv/bin/python" "$release/scripts/site-owner.py" status 2>&1)" || true
  case "$owner_out" in
    "Owner ready"*) ;;
    *) die "the site owner of $name does not exist yet (create it interactively first); staying in maintenance" ;;
  esac
fi

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
python3 "$here/instance.py" render "$name" --out "$tmp" --caddy-mode "$mode" ${RUNNOTE_INSTANCES_DIR:+--dir "$RUNNOTE_INSTANCES_DIR"} >/dev/null
mkdir -p "$SITES_DIR"
target="$SITES_DIR/$name.caddy" previous=""
if [ -f "$target" ]; then previous="$tmp/previous.caddy"; cp -p "$target" "$previous"; fi
install -m 0644 "$tmp/$name.caddy" "$target"
# The main Caddyfile reads RUNNOTE_DOMAIN from the service environment; validation needs the same.
legacy_domain="${RUNNOTE_DOMAIN:-$("$SYSTEMCTL" show caddy --property=Environment --value 2>/dev/null | tr ' ' '\n' | sed -n 's/^RUNNOTE_DOMAIN=//p')}"
if ! RUNNOTE_DOMAIN="${legacy_domain:-legacy.invalid}" "$CADDY" validate --config "$CADDYFILE" --adapter caddyfile >"$tmp/validate.log" 2>&1; then
  if [ -n "$previous" ]; then install -m 0644 "$previous" "$target"; else rm -f "$target"; fi
  tail -5 "$tmp/validate.log" >&2
  die "the generated site did not validate; the previous state was restored and nothing was reloaded"
fi
"$SYSTEMCTL" reload caddy
log "$INSTANCE_DOMAIN is now in '$mode' mode"
