import importlib.util
from datetime import date

import pytest


def test_ai_module_is_available():
    assert importlib.util.find_spec("app.modules.ai_reports") is not None


def test_complete_weeks_and_zero_baseline():
    from app.modules.ai_reports.snapshot import change_rate, default_range

    assert default_range(date(2026, 10, 13)) == (date(2026, 9, 14), date(2026, 10, 12))
    assert change_rate(1000, 0) is None
    assert change_rate(1500, 1000) == "50.000"
    assert change_rate(500, 1000) == "-50.000"


@pytest.mark.parametrize(
    "text",
    [
        "跑了42公里",
        "增加五公里",
        "run ten miles",
        "配速６分",
        "提升百分之十",
        "建议下周完成三组间歇训练",
        "每周训练叁回",
        "跑量增加Ⅲ倍",
        "完成③组",
        "若身体感觉良好，可尝试增加一次轻松跑",
        "当前数据仅覆盖一个周区间",
    ],
)
def test_output_rejects_invented_quantities(text):
    from pydantic import ValidationError

    from app.modules.ai_reports.schema import AnalysisText

    with pytest.raises(ValidationError):
        AnalysisText(trend_summary=text, recommendations=["保持轻松跑"], limitations="依据有限")


def test_output_plain_text_and_length_boundary():
    from pydantic import ValidationError

    from app.modules.ai_reports.schema import AnalysisText

    assert AnalysisText(
        trend_summary="跑量呈上升趋势", recommendations=["留意恢复"], limitations="非医疗建议"
    )
    for text in ["<script>alert()</script>", "x" * 3001, ""]:
        with pytest.raises(ValidationError):
            AnalysisText(trend_summary=text, recommendations=["留意恢复"], limitations="依据有限")


def test_ai_configuration_is_optional_and_server_only():
    from app.core.config import Settings

    s = Settings(database_url="postgresql+psycopg://fake:fake@127.0.0.1:1/test", _env_file=None)
    assert s.ai_api_key is None and s.ai_daily_limit == 5 and s.ai_total_timeout_seconds == 30
    assert not s.ai_configured


def test_output_json_storage_limit_includes_escaping():
    from pydantic import ValidationError

    from app.modules.ai_reports.schema import AnalysisText

    with pytest.raises(ValidationError):
        AnalysisText(
            trend_summary="\\" * 3000, recommendations=["\\" * 2900], limitations="依据有限"
        )


@pytest.mark.parametrize("consent", [False, 1, "true"])
def test_summary_consent_requires_explicit_json_true(consent):
    from pydantic import ValidationError

    from app.modules.ai_reports.schema import ReportCreate

    with pytest.raises(ValidationError):
        ReportCreate(date_from="2024-01-01", date_to="2024-01-29", consent_to_send_summary=consent)


@pytest.mark.parametrize("text", ["整体趋势与运动频率基本一致", "建议进一步观察恢复状态"])
def test_ordinary_qualitative_words_are_allowed(text):
    from app.modules.ai_reports.schema import AnalysisText

    assert AnalysisText(trend_summary=text, recommendations=[text], limitations="仅供参考")
