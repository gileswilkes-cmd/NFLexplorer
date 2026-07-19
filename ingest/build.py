"""NFL Explorer build step.

Pulls 2015-2025 data from nfl-data-py (nflverse) and writes compact,
pre-aggregated JSON into public/data/. The Next.js client only ever reads
that JSON; raw play-by-play is aggregated here and never shipped.

Output layout and field definitions: docs/DATA_SCHEMA.md.

Requires Python 3.11 (nfl_data_py pins pandas<2, which has no 3.12+ wheels).

Usage:
    python build.py                       # full build, all seasons
    python build.py --seasons 2024 2025   # subset (weekly refresh)
    python build.py --sample              # baselines + sample player files only
    python build.py --players 00-0033873  # baselines + specific player files
"""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

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
    "DE": "DL", "DT": "DL", "NT": "DL", "EDGE": "DL", "DL": "DL",
    "ILB": "LB", "OLB": "LB", "MLB": "LB", "LB": "LB",
    "CB": "DB", "S": "DB", "FS": "DB", "SS": "DB", "DB": "DB",
}

OFF_POSITION_GROUPS = {"QB": "QB", "RB": "RB", "FB": "RB", "WR": "WR", "TE": "TE", "K": "K"}
POSITION_GROUPS = {**OFF_POSITION_GROUPS, **DEF_POSITION_GROUPS}

# Baseline inclusion rules per group: (stat key, minimum), REG season only.
# QB minimum is 224 attempts (14 games x 16) so the pool is full-season
# starters, not part-season backups.
QUALIFIERS = {
    "QB": ("pass_att", 224), "RB": ("rush_att", 100),
    "WR": ("targets", 50), "TE": ("targets", 30), "K": ("fg_att", 15),
    "DL": ("snaps", 200), "LB": ("snaps", 200), "DB": ("snaps", 200),
}
MIN_BASELINE_N = 8  # don't publish a grid computed from fewer players

# Canonical stat set per position group, applied to BOTH baseline computation
# and player percentiles. Players still STORE incidental out-of-position
# counting stats (a WR's tackle after an interception), but no baseline or
# percentile is ever computed from out-of-position noise.
_PASSING = {"pass_att", "pass_cmp", "pass_yds", "pass_td", "pass_int",
            "sacks", "sack_yds", "pass_air_yds", "pass_yac"}
_RUSHING = {"rush_att", "rush_yds", "rush_td", "rush_fumbles"}
_RECEIVING = {"targets", "rec", "rec_yds", "rec_td", "rec_air_yds", "rec_yac",
              "target_share", "air_yds_share"}
_USAGE = {"snaps", "snap_share"}
_DEFENSE = {"tackles", "tackles_solo", "tfl", "def_sacks", "qb_hits",
            "def_int", "pass_defended", "ff", "fr", "def_td"}
_KICKING = {"fg_att", "fg_made", "fg_long", "xp_att", "xp_made"}
POSITION_STAT_SETS = {
    "QB": _PASSING | _RUSHING | _USAGE | {"epa_per_play", "cpoe", "adot"},
    "RB": _RUSHING | _RECEIVING | _USAGE | {"epa_per_play", "adot", "yac_oe"},
    "WR": _RECEIVING | _RUSHING | _USAGE | {"epa_per_play", "adot", "yac_oe"},
    "TE": _RECEIVING | _USAGE | {"epa_per_play", "adot", "yac_oe"},
    "K": _KICKING,
    "DL": _DEFENSE | _USAGE, "LB": _DEFENSE | _USAGE, "DB": _DEFENSE | _USAGE,
}
# Rates/derived values: a qualified player without the key is skipped. Every
# other (counting) key is a real zero for a qualified player and is included
# as 0 so sparse-stat baselines (a DL's INTs) aren't inflated.
RATE_STATS = {"snap_share", "target_share", "air_yds_share",
              "epa_per_play", "cpoe", "adot", "yac_oe"}

# weekly-data column -> schema stat key (counting stats summed per season)
WEEKLY_STAT_MAP = {
    "attempts": "pass_att", "completions": "pass_cmp", "passing_yards": "pass_yds",
    "passing_tds": "pass_td", "interceptions": "pass_int", "sacks": "sacks",
    "sack_yards": "sack_yds", "passing_air_yards": "pass_air_yds",
    "passing_yards_after_catch": "pass_yac",
    "carries": "rush_att", "rushing_yards": "rush_yds", "rushing_tds": "rush_td",
    "rushing_fumbles": "rush_fumbles",
    "targets": "targets", "receptions": "rec", "receiving_yards": "rec_yds",
    "receiving_tds": "rec_td", "receiving_air_yards": "rec_air_yds",
    "receiving_yards_after_catch": "rec_yac",
}
INT_STATS = {
    "pass_att", "pass_cmp", "pass_yds", "pass_td", "pass_int", "sacks", "sack_yds",
    "pass_air_yds", "pass_yac", "rush_att", "rush_yds", "rush_td", "rush_fumbles",
    "targets", "rec", "rec_yds", "rec_td", "rec_air_yds", "rec_yac",
    "snaps", "tackles", "tackles_solo", "tfl", "qb_hits", "def_int",
    "pass_defended", "ff", "fr", "def_td", "fg_att", "fg_made", "fg_long",
    "xp_att", "xp_made", "punt_ret", "punt_ret_yds", "punt_ret_td",
    "kick_ret", "kick_ret_yds", "kick_ret_td", "games",
}

