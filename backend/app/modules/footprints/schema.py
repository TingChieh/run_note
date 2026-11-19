from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, model_serializer

from app.core.responses import Bounds, ExactView, LonLat


class AllFootprintCollection(BaseModel):
    scope: Literal["all"]
    type: Literal["FeatureCollection"]
    mode: Literal["tracks", "heatmap"]
    features: list[dict[str, Any]]
    activity_count: int = Field(ge=0)
    visible_activity_count: int = Field(ge=0)
    unsupported_segment_count: int = Field(ge=0)
    grid_size_m: Literal[100]
    grid_crs: Literal["EPSG:3857"]
    count_basis: Literal["distinct_activity_per_cell"]
    max_count: int = Field(ge=0)
    # Present only for ?encoding=delta (footprints/encoding.py); plain GeoJSON omits the key.
    coordinate_encoding: Literal["delta-1e9"] | None = None

    @model_serializer(mode="wrap")
    def _plain_omits_encoding(self, handler):
        data = handler(self)
        if data.get("coordinate_encoding") is None:
            data.pop("coordinate_encoding", None)
        return data


class AllFootprintView(BaseModel):
    status: Literal["pending", "ready", "failed"]
    generated_at: datetime | None
    refreshing: bool
    refresh_failed: bool
    result: AllFootprintCollection | None


class ProvinceCount(ExactView):
    code: int
    name: str
    activity_count: int


class ProvinceSummary(ExactView):
    year: int | None
    total: int
    activity_count: int
    located_activity_count: int
    provinces: list[ProvinceCount]


class FootprintCollection(ExactView):
    type: Literal["FeatureCollection"]
    mode: Literal["tracks", "heatmap"]
    date_from: str
    date_to: str
    features: list[dict[str, Any]]
    activity_count: int
    visible_activity_count: int
    unsupported_segment_count: int
    grid_size_m: int
    grid_crs: str
    count_basis: str
    max_count: int


class GlobalCity(ExactView):
    code: str
    name: str
    short_name: str
    activity_count: int
    distance_m: float
    lon: float
    lat: float


class GlobalRegion(ExactView):
    code: str
    name: str
    short_name: str
    activity_count: int
    distance_m: float
    bounds: Bounds
    center: LonLat
    cities: list[GlobalCity]


class GlobalCountry(ExactView):
    code: str
    name: str
    activity_count: int
    distance_m: float
    bounds: Bounds | None
    regions: list[GlobalRegion]
    region_count: int
    city_count: int


class GlobalRegionProperties(ExactView):
    code: str
    name: str
    short_name: str
    country_code: str
    activity_count: int


class GlobalRegionFeature(ExactView):
    type: Literal["Feature"]
    properties: GlobalRegionProperties
    geometry: dict[str, Any]  # atlas Polygon/MultiPolygon, not user data


class GlobalRegionFeatures(ExactView):
    type: Literal["FeatureCollection"]
    features: list[GlobalRegionFeature]


class GlobalFootprintSummary(ExactView):
    year: int | None
    activity_count: int
    located_activity_count: int
    region_count: int
    city_count: int
    countries: list[GlobalCountry]
    region_features: GlobalRegionFeatures
