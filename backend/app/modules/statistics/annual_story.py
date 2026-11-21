"""Read-only private annual running story aggregation (current user only, no writes)."""

from collections import Counter
from datetime import date, timedelta
from decimal import ROUND_HALF_EVEN, Decimal
from statistics import median
from uuid import UUID

from sqlalchemy import exists, select, text

from app.modules.activities.classify import DISTANCE_BANDS, classify_distance
from app.modules.activities.model import Activity as A
from app.modules.footprints import global_atlas
from app.modules.gpx.model import ActivitySegment as S
from app.modules.route_groups import queries as route_group_queries
from app.modules.shoes.model import Shoe
from app.modules.statistics import service
from app.modules.statistics.annual_story_schema import (
    AnnualStory,
    StoryBestHighlight,
    StoryCategoryBest,
    StoryCitiesSection,
    StoryCityItem,
    StoryFootprintTimeline,
    StoryFrequentRouteSection,
    StoryLongestHighlight,
    StoryMilestone,
    StoryRunHighlight,
    StoryTimelineItem,
)
from app.modules.statistics.streaks import runs as consecutive_runs

MAX_TIMELINE_RUNS = 366
MAX_LINE_POINTS = 48
MAX_OVERLAY_SHAPES = 16
MAX_INLINE_CITY_COMPUTE = 100
SIMPLIFY_TOLERANCE_DEG = 0.0002
BAND_PRIORITY = ("10km", "半马", "全马", "5km", "3km")
BAND_BOUNDS = {label: (low, high) for label, low, high in DISTANCE_BANDS}
PACE_STEP = Decimal(".001")
DEC_ZERO = Decimal("0")


def downsample_line(
    coords: list[tuple[float, float]], limit: int = MAX_LINE_POINTS
) -> list[tuple[float, float]]:
    """Keep endpoints and evenly thin vertices so timelines remain lightweight."""
    if len(coords) <= limit:
        return coords
    if limit < 2:
        return coords[:1]
    step = (len(coords) - 1) / (limit - 1)
    indices = [round(i * step) for i in range(limit)]
    return [coords[idx] for idx in indices]


def extract_lines(
    geojson: dict | None, *, max_points: int = MAX_LINE_POINTS
) -> list[list[tuple[float, float]]]:
    """Normalize GeoJSON LineString/MultiLineString into bounded (lon, lat) polylines."""
    if not geojson or not isinstance(geojson, dict):
        return []
    kind = geojson.get("type")
    raw_coords = geojson.get("coordinates")
    if not isinstance(raw_coords, list):
        return []
    raw_lines = (
        [raw_coords] if kind == "LineString" else raw_coords if kind == "MultiLineString" else []
    )
    lines: list[list[tuple[float, float]]] = []
    for line in raw_lines:
        if not isinstance(line, list):
            continue
        pts: list[tuple[float, float]] = []
        for pt in line:
            if isinstance(pt, (list, tuple)) and len(pt) >= 2:
                lon, lat = float(pt[0]), float(pt[1])
                if -180.0 <= lon <= 180.0 and -90.0 <= lat <= 90.0:
                    pts.append((round(lon, 5), round(lat, 5)))
        if len(pts) >= 2:
            lines.append(downsample_line(pts, max_points))
    return lines


def sample_timeline_indices(
    total: int, milestone_indices: set[int], limit: int = MAX_TIMELINE_RUNS
) -> tuple[list[int], bool]:
    """Select chronological indices up to `limit`, always keeping milestone runs."""
    if total <= limit:
        return list(range(total)), False
    kept = {idx for idx in milestone_indices if 0 <= idx < total}
    if total > 0:
        kept.add(0)
        kept.add(total - 1)
    remaining = limit - len(kept)
    if remaining > 0:
        candidates = [i for i in range(total) if i not in kept]
        if len(candidates) <= remaining:
            kept.update(candidates)
        else:
            step = (len(candidates) - 1) / max(1, remaining - 1)
            for k in range(remaining):
                kept.add(candidates[round(k * step)])
    return sorted(kept)[:limit], True


