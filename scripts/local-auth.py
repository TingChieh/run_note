#!/usr/bin/env python3
"""Persistent local-only auth key; never print secrets or modify .env / database schema."""
import argparse
import os
import secrets
import stat
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
KEY = ROOT / '.env.auth-rate.key'
ORIGIN = 'http://127.0.0.1:5173'


def local_key():
    if not KEY.exists():
        try:
            descriptor = os.open(KEY, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError:
            pass
        else:
            with os.fdopen(descriptor, 'w') as handle:
                handle.write(secrets.token_urlsafe(48) + '\n')
    info = KEY.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o600:
        raise SystemExit('Local key must be an owned regular file with permission 600')
    value = KEY.read_text().strip()
    if len(value.encode()) < 32:
        raise SystemExit('Local key must contain at least 32 UTF-8 bytes; existing file preserved')
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['init', 'serve'])
    parser.add_argument('--port', type=int, default=8000)
    parser.add_argument('--site-origin', default=ORIGIN)
    args = parser.parse_args()
    # Preserve an explicitly provided process key; never generate a fresh key per restart.
    key = os.environ.get('AUTH_RATE_HASH_KEY')
    if key is None:
        key = local_key()
    elif len(key.encode()) < 32:
        raise SystemExit('AUTH_RATE_HASH_KEY requires at least 32 UTF-8 bytes')
    if args.action == 'init':
        print('Local auth key ready (value hidden); .env preserved')
        return
    os.environ.update(AUTH_RATE_HASH_KEY=key, SITE_ORIGIN=args.site_origin)
    os.chdir(ROOT / 'backend')
    python = str(ROOT / 'backend/.venv/bin/python')
    os.execv(python, [python, '-m', 'uvicorn', 'app.main:create_app', '--factory', '--host', '127.0.0.1', '--port', str(args.port)])


if __name__ == '__main__':
    main()
