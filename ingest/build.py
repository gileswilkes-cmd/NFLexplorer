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
    "CB": "DB", "S": "DB", "FS": "DB", "SS": "DB", "SAF": "DB", "DB": "DB",
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
        if not _qualifies_for_index(all_rows):
            continue  # file written above; just no search-index entry
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


def _qualifies_for_index(all_rows: list[dict]) -> bool:
    """Appearance filter for the search index only — player FILES are written
    for everyone and stay reachable by direct URL. An entry requires at least
    one season clearing a real statistical threshold; punters, snap-only
    players (OL), and one-game cameos don't clutter search results.
    """
    for r in all_rows:
        s = r["stats"]
        if (s.get("pass_att", 0) >= 50 or s.get("rush_att", 0) >= 20
                or s.get("targets", 0) >= 20):
            return True
        if s.get("fg_att", 0) >= 5:
            return True
        if (position_group(r["pos"] or "") in ("DL", "LB", "DB")
                and s.get("snaps", 0) >= 200):
            return True
    return False


def build_player_index(index_entries: list[dict]) -> Path:
    """Write players/index.json — the eagerly-loaded search index."""
    entries = sorted(index_entries, key=lambda e: e["name"])
    path = DATA_DIR / "players" / "index.json"
    write_json(path, {"schema_version": SCHEMA_VERSION, "players": entries})
    return path


# --- Phase 3a: team data layer ------------------------------------------------
# Metric definitions: docs/PHASE3A_TEAMS_SPEC.md. Do not improvise them.

FRANCHISE_MAP = {"OAK": "LV", "SD": "LAC", "STL": "LA"}  # relocations in window
# Franchise -> (legacy code, first season at the new home). nflfastR PBP
# retroactively uses CURRENT codes for all seasons; schedules keep era codes.
# We key everything by current code and derive the era code per season row.
RELOCATIONS = {"LV": ("OAK", 2020), "LAC": ("SD", 2017), "LA": ("STL", 2016)}


def era_code(franchise: str, season: int) -> str:
    legacy = RELOCATIONS.get(franchise)
    return legacy[0] if legacy and season < legacy[1] else franchise

# Rankable team metrics (dotted paths into the season block). Direction rule:
# any key containing "allowed" inverts (lower = better = higher percentile).
# Fingerprint axes rank raw — they are style, not quality (a high PROE
# percentile means "more pass-happy than the league", not "better").
TEAM_RANKABLE_OFF = [
    "summary.points_per_game", "summary.yds_per_game", "summary.plays_per_game",
    "summary.epa_per_play", "summary.success_rate",
    "by_play_type.pass.epa_per_play", "by_play_type.rush.epa_per_play",
    "fingerprint.proe", "fingerprint.early_down_pass_rate",
    "fingerprint.neutral_pace_sec", "fingerprint.shotgun_rate", "fingerprint.adot",
    "scheme_splits.deep_shots.rate",
]
TEAM_RANKABLE_DEF = [
    "summary.points_allowed_per_game", "summary.yds_allowed_per_game",
    "summary.epa_per_play_allowed", "summary.success_rate_allowed",
    "by_play_type.pass.epa_per_play_allowed", "by_play_type.rush.epa_per_play_allowed",
    "explosive_rate_allowed", "sack_rate",
]


def team_stat_is_negative(key: str) -> bool:
    return "allowed" in key


def team_percentile(value: float, p: list[float], key: str) -> float:
    """Team wrapper over the one canonical percentile function."""
    pct = percentile_from_grid(value, p, "__team__")  # never in NEGATIVE_STATS
    return 100.0 - pct if team_stat_is_negative(key) else pct


def fetch_team_desc() -> pd.DataFrame:
    import nfl_data_py as ndp
    return _cached("team_desc", ndp.import_team_desc)


def _dig(d: dict, dotted: str):
    cur = d
    for part in dotted.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return None
        cur = cur[part]
    return cur


def _eff(sub: pd.DataFrame, allowed: bool = False, games: int | None = None) -> dict:
    """EPA/play + success rate (+ plays_per_game) for a set of plays."""
    suffix = "_allowed" if allowed else ""
    out = {}
    n = len(sub)
    if n:
        out[f"epa_per_play{suffix}"] = _f(sub.epa.mean())
        out[f"success_rate{suffix}"] = _f((sub.epa > 0).mean())
    if games:
        out["plays_per_game"] = _f(n / games)
    return out