def pick_route_name(titles: list[str]) -> str:
    """Choose the most common non-blank title, preferring the most recent on ties."""
    cleaned = [t.strip() for t in titles if t and t.strip()]
    if not cleaned:
        return "常跑路线"
    counts = Counter(cleaned)
    max_count = max(counts.values())
    for title in reversed(cleaned):
        if counts[title] == max_count:
            return title
    return cleaned[-1]


def _decimal(value) -> Decimal | None:
    return None if value is None else Decimal(str(value))


def _load_shapes(
    db, owner: UUID, activity_ids: list[UUID]
) -> dict[UUID, list[list[tuple[float, float]]]]:
    """Fetch simplified polylines per activity, preferring cached route_fingerprints."""
    if not activity_ids:
        return {}
    ids = list(dict.fromkeys(activity_ids))
    shapes: dict[UUID, list[list[tuple[float, float]]]] = {}

    fp_rows = db.execute(
        text(
            """SELECT f.activity_id,
                      ST_AsGeoJSON(ST_Simplify(f.geom, :tol, true), 5)::json AS geojson
               FROM route_fingerprints f
               WHERE f.user_id = :owner AND f.activity_id = ANY(:ids) AND f.geom IS NOT NULL"""
        ),
        {"owner": owner, "ids": ids, "tol": SIMPLIFY_TOLERANCE_DEG},
    ).mappings()
    for row in fp_rows:
        lines = extract_lines(row["geojson"])
        if lines:
            shapes[row["activity_id"]] = lines

    missing = [aid for aid in ids if aid not in shapes]
    if missing:
        seg_rows = db.execute(
            text(
                """SELECT s.activity_id,
                          ST_AsGeoJSON(ST_Simplify(s.geom, :tol, true), 5)::json AS geojson
                   FROM activities a
                   JOIN activity_segments s ON s.activity_id = a.id
                   WHERE a.user_id = :owner AND a.id = ANY(:ids) AND s.geom IS NOT NULL
                   ORDER BY s.activity_id, s.segment_index"""
            ),
            {"owner": owner, "ids": missing, "tol": SIMPLIFY_TOLERANCE_DEG},
        ).mappings()
        for row in seg_rows:
            lines = extract_lines(row["geojson"])
            if lines:
                shapes.setdefault(row["activity_id"], []).extend(lines)

    return shapes


