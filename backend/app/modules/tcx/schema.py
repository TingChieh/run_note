from dataclasses import dataclass
from decimal import Decimal

from app.modules.gpx.schema import ParsedGPX


@dataclass
class ParsedTCX(ParsedGPX):
    summary: dict[str, Decimal | int | None]