def _neutral_pace(team_neutral: pd.DataFrame, comp: pd.DataFrame) -> float | None:
    """Mean seconds between consecutive offensive snaps, neutral filter,
    excluding snaps that follow clock-stopping events. The spec flags this as
    the fiddliest axis: the guards here are (same game, same drive, previous
    play kept the clock moving, gap in a sane 5-45s window)."""
    if team_neutral.empty:
        return None
    # order of the full competitive frame preserves play order within game
    comp = comp.sort_values(["game_id", "fixed_drive", "game_seconds_remaining"],
                            ascending=[True, True, False])
    prev = comp.shift(1)
    same_ctx = (comp.game_id == prev.game_id) & (comp.fixed_drive == prev.fixed_drive) \
        & (comp.posteam == prev.posteam)
    clock_ran = (prev.incomplete_pass != 1) & (prev.out_of_bounds != 1) \
        & (prev.timeout != 1) & (prev.penalty != 1)
    gap = prev.game_seconds_remaining - comp.game_seconds_remaining
    ok = same_ctx & clock_ran & gap.between(5, 45) & comp.index.isin(team_neutral.index)
    vals = gap[ok]
    return round(float(vals.mean()), 1) if len(vals) >= 50 else None


def _down_distance(sub: pd.DataFrame, allowed: bool) -> dict:
    out = {}
    dd = sub[sub.down.notna()]
    buckets = [("short", dd.ydstogo <= 3), ("medium", dd.ydstogo.between(4, 6)),
               ("long", dd.ydstogo >= 7)]
    for down in (1, 2, 3, 4):
        for bname, bmask in buckets:
            cell = dd[(dd.down == down) & bmask]
            entry = _eff(cell, allowed)
            entry["plays"] = len(cell)
            out[f"{down}_{bname}"] = entry
    return out