def _resolve_cities(
    db, owner: UUID, date_from: date, date_to: date, year_activities: list[dict]
) -> tuple[StoryCitiesSection, dict[UUID, tuple[str | None, str | None]]]:
    """Resolve explored cities for the year and map each activity to its primary city."""
    if not year_activities:
        return (
            StoryCitiesSection(
                status="ready",
                total_cities=0,
                new_cities_count=0,
                total_regions=0,
                located_activity_count=0,
                unlocated_activity_count=0,
                items=[],
            ),
            {},
        )

    atlas_ver = global_atlas.atlas_version()
    atlas = global_atlas._atlas()
    cities_by_code = atlas["cities_by_code"]
    regions_by_code = atlas["regions_by_code"]

    cached_rows = (
        db.execute(
            text(
                """SELECT a.id, c.region_codes, c.city_codes
                   FROM activities a
                   JOIN activity_global_footprint_caches c
                     ON (c.activity_id, c.user_id) = (a.id, a.user_id)
                    AND c.atlas_version = :atlas
                   WHERE a.user_id = :owner
                     AND a.activity_date >= :start
                     AND a.activity_date < :end"""
            ),
            {"owner": owner, "atlas": atlas_ver, "start": date_from, "end": date_to},
        )
        .mappings()
        .all()
    )
    geo_by_id: dict[UUID, tuple[list[str], list[str]]] = {
        row["id"]: (list(row["region_codes"] or []), list(row["city_codes"] or []))
        for row in cached_rows
    }

    missing_track_ids = [
        act["id"] for act in year_activities if act["has_track"] and act["id"] not in geo_by_id
    ]
    status = "ready"
    if missing_track_ids:
        if len(missing_track_ids) <= MAX_INLINE_CITY_COMPUTE:
            computed = global_atlas.compute_global_codes(db, owner, missing_track_ids)
            for aid, pair in computed.items():
                geo_by_id[aid] = pair
        else:
            status = "pending"

    prior_city_codes = set(
        db.scalars(
            text(
                """SELECT DISTINCT unnest(c.city_codes)
                   FROM activities a
                   JOIN activity_global_footprint_caches c
                     ON (c.activity_id, c.user_id) = (a.id, a.user_id)
                    AND c.atlas_version = :atlas
                   WHERE a.user_id = :owner AND a.activity_date < :start"""
            ),
            {"owner": owner, "atlas": atlas_ver, "start": date_from},
        ).all()
    )

    city_stats: dict[str, dict] = {}
    region_set: set[str] = set()
    located = 0
    activity_city: dict[UUID, tuple[str | None, str | None]] = {}

    for act in year_activities:
        r_codes, c_codes = geo_by_id.get(act["id"], ([], []))
        if r_codes or c_codes:
            located += 1
        region_set.update(r_codes)
        valid_codes = [code for code in c_codes if code in cities_by_code]
        if valid_codes:
            primary_code = valid_codes[0]
            activity_city[act["id"]] = (primary_code, cities_by_code[primary_code]["name"])
        else:
            activity_city[act["id"]] = (None, None)

        dist = Decimal(act["distance_m"])
        day = act["activity_date"]
        for code in valid_codes:
            entry = city_stats.get(code)
            if entry is None:
                city_stats[code] = {
                    "count": 1,
                    "distance_m": dist,
                    "first_date": day,
                    "last_date": day,
                }
            else:
                entry["count"] += 1
                entry["distance_m"] += dist
                if day < entry["first_date"]:
                    entry["first_date"] = day
                if day > entry["last_date"]:
                    entry["last_date"] = day

    items: list[StoryCityItem] = []
    for code, stat in city_stats.items():
        meta = cities_by_code[code]
        reg = regions_by_code.get(meta.get("region_code"))
        lon, lat = meta["center"] if "center" in meta else (meta["lon"], meta["lat"])
        items.append(
            StoryCityItem(
                code=code,
                name=meta["name"],
                region_name=reg["name"] if reg else None,
                is_new=code not in prior_city_codes,
                first_date=stat["first_date"],
                last_date=stat["last_date"],
                activity_count=stat["count"],
                distance_m=stat["distance_m"].quantize(Decimal("0.001"), rounding=ROUND_HALF_EVEN),
                lon=float(lon),
                lat=float(lat),
            )
        )

    items.sort(key=lambda item: (-item.activity_count, -item.distance_m, item.code))
    new_count = sum(1 for item in items if item.is_new)

    section = StoryCitiesSection(
        status=status,
        total_cities=len(items),
        new_cities_count=new_count,
        total_regions=len(region_set),
        located_activity_count=located,
        unlocated_activity_count=len(year_activities) - located,
        items=items,
    )
    return section, activity_city


