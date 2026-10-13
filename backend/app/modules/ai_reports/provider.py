"""Bounded server-only OpenAI-compatible HTTP call; no automatic retries or redirects."""

import http.client
import json
import multiprocessing
import threading
import time
from urllib.parse import urlsplit

from pydantic import ValidationError

from app.core.errors import ApiError
from app.modules.ai_reports.schema import AnalysisText, ProviderResult

PROMPT_VERSION = "running-qualitative-v1"
PROMPT = """你是跑步数据解释助手。输入是后端计算的唯一事实依据。
不能推断未提供的能力、健康状况或运动表现。
只返回JSON对象，字段trend_summary（字符串）、recommendations（字符串数组）、limitations（字符串）。
解释周跑量与运动频率趋势，给出下周保守辅助建议，并说明覆盖率/质量限制。
严格只写定性文字，不写任何数字、中文数字数量、英文数量、距离、次数、配速或百分比数值；事实数值由页面单独展示。
依据有限时明确承认，禁止虚构。不得提供医疗诊断、保证效果或具体训练处方。提醒建议仅供参考，不构成医疗建议。
不要输出HTML、Markdown代码围栏或其他字段。"""


def request_body(snapshot: dict, model: str) -> dict:
    # Reconstruct the allowlist rather than passing arbitrary report/user objects.
    allowed = {
        key: snapshot[key]
        for key in (
            "schema_version",
            "date_from",
            "date_to",
            "week_start",
            "date_assignment",
            "summary",
            "weeks",
            "average_runs_per_week",
            "evidence_limited",
            "limitations",
        )
    }
    summary_keys = {
        "activity_count",
        "distance_m",
        "activity_days",
        "duration_sum_seconds",
        "known_duration_count",
        "missing_duration_count",
        "pace_eligible_count",
        "pace_eligible_distance_m",
        "avg_pace_seconds_per_km",
        "quality_warning_count",
        "date_assignment",
    }
    allowed["summary"] = {k: v for k, v in allowed["summary"].items() if k in summary_keys}
    allowed["weeks"] = [
        {
            k: v
            for k, v in row.items()
            if k
            in summary_keys
            | {
                "bucket_start",
                "bucket_end",
                "is_partial",
                "distance_change_pct",
            }
        }
        for row in allowed["weeks"]
    ]
    return {
        "model": model,
        "temperature": 0.2,
        "max_tokens": 2000,
        "messages": [
            {"role": "system", "content": PROMPT},
            {"role": "user", "content": json.dumps(allowed, ensure_ascii=False)},
        ],
    }


def _http_target(url, key, body, timeout, pipe):
    connection = None
    try:
        parsed = urlsplit(url)
        cls = (
            http.client.HTTPSConnection if parsed.scheme == "https" else http.client.HTTPConnection
        )
        # Direct connections ignore environment proxies; redirects are errors.
        connection = cls(parsed.hostname, parsed.port, timeout=min(5, timeout))
        connection.connect()
        # Connect and response waiting have separate budgets. The parent watchdog
        # enforces the overall deadline, including DNS, TLS and all response reads.
        connection.sock.settimeout(timeout)
        path = parsed.path or "/"
        if parsed.query:
            path += "?" + parsed.query
        connection.request(
            "POST",
            path,
            body=json.dumps(body).encode(),
            headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"},
        )
        response = connection.getresponse()
        if not 200 <= response.status < 300:
            pipe.send(("error", "AI_PROVIDER_ERROR"))
            return
        raw = response.read(65537)
        if len(raw) > 65536:
            pipe.send(("error", "AI_OUTPUT_INVALID"))
        else:
            pipe.send(("ok", raw))
    except TimeoutError:
        pipe.send(("error", "AI_TIMEOUT"))
    except Exception:
        pipe.send(("error", "AI_PROVIDER_ERROR"))
    finally:
        if connection is not None:
            connection.close()
        pipe.close()


def bounded_request(url, key, body, timeout, *, target=None):
    ctx = multiprocessing.get_context("spawn")
    receiver, sender = ctx.Pipe(duplex=False)
    process = ctx.Process(target=target or _http_target, args=(url, key, body, timeout, sender))
    deadline = time.monotonic() + timeout
    started = False
    watchdog = None
    expired = threading.Event()

    def expire():
        expired.set()
        if process.is_alive():
            process.kill()

    try:
        process.start()
        started = True
        sender.close()
        watchdog = threading.Timer(max(0, deadline - time.monotonic()), expire)
        watchdog.start()
        if not receiver.poll(max(0, deadline - time.monotonic())):
            raise ApiError(503, "AI_TIMEOUT", "AI分析超时，请查看历史后再主动重试")
        try:
            kind, result = receiver.recv()
        except (EOFError, OSError):
            code = (
                "AI_TIMEOUT"
                if expired.is_set() or time.monotonic() >= deadline
                else "AI_PROVIDER_ERROR"
            )
            raise ApiError(503 if code == "AI_TIMEOUT" else 502, code, "AI服务暂时不可用") from None
        if time.monotonic() >= deadline:
            raise ApiError(503, "AI_TIMEOUT", "AI分析超时，请查看历史后再主动重试")
        if kind != "ok":
            raise ApiError(
                503 if result == "AI_TIMEOUT" else 502, result, "AI服务暂时不可用，请查看失败报告"
            )
        return result
    finally:
        if watchdog:
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


class OpenAIProvider:
    def generate(self, snapshot, settings):
        if not settings.ai_configured:
            raise ApiError(503, "AI_NOT_CONFIGURED", "AI服务尚未配置")
        raw = bounded_request(
            settings.ai_base_url + "/chat/completions",
            settings.ai_api_key.get_secret_value(),
            request_body(snapshot, settings.ai_model),
            settings.ai_total_timeout_seconds,
        )
        try:
            data = json.loads(raw)
            content = data["choices"][0]["message"]["content"]
            if not isinstance(content, str) or len(content) > 8000:
                raise ValueError
            analysis = AnalysisText.model_validate_json(content)
            usage = data.get("usage") or {}
            return ProviderResult(
                analysis=analysis,
                input_tokens=usage.get("prompt_tokens"),
                output_tokens=usage.get("completion_tokens"),
            )
        except (ValueError, TypeError, KeyError, IndexError, ValidationError):
            raise ApiError(
                502, "AI_OUTPUT_INVALID", "AI返回了不符合要求的分析，未展示内容"
            ) from None
