"""Spawn isolation with a per-API-process parser slot and bounded cleanup."""

import multiprocessing
import threading
import time

from app.core.errors import ApiError
from app.modules.gpx.parser import MAX_BYTES, parse_gpx
from app.modules.gpx.schema import ParsedGPX

_SLOT = threading.Semaphore(1)


def _parse_target(raw, pipe):
    try:
        pipe.send(("ok", parse_gpx(raw)))
    except ApiError as error:
        pipe.send(("error", (error.status_code, error.code, error.message)))
    except Exception:
        pipe.send(("error", (400, "GPX_XML_INVALID", "GPX 无法解析")))
    finally:
        pipe.close()


def bounded_parse(raw: bytes, timeout: float = 15, *, _target=None) -> ParsedGPX:
    if len(raw) > MAX_BYTES:
        raise ApiError(413, "GPX_TOO_LARGE", "GPX 文件超过大小限制")
    if not _SLOT.acquire(blocking=False):
        raise ApiError(429, "IMPORT_BUSY", "解析服务正忙", retry_after=1)
    context = multiprocessing.get_context("spawn")
    receiver, sender = context.Pipe(duplex=False)
    process = context.Process(target=_target or _parse_target, args=(raw, sender))
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
            raise ApiError(503, "GPX_PROCESSING_TIMEOUT", "GPX 解析超时")
        try:
            kind, result = receiver.recv()
        except (EOFError, OSError):
            if expired.is_set() or time.monotonic() >= deadline:
                raise ApiError(503, "GPX_PROCESSING_TIMEOUT", "GPX 解析超时") from None
            raise ApiError(503, "GPX_PROCESSING_FAILED", "GPX 解析失败") from None
        if time.monotonic() > deadline:
            raise ApiError(503, "GPX_PROCESSING_TIMEOUT", "GPX 解析超时")
        process.join(max(0, deadline - time.monotonic()))
        if process.is_alive():
            raise ApiError(503, "GPX_PROCESSING_TIMEOUT", "GPX 解析超时")
        if kind == "error":
            raise ApiError(*result)
        if kind != "ok" or not isinstance(result, ParsedGPX):
            raise ApiError(503, "GPX_PROCESSING_FAILED", "GPX 解析失败")
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