def _resolve_frequent_route(
    db,
    owner: UUID,
    date_from: date,
    date_to: date,
    total_activities: int,
    activity_city: dict[UUID, tuple[str | None, str | None]],
) -> tuple[StoryFrequentRouteSection, UUID | None]:
    """Find the most repeated route group within the target year (>= 2 runs)."""
    empty = StoryFrequentRouteSection(
        status="none",
        group_id=None,
        name=None,
        city_name=None,
        run_count=0,
        share_pct=0,
        median_distance_m=None,
        first_date=None,
        last_date=None,
        first_pace_seconds_per_km=None,
        best_pace_seconds_per_km=None,
        avg_pace_seconds_per_km=None,
        pace_improvement_seconds_per_km=None,
        monthly_hits=[0] * 12,
        shape=[],
        overlay_shapes=[],
    )
    if total_activities < 2:
        return empty, None

    top = (
        db.execute(
            text(
                """SELECT m.group_id, count(*) AS run_count, max(a.activity_date) AS last_date
                   FROM route_group_members m
                   JOIN activities a ON a.id = m.activity_id
                   WHERE m.user_id = :owner
                     AND a.activity_date >= :start
                     AND a.activity_date < :end
                   GROUP BY m.group_id
                   HAVING count(*) >= 2
                   ORDER BY count(*) DESC, max(a.activity_date) DESC, m.group_id ASC
                   LIMIT 1"""
            ),
            {"owner": owner, "start": date_from, "end": date_to},
        )
        .mappings()
        .first()
    )

    if top is None:
        if route_group_queries.has_unprocessed(db, owner):
            return empty.model_copy(update={"status": "building"}), None
        return empty, None

    group_id: UUID = top["group_id"]
    members = (
        db.execute(
            text(
                """SELECT a.id, a.title, a.activity_date, a.distance_m,
                          COALESCE(a.timer_seconds, a.elapsed_seconds) AS duration_seconds,
                          a.temporal_quality, a.timer_seconds
                   FROM route_group_members m
                   JOIN activities a ON a.id = m.activity_id
                   WHERE m.user_id = :owner
                     AND m.group_id = :group_id
                     AND a.activity_date >= :start
                     AND a.activity_date < :end
                   ORDER BY a.activity_date ASC, a.started_at ASC NULLS LAST, a.id ASC"""
            ),
            {"owner": owner, "group_id": group_id, "start": date_from, "end": date_to},
        )
        .mappings()
        .all()
    )

    run_count = len(members)
    distances = [Decimal(row["distance_m"]) for row in members]
    med_dist = Decimal(str(median(distances))).quantize(Decimal("0.001"), rounding=ROUND_HALF_EVEN)
    monthly_hits = [0] * 12
    eligible_paces: list[Decimal] = []
    eligible_dist_sum = DEC_ZERO
    eligible_dur_sum = DEC_ZERO

    for row in members:
        monthly_hits[row["activity_date"].month - 1] += 1
        dist = Decimal(row["distance_m"])
        dur = _decimal(row["duration_seconds"])
        eligible = (
            dist > 0
            and dur is not None
            and dur > 0
            and (
                row["timer_seconds"] is not None
                or row["temporal_quality"] in ("complete", "manual")
            )
        )
        if eligible and dur is not None:
            eligible_paces.append(service.pace_seconds_per_km(dur, dist))
            eligible_dist_sum += dist
            eligible_dur_sum += dur

    first_pace = eligible_paces[0] if eligible_paces else None
    best_pace = min(eligible_paces) if eligible_paces else None
    avg_pace = (
        service.pace_seconds_per_km(eligible_dur_sum, eligible_dist_sum)
        if eligible_dist_sum > 0 and eligible_dur_sum > 0
        else None
    )
    improvement: Decimal | None = None
    if first_pace is not None and best_pace is not None:
        gain = (first_pace - best_pace).quantize(PACE_STEP, rounding=ROUND_HALF_EVEN)
        if gain > 0:
            improvement = gain

    member_ids = [row["id"] for row in members]
    # Representative run is the member closest to the median distance.
    rep_row = min(
        members,
        key=lambda r: (abs(Decimal(r["distance_m"]) - med_dist), r["activity_date"], r["id"]),
    )
    overlay_ids = member_ids
    if len(overlay_ids) > MAX_OVERLAY_SHAPES:
        step = (len(overlay_ids) - 1) / (MAX_OVERLAY_SHAPES - 1)
        overlay_ids = [overlay_ids[round(i * step)] for i in range(MAX_OVERLAY_SHAPES)]
    shape_ids = list(dict.fromkeys([rep_row["id"], *overlay_ids]))
    shapes_map = _load_shapes(db, owner, shape_ids)
    rep_shape = shapes_map.get(rep_row["id"], [])
    overlay_shapes = [shapes_map[aid] for aid in overlay_ids if aid in shapes_map]

    city_names = [activity_city.get(aid, (None, None))[1] for aid in member_ids]
    city_name = Counter(name for name in city_names if name).most_common(1)
    share_pct = round((run_count / total_activities) * 100) if total_activities > 0 else 0

    section = StoryFrequentRouteSection(
        status="ready",
        group_id=group_id,
        name=pick_route_name([row["title"] for row in members]),
        city_name=city_name[0][0] if city_name else None,
        run_count=run_count,
        share_pct=share_pct,
        median_distance_m=med_dist,
        first_date=members[0]["activity_date"],
        last_date=members[-1]["activity_date"],
        first_pace_seconds_per_km=first_pace,
        best_pace_seconds_per_km=best_pace,
        avg_pace_seconds_per_km=avg_pace,
        pace_improvement_seconds_per_km=improvement,
        monthly_hits=monthly_hits,
        shape=rep_shape,
        overlay_shapes=overlay_shapes,
    )
    return section, members[-1]["id"]


