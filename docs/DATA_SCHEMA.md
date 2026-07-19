# NFL Explorer — JSON data schema (v1)

This is the contract between the Python build step (`ingest/build.py`) and the
Next.js app. It is the expensive thing to change later, so it is decided here,
up front. Every file carries `"schema_version": 1`; any breaking change bumps
the version in `build.py` and in this document together.

## Ground rules

- **Location:** everything lives under `public/data/`, committed to the repo.
  Files are served statically by Next.js, so the client can `fetch("/data/…")`
  with no API routes and no secrets.
- **Compact, pre-aggregated JSON only.** Raw play-by-play never appears here —
  it is aggregated at build time into the per-player / per-season numbers below.
- **Per-entity files.** The client loads one small file per view (one player,
  one season baseline), never a monolith. Only `players/index.json` is loaded
  eagerly, so it stays lean.
- **Stat keys** are flat `snake_case` maps (see the stat dictionary below).
  Keys that don't apply to a player/position are **omitted**; a key that
  applies but has no data for that era is **`null`** (the 2015 NGS case).
  The UI renders `null` as "n/a", never as 0.
- **Player IDs** are nflverse GSIS ids (e.g. `"00-0033873"`) — the stable key
  across every nfl-data-py table. Team codes are nflverse abbreviations
  (`KC`, `BUF`, …).
- Seasons are calendar years `2015`–`2025`. `week` uses nflverse numbering
  (regular season 1–18, then playoffs); `game_type` distinguishes
  `REG` / `WC` / `DIV` / `CON` / `SB`.

## File tree

```
public/data/
  meta.json                 build metadata (when, which seasons, schema version)
  players/
    index.json              search index — every player, minimal fields
    {gsis_id}.json          one file per player: profile, seasons, career, game logs
  seasons/
    {year}.json             league-wide aggregates & percentile baselines for that season
  teams/                    (Phase 3 — reserved, not written yet)
```

---

## `meta.json`

```jsonc
{
  "schema_version": 1,
  "generated_at": "2026-07-19T12:00:00+00:00",  // UTC ISO-8601
  "seasons": [2015, 2016, /* … */ 2025],        // seasons present in this build
  "first_ngs_season": 2016,
  "source": "nfl-data-py (nflverse)"
}
```

---

## `players/index.json` — search index

One entry per player who appears in any built season. This file is loaded on
app start for search/autocomplete, so entries carry only what search and a
result row need. Everything else lives in the per-player file.

```jsonc
{
  "schema_version": 1,
  "players": [
    {
      "id": "00-0033873",            // GSIS id == filename of the detail file
      "name": "Patrick Mahomes",
      "pos": "QB",                   // primary position (latest season)
      "team": "KC",                  // most recent team; null if not on a roster
      "first_season": 2017,          // within the 2015–2025 window
      "last_season": 2025,
      "active": true,
      "headshot": "https://…"        // nflverse headshot URL; null if none
    }
  ]
}
```

---

## `players/{gsis_id}.json` — per-player file

Everything one player's profile page needs: identity, season-by-season rows,
career totals, and game logs.

```jsonc
{
  "schema_version": 1,
  "id": "00-0033873",
  "profile": {
    "name": "Patrick Mahomes",
    "pos": "QB",
    "dob": "1995-09-17",             // null if unknown
    "height_in": 74,                 // inches; null if unknown
    "weight_lb": 225,                // pounds; null if unknown
    "college": "Texas Tech",         // null if unknown
    "draft": {                       // null for undrafted
      "year": 2017, "round": 1, "pick": 10, "team": "KC"
    },
    "headshot": "https://…",         // null if none
    "teams": ["KC"]                  // every team within the window, chronological
  },

  "seasons": [                       // one row per season played, ascending
    {
      "season": 2024,
      "team": "KC",                  // team of most games that season
      "teams": ["KC"],               // all teams (mid-season trades)
      "pos": "QB",                   // position that season
      "games": 16,
      "game_type": "REG",            // season rows aggregate regular season only
      "stats": { /* stat dictionary keys, e.g. */
        "pass_att": 581, "pass_yds": 3928, "pass_td": 26, "pass_int": 11,
        "snaps": 1108, "snap_share": 0.98
      },
      "advanced": {                  // aggregated from PBP + NGS at build time
        "epa_per_play": 0.11,
        "cpoe": 1.9,
        "adot": 6.9,
        "ngs": {                     // null (whole object) for 2015 — NGS starts 2016
          "avg_time_to_throw": 2.83,
          "avg_separation": null     // key present but null = not tracked for this pos
        }
      },
      "percentiles": {               // 0–100 vs same-position qualifiers that season;
        "pass_yds": 88, "epa_per_play": 91   // computed against seasons/{year}.json
      }
    }
  ],

  "career": {                        // sums/weighted rates across built seasons (REG)
    "games": 128,
    "stats": { "pass_att": 4523, "pass_yds": 35104, "pass_td": 261 }
  },

  "game_logs": [                     // one row per game, ascending (season, week)
    {
      "season": 2024, "week": 11, "game_type": "REG",
      "date": "2024-11-17",
      "team": "KC", "opp": "BUF", "home": false,
      "stats": { "pass_att": 42, "pass_yds": 292, "pass_td": 3 }
    }
  ]
}
```

