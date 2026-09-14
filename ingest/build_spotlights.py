"""Build step for the /matchups player-spotlights layer (docs/MATCHUPS_SPOTLIGHTS.md,
docs/MATCHUPS_INJURIES.md).

Output: public/data/matchups/team_players.json — per team (2026 roster), the
key players by unit, each carrying their **2025** headline stat line and
position percentile (both reused straight from the existing player files —
no new production data is computed here), plus this-week injury status and,
for QB/RB, the depth-chart-resolved starter.

The reconciliation this build exists to get right:
  - Team membership -> 2026 roster (import_seasonal_rosters([2026])).
  - Production level -> that player's 2025 REG season record, wherever he
    played that year. A player who changed teams for 2026 still shows his
    old team's 2025 numbers, just filed under his new team.
  - Rookies / anyone with no 2025 REG record -> flagged ("no_2025_data"),
    never a fabricated or zeroed stat line.
  - QB / RB starter -> the current **depth chart** (import_depth_charts),
    overridden by the current week's **injury report** (import_injuries)
    when the depth-chart QB1/RB1 is Out/IR: docs/MATCHUPS_INJURIES.md's
    "who actually plays this week" rule. This replaces the old "rank by
    2025 attempts" pick, which named last year's starter, not this week's.
  - WR/TE and defensive spotlights stay ranked by 2025 production (depth
    chart ordering there is noisy; production is the better "who to watch"
    signal) but still carry an `injury_status` flag.

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

# Injury-report statuses (import_injuries `report_status`) severe enough to
# knock a depth-chart QB1/RB1 out of the starter slot for this week
# (docs/MATCHUPS_INJURIES.md: "Out/IR" -> next man up). Doubtful/Questionable
# do NOT override the starter — they're shown as a flag only, per the doc's
# "don't reorder on a one-week absence" rule (which applies to the starter
# pick too: a Questionable QB1 is still the starter).
OUT_STATUSES = {"Out", "IR"}

# import_injuries' `report_status` only ever carries Out/Doubtful/Questionable
# (confirmed at the data-inspection gate) — "IR" / longer-term reserve moves
# don't show up there. import_seasonal_rosters' `status` column does carry
# that (ACT/RES/CUT/...); "RES" is the free signal for "not on this week's
# active gameday roster at all", so it's treated the same as an Out report.
RESERVE_ROSTER_STATUSES = {"RES"}


def load_roster() -> "tuple[list[dict], dict[str, str]]":
    """import_seasonal_rosters([2026]): active roster rows for team
    membership (one row per player.id; the raw table can carry incidental
    duplicate rows for the same id/team), plus a gsis_id -> roster `status`
    map (ACT/RES/CUT/...) for every rostered player, used as the IR/reserve
    signal for starter resolution."""
    df = nfl.import_seasonal_rosters([ROSTER_SEASON])
    if df.empty:
        raise SystemExit(f"import_seasonal_rosters([{ROSTER_SEASON}]) returned no rows")
    status_by_id = dict(zip(df["player_id"], df["status"]))
    act = df[(df["status"] == "ACT") & df["player_id"].notna()]
    act = act.drop_duplicates("player_id")
    rows = act[["team", "player_id", "player_name", "position"]].to_dict("records")
    return rows, status_by_id


def load_depth_chart_current() -> "dict[tuple[str, str], list[tuple[int, str, str]]]":
    """(team, pos_abb) -> [(pos_rank, gsis_id, player_name), ...] sorted by
    pos_rank, from the *latest* depth-chart snapshot.

    import_depth_charts returns a full time series (one row per player per
    scrape `dt`, going back months) rather than one row per current starter
    — "who's QB1 right now" means filtering to the max `dt`, not just
    reading the table as-is."""
    df = nfl.import_depth_charts([ROSTER_SEASON])
    if df.empty:
        raise SystemExit(f"import_depth_charts([{ROSTER_SEASON}]) returned no rows")
    latest_dt = df["dt"].max()
    cur = df[(df["dt"] == latest_dt) & df["gsis_id"].notna()]
    by_key: "dict[tuple[str, str], list[tuple[int, str, str]]]" = {}
    for row in cur.itertuples(index=False):
        by_key.setdefault((row.team, row.pos_abb), []).append((row.pos_rank, row.gsis_id, row.player_name))
    for key, entries in by_key.items():
        entries.sort(key=lambda t: t[0])
    return by_key


def current_week() -> int:
    """The same "first week that isn't fully in the past" rule as
    defaultWeek() in src/lib/matchups.ts, so the injury report we resolve
    starters against is the same week /matchups itself is showing."""
    sched_path = DATA_DIR / "matchups" / "schedule_2026.json"
    doc = json.loads(sched_path.read_text(encoding="utf-8"))
    today = datetime.now(timezone.utc).date().isoformat()
    weeks = sorted(doc["weeks"].keys(), key=int)
    for wk in weeks:
        games = doc["weeks"][wk]
        last_date = max((g["date"] for g in games), default="")
        if last_date >= today:
            return int(wk)
    return int(weeks[-1])


def load_injuries_current(week: int) -> "dict[str, str]":
    """gsis_id -> report_status ('Out'/'Doubtful'/'Questionable') for this
    week's injury report only. Absence from this map means "not on the
    report" — never treated as Out, never treated as healthy-confirmed
    either; it's just no flag."""
    df = nfl.import_injuries([ROSTER_SEASON])
    if df.empty:
        raise SystemExit(f"import_injuries([{ROSTER_SEASON}]) returned no rows")
    wk = df[(df["week"] == week) & df["report_status"].notna()]
    return dict(zip(wk["gsis_id"], wk["report_status"]))


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


