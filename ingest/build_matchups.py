"""Build step for the weekly unit-matchup product (docs/MATCHUPS_SPEC.md).

Two outputs, both read straight by src/lib/matchups.ts (computed client-side):
  public/data/matchups/unit_ratings.json  32 teams x 4 units, 2025 EPA/play + 1-32 rank
  public/data/matchups/schedule_2026.json the 2026 REG-season schedule, keyed by week

Requires Python 3.11 (same nfl_data_py constraint as ingest/build.py) and the
existing public/data/teams/{fr}.json files (Phase 3 team data) already built.

Usage:
    python build_matchups.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import nfl_data_py as nfl
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build import DATA_DIR, REPO_ROOT, SCHEMA_VERSION, fetch_schedules, write_json  # noqa: E402

RATINGS_BASIS_SEASON = 2025
SCHEDULE_SEASON = 2026

UNIT_KEYS = ("run_off", "pass_off", "run_def", "pass_def")

# A unit's SOS looks at the rank of the specific opposing unit it lined up
# against each week (docs/MATCHUPS_SOS.md) — an offence faces the opposing
# defence of the same kind, and vice versa.
OPPOSING_UNIT = {
    "run_off": "run_def", "pass_off": "pass_def",
    "run_def": "run_off", "pass_def": "pass_off",
}


def _dig(d: dict, *keys):
    for k in keys:
        if d is None:
            return None
        d = d.get(k)
    return d


def build_unit_ratings() -> dict:
    """Read each teams/{fr}.json, pull the 2025 by_play_type EPA, rank 1-32."""
    team_files = sorted(
        p for p in (DATA_DIR / "teams").glob("*.json") if p.name != "index.json"
    )
    if not team_files:
        raise SystemExit("no public/data/teams/*.json files found — run the Phase 3 team build first")

    raw: dict[str, dict] = {}
    for path in team_files:
        doc = json.loads(path.read_text(encoding="utf-8"))
        fr = doc["franchise"]
        season = next((s for s in doc["seasons"] if s["season"] == RATINGS_BASIS_SEASON), None)
        if season is None:
            print(f"  !! {fr}: no {RATINGS_BASIS_SEASON} season in teams/{fr}.json, skipped")
            continue
        raw[fr] = {
            "run_off_epa": _dig(season, "offense", "by_play_type", "rush", "epa_per_play"),
            "pass_off_epa": _dig(season, "offense", "by_play_type", "pass", "epa_per_play"),
            "run_def_epa": _dig(season, "defense", "by_play_type", "rush", "epa_per_play_allowed"),
            "pass_def_epa": _dig(season, "defense", "by_play_type", "pass", "epa_per_play_allowed"),
        }

    missing = [fr for fr, v in raw.items() if any(x is None for x in v.values())]
    if missing:
        raise SystemExit(f"missing EPA values for: {missing}")
    if len(raw) != 32:
        print(f"  !! warning: expected 32 franchises, got {len(raw)}")

    # Offense: higher EPA/play = better -> rank 1. Defense: lower EPA/play
    # allowed = better -> rank 1 (spec: "defensive ranks treat lower
    # EPA-allowed as rank 1").
    def ranks_for(metric_key: str, *, higher_is_better: bool) -> dict[str, int]:
        ordered = sorted(raw.items(), key=lambda kv: kv[1][metric_key], reverse=higher_is_better)
        return {fr: i + 1 for i, (fr, _) in enumerate(ordered)}

    unit_ranks = {
        "run_off": ranks_for("run_off_epa", higher_is_better=True),
        "pass_off": ranks_for("pass_off_epa", higher_is_better=True),
        "run_def": ranks_for("run_def_epa", higher_is_better=False),
        "pass_def": ranks_for("pass_def_epa", higher_is_better=False),
    }

    sos = build_sos(list(raw.keys()), unit_ranks)

    teams = {}
    for fr, v in raw.items():
        teams[fr] = {
            "run_off": {"epa": v["run_off_epa"], "rank": unit_ranks["run_off"][fr], "sos": sos["run_off"][fr]},
            "pass_off": {"epa": v["pass_off_epa"], "rank": unit_ranks["pass_off"][fr], "sos": sos["pass_off"][fr]},
            "run_def": {"epa_allowed": v["run_def_epa"], "rank": unit_ranks["run_def"][fr], "sos": sos["run_def"][fr]},
            "pass_def": {"epa_allowed": v["pass_def_epa"], "rank": unit_ranks["pass_def"][fr], "sos": sos["pass_def"][fr]},
        }

    return {"schema_version": SCHEMA_VERSION, "season_basis": RATINGS_BASIS_SEASON, "teams": teams}


def build_sos(franchises: list[str], unit_ranks: dict[str, dict[str, int]]) -> dict[str, dict[str, dict]]:
    """For each team's each unit, the avg raw rank of the opposing units it
    faced in its 2025 REG-season games (docs/MATCHUPS_SOS.md) — one pass over
    the already-computed raw ranks, not circular. Classified into terciles
    per unit type: lowest third of avg-opponent-rank = "tough" (faced strong
    units), highest third = "soft" (faced weak units), middle = "neutral".
    """
    sched = fetch_schedules(RATINGS_BASIS_SEASON)
    reg = sched[sched["game_type"] == "REG"]

    opponents: dict[str, list[str]] = {fr: [] for fr in franchises}
    fr_set = set(franchises)
    for r in reg.itertuples():
        home, away = r.home_team, r.away_team
        if home in fr_set and away in fr_set:
            opponents[home].append(away)
            opponents[away].append(home)

    missing = [fr for fr, opps in opponents.items() if not opps]
    if missing:
        raise SystemExit(f"no {RATINGS_BASIS_SEASON} REG opponents found for: {missing}")

    avg_opp_rank: dict[str, dict[str, float]] = {}
    for unit in UNIT_KEYS:
        opp_unit_ranks = unit_ranks[OPPOSING_UNIT[unit]]
        avg_opp_rank[unit] = {
            fr: sum(opp_unit_ranks[opp] for opp in opponents[fr]) / len(opponents[fr])
            for fr in franchises
        }

    sos: dict[str, dict[str, dict]] = {}
    for unit in UNIT_KEYS:
        ordered = sorted(avg_opp_rank[unit].items(), key=lambda kv: kv[1])
        n = len(ordered)
        tough_cut = n // 3
        soft_cut = n - n // 3
        sos[unit] = {}
        for i, (fr, avg_rank) in enumerate(ordered):
            classification = "tough" if i < tough_cut else "soft" if i >= soft_cut else "neutral"
            sos[unit][fr] = {"avg_opponent_rank": round(avg_rank, 1), "classification": classification}

    return sos


def build_schedule() -> dict:
    """import_schedules(2026) -> weeks keyed by REG-season week number."""
    df = nfl.import_schedules([SCHEDULE_SEASON])
    df = df[df["game_type"] == "REG"]
    if df.empty:
        raise SystemExit(
            f"import_schedules({SCHEDULE_SEASON}) returned no REG rows — "
            "the 2026 schedule is not published yet, product is blocked"
        )

    weeks: dict[str, list[dict]] = {}
    for _, row in df.sort_values(["week", "gameday", "game_id"]).iterrows():
        wk = str(int(row["week"]))
        weeks.setdefault(wk, []).append({
            "game_id": row["game_id"],
            "away": row["away_team"],
            "home": row["home_team"],
            "date": row["gameday"],
            "away_score": None if pd.isna(row["away_score"]) else int(row["away_score"]),
            "home_score": None if pd.isna(row["home_score"]) else int(row["home_score"]),
        })

    return {"schema_version": SCHEMA_VERSION, "season": SCHEDULE_SEASON, "weeks": weeks}


def main() -> None:
    out_dir = DATA_DIR / "matchups"

    print(f"Checking import_schedules({SCHEDULE_SEASON})...")
    schedule_doc = build_schedule()
    n_games = sum(len(g) for g in schedule_doc["weeks"].values())
    n_weeks = len(schedule_doc["weeks"])
    print(f"  OK: {n_games} REG games across {n_weeks} weeks")

    print("Building unit_ratings.json from 2025 team data...")
    ratings_doc = build_unit_ratings()
    print(f"  {len(ratings_doc['teams'])} franchises rated")

    rpath = out_dir / "unit_ratings.json"
    write_json(rpath, ratings_doc)
    print(f"  wrote {rpath.relative_to(REPO_ROOT)}")

    spath = out_dir / "schedule_2026.json"
    write_json(spath, schedule_doc)
    print(f"  wrote {spath.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
