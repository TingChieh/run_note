"""Test-only injectable provider for automated and local browser acceptance."""

import time

from app.core.errors import ApiError
from app.modules.ai_reports.schema import ProviderResult


class DemoProvider:
    def generate(self, snapshot, settings):
        time.sleep(1.2)
        # Synthetic fixture range triggers a deterministic failure, never a production switch.
        if snapshot["date_from"] == "2024-02-05":
            raise ApiError(503, "AI_TIMEOUT", "模拟供应商超时")
        last = snapshot["weeks"][-1]["distance_change_pct"]
        if snapshot["evidence_limited"]:
            trend = "活动较少或覆盖周数有限，分析依据有限，不能据此判断长期运动表现。"
        elif last is None:
            trend = "相邻周的跑量基线不足，无法可靠比较变化趋势。"
        elif float(last) > 0:
            trend = (
                "近期周跑量呈上升趋势。结合运动频率与数据覆盖情况，应留意恢复，避免继续急于加量。"
            )
        elif float(last) < 0:
            trend = (
                "近期周跑量有所下降，不能仅凭跑量变化判断运动能力下降，应结合休息和训练安排理解。"
            )
        else:
            trend = "近期周跑量保持稳定，继续观察训练后的恢复情况。"
        return ProviderResult(
            analysis={
                "trend_summary": trend,
                "recommendations": [
                    "下周优先安排轻松跑，保持可交谈的强度。",
                    "根据疲劳和恢复情况调整安排，休息后再决定是否增加训练。",
                    "出现疼痛或明显不适时停止训练并寻求专业意见。",
                ],
                "limitations": (
                    "这是模拟AI报告，仅基于后端统计摘要。"
                    "部分记录缺少可靠耗时，配速依据并不完整；无法判断健康状况。"
                    "训练建议仅供参考，不构成医疗建议。"
                ),
            },
            input_tokens=None,
            output_tokens=None,
        )