def attach_injury(entry: dict, gsis_id: str, injuries: "dict[str, str]") -> dict:
    """Current-week Out/Doubtful/Questionable flag — informational only here;
    it does NOT by itself change who's shown as the starter (see
    resolve_starter for the QB/RB override)."""
    entry["injury_status"] = injuries.get(gsis_id)
    return entry


def attach_starter_meta(
    entry: dict, depth_rank: int, skipped: "list[tuple[str, str]]", injuries: "dict[str, str]"
) -> dict:
    """QB/RB entries only: where this player sits on the current depth chart,
    and — when an injury bumped him into the job — every depth-chart entry
    ranked above him that was Out/IR (not just the nominal #1: ATL's QB1 and
    QB2 are both Out this week, so Cooper Rush's chain has two names), each
    with its own injury status, so the UI can show "started for Penix, Tua"
    rather than silently swapping in one name."""
    entry["depth_rank"] = depth_rank
    entry["starter_override"] = bool(skipped)
    entry["overridden_starters"] = [
        {"gsis_id": gid, "name": name, "injury_status": injuries.get(gid)} for gid, name in skipped
    ]
    return entry


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


def is_out(gsis_id: str, injuries: "dict[str, str]", roster_status: "dict[str, str]") -> bool:
    if injuries.get(gsis_id) in OUT_STATUSES:
        return True
    return roster_status.get(gsis_id) in RESERVE_ROSTER_STATUSES


def resolve_starter(
    team: str,
    pos_abb: str,
    depth_chart: "dict[tuple[str, str], list[tuple[int, str, str]]]",
    injuries: "dict[str, str]",
    roster_status: "dict[str, str]",
) -> "tuple[str, str, int, list[tuple[str, str]]] | None":
    """docs/MATCHUPS_INJURIES.md starter-resolution rule: depth-chart rank 1,
    unless Out/IR this week, in which case the next available depth-chart
    entry — walking past *every* consecutive Out/IR entry above him (ATL's
    QB1 and QB2 are both Out this week; QB3 is the resolved starter with a
    two-name chain, not just one). Returns (gsis_id, name, depth_rank,
    skipped) — `skipped` is the [(gsis_id, name), ...] of every depth-chart
    entry ranked above the resolved starter that was Out/IR, in depth-chart
    order, empty when no override happened — or None if this team has no
    depth-chart entry at this position at all."""
    candidates = depth_chart.get((team, pos_abb), [])
    if not candidates:
        return None
    skipped: "list[tuple[str, str]]" = []
    for rank, gsis_id, name in candidates:
        if not is_out(gsis_id, injuries, roster_status):
            return gsis_id, name, rank, skipped
        skipped.append((gsis_id, name))
    # Every depth-chart entry at this position is Out/IR: fall back to the
    # nominal (rank-1) starter rather than showing nobody — he's still
    # flagged Out on the card via attach_injury, just not swapped for a
    # healthy nobody who doesn't exist on this depth chart.
    nominal_rank, nominal_id, nominal_name = candidates[0]
    return nominal_id, nominal_name, nominal_rank, []