def _is_all_time_band_pb(db, owner: UUID, band: str, best_pace: Decimal) -> bool:
    """True when no eligible activity across all history in `band` is strictly faster."""
    low, high = BAND_BOUNDS[band]
    dur = service.duration_expression()
    conditions = [A.user_id == owner, service.eligible_expression(), A.distance_m >= low]
    if band == "3km":
        conditions.append(A.distance_m < high)
    else:
        conditions.append(A.distance_m <= high)
    rows = db.execute(select(A.distance_m, dur.label("dur")).where(*conditions)).all()
    for dist, elapsed in rows:
        if service.pace_seconds_per_km(Decimal(elapsed), Decimal(dist)) < best_pace:
            return False
    return True


def _resolve_best_performance(
    db,
    owner: UUID,
    year_activities: list[dict],
    longest_act: dict | None,
    activity_city: dict[UUID, tuple[str | None, str | None]],
    shapes_map: dict[UUID, list[list[tuple[float, float]]]],
) -> StoryBestHighlight | None:
    """Pick the headline best performance for the year with standard-band + graceful fallbacks."""
    if not year_activities:
        return None

    eligible = [act for act in year_activities if act["pace_eligible"] and act["pace"] is not None]
    if not eligible:
        if longest_act is None:
            return None
        return StoryBestHighlight(
            basis="distance_fallback",
            category="年度最长",
            activity_id=longest_act["id"],
            activity_date=longest_act["activity_date"],
            started_at=longest_act["started_at"],
            title=longest_act["title"],
            distance_m=Decimal(longest_act["distance_m"]),
            duration_seconds=_decimal(longest_act["duration_seconds"]),
            avg_pace_seconds_per_km=None,
            city_name=activity_city.get(longest_act["id"], (None, None))[1],
            has_track=longest_act["has_track"],
            shape=shapes_map.get(longest_act["id"], []),
            is_all_time_pb=False,
            pace_gain_seconds_per_km=None,
            other_bests=[],
        )

    by_band: dict[str, list[dict]] = {}
    for act in eligible:
        band = classify_distance(act["distance_m"])
        if band:
            by_band.setdefault(band, []).append(act)

    band_winners: dict[str, tuple[dict, dict]] = {}
    for band, items in by_band.items():
        fastest = min(items, key=lambda r: (r["pace"], r["activity_date"], r["id"]))
        earliest = min(
            items,
            key=lambda r: (
                r["activity_date"],
                1 if r["started_at"] is None else 0,
                r["started_at"].timestamp() if r["started_at"] is not None else 0.0,
                r["id"],
            ),
        )
        band_winners[band] = (fastest, earliest)

    chosen_band = next((b for b in BAND_PRIORITY if b in band_winners), None)
    if chosen_band is not None:
        winner, earliest = band_winners[chosen_band]
        gain: Decimal | None = None
        if winner["id"] != earliest["id"]:
            diff = (earliest["pace"] - winner["pace"]).quantize(PACE_STEP, rounding=ROUND_HALF_EVEN)
            if diff > 0:
                gain = diff
        other = [
            StoryCategoryBest(
                category=b,
                activity_id=band_winners[b][0]["id"],
                activity_date=band_winners[b][0]["activity_date"],
                distance_m=Decimal(band_winners[b][0]["distance_m"]),
                duration_seconds=Decimal(band_winners[b][0]["duration_seconds"]),
                avg_pace_seconds_per_km=band_winners[b][0]["pace"],
            )
            for b in BAND_PRIORITY
            if b in band_winners and b != chosen_band
        ][:3]
        return StoryBestHighlight(
            basis="standard_band",
            category=chosen_band,
            activity_id=winner["id"],
            activity_date=winner["activity_date"],
            started_at=winner["started_at"],
            title=winner["title"],
            distance_m=Decimal(winner["distance_m"]),
            duration_seconds=Decimal(winner["duration_seconds"]),
            avg_pace_seconds_per_km=winner["pace"],
            city_name=activity_city.get(winner["id"], (None, None))[1],
            has_track=winner["has_track"],
            shape=shapes_map.get(winner["id"], []),
            is_all_time_pb=_is_all_time_band_pb(db, owner, chosen_band, winner["pace"]),
            pace_gain_seconds_per_km=gain,
            other_bests=other,
        )

    # No standard distance band achieved: fastest eligible run >= 1 km, else any eligible run.
    over_1k = [act for act in eligible if Decimal(act["distance_m"]) >= Decimal(1000)]
    pool = over_1k or eligible
    winner = min(pool, key=lambda r: (r["pace"], r["activity_date"], r["id"]))
    return StoryBestHighlight(
        basis="fastest_run",
        category="最快单次",
        activity_id=winner["id"],
        activity_date=winner["activity_date"],
        started_at=winner["started_at"],
        title=winner["title"],
        distance_m=Decimal(winner["distance_m"]),
        duration_seconds=Decimal(winner["duration_seconds"]),
        avg_pace_seconds_per_km=winner["pace"],
        city_name=activity_city.get(winner["id"], (None, None))[1],
        has_track=winner["has_track"],
        shape=shapes_map.get(winner["id"], []),
        is_all_time_pb=False,
        pace_gain_seconds_per_km=None,
        other_bests=[],
    )


