"""Compatibility re-export; authoritative implementation lives in statistics.device_metrics."""

from app.modules.statistics.device_metrics import (
    DEVICE_METRIC_KEYS,
    device_summaries,
    finalize,
)

__all__ = ["DEVICE_METRIC_KEYS", "device_summaries", "finalize"]
