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
      "game_type": "REG",            // "REG" or "POST" — see "Playoff aggregation" below
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
        "pass_yds": 88, "epa_per_play": 91   // method: see "Percentiles" below
      }
    }
  ],

  "career": {                        // regular season only, across built seasons
    "games": 128,
    "stats": { "pass_att": 4523, "pass_cmp": 2934, "pass_yds": 35104, "pass_td": 261 },
    "advanced": {                    // pooled from raw plays — see "Career blocks"
      "epa_per_play": 0.13, "n_plays": 4980,
      "cpoe": 2.1, "n_att": 4523,
      "adot": 7.2,
      "yac_oe": 0.4
    }
  },
  "career_post": { /* same shape as career; omitted if no playoff games */ },

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

### Career blocks

- **`career.stats` must contain every counting key that appears in any of the
  player's season rows** — otherwise career ratios (completion %, Y/A, catch
  rate, …) are underivable. Ratios themselves are not stored at career level;
  clients derive them from the counting keys.
- **`career.advanced` is pooled over raw plays, never averaged over seasons.**
  Career EPA/play = `sum(epa) / sum(plays)` across every built play for the
  player; likewise CPOE over attempts, aDOT as `sum(air_yds) / sum(att)`. Each
  rate is stored alongside the denominator it was pooled over (`n_plays`,
  `n_att`) so consumers can audit or re-derive. Re-weighting season values
  client-side is an approximation — the build has the play-by-play, so it
  computes the exact figure.
- **Career NGS is intentionally omitted in v1.** NGS metrics arrive as
  season-level aggregates (not play-level), so any career figure would be a
  soft weighted average. NGS displays at season granularity only. This is a
  decision, not a gap.

### Playoff aggregation

Playoff production is aggregated at build time even though the UI may surface
it later — the games are in hand and losing the data is the expensive mistake.

- **Season rows:** up to two rows per season, distinguished by `game_type`:
  a `"REG"` row always, plus a `"POST"` row (same shape) only for seasons in
  which the player appeared in a playoff game.
- **Career:** `career` remains regular-season only. A parallel `career_post`
  (identical shape, including pooled `advanced`) is present only if the player
  has any playoff games — code paths that only care about the regular season
  never see it.
- `game_logs` continues to hold all games, tagged `REG` / `WC` / `DIV` /
  `CON` / `SB`; the `POST` season row aggregates the non-`REG` types.

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
    "WR": {}, "TE": {}, "K": {},
    "DL": {}, "LB": {}, "DB": {}    // defence is three groups, never one
  }
}
```

### Defensive baseline groups

Defence is **never** a single baseline population — a cornerback's INTs and a
defensive tackle's are different distributions, and a merged percentile is
misleading. Roster positions map to three groups:

| Group | Roster positions | Character |
|---|---|---|
| `DL` | DE, DT, NT, EDGE | pass rush / run stop |
| `LB` | ILB, OLB, MLB, LB | second level |
| `DB` | CB, S, FS, SS, DB | coverage |

Known coarse edge (accepted for v1): nflverse positions blur edge rushers
across DL/OLB, so some 3-4 OLBs land in `LB` while playing a `DL`-shaped role.

### Percentiles — one method, one direction convention

There is exactly **one** percentile method, used identically by the build step
(pre-computed season-row `percentiles`, Phase 1) and by any client-side
computation (era-adjusted comparisons, Phase 2) — otherwise a profile badge
would disagree with the same player's standing in a comparison view.

- **Method: empirical linear interpolation on the stored 7-point grid**
  `p = [p5, p10, p25, p50, p75, p90, p95]`. No z-scores for badges — the
  grid handles skewed counting stats (TDs, sacks) far better. `mean`/`std`
  stay in the file for *context display only* ("1.2 SD above average").
- **Tail rule: clamp to the grid edges.** Values below p5 report 5 and render
  as `<5`; above p95 report 95 and render as `95+`. No fake precision at the
  extremes.
- **Direction:** higher is not always better. Stats in the `negative_stats`
  set (see stat dictionary) are inverted — `pct = 100 − raw_pct` — so a low
  interception count reads as a *good* percentile.
- The reference implementation is `percentile_from_grid()` in
  `ingest/build.py`; a TypeScript port for Phase 2 must match it
  case-for-case.

**Build ordering:** all `seasons/{year}.json` baselines are computed **before**
any player files, because season-row percentiles are computed against them.

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

**Direction (`negative_stats`).** These keys are *bad when high*; the
percentile function inverts them (`pct = 100 − raw_pct`) so badges read
correctly:

```
pass_int, sacks, sack_yds, rush_fumbles
```

Every other key is neutral-or-good when high. Any new key added later must be
classified at the same time. The canonical set lives as `NEGATIVE_STATS` in
`ingest/build.py`.

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