# Repo-root-relative, resolved via this file's location: works from any CWD,
# on Windows and on Linux (Vercel/CI).
REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "public" / "data"
CACHE_DIR = Path(__file__).resolve().parent / ".cache"


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


# --- source pulls (parquet-cached in ingest/.cache) --------------------------


def _cached(name: str, loader) -> pd.DataFrame:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = CACHE_DIR / f"{name}.parquet"
    if path.exists():
        return pd.read_parquet(path)
    df = loader()
    df.to_parquet(path, index=False)
    return df


# nflverse froze the legacy player_stats release after 2024; later seasons ship
# the new-format file (tag stats_player), which renames a few columns.
NEW_WEEKLY_URL = ("https://github.com/nflverse/nflverse-data/releases/download/"
                  "stats_player/stats_player_week_{year}.parquet")
NEW_WEEKLY_RENAMES = {"passing_interceptions": "interceptions",
                      "sacks_suffered": "sacks",
                      "sack_yards_lost": "sack_yards",
                      "team": "recent_team"}


def fetch_weekly(year: int) -> pd.DataFrame:
    import urllib.error

    import nfl_data_py as ndp

    def load():
        try:
            return ndp.import_weekly_data([year])
        except urllib.error.HTTPError as e:
            if e.code != 404:
                raise
            df = pd.read_parquet(NEW_WEEKLY_URL.format(year=year))
            df = df.rename(columns=NEW_WEEKLY_RENAMES)
            # Legacy stores sack yardage as magnitude; the new format stores
            # yards LOST (negative). Audited 2026-07: this is the only used
            # column whose sign convention differs.
            df["sack_yards"] = df["sack_yards"].abs()
            return df

    return _cached(f"weekly_{year}", load)


def fetch_rosters(year: int) -> pd.DataFrame:
    import nfl_data_py as ndp
    return _cached(f"rosters_{year}", lambda: ndp.import_seasonal_rosters([year]))


def fetch_snaps(year: int) -> pd.DataFrame:
    import nfl_data_py as ndp
    return _cached(f"snaps_{year}", lambda: ndp.import_snap_counts([year]))


def fetch_schedules(year: int) -> pd.DataFrame:
    import nfl_data_py as ndp
    return _cached(f"schedules_{year}", lambda: ndp.import_schedules([year]))


def fetch_pbp(year: int) -> pd.DataFrame:
    import nfl_data_py as ndp
    return _cached(f"pbp_{year}", lambda: ndp.import_pbp_data([year], cache=False))


def fetch_ngs(stat_type: str, year: int) -> pd.DataFrame:
    import nfl_data_py as ndp
    if year < FIRST_NGS_SEASON:
        return pd.DataFrame()
    return _cached(f"ngs_{stat_type}_{year}", lambda: ndp.import_ngs_data(stat_type, [year]))


def fetch_players() -> pd.DataFrame:
    import nfl_data_py as ndp
    return _cached("players_master", ndp.import_players)


# --- per-season aggregation --------------------------------------------------


def _f(x) -> float:
    return round(float(x), 3)


def _norm_type(game_type: str) -> str:
    return "REG" if game_type == "REG" else "POST"


def _schedule_maps(year: int):
    """(week, team) -> {game_id, date, opp, home} plus game_id -> date."""
    sched = fetch_schedules(year)
    by_team, by_gid = {}, {}
    for r in sched.itertuples():
        by_gid[r.game_id] = str(r.gameday)
        by_team[(int(r.week), r.home_team)] = {
            "game_id": r.game_id, "date": str(r.gameday), "opp": r.away_team,
            "home": True, "game_type": r.game_type}
        by_team[(int(r.week), r.away_team)] = {
            "game_id": r.game_id, "date": str(r.gameday), "opp": r.home_team,
            "home": False, "game_type": r.game_type}
    return by_team, by_gid


class SeasonAccumulator:
    """Everything the build extracts from one season, keyed by player."""

    def __init__(self, year: int):
        self.year = year
        # (pid, "REG"|"POST") -> Counter-ish dicts
        self.stats = defaultdict(lambda: defaultdict(float))
        self.pools = defaultdict(lambda: defaultdict(float))  # advanced-metric numerators/denominators
        self.games = defaultdict(set)          # (pid, type) -> set of game keys
        self.teams = defaultdict(dict)         # (pid, type) -> {team: games}
        self.ngs = defaultdict(dict)           # (pid, type) -> {ngs_key: value}
        self.logs = defaultdict(dict)          # pid -> {(week): log row dict}
        self.roster = {}                       # pid -> {"pos":, "team":}
        self.pfr_to_gsis = {}


def _add_log(acc: SeasonAccumulator, pid: str, week: int, meta: dict, stats: dict) -> None:
    log = acc.logs[pid].setdefault(week, {
        "season": acc.year, "week": week, "game_type": meta["game_type"],
        "date": meta["date"], "team": meta["team"], "opp": meta["opp"],
        "home": meta["home"], "stats": {}})
    for k, v in stats.items():
        if v:
            log["stats"][k] = log["stats"].get(k, 0) + v


