"""Serialized together overview results, reused until participant or activity state changes.

The together overview simplifies and encodes up to 500 track segments plus 20 recent activities on
every request (~0.5 s of server time on production, ~525 KB of JSON). Each worker caches the
serialized result per (site_owner_email, period), keyed by the Shanghai date and a lightweight
metadata fingerprint over eligible participants and their activities/segments.

As in footprints/cache.py, the cached JSON body is deflated once at zlib level 9 (Z_SYNC_FLUSH)
and spliced into a single valid gzip member per request so Caddy passes it through without
re-compressing on the fly.
"""

import struct
import zlib
from collections import OrderedDict
from threading import Lock
from zoneinfo import ZoneInfo

from fastapi import Response
from sqlalchemy import text

from app.core.responses import ApiResponse, ResponseMeta
from app.modules.footprints.cache import GZIP_HEADER, _accepts_gzip, _deflate
from app.modules.together.schema import TogetherView
from app.modules.together.service import ELIGIBLE, overview

MAX_ENTRIES = 8
_entries: OrderedDict = OrderedDict()
_lock = Lock()


def _fingerprint(db, settings, today):
    rows = db.execute(
        text(f"""
            SELECT u.id, u.username, u.display_name, u.avatar_version, u.activity_data_version,
                count(a.id), COALESCE(sum(a.distance_m), 0), max(a.updated_at),
                COALESCE(sum(a.activity_date - DATE '2000-01-01'), 0),
                (SELECT count(*) FROM activity_segments s
                    JOIN activities a2 ON a2.id = s.activity_id WHERE a2.user_id = u.id)
            FROM users u LEFT JOIN activities a ON a.user_id = u.id
            WHERE {ELIGIBLE}
            GROUP BY u.id ORDER BY u.id
        """),
        {"owner": settings.site_owner_email},
    ).all()
    return (today, tuple(tuple(row) for row in rows))


def _get(slot, identity):
    with _lock:
        entry = _entries.get(slot)
        if entry is None or entry[0] != identity:
            return None
        _entries.move_to_end(slot)
        return entry[1]


def _put(slot, identity, entry):
    with _lock:
        _entries[slot] = (identity, entry)
        _entries.move_to_end(slot)
        while len(_entries) > MAX_ENTRIES:
            _entries.popitem(last=False)


def _respond(request, body, deflated=None):
    outer = ApiResponse[None](
        data=None, meta=ResponseMeta(request_id=request.state.request_id)
    ).model_dump_json()
    head, _, tail = outer.partition('"data":null')
    head, tail = (head + '"data":').encode(), tail.encode()
    headers = {"Cache-Control": "no-store", "Vary": "Accept-Encoding"}
    if deflated is None or not _accepts_gzip(request.headers.get("accept-encoding", "")):
        return Response(head + body + tail, media_type="application/json", headers=headers)
    crc = zlib.crc32(tail, zlib.crc32(body, zlib.crc32(head)))
    size = (len(head) + len(body) + len(tail)) & 0xFFFFFFFF
    content = b"".join(
        (
            GZIP_HEADER,
            _deflate(head, zlib.Z_SYNC_FLUSH),
            deflated,
            _deflate(tail, zlib.Z_FINISH),
            struct.pack("<II", crc, size),
        )
    )
    headers["Content-Encoding"] = "gzip"
    return Response(content, media_type="application/json", headers=headers)


def together_response(request, db, settings, now, period):
    today = now.astimezone(ZoneInfo("Asia/Shanghai")).date()
    slot = (settings.site_owner_email, period)
    identity = _fingerprint(db, settings, today)
    entry = _get(slot, identity)
    if entry is not None:
        return _respond(request, *entry)
    data = overview(db, settings, now, period)
    body = TogetherView.model_validate(data).model_dump_json().encode()
    if _fingerprint(db, settings, today) != identity:
        return _respond(request, body)
    entry = (body, _deflate(body, zlib.Z_SYNC_FLUSH))
    _put(slot, identity, entry)
    return _respond(request, *entry)