def _team_season_metrics(year: int) -> dict[str, dict]:
    """One season block (spec shape, minus percentiles) per team code."""
    pbp = fetch_pbp(year)
    reg = pbp[pbp.season_type == "REG"]
    plays = reg[((reg["pass"] == 1) | (reg["rush"] == 1)) & (reg.play_type != "no_play")]
    comp = plays[(plays.qb_kneel != 1) & (plays.qb_spike != 1)]
    neutral = comp[(comp.wp >= 0.2) & (comp.wp <= 0.8) & (comp.half_seconds_remaining > 120)]
    del pbp

    sched = fetch_schedules(year)
    sreg = sched[(sched.game_type == "REG") & sched.home_score.notna()].copy()
    # schedules use era codes (STL/SD/OAK); PBP uses current codes — normalize
    sreg["home_team"] = sreg.home_team.replace(FRANCHISE_MAP)
    sreg["away_team"] = sreg.away_team.replace(FRANCHISE_MAP)

    out = {}
    for code in sorted(comp.posteam.dropna().unique()):
        off = comp[comp.posteam == code]
        dfn = comp[comp.defteam == code]
        noff = neutral[neutral.posteam == code]
        home = sreg[sreg.home_team == code]
        away = sreg[sreg.away_team == code]
        games = len(home) + len(away)
        if games == 0 or off.empty:
            continue
        pf = home.home_score.sum() + away.away_score.sum()
        pa = home.away_score.sum() + away.home_score.sum()
        w = int((home.home_score > home.away_score).sum() + (away.away_score > away.home_score).sum())
        t = int((home.home_score == home.away_score).sum() + (away.away_score == away.home_score).sum())

        offense: dict = {"summary": {
            "points_per_game": _f(pf / games),
            "yds_per_game": _f(off.yards_gained.sum() / games),
            **_eff(off, games=games),
        }}
        offense["by_play_type"] = {
            "pass": _eff(off[off["pass"] == 1], games=games),
            "rush": _eff(off[off["rush"] == 1], games=games),
        }

        # fingerprint (neutral filter for tendency/tempo; competitive elsewhere)
        atts = off[(off.pass_attempt == 1) & off.air_yards.notna()]
        rd = off[(off["rush"] == 1) & off.run_location.isin(["left", "middle", "right"])]
        rd_n = len(rd)
        offense["fingerprint"] = {
            "proe": _f(noff["pass"].mean() - noff.xpass.mean()) if len(noff) else None,
            "early_down_pass_rate": _f(noff[noff.down.isin([1, 2])]["pass"].mean()) if len(noff) else None,
            "neutral_pace_sec": _neutral_pace(noff, comp),
            "shotgun_rate": _f(off.shotgun.mean()),
            "adot": round(float(atts.air_yards.mean()), 1) if len(atts) else None,
            "run_dir": {k: _f((rd.run_location == k).sum() / rd_n) for k in ("left", "middle", "right")} if rd_n else None,
            # share of rushes with a known direction — run_dir normalizes over
            # these only (league-wide ~99%; documented exclusion)
            "run_dir_known": _f(rd_n / int((off["rush"] == 1).sum())) if (off["rush"] == 1).any() else None,
        }

        # scheme cross-tabs
        gun = off[off.shotgun == 1]
        uc = off[off.shotgun != 1]
        ed = off[off.down.isin([1, 2])]
        deep = atts[atts.air_yards >= 20]
        # pass_heavy_vs_balanced: game-level buckets by neutral pass rate
        # (games with <10 neutral plays fall back to competitive pass rate)
        rates = []
        for gid, g in off.groupby("game_id"):
            ng = noff[noff.game_id == gid]
            rates.append((gid, float(ng["pass"].mean()) if len(ng) >= 10 else float(g["pass"].mean())))
        rates.sort(key=lambda x: -x[1])
        n_heavy = max(1, -(-len(rates) // 3))  # top third, ceil
        heavy_ids = {gid for gid, _ in rates[:n_heavy]}
        heavy = off[off.game_id.isin(heavy_ids)]
        balanced = off[~off.game_id.isin(heavy_ids)]
        offense["scheme_splits"] = {
            "shotgun_vs_under_center": {
                "shotgun": {**_eff(gun), "plays": len(gun)},
                "under_center": {**_eff(uc), "plays": len(uc)},
            },
            "early_down_pass_vs_run": {
                "pass": {**_eff(ed[ed["pass"] == 1]), "plays": int((ed["pass"] == 1).sum())},
                "rush": {**_eff(ed[ed["rush"] == 1]), "plays": int((ed["rush"] == 1).sum())},
            },
            "pass_heavy_vs_balanced": {
                "pass_heavy": {**_eff(heavy), "games": len(heavy_ids)},
                "balanced": {**_eff(balanced), "games": len(rates) - len(heavy_ids)},
            },
            "deep_shots": {
                "rate": _f(len(deep) / len(atts)) if len(atts) else None,
                **_eff(deep), "attempts": len(deep),
            },
        }
        offense["down_distance"] = _down_distance(off, allowed=False)

        opp_dropbacks = int((dfn.qb_dropback == 1).sum())
        defense = {
            "summary": {
                "points_allowed_per_game": _f(pa / games),
                "yds_allowed_per_game": _f(dfn.yards_gained.sum() / games),
                **_eff(dfn, allowed=True),
            },
            "by_play_type": {
                "pass": _eff(dfn[dfn["pass"] == 1], allowed=True),
                "rush": _eff(dfn[dfn["rush"] == 1], allowed=True),
            },
            "explosive_rate_allowed": _f((dfn.yards_gained >= 20).mean()),
            "sack_rate": _f(int(dfn.sack.sum()) / opp_dropbacks) if opp_dropbacks else None,
            "down_distance": _down_distance(dfn, allowed=True),
        }

        out[code] = {
            "season": year, "code": era_code(code, year), "games": games,
            "record": {"w": w, "l": games - w - t, "t": t},
            "offense": offense, "defense": defense,
        }
    return out


def _team_baselines(season_metrics: dict[str, dict]) -> dict:
    """7-point grids over the 32 team values, same shape as player baselines."""
    out = {"offense": {}, "defense": {}}
    for side, keys in (("offense", TEAM_RANKABLE_OFF), ("defense", TEAM_RANKABLE_DEF)):
        for key in keys:
            vals = []
            for block in season_metrics.values():
                v = _dig(block[side], key)
                if isinstance(v, (int, float)):
                    vals.append(float(v))
            if len(vals) < 16:  # a real league-wide metric or nothing
                continue
            arr = np.array(vals)
            out[side][key] = {"mean": _f(arr.mean()), "std": _f(arr.std(ddof=0)),
                              "p": [_f(v) for v in np.percentile(arr, PERCENTILE_GRID)]}
    return out


def _apply_team_percentiles(block: dict, baselines: dict) -> None:
    pct: dict = {"offense": {}, "defense": {}}
    for side, keys in (("offense", TEAM_RANKABLE_OFF), ("defense", TEAM_RANKABLE_DEF)):
        for key in keys:
            bl = baselines.get(side, {}).get(key)
            v = _dig(block[side], key)
            if bl and isinstance(v, (int, float)):
                pct[side][key] = round(team_percentile(float(v), bl["p"], key), 1)
    block["percentiles"] = pct


def build_team_files(seasons: list[int], franchises: list[str] | None,
                     sample: bool = False, sample_year: int = 2024) -> list[Path]:
    """Phase 3a team stage. Computes every team's season block (needed for
    baselines regardless), merges team_baselines into seasons/{year}.json, and
    writes teams/{franchise}.json for the requested franchises only.

    sample=True picks the franchises from the data per the 3a spec: most
    pass-heavy + most run-heavy offence by PROE, best defence by EPA/play
    allowed, in sample_year.
    """
    desc = fetch_team_desc().set_index("team_abbr")
    per_year: dict[int, dict[str, dict]] = {}
    for year in seasons:
        print(f"  [teams {year}] aggregating…")
        per_year[year] = _team_season_metrics(year)
        baselines = _team_baselines(per_year[year])
        # merge into the existing season file (schema addition, no bump)
        spath = DATA_DIR / "seasons" / f"{year}.json"
        sdoc = json.loads(spath.read_text(encoding="utf-8")) if spath.exists() else {
            "schema_version": SCHEMA_VERSION, "season": year}
        sdoc["team_baselines"] = baselines
        write_json(spath, sdoc)
        for block in per_year[year].values():
            _apply_team_percentiles(block, baselines)

    if sample:
        picks = select_sample_franchises(per_year[sample_year])
        for role, fr in picks.items():
            code_year = next((b["code"] for b in per_year[sample_year].values()
                              if FRANCHISE_MAP.get(b["code"], b["code"]) == fr), fr)
            detail = per_year[sample_year][code_year]
            proe = _dig(detail["offense"], "fingerprint.proe")
            epa_a = _dig(detail["defense"], "summary.epa_per_play_allowed")
            print(f"  sample pick [{role}]: {fr} ({sample_year} PROE {proe}, "
                  f"EPA/play allowed {epa_a})")
        franchises = sorted(set(picks.values()))
    if franchises == ["all"]:
        franchises = sorted({FRANCHISE_MAP.get(c, c)
                             for year in per_year for c in per_year[year]})
    if franchises is None:
        return []
    written = []
    for fr in franchises:
        rows = []
        for year in seasons:
            for code, block in per_year[year].items():
                if FRANCHISE_MAP.get(code, code) == fr:
                    rows.append(block)
        if not rows:
            print(f"  !! no seasons found for franchise {fr}")
            continue
        rows.sort(key=lambda b: b["season"])
        name = desc.loc[fr].team_name if fr in desc.index else fr
        colors = None
        if fr in desc.index:
            colors = {"primary": desc.loc[fr].team_color, "secondary": desc.loc[fr].team_color2}
        doc = {"schema_version": SCHEMA_VERSION, "franchise": fr, "name": name,
               "colors": colors, "seasons": rows}
        path = DATA_DIR / "teams" / f"{fr}.json"
        write_json(path, doc)
        written.append((fr, doc))
        print(f"  wrote {path.relative_to(REPO_ROOT)} ({len(rows)} seasons)")

    if len(written) > 8:  # full-run: emit the teams index for /teams
        entries = []
        for fr, doc in sorted(written):
            last = doc["seasons"][-1]
            entries.append({"franchise": fr, "name": doc["name"], "colors": doc["colors"],
                            "latest": {"season": last["season"], "record": last["record"]}})
        ipath = DATA_DIR / "teams" / "index.json"
        write_json(ipath, {"schema_version": SCHEMA_VERSION, "teams": entries})
        print(f"  wrote {ipath.relative_to(REPO_ROOT)} ({len(entries)} franchises)")
    return [p for p, _ in written]


def select_sample_franchises(per_year_metrics: dict[str, dict]) -> dict[str, str]:
    """Most pass-heavy + most run-heavy by PROE, best defence by EPA allowed."""
    proe = {c: _dig(b["offense"], "fingerprint.proe") for c, b in per_year_metrics.items()}
    proe = {c: v for c, v in proe.items() if v is not None}
    epa_allowed = {c: _dig(b["defense"], "summary.epa_per_play_allowed")
                   for c, b in per_year_metrics.items()}
    picks = {
        "pass_heavy": max(proe, key=proe.get),
        "run_heavy": min(proe, key=proe.get),
        "best_defense": min(epa_allowed, key=epa_allowed.get),
    }
    return {role: FRANCHISE_MAP.get(code, code) for role, code in picks.items()}


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
    # Team stage (Phase 3b will hook the full 32-franchise run in here);
    # for now teams build only via --teams / --teams-sample.

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
    parser.add_argument("--teams", nargs="+", default=None, metavar="FRANCHISE",
                        help="run ONLY the team stage for these franchise codes")
    parser.add_argument("--teams-sample", action="store_true",
                        help="run ONLY the team stage; pick sample franchises from the data")
    args = parser.parse_args()

    bad = [s for s in args.seasons if s not in ALL_SEASONS]
    if bad:
        parser.error(f"seasons outside the 2015-2025 window: {bad}")

    if args.teams or args.teams_sample:
        build_team_files(sorted(args.seasons), args.teams, sample=args.teams_sample)
        return

    build(sorted(args.seasons), args.sample, args.players)


if __name__ == "__main__":
    main()