def _aggregate_weekly(acc: SeasonAccumulator, by_team_sched: dict) -> None:
    wk = fetch_weekly(acc.year)
    for r in wk.itertuples():
        pid = r.player_id
        gtype = _norm_type(r.season_type)
        week = int(r.week)
        team = r.recent_team
        key = (pid, gtype)
        row_stats = {}
        for src, dst in WEEKLY_STAT_MAP.items():
            v = getattr(r, src, None)
            if v is not None and not pd.isna(v) and v != 0:
                row_stats[dst] = v
        for k, v in row_stats.items():
            acc.stats[key][k] += v
        acc.games[key].add(("wk", week))
        acc.teams[key][team] = acc.teams[key].get(team, 0) + 1
        sched = by_team_sched.get((week, team), {})
        meta = {"game_type": sched.get("game_type", r.season_type), "date": sched.get("date"),
                "team": team, "opp": r.opponent_team, "home": sched.get("home")}
        _add_log(acc, pid, week, meta, row_stats)
        # season-level shares for REG come from summing numerators; the share
        # itself is computed at emit time against team totals accumulated below
        if not pd.isna(r.target_share):
            acc.pools[key]["tgt_share_num"] += r.targets
        if not pd.isna(r.air_yards_share):
            acc.pools[key]["ay_share_num"] += r.receiving_air_yards


def _aggregate_team_targets(acc: SeasonAccumulator, pbp: pd.DataFrame) -> None:
    """Team pass attempts + air yards per game type, for target/air-yard shares."""
    for gtype_mask, gtype in ((pbp.season_type == "REG", "REG"), (pbp.season_type != "REG", "POST")):
        sub = pbp[gtype_mask & (pbp.pass_attempt == 1) & pbp.passer_player_id.notna()]
        for team, n in sub.groupby("posteam").size().items():
            acc.pools[(("__team__", team), gtype)]["team_targets"] = float(n)
        ay = sub[sub.air_yards.notna()].groupby("posteam").air_yards.sum()
        for team, v in ay.items():
            acc.pools[(("__team__", team), gtype)]["team_air_yds"] = float(v)


def _aggregate_pbp_advanced(acc: SeasonAccumulator, pbp: pd.DataFrame) -> None:
    """Pool the advanced-metric numerators/denominators per player.

    Pools sum cleanly across seasons, which is exactly the career rule in the
    schema: career EPA/play = sum(epa)/sum(plays), never a season average.
    """
    for st_mask, gtype in ((pbp.season_type == "REG", "REG"), (pbp.season_type != "REG", "POST")):
        sub = pbp[st_mask]
        # QB dropbacks: passes + sacks (passer set) plus scrambles (rusher is the QB)
        drop = sub[(sub.qb_dropback == 1)]
        passer = drop[drop.passer_player_id.notna()]
        for pid, g in passer.groupby("passer_player_id"):
            p = acc.pools[(pid, gtype)]
            p["qb_epa_sum"] += float(g.qb_epa.sum())
            p["qb_plays"] += len(g)
            cp = g[g.cpoe.notna()]
            p["cpoe_sum"] += float(cp.cpoe.sum())
            p["cpoe_n"] += len(cp)
            ay = g[(g.pass_attempt == 1) & g.air_yards.notna()]
            p["pass_air_sum"] += float(ay.air_yards.sum())
            p["pass_att_n"] += len(ay)
        scram = drop[(drop.qb_scramble == 1) & drop.rusher_player_id.notna()]
        for pid, g in scram.groupby("rusher_player_id"):
            p = acc.pools[(pid, gtype)]
            p["qb_epa_sum"] += float(g.qb_epa.sum())
            p["qb_plays"] += len(g)
        # Skill plays: EPA over targets + carries (excluding QB scrambles)
        tgt = sub[(sub.pass_attempt == 1) & sub.receiver_player_id.notna()]
        for pid, g in tgt.groupby("receiver_player_id"):
            p = acc.pools[(pid, gtype)]
            p["skill_epa_sum"] += float(g.epa.sum())
            p["skill_plays"] += len(g)
            ay = g[g.air_yards.notna()]
            p["tgt_air_sum"] += float(ay.air_yards.sum())
            p["tgt_n"] += len(ay)
            done = g[(g.complete_pass == 1) & g.xyac_mean_yardage.notna() & g.yards_after_catch.notna()]
            p["yac_diff_sum"] += float((done.yards_after_catch - done.xyac_mean_yardage).sum())
            p["yac_rec_n"] += len(done)
        rush = sub[(sub.rush_attempt == 1) & (sub.qb_scramble != 1) & sub.rusher_player_id.notna()]
        for pid, g in rush.groupby("rusher_player_id"):
            p = acc.pools[(pid, gtype)]
            p["skill_epa_sum"] += float(g.epa.sum())
            p["skill_plays"] += len(g)