def build_team_players(
    roster: list[dict],
    roster_status: "dict[str, str]",
    depth_chart: "dict[tuple[str, str], list[tuple[int, str, str]]]",
    injuries: "dict[str, str]",
) -> dict:
    cache = PlayerCache()

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

        # --- pass offence: QB (depth chart + injury override) + top 1-2 receivers ---
        qb_entry = None
        qb_resolved = resolve_starter(team, "QB", depth_chart, injuries, roster_status)
        if qb_resolved is None:
            print(f"  note: {team} has no QB on the current depth chart — leaving qb spotlight empty")
        else:
            pid, name, depth_rank, skipped = qb_resolved
            season = season_2025(cache.get(pid))
            qb_entry = (
                make_entry(pid, name, "QB", season, *qb_headline(season)) if season
                else no_data_entry(pid, name, "QB")
            )
            attach_injury(qb_entry, pid, injuries)
            attach_starter_meta(qb_entry, depth_rank, skipped, injuries)

        receivers = []
        wr_te_cands = pick_top(
            by_group.get("WR", []) + by_group.get("TE", []), cache, "targets"
        )
        for row, doc, season in wr_te_cands[:2]:
            entry = (
                make_entry(row["player_id"], row["player_name"], row["position"], season, *receiver_headline(season))
                if season else no_data_entry(row["player_id"], row["player_name"], row["position"])
            )
            attach_injury(entry, row["player_id"], injuries)
            receivers.append(entry)

        # --- run offence: lead RB (depth chart + injury override) ------------
        rb_entry = None
        rb_resolved = resolve_starter(team, "RB", depth_chart, injuries, roster_status)
        if rb_resolved is None:
            print(f"  note: {team} has no RB on the current depth chart — leaving rb spotlight empty")
        else:
            pid, name, depth_rank, skipped = rb_resolved
            season = season_2025(cache.get(pid))
            rb_entry = (
                make_entry(pid, name, "RB", season, *rb_headline(season)) if season
                else no_data_entry(pid, name, "RB")
            )
            attach_injury(rb_entry, pid, injuries)
            attach_starter_meta(rb_entry, depth_rank, skipped, injuries)

        # --- pass defence: top pass-rusher, optional top DB ------------------
        # Not optional per spec ("top pass-rusher", unlike the DB/tackler
        # slots) — always shown when the roster has any DL/LB, even if their
        # 2025 sack/hit total is thin, but never fabricated when there's
        # simply no 2025 record.
        rusher_entry = None
        rusher_cands = pick_top(by_group.get("DL", []) + by_group.get("LB", []), cache, "def_sacks")
        if rusher_cands:
            row, doc, season = rusher_cands[0]
            rusher_entry = (
                make_entry(row["player_id"], row["player_name"], row["position"], season, *rusher_headline(season))
                if season else no_data_entry(row["player_id"], row["player_name"], row["position"])
            )
            attach_injury(rusher_entry, row["player_id"], injuries)

        db_entry = None
        db_cands = pick_top(by_group.get("DB", []), cache, "def_int")
        if db_cands:
            row, doc, season = db_cands[0]
            if season:
                st = season.get("stats", {})
                if (st.get("def_int", 0) >= DB_MIN_PRODUCTION) or (st.get("pass_defended", 0) >= PD_MIN_PRODUCTION):
                    db_entry = make_entry(row["player_id"], row["player_name"], row["position"], season, *db_headline(season))
                    attach_injury(db_entry, row["player_id"], injuries)
            # no `season` (no 2025 data) or below the production bar -> omit
            # entirely; per spec this slot is optional and thin data should
            # not be forced into a spotlight.

        # --- run defence: optional top tackler --------------------------------
        tackler_entry = None
        tackler_cands = pick_top(by_group.get("DL", []) + by_group.get("LB", []), cache, "tackles")
        if tackler_cands:
            row, doc, season = tackler_cands[0]
            if season and season.get("stats", {}).get("tackles", 0) >= TACKLER_MIN_TACKLES:
                tackler_entry = make_entry(row["player_id"], row["player_name"], row["position"], season, *tackler_headline(season))
                attach_injury(tackler_entry, row["player_id"], injuries)

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
    roster, roster_status = load_roster()
    n_teams = len({row["team"] for row in roster})
    print(f"  {len(roster)} active rows, {n_teams} teams")
    if n_teams < 32:
        raise SystemExit(
            f"import_seasonal_rosters([{ROSTER_SEASON}]) does not look like a real full-league "
            f"roster ({n_teams} teams) — stopping before building spotlights"
        )

    print(f"Checking import_depth_charts([{ROSTER_SEASON}])...")
    depth_chart = load_depth_chart_current()
    dc_teams = {team for (team, _pos) in depth_chart}
    dc_qb_teams = {team for (team, pos) in depth_chart if pos == "QB"}
    print(f"  {len(dc_teams)} teams on the latest depth-chart snapshot, {len(dc_qb_teams)} with a QB entry")
    if len(dc_teams) < 32 or len(dc_qb_teams) < 32:
        raise SystemExit(
            f"import_depth_charts([{ROSTER_SEASON}]) doesn't cover all 32 teams "
            f"({len(dc_teams)} teams, {len(dc_qb_teams)} with QB) — stopping before building spotlights"
        )

    wk = current_week()
    print(f"Checking import_injuries([{ROSTER_SEASON}])... (current week resolves to {wk})")
    injuries = load_injuries_current(wk)
    print(f"  {len(injuries)} players on week {wk}'s injury report with a status")

    print("  OK: rosters, depth charts, and injuries all look real — proceeding")

    doc = build_team_players(roster, roster_status, depth_chart, injuries)
    n_teams_out = len(doc["teams"])
    print(f"Built spotlights for {n_teams_out} teams")

    out_path = DATA_DIR / "matchups" / "team_players.json"
    write_json(out_path, doc)
    print(f"  wrote {out_path.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
