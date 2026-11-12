"""Serialized all-record footprint results, reused until their snapshot changes.

A tracks snapshot is several megabytes of JSON that changes only when it is rebuilt, yet every read
loaded it from PostgreSQL, parsed, re-encoded and validated it again (about 0.8 s per request on the
production server). Each worker now keeps the serialized result keyed by what identifies the
snapshot: its owner, source data version, algorithm version and generation time. A snapshot's
content is a function of exactly those (every activity write bumps the data version, and a new
algorithm ships with a restart), so a hit can never serve stale geometry. A hit reads only the
snapshot's small columns.

The stored result is also deflated once (level 9) so that a hit is sent gzip-encoded without
compressing again: Caddy's on-the-fly gzip 9 made this response slower than not compressing at all,
while its default zstd sends about 30% more bytes. A response is one gzip member, spliced from the
per-request envelope around the stored deflate stream (Caddy passes an encoded response through).
"""

import struct
import zlib
from collections import OrderedDict
from threading import Lock

from fastapi import Response
from sqlalchemy import select
from sqlalchemy.orm import load_only

from app.core.responses import ApiResponse, ResponseMeta
from app.modules.footprints.encoding import encode_collection
from app.modules.footprints.model import FootprintSnapshot
from app.modules.footprints.schema import AllFootprintCollection, AllFootprintView
from app.modules.footprints.snapshot import read_all_footprints, snapshot_current, snapshot_view
from app.modules.users.model import User

# One tracks result is a few MB; this bounds a worker to a handful of owners.
MAX_ENTRIES = 8
_entries: OrderedDict = OrderedDict()
_lock = Lock()


def _versions(db, owner):
    return db.execute(
        select(User.activity_data_version, FootprintSnapshot)
        .options(
            load_only(
                FootprintSnapshot.source_version,
                FootprintSnapshot.algorithm_version,
                FootprintSnapshot.generated_at,
                FootprintSnapshot.state,
                FootprintSnapshot.target_version,
                raiseload=True,
            )
        )
        .outerjoin(FootprintSnapshot, FootprintSnapshot.user_id == User.id)
        .where(User.id == owner)
        .execution_options(populate_existing=True)
    ).one()


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


# Fixed gzip header (RFC 1952): deflate, no flags, no mtime, maximum compression, unknown OS.
GZIP_HEADER = b"\x1f\x8b\x08\x00\x00\x00\x00\x00\x02\xff"


def _deflate(data, mode):
    """Raw deflate. Z_SYNC_FLUSH ends on a byte boundary without a final block, so another
    independently compressed stream may follow it in the same gzip member."""
    compressor = zlib.compressobj(9, zlib.DEFLATED, -15)
    return compressor.compress(data) + compressor.flush(mode)


def _accepts_gzip(header):
    for item in header.split(","):
        name, _, params = item.partition(";")
        if name.strip().lower() != "gzip":
            continue
        params = params.replace(" ", "").lower()
        try:
            return not params.startswith("q=") or float(params[2:]) > 0
        except ValueError:
            return False
    return False


def _respond(request, data, body, deflated=None):
    outer = ApiResponse[AllFootprintView](
        data={**data, "result": None}, meta=ResponseMeta(request_id=request.state.request_id)
    ).model_dump_json()
    # Inside JSON strings quotes are escaped, so this marker occurs once: the data's own result.
    head, marker, tail = outer.partition('"result":null}')
    head, tail = (head + '"result":').encode(), ("}" + tail).encode()
    headers = {"Vary": "Accept-Encoding"}
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


def all_footprints_response(request, db, owner, mode, encoding, view=None):
    """GET .../footprints/all; `view` is the showcase whitelist, None for the owner's own read."""
    slot = (view is not None, owner, mode, encoding)
    version, snapshot = _versions(db, owner)
    identity = None
    if snapshot_current(snapshot, version):
        identity = (
            snapshot.source_version,
            snapshot.algorithm_version,
            snapshot.generated_at,
        )
        entry = _get(slot, identity)
        if entry is not None:
            return _respond(request, snapshot_view(snapshot, version, mode, result=True), *entry)
    data = read_all_footprints(db, owner, mode)
    if data["result"] is None:
        return _respond(request, data, b"null")
    result = view(data["result"]) if view is not None else data["result"]
    if encoding == "delta":
        result = encode_collection(result)
    body = AllFootprintCollection.model_validate(result).model_dump_json().encode()
    # Rebuilt between the two reads: the payload is newer than `identity`, so it is not stored.
    if identity is None or data["generated_at"] != identity[2]:
        return _respond(request, data, body)
    entry = (body, _deflate(body, zlib.Z_SYNC_FLUSH))
    _put(slot, identity, entry)
    return _respond(request, data, *entry)