def _aggregate_pbp_events(acc: SeasonAccumulator, pbp: pd.DataFrame, by_gid: dict, by_team_sched: dict) -> None:
    """Defensive, kicking, and return counting stats from PBP events."""

    def resolve_team(pid, gtype, posteam, defteam):
        """The player's own team, from weekly/roster data — NEVER from which
        side of the ball a play was recorded on. (A QB tackling after his own
        interception appears in defensive event columns; posteam/defteam
        attribution would credit him to the opponent.)"""
        for key in ((pid, gtype), (pid, "REG"), (pid, "POST")):
            tp = acc.teams.get(key)
            if tp:
                if posteam in tp and defteam not in tp:
                    return posteam
                if defteam in tp and posteam not in tp:
                    return defteam
                return max(tp, key=tp.get)
        rteam = acc.roster.get(pid, {}).get("team")
        if rteam in (posteam, defteam):
            return rteam
        return defteam  # last resort: most PBP events are defensive

    def add(pid, week, game_id, stat, val, posteam, defteam, season_type):
        gtype = _norm_type(season_type)
        key = (pid, gtype)
        acc.stats[key][stat] += val
        acc.games[key].add(("wk", week))  # same key form as weekly, no double count
        team = resolve_team(pid, gtype, posteam, defteam)
        opp = defteam if team == posteam else posteam
        sched = by_team_sched.get((week, team), {})
        meta = {"game_type": sched.get("game_type", season_type),
                "date": by_gid.get(game_id), "team": team,
                "opp": opp, "home": sched.get("home")}
        _add_log(acc, pid, week, meta, {stat: val})

    def run(mask, id_cols, stat, weight=1.0):
        sub = pbp[mask] if mask is not None else pbp
        for c in id_cols:
            if c not in sub.columns:
                continue
            s = sub[sub[c].notna()]
            for r in s[[c] + ["game_id", "week", "posteam", "defteam", "season_type"]].itertuples(index=False):
                add(r[0], int(r.week), r.game_id, stat, weight,
                    r.posteam, r.defteam, r.season_type)

    # Defence
    run(None, ["solo_tackle_1_player_id", "solo_tackle_2_player_id"], "tackles_solo")
    run(None, ["solo_tackle_1_player_id", "solo_tackle_2_player_id",
               "assist_tackle_1_player_id", "assist_tackle_2_player_id",
               "assist_tackle_3_player_id", "assist_tackle_4_player_id"], "tackles")
    run(None, ["tackle_for_loss_1_player_id", "tackle_for_loss_2_player_id"], "tfl")
    run(None, ["sack_player_id"], "def_sacks")
    run(None, ["half_sack_1_player_id", "half_sack_2_player_id"], "def_sacks", 0.5)
    run(None, ["qb_hit_1_player_id", "qb_hit_2_player_id"], "qb_hits")
    run(None, ["interception_player_id"], "def_int")
    run(None, ["pass_defense_1_player_id", "pass_defense_2_player_id"], "pass_defended")
    run(None, ["forced_fumble_player_1_player_id", "forced_fumble_player_2_player_id"], "ff")
    # fr = takeaway recoveries only: recovering your own team's fumble is not
    # a defensive stat.
    for n in ("1", "2"):
        pcol, tcol = f"fumble_recovery_{n}_player_id", f"fumble_recovery_{n}_team"
        if pcol not in pbp.columns or "fumbled_1_team" not in pbp.columns:
            continue
        run(pbp[pcol].notna() & pbp["fumbled_1_team"].notna()
            & (pbp[tcol] != pbp["fumbled_1_team"]), [pcol], "fr")
    run((pbp.return_touchdown == 1) & ((pbp.interception == 1) | (pbp.fumble == 1)),
        ["td_player_id"], "def_td")
    # Kicking
    fg = pbp.field_goal_result.notna()
    run(fg, ["kicker_player_id"], "fg_att")
    run(fg & (pbp.field_goal_result == "made"), ["kicker_player_id"], "fg_made")
    made = pbp[fg & (pbp.field_goal_result == "made") & pbp.kicker_player_id.notna()]
    for pid, g in made.groupby("kicker_player_id"):
        for gtype in ("REG", "POST"):
            gg = g[(g.season_type == "REG")] if gtype == "REG" else g[(g.season_type != "REG")]
            if len(gg):
                key = (pid, gtype)
                acc.stats[key]["fg_long"] = max(acc.stats[key].get("fg_long", 0), float(gg.kick_distance.max()))
    xp = pbp.extra_point_result.notna()
    run(xp, ["kicker_player_id"], "xp_att")
    run(xp & (pbp.extra_point_result == "good"), ["kicker_player_id"], "xp_made")
    # Returns (team resolution is roster-derived, so posteam/defteam
    # conventions on kickoffs vs punts don't matter here)
    run(pbp.punt_returner_player_id.notna(), ["punt_returner_player_id"], "punt_ret")
    run(pbp.kickoff_returner_player_id.notna(), ["kickoff_returner_player_id"], "kick_ret")
    for mask_col, prefix in (("punt_returner_player_id", "punt_ret"),
                             ("kickoff_returner_player_id", "kick_ret")):
        s = pbp[pbp[mask_col].notna()]
        for r in s[[mask_col, "return_yards", "return_touchdown", "game_id", "week", "posteam", "defteam", "season_type"]].itertuples(index=False):
            if r.return_yards and not pd.isna(r.return_yards):
                add(r[0], int(r.week), r.game_id, f"{prefix}_yds", float(r.return_yards),
                    r.posteam, r.defteam, r.season_type)
            if r.return_touchdown == 1:
                add(r[0], int(r.week), r.game_id, f"{prefix}_td", 1,
                    r.posteam, r.defteam, r.season_type)


