#!/usr/bin/env bash
# Build one self-describing release tarball. Runs on CI or a workstation, never on the server.
#
#   build-release.sh [--out DIR] [--allow-dirty]
#
# Prerequisite: frontend dependencies installed (`pnpm install --frozen-lockfile`).
# The tarball ships sources + the built SvelteKit app. The Python virtualenv is created on the
# server from backend/requirements.lock (`--require-hashes`) because venvs are not relocatable.
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"

out="" dirty=0
while [ $# -gt 0 ]; do
  case "$1" in
    --out) out="${2:?--out needs a directory}"; shift ;;
    --allow-dirty) dirty=1 ;;
    *) die "unknown option: $1" ;;
  esac
  shift
done
require_cmd git tar pnpm node

repo="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
cd "$repo"
sha="$(git rev-parse --short=12 HEAD)"
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  [ "$dirty" -eq 1 ] || die "working tree has uncommitted changes; commit them or pass --allow-dirty (never for a real release)"
  sha="$sha-dirty"
fi
stamp="$(date -u +%Y%m%d%H%M%S)"
id="$stamp-$sha"
valid_release_id "$id" || die "unsafe release id: $id"
out="${out:-$repo/dist-release}"
mkdir -p "$out"

log "building frontend ($id)"
(cd frontend && pnpm build)
[ -f frontend/build/index.js ] || die "frontend build produced no build/index.js"

stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
root="$stage/$id"
mkdir -p "$root/backend" "$root/frontend" "$root/scripts" "$root/infra"
cp -R backend/app backend/migrations "$root/backend/"
cp backend/alembic.ini backend/pyproject.toml backend/requirements.lock "$root/backend/"
cp -R frontend/build "$root/frontend/build"
cp frontend/package.json "$root/frontend/"
cp scripts/site-owner.py scripts/osm-places.py scripts/backfill-place-titles.py "$root/scripts/"
cp -R infra/native "$root/infra/native"
cp -R infra/native/ops "$root/ops"
find "$root" \( -name __pycache__ -o -name '*.pyc' -o -name '.DS_Store' \) -prune -exec rm -rf {} +
rm -rf "$root/infra/native/tests"
# macOS metadata must never ship: AppleDouble companions (`._*`) are mostly NUL bytes and Alembic
# would try to import `._0001_x.py`. Delete any stray ones (and .DS_Store) from the staged tree.
find "$root" \( -name '._*' -o -name '.DS_Store' \) -exec rm -rf {} +

cat > "$root/RELEASE" <<META
id=$id
git_sha=$sha
built_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
node=$(node --version)
META

tarball="$out/run-note-$id.tar.gz"
tar_flags=(-czf "$tarball" -C "$stage")
if tar --version 2>/dev/null | grep -qi 'gnu tar'; then
  tar_flags+=(--owner=0 --group=0)
else
  # bsdtar: never archive extended attributes / AppleDouble data (older bsdtar lacks the flags,
  # COPYFILE_DISABLE below covers it).
  tar_flags+=(--uid 0 --gid 0)
  for f in --no-mac-metadata --no-xattrs; do
    if tar "$f" -cf /dev/null --files-from /dev/null 2>/dev/null; then tar_flags+=("$f"); fi
  done
fi
COPYFILE_DISABLE=1 tar "${tar_flags[@]}" "$id"
# A release that is not self-contained must never leave this script.
if ! "$(dirname "$0")/verify-release.sh" "$tarball"; then
  rm -f "$tarball"
  die "the release failed its self-containment check and was discarded"
fi
sha256_of "$tarball" | awk -v f="$(basename "$tarball")" '{print $1"  "f}' > "$tarball.sha256"
log "release ready: $tarball"
printf '%s\n' "$tarball"