`percentiles` is reserved and may be an empty object `{}` until Phase 1 wires
up the baseline computation — the shape is fixed now so the UI can build
against it.

---

## `seasons/{year}.json` — season aggregates

League context for one season: totals for trend charts (Phase 4) and
per-position baselines that power percentile badges (Phase 1) and
era-adjusted comparisons (Phase 2).

```jsonc
{
  "schema_version": 1,
  "season": 2024,
  "league": {                        // league-wide REG totals & rates
    "games": 272,
    "stats": { "pass_att": 17434, "pass_yds": 119876, "plays": 34980,
               "pass_rate": 0.58, "epa_per_play": 0.02 }
  },
  "baselines": {                     // per position group, qualified players only
    "QB": {
      "qualifier": "pass_att >= 150",   // human-readable inclusion rule
      "n": 34,                          // players meeting it
      "stats": {
        "pass_yds": {
          "mean": 3410.2,
          "std": 812.5,
          "p": [1990, 2450, 2903, 3388, 3910, 4306, 4790]
          // fixed percentile grid: p5, p10, p25, p50, p75, p90, p95
        },
        "epa_per_play": { "mean": 0.04, "std": 0.09, "p": [/* … */] }
      }
    },
    "RB": { /* same shape, rushing/receiving keys */ },
    "WR": {}, "TE": {}, "DEF": {}, "K": {}
  }
}
```

The percentile grid is always the same seven points
(`p5, p10, p25, p50, p75, p90, p95`) so the client can interpolate a player's
percentile from `p` + `mean`/`std` without per-stat special cases.

---

## Stat dictionary (position-aware sets)

All stat maps (`stats` in season rows, career, game logs, baselines) draw
from one shared dictionary. Counting stats are integers; rates/shares are
floats (shares are 0–1 fractions, not percentages).

| Group | Keys |
|---|---|
| Passing | `pass_att`, `pass_cmp`, `pass_yds`, `pass_td`, `pass_int`, `sacks`, `sack_yds`, `pass_air_yds`, `pass_yac` |
| Rushing | `rush_att`, `rush_yds`, `rush_td`, `rush_fumbles` |
| Receiving | `targets`, `rec`, `rec_yds`, `rec_td`, `rec_air_yds`, `rec_yac`, `target_share`, `air_yds_share` |
| Usage | `snaps`, `snap_share` |
| Defense | `tackles`, `tackles_solo`, `tfl`, `def_sacks`, `qb_hits`, `def_int`, `pass_defended`, `ff`, `fr`, `def_td` |
| Kicking | `fg_att`, `fg_made`, `fg_long`, `xp_att`, `xp_made` |
| Returns | `punt_ret`, `punt_ret_yds`, `punt_ret_td`, `kick_ret`, `kick_ret_yds`, `kick_ret_td` |
| Advanced (PBP-derived, all seasons) | `epa_per_play`, `cpoe`, `adot`, `yac_oe` |
| Advanced (NGS, 2016+, under `advanced.ngs`) | `avg_time_to_throw`, `avg_completed_air_yds`, `avg_intended_air_yds`, `avg_separation`, `avg_cushion`, `efficiency`, `avg_speed` |

New keys may be **added** within schema v1; existing keys are never renamed or
re-typed without a version bump.

---

## Size discipline

Rough budgets so the app stays fast: `players/index.json` ≲ 500 KB
(~5k players × ~100 bytes), each `players/{id}.json` ≲ 100 KB even for a
15-year QB with full game logs, each `seasons/{year}.json` ≲ 50 KB. If a file
class outgrows its budget, split it (e.g. move game logs to
`players/{id}/logs.json`) rather than trimming data — but that is a schema
version bump.