def _aggregate_snaps(acc: SeasonAccumulator) -> None:
    """Snap totals + snap share vs team totals, offense or defense by side."""
    snaps = fetch_snaps(acc.year)
    if snaps.empty:
        return
    # Team totals per game: max player snaps on that side (someone plays 100%)
    team_off = snaps.groupby(["game_id", "team"]).offense_snaps.max()
    team_def = snaps.groupby(["game_id", "team"]).defense_snaps.max()
    for r in snaps.itertuples():
        pid = acc.pfr_to_gsis.get(r.pfr_player_id)
        if pid is None:
            continue
        gtype = _norm_type(r.game_type)
        key = (pid, gtype)
        off, dfn = float(r.offense_snaps or 0), float(r.defense_snaps or 0)
        side_snaps, team_total = (off, team_off.get((r.game_id, r.team), 0)) if off >= dfn \
            else (dfn, team_def.get((r.game_id, r.team), 0))
        if side_snaps > 0:
            acc.pools[key]["snap_sum"] += side_snaps
            acc.pools[key]["snap_team_sum"] += float(team_total or 0)
            acc.games[key].add(("wk", int(r.week)))


NGS_MAPS = {
    "passing": {"avg_time_to_throw": "avg_time_to_throw",
                "avg_completed_air_yards": "avg_completed_air_yds",
                "avg_intended_air_yards": "avg_intended_air_yds"},
    "receiving": {"avg_separation": "avg_separation", "avg_cushion": "avg_cushion",
                  "avg_intended_air_yards": "avg_intended_air_yds"},
    "rushing": {"efficiency": "efficiency"},
}
NGS_WEIGHTS = {"passing": "attempts", "rushing": "rush_attempts", "receiving": "targets"}


def _aggregate_ngs(acc: SeasonAccumulator) -> None:
    if acc.year < FIRST_NGS_SEASON:
        return
    for stat_type, mapping in NGS_MAPS.items():
        df = fetch_ngs(stat_type, acc.year)
        if df.empty:
            continue
        for gtype in ("REG", "POST"):
            sub = df[df.season_type == gtype]
            if sub.empty:
                continue
            agg = sub[sub.week == 0]
            if agg.empty:
                # no season-aggregate row published: weight weekly rows
                wcol = NGS_WEIGHTS[stat_type]
                for pid, g in sub.groupby("player_gsis_id"):
                    w = g[wcol].fillna(0)
                    if w.sum() <= 0:
                        continue
                    for src, dst in mapping.items():
                        vals = g[src]
                        m = vals.notna() & w.gt(0)
                        if m.any():
                            acc.ngs[(pid, gtype)][dst] = round(float(np.average(vals[m], weights=w[m])), 2)
            else:
                for r in agg.itertuples():
                    for src, dst in mapping.items():
                        v = getattr(r, src)
                        if v is not None and not pd.isna(v):
                            acc.ngs[(r.player_gsis_id, gtype)][dst] = round(float(v), 2)


def _load_rosters(acc: SeasonAccumulator) -> None:
    ro = fetch_rosters(acc.year)
    for r in ro.itertuples():
        if pd.isna(r.player_id):
            continue
        acc.roster[r.player_id] = {"pos": r.position, "team": r.team}
        if isinstance(r.pfr_id, str) and r.pfr_id:
            acc.pfr_to_gsis[r.pfr_id] = r.player_id


def process_season(year: int) -> SeasonAccumulator:
    print(f"  [{year}] pulling + aggregating…")
    acc = SeasonAccumulator(year)
    _load_rosters(acc)
    by_team_sched, by_gid = _schedule_maps(year)
    _aggregate_weekly(acc, by_team_sched)
    pbp = fetch_pbp(year)
    _aggregate_team_targets(acc, pbp)
    _aggregate_pbp_advanced(acc, pbp)
    _aggregate_pbp_events(acc, pbp, by_gid, by_team_sched)
    del pbp
    _aggregate_snaps(acc)
    _aggregate_ngs(acc)
    return acc


# --- season-row emission ------------------------------------------------------


def position_group(pos: str) -> str | None:
    return POSITION_GROUPS.get(pos)


def _season_row(acc: SeasonAccumulator, pid: str, gtype: str) -> dict | None:
    key = (pid, gtype)
    stats = dict(acc.stats.get(key, {}))
    pools = acc.pools.get(key, {})
    if not stats and not pools:
        return None
    games = len(acc.games.get(key, set()))
    if games == 0:
        return None
    roster = acc.roster.get(pid, {})
    pos = roster.get("pos")
    teams_played = acc.teams.get(key, {})
    team = max(teams_played, key=teams_played.get) if teams_played else roster.get("team")

    out_stats = {}
    for k, v in stats.items():
        if v == 0:
            continue
        out_stats[k] = int(round(v)) if k in INT_STATS else _f(v)
    if "def_sacks" in out_stats:
        out_stats["def_sacks"] = _f(stats["def_sacks"])  # half sacks are real halves

    # snaps + snap share
    if pools.get("snap_sum", 0) > 0:
        out_stats["snaps"] = int(pools["snap_sum"])
        if pools.get("snap_team_sum", 0) > 0:
            out_stats["snap_share"] = _f(pools["snap_sum"] / pools["snap_team_sum"])
    # target / air-yards share vs team totals (skip rounding noise at 0)
    team_pool = acc.pools.get((("__team__", team), gtype), {})
    if stats.get("targets") and team_pool.get("team_targets"):
        share = _f(stats["targets"] / team_pool["team_targets"])
        if share != 0:
            out_stats["target_share"] = share
    if stats.get("rec_air_yds") and team_pool.get("team_air_yds"):
        share = _f(stats["rec_air_yds"] / team_pool["team_air_yds"])
        if share != 0:
            out_stats["air_yds_share"] = share

    advanced = _advanced_from_pools(pools, pos)
    grp = position_group(pos or "")
    if grp in ("QB", "RB", "WR", "TE"):
        ngs = acc.ngs.get(key)
        advanced = advanced or {}
        advanced["ngs"] = dict(ngs) if ngs else None  # None = null: pre-2016 or not tracked

    row = {"season": acc.year, "team": team,
           "teams": sorted(teams_played, key=teams_played.get, reverse=True) or [team],
           "pos": pos, "games": games, "game_type": gtype, "stats": out_stats}
    if advanced:
        row["advanced"] = advanced
    row["percentiles"] = {}
    return row


