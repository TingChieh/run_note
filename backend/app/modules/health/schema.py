from typing import Literal

from pydantic import BaseModel, Field


class LiveStatus(BaseModel):
    status: Literal["ok"] = "ok"


class ReadyStatus(LiveStatus):
    database: Literal["connected"] = "connected"
    postgis: Literal["enabled"] = "enabled"
    schema_status: Literal["current"] = Field(default="current", serialization_alias="schema")
