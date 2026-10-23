#!/usr/bin/env bash
# Prove a release tarball is self-contained BEFORE it is shipped: every script, template and
# configuration resource the deployment tooling needs is inside it, and the operator-facing tools
# actually work when run from the unpacked release (not from a repository checkout).
#
#   verify-release.sh RELEASE.tar.gz
#
# build-release.sh runs this on every build and deletes the tarball if it fails; CI and the
# end-to-end rehearsals run the tooling from the unpacked release as well.
set -euo pipefail
tarball="${1:?usage: verify-release.sh RELEASE.tar.gz}"
fail() { printf 'verify-release: %s\n' "$*" >&2; exit 1; }
[ -f "$tarball" ] || fail "no such file: $tarball"
command -v python3 >/dev/null 2>&1 || fail "python3 is required"

top="$(tar -tzf "$tarball" | sed -n '1{s#/.*##;p;}')"
[ -n "$top" ] || fail "empty archive"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
tar -xzf "$tarball" -C "$work" --strip-components=1

# ---- every file the tooling needs, at the path the operator and the scripts use ---------
required=(
  RELEASE backend/alembic.ini backend/requirements.lock frontend/build/index.js scripts/site-owner.py
  ops/lib.sh ops/deploy.sh ops/rollback.sh ops/backup.sh ops/restore-drill.sh
  ops/init-instance.sh ops/set-site-mode.sh ops/verify-release.sh
  ops/acceptance-check.py ops/envfile.py ops/instance.py ops/schema_compat.py
  infra/native/Caddyfile infra/native/instances/production.conf.example
  infra/native/runnote-api.service infra/native/runnote-web.service
  infra/native/runnote-backup.service infra/native/runnote-backup.timer
  infra/native/env/backend.env.example infra/native/env/frontend.env.example infra/native/env/backup.env.example
  infra/native/templates/api.service.in infra/native/templates/web.service.in
  infra/native/templates/backup.service.in infra/native/templates/backup.timer.in
  infra/native/templates/caddy-maintenance.in infra/native/templates/caddy-live.in
)
missing=()
for f in "${required[@]}"; do [ -f "$work/$f" ] || missing+=("$f"); done
for d in backend/app backend/migrations; do [ -d "$work/$d" ] || missing+=("$d/"); done
[ "${#missing[@]}" -eq 0 ] || fail "release is missing: ${missing[*]}"
for f in ops/deploy.sh ops/rollback.sh ops/backup.sh ops/restore-drill.sh ops/init-instance.sh ops/set-site-mode.sh ops/verify-release.sh; do
  [ -x "$work/$f" ] || fail "$f is not executable"
  bash -n "$work/$f" || fail "$f has a syntax error"
done
[ -x "$work/ops/acceptance-check.py" ] || fail "ops/acceptance-check.py is not executable"
python3 -m py_compile "$work/ops/acceptance-check.py" || fail "ops/acceptance-check.py does not compile"
grep -q '^(runnote_app) {' "$work/infra/native/Caddyfile" || fail "the shipped Caddyfile lacks the (runnote_app) snippet"
grep -qF 'import /etc/caddy/sites.d/*.caddy' "$work/infra/native/Caddyfile" || fail "the shipped Caddyfile does not import sites.d"

# ---- the operator tools work from the unpacked release, from any working directory ------
tool="$work/ops/instance.py"
cd /
python3 "$tool" render --legacy --out "$work/.legacy" >/dev/null || fail "instance.py cannot render from the release layout"
for f in runnote-api.service runnote-web.service runnote-backup.service runnote-backup.timer; do
  cmp -s "$work/.legacy/$f" "$work/infra/native/$f" || fail "rendering the legacy layout no longer reproduces $f"
done
mkdir -p "$work/.instances"
cp "$work/infra/native/instances/production.conf.example" "$work/.instances/production.conf"
python3 "$tool" check --dir "$work/.instances" >/dev/null || fail "the shipped production.conf.example is not valid"
for mode in maintenance live; do
  python3 "$tool" render production --dir "$work/.instances" --out "$work/.out-$mode" --caddy-mode "$mode" >/dev/null \
    || fail "instance.py cannot render the production instance ($mode) from the release layout"
  [ "$(find "$work/.out-$mode" -type f | wc -l | tr -d ' ')" -eq 5 ] || fail "unexpected number of rendered files ($mode)"
done
printf 'verify-release: %s is self-contained\n' "$(basename "$tarball")" >&2