def _advanced_from_pools(pools: dict, pos: str | None) -> dict | None:
    adv = {}
    if pos == "QB":
        if pools.get("qb_plays", 0) > 0:
            adv["epa_per_play"] = _f(pools["qb_epa_sum"] / pools["qb_plays"])
        if pools.get("cpoe_n", 0) > 0:
            adv["cpoe"] = round(pools["cpoe_sum"] / pools["cpoe_n"], 2)
        if pools.get("pass_att_n", 0) > 0:
            adv["adot"] = round(pools["pass_air_sum"] / pools["pass_att_n"], 2)
    else:
        if pools.get("skill_plays", 0) > 0:
            adv["epa_per_play"] = _f(pools["skill_epa_sum"] / pools["skill_plays"])
        if pools.get("tgt_n", 0) > 0:
            adv["adot"] = round(pools["tgt_air_sum"] / pools["tgt_n"], 2)
        if pools.get("yac_rec_n", 0) > 0:
            adv["yac_oe"] = round(pools["yac_diff_sum"] / pools["yac_rec_n"], 2)
    return adv or None


# --- pipeline stages ----------------------------------------------------------


def build_season_aggregates(accs: dict[int, SeasonAccumulator]) -> dict:
    """Write seasons/{year}.json. Returns {year: baselines} for percentile use.

    Defence baselines are three groups via DEF_POSITION_GROUPS (DL/LB/DB),
    never one merged group. Runs before build_player_files: season-row
    percentiles are computed against these baselines.
    """
    all_baselines = {}
    for year, acc in sorted(accs.items()):
        rows = []
        pids = {pid for (pid, gt) in acc.stats if not isinstance(pid, tuple) and gt == "REG"}
        pids |= {pid for (pid, gt) in acc.pools if not isinstance(pid, tuple) and gt == "REG"}
        for pid in pids:
            row = _season_row(acc, pid, "REG")
            if row:
                rows.append(row)

        baselines = {}
        for grp, (qkey, qmin) in QUALIFIERS.items():
            qualified = []
            for row in rows:
                if position_group(row["pos"] or "") != grp:
                    continue
                flat = dict(row["stats"])
                for k, v in (row.get("advanced") or {}).items():
                    if k != "ngs" and v is not None:
                        flat[k] = v
                if flat.get(qkey, 0) >= qmin:
                    qualified.append(flat)
            if len(qualified) < MIN_BASELINE_N:
                continue
            stats_bl = {}
            for k in sorted(POSITION_STAT_SETS[grp]):
                if k in RATE_STATS:
                    # rates: only players the rate exists for
                    vals = np.array([q[k] for q in qualified if k in q], dtype=float)
                else:
                    # counting stats: a qualified player without the key has a
                    # real zero — include it, or sparse stats (a DL's INTs)
                    # get baselined only against players who recorded one
                    vals = np.array([q.get(k, 0) for q in qualified], dtype=float)
                if len(vals) < MIN_BASELINE_N:
                    continue
                grid = np.percentile(vals, PERCENTILE_GRID)
                stats_bl[k] = {"mean": _f(vals.mean()), "std": _f(vals.std(ddof=0)),
                               "p": [_f(v) for v in grid]}
            baselines[grp] = {"qualifier": f"{qkey} >= {qmin}", "n": len(qualified),
                              "stats": stats_bl}

        league = _league_block(year)
        write_json(DATA_DIR / "seasons" / f"{year}.json",
                   {"schema_version": SCHEMA_VERSION, "season": year,
                    "league": league, "baselines": baselines})
        all_baselines[year] = baselines
        counts = ", ".join(f"{g}:{b['n']}" for g, b in sorted(baselines.items()))
        print(f"  [{year}] seasons/{year}.json written ({counts})")
    return all_baselines


