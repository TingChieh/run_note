"""Pure naming rules: which nearby place category names a run, and the title it gets."""

from datetime import date

ALGORITHM_VERSION = "place-titles-v1"
STEP_M = 200
# Upper bound on sampled points per run, so a very long track cannot blow up the join.
MAX_SAMPLES = 500
RADIUS_M = 100
MIN_SHARE = 0.4
MIN_DISTANCE_M = 1000
# Order is also the tie-break priority.
CATEGORIES = ("sea", "lake", "river", "park", "stadium")
TITLE_WORDS = {
    "sea": "海边跑步",
    "lake": "湖边跑步",
    "river": "河边跑步",
    "park": "公园跑步",
    "stadium": "操场跑步",
}


def default_title(activity_date: date) -> str:
    """The title the importers give a run when the user did not name it."""
    return f"跑步 · {activity_date}"


def title_for(category: str) -> str:
    if category not in TITLE_WORDS:
        raise ValueError(f"Unknown place category: {category}")
    return TITLE_WORDS[category]


def choose_category(total: int, near: dict[str, int]) -> tuple[str, float] | None:
    """Highest share of sampled points near a category, if it reaches MIN_SHARE."""
    if total <= 0:
        return None
    best = None
    for category in CATEGORIES:
        share = near.get(category, 0) / total
        if share >= MIN_SHARE and (best is None or share > best[1]):
            best = (category, share)
    return best
