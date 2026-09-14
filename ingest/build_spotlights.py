"""Build step for the /matchups player-spotlights layer (docs/MATCHUPS_SPOTLIGHTS.md).

Output: public/data/matchups/team_players.json — per team (2026 roster), the
key players by unit, each carrying their **2025** headline stat line and
position percentile (both reused straight from the existing player files —
no new production data is computed here).

The reconciliation this build exists to get right:
  - Team membership -> 2026 roster (import_seasonal_rosters([2026])).
  - Production level -> that player's 2025 REG season record, wherever he
    played that year. A player who changed teams for 2026 still shows his
    old team's 2025 numbers, just filed under his new team.
  - Rookies / anyone with no 2025 REG record -> flagged ("no_2025_data"),
    never a fabricated or zeroed stat line.

Requires Python 3.11 (same nfl_data_py constraint as ingest/build.py) and the
already-built public/data/players/{gsis_id}.json files.

Usage:
    python build_spotlights.py
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import nfl_data_py as nfl

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build import DATA_DIR, REPO_ROOT, SCHEMA_VERSION, position_group, write_json  # noqa: E402

ROSTER_SEASON = 2026
PRODUCTION_SEASON = 2025

# Minimum production before an optional (thin-data) defensive spotlight is
# shown at all — per docs/MATCHUPS_SPOTLIGHTS.md "don't force it": a DB with
# zero INTs/PDs or a tackler with a handful of tackles isn't a spotlight,
# it's noise, so that slot is simply omitted for that team.
DB_MIN_PRODUCTION = 1   # def_int >= 1 OR pass_defended >= this
PD_MIN_PRODUCTION = 3
TACKLER_MIN_TACKLES = 20

# QB tie-break: "top 2025 pass attempts" alone picked the wrong 2026 starter
# for at least one team (SF: Mac Jones 289 att vs Brock Purdy 284 att — Purdy
# is the actual Week 1 starter). QB1 doesn't change week to week, so once a
# team's already-played 2026 games show who actually took its snaps, that
# fact settles the pick for the rest of the season, not just past weeks.
# Within this margin of each other on 2025 attempts, prefer whoever has
# actually started a 2026 game for this team over raw attempt count; outside
# it, or before either has played, fall back to 2025 attempts as before.
QB_TIEBREAK_ATTEMPT_MARGIN = 20


def load_roster() -> "list[dict]":
    """import_seasonal_rosters([2026]), active roster only, one row per
    player (a player can't be on two teams at once, but the raw table can
    carry incidental duplicate rows for the same id/team)."""
    df = nfl.import_seasonal_rosters([ROSTER_SEASON])
    if df.empty:
        raise SystemExit(f"import_seasonal_rosters([{ROSTER_SEASON}]) returned no rows")
    act = df[(df["status"] == "ACT") & df["player_id"].notna()]
    act = act.drop_duplicates("player_id")
    return act[["team", "player_id", "player_name", "position"]].to_dict("records")


class PlayerCache:
    """Lazy per-id loader for public/data/players/{id}.json — most of the
    2962-player roster is irrelevant to spotlights, so avoid loading all
    5,700 player files up front."""

    def __init__(self) -> None:
        self._cache: dict[str, dict | None] = {}

    def get(self, gsis_id: str) -> dict | None:
        if gsis_id not in self._cache:
            fp = DATA_DIR / "players" / f"{gsis_id}.json"
            self._cache[gsis_id] = json.loads(fp.read_text(encoding="utf-8")) if fp.exists() else None
        return self._cache[gsis_id]


def season_2025(doc: dict | None) -> dict | None:
    if not doc:
        return None
    return next(
        (s for s in doc["seasons"] if s["season"] == PRODUCTION_SEASON and s["game_type"] == "REG"),
        None,
    )


def no_data_entry(pid: str, name: str, pos: str) -> dict:
    return {
        "gsis_id": pid, "name": name, "pos": pos,
        "flag": "no_2025_data", "note": "Rookie / no 2025 NFL data",
    }


def _pct(percentiles: dict, *keys: str) -> float | None:
    for k in keys:
        v = percentiles.get(k)
        if v is not None:
            return v
    return None


def make_entry(pid: str, name: str, pos: str, season: dict, headline: str, percentile: float | None) -> dict:
    return {
        "gsis_id": pid, "name": name, "pos": pos,
        "headline": headline, "percentile": percentile,
        "team_2025": season["team"], "games_2025": season["games"],
        "flag": None,
    }


def qb_headline(season: dict) -> tuple[str, float | None]:
    st = season.get("stats", {})
    headline = f"{st.get('pass_yds', 0):,} yds, {st.get('pass_td', 0)} TD in {season['games']} games"
    return headline, _pct(season.get("percentiles", {}), "epa_per_play", "pass_yds")


def rb_headline(season: dict) -> tuple[str, float | None]:
    st = season.get("stats", {})
    headline = f"{st.get('rush_yds', 0):,} yds, {st.get('rush_td', 0)} TD in {season['games']} games"
    return headline, _pct(season.get("percentiles", {}), "rush_yds", "epa_per_play")


def receiver_headline(season: dict) -> tuple[str, float | None]:
    st = season.get("stats", {})
    headline = f"{st.get('rec_yds', 0):,} yds, {st.get('rec_td', 0)} TD in {season['games']} games"
    return headline, _pct(season.get("percentiles", {}), "rec_yds", "targets")


def rusher_headline(season: dict) -> tuple[str, float | None]:
    st = season.get("stats", {})
    headline = f"{st.get('def_sacks', 0)} sacks, {st.get('qb_hits', 0)} QB hits in {season['games']} games"
    return headline, _pct(season.get("percentiles", {}), "def_sacks", "qb_hits")


def db_headline(season: dict) -> tuple[str, float | None]:
    st = season.get("stats", {})
    headline = f"{st.get('def_int', 0)} INT, {st.get('pass_defended', 0)} PD in {season['games']} games"
    return headline, _pct(season.get("percentiles", {}), "def_int", "pass_defended")


def tackler_headline(season: dict) -> tuple[str, float | None]:
    st = season.get("stats", {})
    headline = f"{st.get('tackles', 0)} tackles, {st.get('tfl', 0)} TFL in {season['games']} games"
    return headline, _pct(season.get("percentiles", {}), "tackles", "tfl")


def pick_top(candidates: list[dict], cache: PlayerCache, sort_stat: str) -> "list[tuple[dict, dict | None, dict | None]]":
    """Rank candidates by 2025 production on `sort_stat` (no 2025 data always
    sorts last, never treated as a real zero), returning
    (roster_row, player_doc, season_2025) tuples, most-productive first."""
    scored = []
    for row in candidates:
        doc = cache.get(row["player_id"])
        season = season_2025(doc)
        value = (season.get("stats", {}) or {}).get(sort_stat, 0) if season else None
        has_data = season is not None
        scored.append((has_data, value or 0, row, doc, season))
    scored.sort(key=lambda t: (t[0], t[1]), reverse=True)
    return [(row, doc, season) for _has, _val, row, doc, season in scored]


def load_started_qb_ids() -> dict[str, set[str]]:
    """team -> set of gsis_ids who have thrown a pass for that team in an
    already-played 2026 game. Empty (for every team) before Week 1 has any
    results — the QB pick then falls back to 2025 attempts alone, same as
    before this tie-break existed."""
    try:
        pbp = nfl.import_pbp_data([ROSTER_SEASON], downcast=True, cache=False)
    except Exception as exc:  # noqa: BLE001 - genuinely optional signal, any failure just disables it
        print(f"  note: no {ROSTER_SEASON} play-by-play yet ({exc}) — QB tie-break falls back to 2025 attempts only")
        return {}
    if pbp.empty:
        return {}
    thrown = pbp[pbp["passer_player_id"].notna()][["posteam", "passer_player_id"]].drop_duplicates()
    started: dict[str, set[str]] = {}
    for team, group in thrown.groupby("posteam"):
        started[team] = set(group["passer_player_id"])
    return started


def pick_qb(
    candidates: list[dict], cache: PlayerCache, started_ids: set[str]
) -> "tuple[dict, dict | None, dict | None] | None":
    """pick_top by pass_att, then apply the started-in-2026 tie-break: within
    QB_TIEBREAK_ATTEMPT_MARGIN 2025 attempts of the top-ranked candidate,
    prefer whoever has actually started a 2026 game for this team."""
    ranked = pick_top(candidates, cache, "pass_att")
    if len(ranked) < 2:
        return ranked[0] if ranked else None

    top_row, _top_doc, top_season = ranked[0]
    top_att = (top_season.get("stats", {}).get("pass_att", 0) if top_season else 0)
    top_started = top_row["player_id"] in started_ids

    if top_started:
        return ranked[0]  # already the real starter, nothing to fix

    for candidate in ranked[1:]:
        cand_row, _cand_doc, cand_season = candidate
        cand_att = (cand_season.get("stats", {}).get("pass_att", 0) if cand_season else 0)
        if top_att - cand_att > QB_TIEBREAK_ATTEMPT_MARGIN:
            break  # candidates are sorted by attempts descending; margin only widens from here
        if cand_row["player_id"] in started_ids:
            return candidate
    return ranked[0]


def build_team_players() -> dict:
    roster = load_roster()
    cache = PlayerCache()
    started_qbs = load_started_qb_ids()

    by_team: dict[str, list[dict]] = {}
    for row in roster:
        by_team.setdefault(row["team"], []).append(row)

    teams: dict[str, dict] = {}
    for team, rows in sorted(by_team.items()):
        by_group: dict[str, list[dict]] = {}
        for row in rows:
            grp = position_group(row["position"] or "")
            if grp:
                by_group.setdefault(grp, []).append(row)

        # --- pass offence: QB + top 1-2 receivers (WR/TE) -------------------
        qb_entry = None
        qb_pick = pick_qb(by_group.get("QB", []), cache, started_qbs.get(team, set()))
        if qb_pick:
            row, doc, season = qb_pick
            if season:
                headline, pct = qb_headline(season)
                qb_entry = make_entry(row["player_id"], row["player_name"], row["position"], season, headline, pct)
            else:
                qb_entry = no_data_entry(row["player_id"], row["player_name"], row["position"])

        receivers = []
        wr_te_cands = pick_top(
            by_group.get("WR", []) + by_group.get("TE", []), cache, "targets"
        )
        for row, doc, season in wr_te_cands[:2]:
            if season:
                headline, pct = receiver_headline(season)
                receivers.append(make_entry(row["player_id"], row["player_name"], row["position"], season, headline, pct))
            else:
                receivers.append(no_data_entry(row["player_id"], row["player_name"], row["position"]))

        # --- run offence: lead RB --------------------------------------------
        rb_entry = None
        rb_cands = pick_top(by_group.get("RB", []), cache, "rush_att")
        if rb_cands:
            row, doc, season = rb_cands[0]
            if season:
                headline, pct = rb_headline(season)
                rb_entry = make_entry(row["player_id"], row["player_name"], row["position"], season, headline, pct)
            else:
                rb_entry = no_data_entry(row["player_id"], row["player_name"], row["position"])

        # --- pass defence: top pass-rusher, optional top DB ------------------
        # Not optional per spec ("top pass-rusher", unlike the DB/tackler
        # slots) — always shown when the roster has any DL/LB, even if their
        # 2025 sack/hit total is thin, but never fabricated when there's
        # simply no 2025 record.
        rusher_entry = None
        rusher_cands = pick_top(by_group.get("DL", []) + by_group.get("LB", []), cache, "def_sacks")
        if rusher_cands:
            row, doc, season = rusher_cands[0]
            if season:
                headline, pct = rusher_headline(season)
                rusher_entry = make_entry(row["player_id"], row["player_name"], row["position"], season, headline, pct)
            else:
                rusher_entry = no_data_entry(row["player_id"], row["player_name"], row["position"])

        db_entry = None
        db_cands = pick_top(by_group.get("DB", []), cache, "def_int")
        if db_cands:
            row, doc, season = db_cands[0]
            if season:
                st = season.get("stats", {})
                if (st.get("def_int", 0) >= DB_MIN_PRODUCTION) or (st.get("pass_defended", 0) >= PD_MIN_PRODUCTION):
                    headline, pct = db_headline(season)
                    db_entry = make_entry(row["player_id"], row["player_name"], row["position"], season, headline, pct)
            # no `season` (no 2025 data) or below the production bar -> omit
            # entirely; per spec this slot is optional and thin data should
            # not be forced into a spotlight.

        # --- run defence: optional top tackler --------------------------------
        tackler_entry = None
        tackler_cands = pick_top(by_group.get("DL", []) + by_group.get("LB", []), cache, "tackles")
        if tackler_cands:
            row, doc, season = tackler_cands[0]
            if season and season.get("stats", {}).get("tackles", 0) >= TACKLER_MIN_TACKLES:
                headline, pct = tackler_headline(season)
                tackler_entry = make_entry(row["player_id"], row["player_name"], row["position"], season, headline, pct)

        teams[team] = {
            "pass_off": {"qb": qb_entry, "receivers": receivers},
            "run_off": {"rb": rb_entry},
            "pass_def": {"rusher": rusher_entry, "db": db_entry},
            "run_def": {"tackler": tackler_entry},
        }

    return {
        "schema_version": SCHEMA_VERSION,
        "roster_season": ROSTER_SEASON,
        "production_season": PRODUCTION_SEASON,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "teams": teams,
    }


def main() -> None:
    print(f"Checking import_seasonal_rosters([{ROSTER_SEASON}])...")
    df = nfl.import_seasonal_rosters([ROSTER_SEASON])
    n_teams = df["team"].nunique()
    n_active = (df["status"] == "ACT").sum()
    print(f"  {len(df)} total rows, {n_teams} teams, {n_active} active-status rows")
    if df.empty or n_teams < 32:
        raise SystemExit(
            f"import_seasonal_rosters([{ROSTER_SEASON}]) does not look like a real full-league "
            f"roster ({n_teams} teams) — stopping before building spotlights"
        )
    print("  OK: looks like real 2026 rosters, proceeding")

    doc = build_team_players()
    n_teams_out = len(doc["teams"])
    print(f"Built spotlights for {n_teams_out} teams")

    out_path = DATA_DIR / "matchups" / "team_players.json"
    write_json(out_path, doc)
    print(f"  wrote {out_path.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