def _league_block(year: int) -> dict:
    pbp = fetch_pbp(year)
    reg = pbp[pbp.season_type == "REG"]
    plays = reg[(reg.pass_attempt == 1) | (reg.rush_attempt == 1)]
    sched = fetch_schedules(year)
    sreg = sched[sched.game_type == "REG"]
    out = {
        "games": int(len(sreg)),
        "points": int((sreg.home_score + sreg.away_score).sum()),
        "stats": {
            "plays": int(len(plays)),
            "pass_att": int((plays.pass_attempt == 1).sum()),
            "rush_att": int((plays.rush_attempt == 1).sum()),
            "pass_yds": int(reg.passing_yards.sum()) if "passing_yards" in reg else None,
            "pass_rate": _f((plays.pass_attempt == 1).mean()),
            "epa_per_play": _f(plays.epa.mean()),
        },
    }
    if out["stats"]["pass_yds"] is None:
        out["stats"]["pass_yds"] = int(reg[reg.complete_pass == 1].yards_gained.sum())
    del pbp
    return out


def _apply_percentiles(row: dict, baselines_for_year: dict) -> None:
    grp = position_group(row["pos"] or "")
    bl = (baselines_for_year or {}).get(grp)
    if not bl:
        return
    flat = dict(row["stats"])
    for k, v in (row.get("advanced") or {}).items():
        if k != "ngs" and v is not None:
            flat[k] = v
    # Sub-qualifier seasons (Mahomes 2017: 1 game) get no percentiles — a
    # 35-attempt season measured against full-season starters is noise. {}
    # here matches how POST rows behave.
    qkey, qmin = QUALIFIERS[grp]
    if flat.get(qkey, 0) < qmin:
        return
    allowed = POSITION_STAT_SETS[grp]
    pct = {}
    for k, v in flat.items():
        if k in allowed and k in bl["stats"]:
            pct[k] = round(percentile_from_grid(float(v), bl["stats"][k]["p"], k), 1)
    row["percentiles"] = pct


def _career_block(season_rows: list[dict], pools_by_season: list[dict], pos_latest: str) -> dict | None:
    if not season_rows:
        return None
    stats = defaultdict(float)
    games = 0
    for row in season_rows:
        games += row["games"]
        for k, v in row["stats"].items():
            if k in ("snap_share", "target_share", "air_yds_share"):
                continue
            if k == "fg_long":
                stats[k] = max(stats[k], v)
            else:
                stats[k] += v
    out_stats = {k: (int(round(v)) if k in INT_STATS else _f(v)) for k, v in stats.items() if v != 0}
    pooled = defaultdict(float)
    for p in pools_by_season:
        for k, v in p.items():
            pooled[k] += v
    adv = _advanced_from_pools(pooled, pos_latest)
    career = {"games": games, "stats": out_stats}
    if adv:
        # pooled denominators, per the schema's auditability rule
        if pos_latest == "QB":
            if "epa_per_play" in adv:
                adv["n_plays"] = int(pooled["qb_plays"])
            if "cpoe" in adv:
                adv["n_att"] = int(pooled["cpoe_n"])
        elif "epa_per_play" in adv:
            adv["n_plays"] = int(pooled["skill_plays"])
        career["advanced"] = adv
    return career


def build_player_files(accs: dict[int, SeasonAccumulator], all_baselines: dict,
                       player_ids: list[str], verbose: bool = True):
    """Write players/{id}.json for the given ids. Baselines must already exist.

    Returns (index_entries, failed_ids) — index entries feed players/index.json.
    """
    players = fetch_players()
    players = players.set_index("gsis_id")
    index_entries, failed = [], []
    last_built_season = max(accs)
    for pid in player_ids:
        try:
            ident = players.loc[pid]
        except KeyError:
            failed.append((pid, "not in players master"))
            continue
        if isinstance(ident, pd.DataFrame):
            ident = ident.iloc[0]
        season_rows, post_rows = [], []
        reg_pools, post_pools = [], []
        game_logs = []
        teams_seen = []
        pos_latest = str(ident.get("position") or "")
        for year, acc in sorted(accs.items()):
            for gtype, rows_list, pools_list in (("REG", season_rows, reg_pools),
                                                 ("POST", post_rows, post_pools)):
                row = _season_row(acc, pid, gtype)
                if row:
                    if gtype == "REG":
                        _apply_percentiles(row, all_baselines.get(year, {}))
                    rows_list.append(row)
                    pools_list.append(dict(acc.pools.get((pid, gtype), {})))
                    for t in row["teams"]:
                        if t not in teams_seen:
                            teams_seen.append(t)
            for week in sorted(acc.logs.get(pid, {})):
                log = acc.logs[pid][week]
                log["stats"] = {k: (int(round(v)) if k in INT_STATS else _f(v))
                                for k, v in log["stats"].items() if v != 0}
                if log["stats"]:
                    game_logs.append(log)

        if not season_rows and not post_rows:
            failed.append((pid, "no data in window"))
            continue

        draft = None
        if not pd.isna(ident.get("draft_year")):
            draft = {"year": int(ident.draft_year), "round": int(ident.draft_round),
                     "pick": int(ident.draft_pick), "team": ident.draft_team}
        profile = {
            "name": ident.display_name, "pos": pos_latest,
            "dob": str(ident.birth_date) if not pd.isna(ident.get("birth_date")) else None,
            "height_in": int(ident.height) if not pd.isna(ident.get("height")) else None,
            "weight_lb": int(ident.weight) if not pd.isna(ident.get("weight")) else None,
            "college": ident.college_name if not pd.isna(ident.get("college_name")) else None,
            "draft": draft,
            "headshot": ident.headshot if not pd.isna(ident.get("headshot")) else None,
            "teams": teams_seen,
        }
        doc = {"schema_version": SCHEMA_VERSION, "id": pid, "profile": profile,
               "seasons": sorted(season_rows + post_rows,
                                 key=lambda r: (r["season"], r["game_type"] != "REG"))}
        career = _career_block(season_rows, reg_pools, pos_latest)
        if career:
            doc["career"] = career
        career_post = _career_block(post_rows, post_pools, pos_latest)
        if career_post:
            doc["career_post"] = career_post
        doc["game_logs"] = game_logs
        path = DATA_DIR / "players" / f"{pid}.json"
        write_json(path, doc)
        if verbose:
            print(f"  wrote {path.relative_to(REPO_ROOT)} "
                  f"({len(season_rows)} REG + {len(post_rows)} POST seasons, {len(game_logs)} logs)")

        all_rows = season_rows + post_rows
        first_season = min(r["season"] for r in all_rows)
        last_season = max(r["season"] for r in all_rows)
        latest = max(all_rows, key=lambda r: (r["season"], r["game_type"] == "REG"))
        index_entries.append({
            "id": pid, "name": profile["name"], "pos": pos_latest or None,
            "team": latest["team"], "first_season": first_season,
            "last_season": last_season, "active": last_season == last_built_season,
            "headshot": profile["headshot"],
        })
    return index_entries, failed


