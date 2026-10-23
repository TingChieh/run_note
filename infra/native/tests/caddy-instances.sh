#!/usr/bin/env bash
# Functional check of the edge configuration with a real, throw-away Caddy process on high ports
# (HTTP only, admin API off, nothing under /etc touched). Proves:
#   * the legacy site keeps its basic auth and its own upstreams (8000/3000)
#   * a rendered "maintenance" site answers 503 and never reaches any upstream
#   * a rendered "live" site proxies ONLY its own ports and needs no basic auth
#   * the access limit of one site does not leak to the other
#   * the client address handed to the application is the real peer, whatever X-Forwarded-For says
#
#   caddy-instances.sh      (needs caddy, python3, curl on PATH)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
native="$(cd "$here/.." && pwd)"
T="$(mktemp -d)"
pids=""
cleanup() { for p in $pids; do kill "$p" 2>/dev/null || true; done; rm -rf "$T"; }
trap cleanup EXIT
fail() { echo "CADDY FAIL: $*" >&2; exit 1; }
ok() { echo "ok: $*" >&2; }

# four upstreams that say who they are and what client address they were told
cat > "$T/upstream.py" <<'PY'
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
who = sys.argv[2]
class H(BaseHTTPRequestHandler):
    def do_GET(self):
        body = f"{who} xff={self.headers.get('X-Forwarded-For', '-')} proto={self.headers.get('X-Forwarded-Proto', '-')}".encode()
        self.send_response(200); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
    def log_message(self, *a): pass
HTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
PY
for spec in "18000 legacy-api" "18001 legacy-web" "18100 prod-api" "18101 prod-web"; do
  # shellcheck disable=SC2086
  python3 "$T/upstream.py" $spec & pids="$pids $!"
done

cat > "$T/prod.conf" <<'CONF'
INSTANCE=prod
DOMAIN=prod.example.test
ROOT=/opt/run-note-prod
ETC=/etc/run-note-prod
BACKUP_DIR=/var/backups/run-note-prod
APP_USER=run_prod
APP_GROUP=run_prod
DB_NAME=run_prod
DB_ROLE=run_prod
API_PORT=18100
WEB_PORT=18101
SERVICE_API=runnote-prod-api
SERVICE_WEB=runnote-prod-web
SERVICE_BACKUP=runnote-prod-backup
BACKUP_ONCALENDAR=*-*-* 03:15:00 Asia/Hong_Kong
BACKUP_RANDOM_DELAY=0
CONF
mkdir -p "$T/instances" "$T/caddy/access.d" "$T/caddy/sites.d"
cp "$T/prod.conf" "$T/instances/prod.conf"
python3 "$native/ops/instance.py" check --dir "$T/instances" >/dev/null

# the staging host's access limit, as a snippet in access.d (basic auth, one user)
hash="$(caddy hash-password --plaintext 'staging-test-password')"
printf 'basic_auth {\n\tstaging %s\n}\n' "$hash" > "$T/caddy/access.d/staging.caddy"

# the repository Caddyfile, with the absolute /etc/caddy paths pointed at the sandbox and the
# sites made plain-HTTP on a high port (certificates are not what is under test here)
make_caddyfile() {
  {
    printf '{\n\tauto_https off\n\tadmin off\n\thttp_port 18080\n}\n'
    # shellcheck disable=SC2016 # the single quotes keep the literal Caddy placeholder {$RUNNOTE_DOMAIN}
    # (the legacy upstream ports 8000/3000 are moved to 18000/18001 so this test can never touch a
    # real service on a host that runs one)
    sed -e "s#/etc/caddy/#$T/caddy/#g" -e 's#^{\$RUNNOTE_DOMAIN} {#http://{$RUNNOTE_DOMAIN} {#' \
      -e 's#import runnote_app 8000 3000#import runnote_app 18000 18001#' "$native/Caddyfile"
  } > "$T/Caddyfile"
}
render_site() { # $1 maintenance|live
  rm -rf "$T/out"
  python3 "$native/ops/instance.py" render prod --dir "$T/instances" --out "$T/out" --caddy-mode "$1" >/dev/null
  sed -e 's#^prod.example.test {#http://prod.example.test {#' "$T/out/prod.caddy" > "$T/caddy/sites.d/prod.caddy"
}
get() { # $1 host, $2 path, extra curl args...
  local host="$1" path="$2"; shift 2
  curl -sS --max-time 5 -H "Host: $host" "$@" "http://127.0.0.1:18080$path"
}
code() { local host="$1" path="$2"; shift 2; curl -sS --max-time 5 -o /dev/null -w '%{http_code}' -H "Host: $host" "$@" "http://127.0.0.1:18080$path"; }

