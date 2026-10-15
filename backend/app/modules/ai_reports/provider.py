"""Bounded server-only OpenAI-compatible HTTP call; no automatic retries or redirects."""

import http.client
import json
import multiprocessing
import threading
import time
from urllib.parse import urlsplit

from pydantic import ValidationError

from app.core.errors import ApiError
from app.modules.ai_reports.device_metrics import DEVICE_METRIC_KEYS
from app.modules.ai_reports.schema import AnalysisText, ProviderResult

PROMPT_VERSION = "running-qualitative-v3"
PROMPT = """你是跑步数据解释助手。输入是后端计算的唯一事实依据。
不能推断未提供的能力、健康状况或运动表现。
只返回JSON对象，字段trend_summary（字符串）、recommendations（字符串数组）、limitations（字符串）。
解释周跑量与运动频率趋势，给出下周保守辅助建议，并说明覆盖率/质量限制。
设备用时优先于轨迹经过时间。device_metrics 是已知记录的汇总，缺失表示未知。
必须结合记录覆盖率说明限制。
平均心率是有正有效用时记录的平均心率按用时加权估计，非逐点心率；缺心率或可靠用时的记录不参与。
可谨慎描述周汇总心率及配速各自的变化；没有活动配对或可比训练条件，不得声称两者对应、相关或因果，也不能据此判断能力提升。
不能根据平均心率推断最大心率、心率区间、疾病或训练强度过量。总步数不能推断跑步步频；设备热量是估计值，不能当作精确消耗。
热量和步数仅是已知记录小计；覆盖不足时不能比较完整总量，不得虚构缺失指标。
严格只写定性文字，不写任何数字、中文数字数量、英文数量、距离、次数、配速或百分比数值；事实数值由页面单独展示。
不要复述输入中的数量，也不要在建议中安排具体训练次数、时长或距离。
“一个周区间”“一次轻松跑”“两次训练”均不合规，应改成“覆盖周数有限”“轻松活动”“规律训练”等不含数量的表达。
依据有限时明确承认，禁止虚构。不得提供医疗诊断、保证效果或具体训练处方。提醒建议仅供参考，不构成医疗建议。
不要输出HTML、Markdown代码围栏或其他字段。
JSON格式示例（只参考结构与定性表达，不照抄结论）：
{"trend_summary":"记录覆盖有限，暂时无法判断稳定趋势。","recommendations":["结合恢复情况保持轻松活动，避免急于加量。"],"limitations":"分析仅依据已知汇总，缺失记录表示未知。建议仅供参考，不构成医疗建议。"}
返回前检查所有字段：出现任何数量表达就改写为定性文字。"""


def request_body(snapshot: dict, model: str, *, base_url: str | None = None) -> dict:
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
    if snapshot["schema_version"] == "running-summary-v2":
        allowed["device_metrics"] = {
            key: snapshot["device_metrics"][key] for key in DEVICE_METRIC_KEYS
        }
        for week, source in zip(allowed["weeks"], snapshot["weeks"], strict=True):
            week["device_metrics"] = {
                key: source["device_metrics"][key] for key in DEVICE_METRIC_KEYS
            }
    body = {
        "model": model,
        "temperature": 0.2,
        "max_tokens": 2000,
        "messages": [
            {"role": "system", "content": PROMPT},
            {"role": "user", "content": json.dumps(allowed, ensure_ascii=False)},
        ],
    }
    if base_url and urlsplit(base_url).hostname == "api.deepseek.com":
        # DeepSeek thinks by default; reasoning can exhaust this short report's
        # output budget before producing any final content. Keep vendor-specific
        # options scoped to its API instead of sending them to other providers.
        body["thinking"] = {"type": "disabled"}
        body["response_format"] = {"type": "json_object"}
    return body


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
            request_body(snapshot, settings.ai_model, base_url=settings.ai_base_url),
            settings.ai_total_timeout_seconds,
        )
        try:
            data = json.loads(raw)
            choice = data["choices"][0]
            if choice.get("finish_reason") == "length":
                raise ValueError
            content = choice["message"]["content"]
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
