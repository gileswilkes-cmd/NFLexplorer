"""NFL Explorer build step.

Pulls 2015-2025 data from nfl-data-py (nflverse) and writes compact,
pre-aggregated JSON into public/data/. The Next.js client only ever reads
that JSON; raw play-by-play is aggregated here and never shipped.

Output layout and field definitions: docs/DATA_SCHEMA.md.

Phase 0: skeleton only. The pipeline stages are stubbed; each later phase
fills them in. Running it today creates the output tree and writes meta.json.

Usage:
    python build.py                       # all seasons
    python build.py --seasons 2024 2025   # subset (weekly refresh)
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

SCHEMA_VERSION = 1
ALL_SEASONS = list(range(2015, 2026))
FIRST_NGS_SEASON = 2016  # NGS-derived metrics do not exist for 2015

# Stats that are bad when high; the percentile function inverts them so a low
# interception count reads as a good percentile. Canonical set — the schema
# doc points here. Classify every new stat key when it is added.
NEGATIVE_STATS = {"pass_int", "sacks", "sack_yds", "rush_fumbles"}

# The fixed grid stored in seasons/{year}.json baselines ("p": [...]).
PERCENTILE_GRID = (5, 10, 25, 50, 75, 90, 95)

# Defence baselines use three populations, never one merged "DEF" group
# (a CB's INTs and a DT's are different distributions). Known coarse edge:
# nflverse blurs edge rushers across DE/OLB, accepted for v1.
DEF_POSITION_GROUPS = {
    "DE": "DL", "DT": "DL", "NT": "DL", "EDGE": "DL",
    "ILB": "LB", "OLB": "LB", "MLB": "LB", "LB": "LB",
    "CB": "DB", "S": "DB", "FS": "DB", "SS": "DB", "DB": "DB",
}

# Repo-root-relative, resolved via this file's location: works from any CWD,
# on Windows and on Linux (Vercel/CI).
REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "public" / "data"


def write_json(path: Path, obj: object) -> None:
    """Write compact JSON (no whitespace padding — these files ship to the browser)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")


def percentile_from_grid(value: float, p: list[float], stat_key: str) -> float:
    """The one canonical percentile: linear interpolation on the 7-point grid.

    Used for build-time season-row percentiles (Phase 1); the Phase 2
    TypeScript port for live era-adjusted comparisons must match this
    case-for-case, or profile badges will disagree with comparison views.

    ``p`` is the stored grid [p5, p10, p25, p50, p75, p90, p95]. Results clamp
    to the grid edges [5, 95]; the UI renders those as "<5" and "95+". Keys in
    NEGATIVE_STATS (bad when high) are inverted: pct = 100 - raw_pct.
    """
    if value <= p[0]:
        pct = float(PERCENTILE_GRID[0])
    elif value >= p[-1]:
        pct = float(PERCENTILE_GRID[-1])
    else:
        pct = float(PERCENTILE_GRID[-1])  # unreachable fallback for type-safety
        for i in range(len(p) - 1):
            if p[i] <= value <= p[i + 1]:
                lo_q, hi_q = PERCENTILE_GRID[i], PERCENTILE_GRID[i + 1]
                span = p[i + 1] - p[i]
                frac = (value - p[i]) / span if span else 0.0
                pct = lo_q + frac * (hi_q - lo_q)
                break
    if stat_key in NEGATIVE_STATS:
        pct = 100.0 - pct
    return pct


# --- pipeline stages (filled in by later phases) -----------------------------


def pull_source_data(seasons: list[int]) -> dict:
    """Phase 1+: import weekly/seasonal/rosters/NGS/snap counts/pbp via nfl_data_py."""
    return {}


def build_season_aggregates(source: dict, seasons: list[int]) -> None:
    """Phase 1: write seasons/{year}.json league baselines (percentile/era context).

    Defence baselines are three groups via DEF_POSITION_GROUPS (DL/LB/DB),
    never one merged group. Must run before build_player_files: season-row
    percentiles are computed against these baselines.
    """


def build_player_files(source: dict, seasons: list[int]) -> None:
    """Phase 1: write players/index.json and players/{id}.json.

    Contract highlights (docs/DATA_SCHEMA.md):
    - Season rows: a REG row per season played, plus a POST row (same shape)
      only for seasons with playoff appearances.
    - career (REG) / career_post (omit if no playoff games): stats must carry
      every counting key from any season row; the advanced block is pooled
      over raw plays — sum(epa)/sum(plays), never an average of season values
      — and stores its denominators (n_plays, n_att). No career NGS in v1.
    - Season-row percentiles come from percentile_from_grid() against the
      already-built seasons/{year}.json baselines.
    """


def build_team_files(source: dict, seasons: list[int]) -> None:
    """Phase 3: write teams/index.json and teams/{abbr}.json."""


# -----------------------------------------------------------------------------


def build(seasons: list[int]) -> None:
    print(f"Building seasons {seasons[0]}-{seasons[-1]} -> {DATA_DIR}")

    source = pull_source_data(seasons)
    # Order matters: baselines first — player-file percentiles depend on them.
    build_season_aggregates(source, seasons)
    build_player_files(source, seasons)
    build_team_files(source, seasons)

    write_json(
        DATA_DIR / "meta.json",
        {
            "schema_version": SCHEMA_VERSION,
            "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "seasons": seasons,
            "first_ngs_season": FIRST_NGS_SEASON,
            "source": "nfl-data-py (nflverse)",
        },
    )
    print("Done.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--seasons",
        type=int,
        nargs="+",
        default=ALL_SEASONS,
        metavar="YEAR",
        help="seasons to (re)build (default: 2015-2025)",
    )
    args = parser.parse_args()

    bad = [s for s in args.seasons if s not in ALL_SEASONS]
    if bad:
        parser.error(f"seasons outside the 2015-2025 window: {bad}")

    build(sorted(args.seasons))


if __name__ == "__main__":
    main()
