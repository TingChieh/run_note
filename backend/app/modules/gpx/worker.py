"""Spawn isolation with a per-API-process parser slot and bounded cleanup."""

import multiprocessing
import threading
import time
from functools import partial

from app.core.errors import ApiError
from app.modules.gpx.parser import MAX_BYTES, parse_gpx
from app.modules.gpx.schema import ParsedGPX
from app.modules.mifitness.parser import parse_mifitness_gpx
from app.modules.tcx.parser import parse_tcx

_SLOT = threading.Semaphore(1)


def _parse_target(raw, pipe, format="gpx", timezone="UTC", time_mode="absolute"):
    try:
        if format == "mifitness":
            parsed = parse_mifitness_gpx(raw)
        elif format == "tcx":
            parsed = parse_tcx(raw, timezone, time_mode)
        else:
            parsed = parse_gpx(raw)
        pipe.send(("ok", parsed))
    except ApiError as error:
        pipe.send(("error", (error.status_code, error.code, error.message)))
    except Exception:
        pipe.send(("error", (400, f"{format.upper()}_XML_INVALID", "轨迹文件无法解析")))
    finally:
        pipe.close()


def bounded_parse(
    raw: bytes,
    timeout: float = 15,
    *,
    _target=None,
    format="gpx",
    timezone="UTC",
    time_mode="absolute",
) -> ParsedGPX:
    prefix = format.upper()
    if len(raw) > MAX_BYTES:
        raise ApiError(413, f"{prefix}_TOO_LARGE", "轨迹文件超过大小限制")
    if not _SLOT.acquire(blocking=False):
        raise ApiError(429, "IMPORT_BUSY", "解析服务正忙", retry_after=1)
    context = multiprocessing.get_context("spawn")
    receiver, sender = context.Pipe(duplex=False)
    target = _target or partial(
        _parse_target, format=format, timezone=timezone, time_mode=time_mode
    )
    process = context.Process(target=target, args=(raw, sender))
    started = False
    watchdog = None
    expired = threading.Event()
    deadline = time.monotonic() + timeout

    def expire():
        expired.set()
        # Closing the only child-side writer unblocks even a partial framed recv.
        # finally joins this watchdog before closing the Process object.
        try:
            if process.is_alive():
                process.kill()
        except OSError:
            pass

    try:
        process.start()
        started = True
        sender.close()
        watchdog = threading.Timer(max(0, deadline - time.monotonic()), expire)
        watchdog.daemon = True
        watchdog.start()
        # Receive before joining: a 50000-point payload exceeds pipe capacity.
        if not receiver.poll(max(0, deadline - time.monotonic())):
            raise ApiError(503, f"{prefix}_PROCESSING_TIMEOUT", "轨迹解析超时")
        try:
            kind, result = receiver.recv()
        except (EOFError, OSError):
            if expired.is_set() or time.monotonic() >= deadline:
                raise ApiError(503, f"{prefix}_PROCESSING_TIMEOUT", "轨迹解析超时") from None
            raise ApiError(503, f"{prefix}_PROCESSING_FAILED", "轨迹解析失败") from None
        if time.monotonic() > deadline:
            raise ApiError(503, f"{prefix}_PROCESSING_TIMEOUT", "轨迹解析超时")
        process.join(max(0, deadline - time.monotonic()))
        if process.is_alive():
            raise ApiError(503, f"{prefix}_PROCESSING_TIMEOUT", "轨迹解析超时")
        if kind == "error":
            raise ApiError(*result)
        if kind != "ok" or not isinstance(result, ParsedGPX):
            raise ApiError(503, f"{prefix}_PROCESSING_FAILED", "轨迹解析失败")
        return result
    finally:
        if watchdog is not None:
            watchdog.cancel()
            watchdog.join()
        receiver.close()
        sender.close()
        if started:
            if process.is_alive():
                process.terminate()
            process.join(1)
            if process.is_alive():
                process.kill()
                process.join()
            process.close()
        _SLOT.release()