def build_annual_story(db, owner: UUID, year: int, today: date) -> AnnualStory:
    """Build the full private annual story payload for `owner` and `year` (read-only)."""
    date_from, date_to, is_partial, cutoff_date = service.period_bounds(
        "year", year, None, today=today
    )
    summary = (
        service.finalize({})
        if date_from == date_to
        else service.summary(db, owner, date_from, date_to)
    )

    if date_from == date_to or summary.activity_count == 0:
        return AnnualStory(
            year=year,
            date_from=date_from,
            date_to=date_to,
            is_partial=is_partial,
            cutoff_date=cutoff_date,
            today=today,
            summary=summary,
            longest_streak_days=0,
            longest_streak_weeks=0,
            first_run=None,
            longest_route=None,
            best_performance=None,
            explored_cities=StoryCitiesSection(
                status="ready",
                total_cities=0,
                new_cities_count=0,
                total_regions=0,
                located_activity_count=0,
                unlocated_activity_count=0,
                items=[],
            ),
            frequent_route=StoryFrequentRouteSection(
                status="none",
                group_id=None,
                name=None,
                city_name=None,
                run_count=0,
                share_pct=0,
                median_distance_m=None,
                first_date=None,
                last_date=None,
                first_pace_seconds_per_km=None,
                best_pace_seconds_per_km=None,
                avg_pace_seconds_per_km=None,
                pace_improvement_seconds_per_km=None,
                monthly_hits=[0] * 12,
                shape=[],
                overlay_shapes=[],
            ),
            footprint_timeline=StoryFootprintTimeline(
                has_tracks=False,
                truncated=False,
                total_runs=0,
                shown_runs=0,
                monthly_distance_m=[DEC_ZERO] * 12,
                monthly_activity_count=[0] * 12,
                items=[],
            ),
        )

    duration = service.duration_expression()
    eligible_expr = service.eligible_expression()
    has_track_expr = exists(select(1).where((S.activity_id == A.id) & S.geom.is_not(None)))

    rows = (
        db.execute(
            select(
                A.id,
                A.activity_date,
                A.started_at,
                A.title,
                A.distance_m,
                duration.label("duration_seconds"),
                eligible_expr.label("pace_eligible"),
                Shoe.name.label("shoe_name"),
                has_track_expr.label("has_track"),
            )
            .outerjoin(Shoe, (Shoe.id == A.shoe_id) & (Shoe.user_id == owner))
            .where(A.user_id == owner, A.activity_date >= date_from, A.activity_date < date_to)
            .order_by(A.activity_date.asc(), A.started_at.asc().nulls_last(), A.id.asc())
        )
        .mappings()
        .all()
    )

    activities: list[dict] = []
    for row in rows:
        dist = Decimal(row["distance_m"])
        dur = _decimal(row["duration_seconds"])
        pace = (
            service.pace_seconds_per_km(dur, dist)
            if row["pace_eligible"] and dur is not None and dist > 0
            else None
        )
        activities.append(
            {
                "id": row["id"],
                "activity_date": row["activity_date"],
                "started_at": row["started_at"],
                "title": row["title"],
                "distance_m": dist,
                "duration_seconds": dur,
                "pace_eligible": bool(row["pace_eligible"]),
                "pace": pace,
                "shoe_name": row["shoe_name"],
                "has_track": bool(row["has_track"]),
            }
        )

    # Year-scoped longest streaks
    day_set = {act["activity_date"] for act in activities}
    week_set = {d - timedelta(days=d.weekday()) for d in day_set}
    streak_end = cutoff_date or date(year, 12, 31)
    _, longest_days = consecutive_runs(day_set, streak_end, timedelta(days=1))
    _, longest_weeks = consecutive_runs(
        week_set, streak_end - timedelta(days=streak_end.weekday()), timedelta(days=7)
    )

    first_act = activities[0]
    positive_dist = [act for act in activities if act["distance_m"] > 0]
    longest_act: dict | None = None
    longest_tied = 0
    if positive_dist:
        max_dist = max(act["distance_m"] for act in positive_dist)
        tied = [act for act in positive_dist if act["distance_m"] == max_dist]
        longest_act = tied[0]
        longest_tied = len(tied)

    cities_section, activity_city = _resolve_cities(db, owner, date_from, date_to, activities)
    frequent_section, frequent_anchor_id = _resolve_frequent_route(
        db, owner, date_from, date_to, len(activities), activity_city
    )

    # Identify first appearance of each newly discovered city for timeline milestone badges
    new_city_codes = {item.code for item in cities_section.items if item.is_new}
    seen_new_cities: set[str] = set()
    new_city_run_ids: set[UUID] = set()
    for act in activities:
        c_code = activity_city.get(act["id"], (None, None))[0]
        if c_code and c_code in new_city_codes and c_code not in seen_new_cities:
            seen_new_cities.add(c_code)
            new_city_run_ids.add(act["id"])

    # Determine milestone indices before sampling timeline
    highlight_ids = [first_act["id"]]
    if longest_act is not None:
        highlight_ids.append(longest_act["id"])

    # Resolve best performance first without shape, then batch-load all needed shapes in one query
    best_prelim = _resolve_best_performance(db, owner, activities, longest_act, activity_city, {})
    if best_prelim is not None:
        highlight_ids.append(best_prelim.activity_id)

    milestone_by_id: dict[UUID, StoryMilestone] = {}
    milestone_by_id[first_act["id"]] = "first"
    if longest_act is not None and longest_act["id"] not in milestone_by_id:
        milestone_by_id[longest_act["id"]] = "longest"
    if best_prelim is not None and best_prelim.activity_id not in milestone_by_id:
        milestone_by_id[best_prelim.activity_id] = "best"
    for aid in new_city_run_ids:
        milestone_by_id.setdefault(aid, "new_city")
    if frequent_anchor_id is not None:
        milestone_by_id.setdefault(frequent_anchor_id, "frequent")

    milestone_indices = {idx for idx, act in enumerate(activities) if act["id"] in milestone_by_id}
    sampled_indices, truncated = sample_timeline_indices(len(activities), milestone_indices)

    shape_target_ids = list(
        dict.fromkeys(
            [
                *highlight_ids,
                *(activities[idx]["id"] for idx in sampled_indices if activities[idx]["has_track"]),
            ]
        )
    )
    shapes_map = _load_shapes(db, owner, shape_target_ids)

    def _to_highlight(act: dict) -> StoryRunHighlight:
        return StoryRunHighlight(
            activity_id=act["id"],
            activity_date=act["activity_date"],
            started_at=act["started_at"],
            title=act["title"],
            distance_m=act["distance_m"],
            duration_seconds=act["duration_seconds"],
            avg_pace_seconds_per_km=act["pace"],
            city_name=activity_city.get(act["id"], (None, None))[1],
            shoe_name=act["shoe_name"],
            has_track=act["has_track"],
            shape=shapes_map.get(act["id"], []),
        )

    first_highlight = _to_highlight(first_act)
    longest_highlight = (
        StoryLongestHighlight(
            **_to_highlight(longest_act).model_dump(),
            tied_count=longest_tied,
            same_as_first=longest_act["id"] == first_act["id"],
        )
        if longest_act is not None
        else None
    )
    best_highlight = (
        best_prelim.model_copy(update={"shape": shapes_map.get(best_prelim.activity_id, [])})
        if best_prelim is not None
        else None
    )

    monthly_dist = [DEC_ZERO] * 12
    monthly_counts = [0] * 12
    cumulative_by_idx: list[Decimal] = []
    running_total = DEC_ZERO
    for act in activities:
        m_idx = act["activity_date"].month - 1
        monthly_dist[m_idx] += act["distance_m"]
        monthly_counts[m_idx] += 1
        running_total += act["distance_m"]
        cumulative_by_idx.append(running_total)

    timeline_items: list[StoryTimelineItem] = []
    any_tracks = False
    for idx in sampled_indices:
        act = activities[idx]
        lines = shapes_map.get(act["id"], [])
        primary_line = max(lines, key=len) if lines else []
        if primary_line:
            any_tracks = True
        c_code, c_name = activity_city.get(act["id"], (None, None))
        timeline_items.append(
            StoryTimelineItem(
                activity_id=act["id"],
                activity_date=act["activity_date"],
                month=act["activity_date"].month,
                title=act["title"],
                distance_m=act["distance_m"],
                cumulative_distance_m=cumulative_by_idx[idx],
                avg_pace_seconds_per_km=act["pace"],
                city_code=c_code,
                city_name=c_name,
                milestone=milestone_by_id.get(act["id"]),
                points=primary_line,
            )
        )

    return AnnualStory(
        year=year,
        date_from=date_from,
        date_to=date_to,
        is_partial=is_partial,
        cutoff_date=cutoff_date,
        today=today,
        summary=summary,
        longest_streak_days=longest_days,
        longest_streak_weeks=longest_weeks,
        first_run=first_highlight,
        longest_route=longest_highlight,
        best_performance=best_highlight,
        explored_cities=cities_section,
        frequent_route=frequent_section,
        footprint_timeline=StoryFootprintTimeline(
            has_tracks=any_tracks,
            truncated=truncated,
            total_runs=len(activities),
            shown_runs=len(timeline_items),
            monthly_distance_m=monthly_dist,
            monthly_activity_count=monthly_counts,
            items=timeline_items,
        ),
    )
