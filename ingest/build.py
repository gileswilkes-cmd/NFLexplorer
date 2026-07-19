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


# --- pipeline stages (filled in by later phases) -----------------------------


def pull_source_data(seasons: list[int]) -> dict:
    """Phase 1+: import weekly/seasonal/rosters/NGS/snap counts/pbp via nfl_data_py."""
    return {}


def build_player_files(source: dict, seasons: list[int]) -> None:
    """Phase 1: write players/index.json and players/{id}.json."""


def build_season_aggregates(source: dict, seasons: list[int]) -> None:
    """Phase 1: write seasons/{year}.json league baselines (percentile/era context)."""


def build_team_files(source: dict, seasons: list[int]) -> None:
    """Phase 3: write teams/index.json and teams/{abbr}.json."""


# -----------------------------------------------------------------------------


def build(seasons: list[int]) -> None:
    print(f"Building seasons {seasons[0]}-{seasons[-1]} -> {DATA_DIR}")

    source = pull_source_data(seasons)
    build_player_files(source, seasons)
    build_season_aggregates(source, seasons)
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