def build_player_index(index_entries: list[dict]) -> Path:
    """Write players/index.json — the eagerly-loaded search index."""
    entries = sorted(index_entries, key=lambda e: e["name"])
    path = DATA_DIR / "players" / "index.json"
    write_json(path, {"schema_version": SCHEMA_VERSION, "players": entries})
    return path


def build_team_files(accs, seasons) -> None:
    """Phase 3: write teams/index.json and teams/{abbr}.json."""


# Inspection sample: Mahomes by id; the rest resolved by name+position.
# Kelce/Adams/Donald all pre-date 2016, exercising the NGS-null path.
SAMPLE_IDS = ["00-0033873"]
SAMPLE_NAMES = [("Derrick Henry", "RB"), ("Davante Adams", "WR"),
                ("Travis Kelce", "TE"), ("Aaron Donald", "DL")]


def resolve_sample_ids() -> list[str]:
    players = fetch_players()
    ids = list(SAMPLE_IDS)
    for name, pos in SAMPLE_NAMES:
        m = players[(players.display_name == name) & (players.position == pos)]
        if len(m) == 1:
            ids.append(m.iloc[0].gsis_id)
        else:
            print(f"  !! could not uniquely resolve {name} ({pos}): {len(m)} matches")
    return ids


# -----------------------------------------------------------------------------


def build(seasons: list[int], sample: bool, players_filter: list[str]) -> None:
    print(f"Building seasons {seasons[0]}-{seasons[-1]} -> {DATA_DIR}")
    accs = {y: process_season(y) for y in seasons}

    # Order matters: baselines first — player-file percentiles depend on them.
    all_baselines = build_season_aggregates(accs)

    full_run = not (players_filter or sample)
    if players_filter:
        ids = players_filter
    elif sample:
        ids = resolve_sample_ids()
    else:
        ids = sorted({pid for acc in accs.values()
                      for src in (acc.stats, acc.pools, acc.games)
                      for (pid, _t) in src
                      if isinstance(pid, str)})
    index_entries, failed = build_player_files(accs, all_baselines, ids,
                                               verbose=not full_run)
    if full_run:
        # a partial build would produce a misleadingly small index
        idx_path = build_player_index(index_entries)
        print(f"  wrote {idx_path.relative_to(REPO_ROOT)} "
              f"({len(index_entries)} players, {idx_path.stat().st_size / 1024:.0f} KB)")
    if failed:
        reasons = defaultdict(int)
        for _pid, why in failed:
            reasons[why] += 1
        print(f"  {len(failed)} players failed to build: "
              + ", ".join(f"{why} x{n}" for why, n in reasons.items()))
        for pid, why in failed[:10]:
            print(f"    e.g. {pid}: {why}")
    build_team_files(accs, seasons)

    # meta.json: merge seasons with any existing build so a partial refresh
    # (--seasons 2025) doesn't clobber the recorded coverage
    meta_path = DATA_DIR / "meta.json"
    known = set(seasons)
    if meta_path.exists():
        try:
            known |= set(json.loads(meta_path.read_text())["seasons"])
        except (json.JSONDecodeError, KeyError):
            pass
    write_json(meta_path, {
        "schema_version": SCHEMA_VERSION,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "seasons": sorted(known),
        "first_ngs_season": FIRST_NGS_SEASON,
        "source": "nfl-data-py (nflverse)",
    })
    print("Done.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--seasons", type=int, nargs="+", default=ALL_SEASONS, metavar="YEAR",
                        help="seasons to (re)build (default: 2015-2025)")
    parser.add_argument("--sample", action="store_true",
                        help="write player files for the inspection sample only")
    parser.add_argument("--players", nargs="+", default=[], metavar="GSIS_ID",
                        help="write player files for these ids only")
    args = parser.parse_args()

    bad = [s for s in args.seasons if s not in ALL_SEASONS]
    if bad:
        parser.error(f"seasons outside the 2015-2025 window: {bad}")

    build(sorted(args.seasons), args.sample, args.players)


if __name__ == "__main__":
    main()