start_caddy() {
  make_caddyfile
  RUNNOTE_DOMAIN=staging.example.test caddy validate --config "$T/Caddyfile" --adapter caddyfile >/dev/null 2>"$T/validate.log" || { cat "$T/validate.log" >&2; fail "Caddyfile does not validate"; }
  RUNNOTE_DOMAIN=staging.example.test caddy run --config "$T/Caddyfile" --adapter caddyfile >"$T/caddy.log" 2>&1 &
  caddy_pid=$!; pids="$pids $caddy_pid"
  for _ in $(seq 1 30); do curl -s -o /dev/null --max-time 1 "http://127.0.0.1:18080/" && return 0; sleep 0.5; done
  cat "$T/caddy.log" >&2; fail "caddy did not start"
}
stop_caddy() { kill "$caddy_pid" 2>/dev/null || true; wait "$caddy_pid" 2>/dev/null || true; }

echo "=== maintenance mode" >&2
render_site maintenance
start_caddy
[ "$(code staging.example.test /)" = 401 ] || fail "staging must demand basic auth"
[ "$(code staging.example.test / -u staging:wrong)" = 401 ] || fail "wrong staging password accepted"
body="$(get staging.example.test /api/v1/x -u staging:staging-test-password)"
case "$body" in "legacy-api "*) ;; *) fail "staging /api did not reach the legacy API upstream: $body" ;; esac
body="$(get staging.example.test / -u staging:staging-test-password)"
case "$body" in "legacy-web "*) ;; *) fail "staging / did not reach the legacy web upstream: $body" ;; esac
ok "staging keeps basic auth and proxies only its own upstreams"
for path in / /api/v1/health/ready /dashboard; do
  [ "$(code prod.example.test "$path")" = 503 ] || fail "maintenance site answered something other than 503 for $path"
done
get prod.example.test / | grep -q "即将上线" || fail "maintenance page text missing"
curl -sSI --max-time 5 -H "Host: prod.example.test" http://127.0.0.1:18080/ | tr -d '\r' | grep -iq '^retry-after: 3600' || fail "Retry-After header missing"
curl -sSI --max-time 5 -H "Host: prod.example.test" http://127.0.0.1:18080/ | tr -d '\r' | grep -iq '^www-authenticate' && fail "maintenance site asks for credentials"
if get prod.example.test / | grep -q "prod-"; then fail "maintenance site reached a production upstream"; fi
ok "production is a 503 maintenance page and reaches no upstream, with no basic auth"
stop_caddy

echo "=== live mode" >&2
render_site live
start_caddy
body="$(get prod.example.test /api/v1/x)"
case "$body" in "prod-api "*) ;; *) fail "live /api did not reach the production API upstream: $body" ;; esac
body="$(get prod.example.test /)"
case "$body" in "prod-web "*) ;; *) fail "live / did not reach the production web upstream: $body" ;; esac
[ "$(code prod.example.test /)" = 200 ] || fail "live site must not require basic auth"
headers="$(curl -sSI --max-time 5 -H "Host: prod.example.test" http://127.0.0.1:18080/ | tr -d '\r')"
for h in strict-transport-security x-content-type-options x-frame-options content-security-policy-report-only; do
  printf '%s\n' "$headers" | grep -iq "^$h:" || fail "live site lacks the $h header"
done
printf '%s\n' "$headers" | grep -iq '^server:' && fail "live site leaks a Server header"
ok "live production proxies only its own upstreams, needs no basic auth and carries the security headers"
[ "$(code staging.example.test /)" = 401 ] || fail "staging lost its basic auth after production went live"
body="$(get prod.example.test /api/v1/x -H 'X-Forwarded-For: 203.0.113.9')"
case "$body" in *"xff=203.0.113.9"*) fail "a spoofed X-Forwarded-For reached the production API: $body" ;; esac
case "$body" in *"xff=127.0.0.1"*) ;; *) fail "production API did not receive the real peer address: $body" ;; esac
body="$(get staging.example.test /api/v1/x -u staging:staging-test-password -H 'X-Forwarded-For: 203.0.113.9')"
case "$body" in *"xff=203.0.113.9"*) fail "a spoofed X-Forwarded-For reached the legacy API: $body" ;; esac
ok "X-Forwarded-For is overwritten with the real peer for both sites"
stop_caddy
echo "ALL CADDY INSTANCE CHECKS PASSED" >&2
