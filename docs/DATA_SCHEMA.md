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
    {year}.json             league aggregates, player baselines, team_baselines
  teams/
    {franchise}.json        one file per franchise, seasons nested (Phase 3a)
  leaderboards/
    season/{year}.json      that season's leaders (players + teams)
    records.json            best single-season performances, pooled 2015-2025
    career.json             career totals within 2015-2025 (players only)
  trends.json               league-wide metric series across 2015-2025 (Phase 4)
  matchups/
    unit_ratings.json        32 teams x 4 units, 2025 EPA/play + league rank
    schedule_2026.json       2026 REG schedule, scores fill in as games are played
    odds_2026.json           pull-and-commit betting lines (Matchups product)
  predictions/
    week_{N}.json            frozen ex ante model + market forecast per game (Matchups product)
    meta.json                merge-not-replace index of which weeks have a snapshot
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
      "qualifier": "pass_att >= 224",   // human-readable inclusion rule
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
| `DL` | DE, DT, NT, EDGE, DL | pass rush / run stop |
| `LB` | ILB, OLB, MLB, LB | second level |
| `DB` | CB, S, FS, SS, DB | coverage |

(Recent nflverse rosters use the coarse codes `DL`/`LB`/`DB` directly; older
seasons use the fine-grained ones. Both map.)

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

## `teams/{franchise}.json` — team file (Phase 3a)

One file per **franchise**, keyed by the current code (`LA`, `LAC`, `LV` for the
relocated ones); each nested season row carries `code` = the code used that
season (`OAK`, `SD`, `STL` pre-relocation). Regular season only. Full metric
definitions — filter regimes, PROE, success rate, pace, the four scheme
cross-tabs, down×distance buckets — live in `docs/PHASE3A_TEAMS_SPEC.md` and
are implemented in `build.py`; this file documents shape and conventions.

```jsonc
{
  "schema_version": 1,
  "franchise": "LV", "name": "Las Vegas Raiders",
  "colors": { "primary": "#000000", "secondary": "#A5ACAF" },
  "seasons": [{
    "season": 2024, "code": "LV", "games": 17,
    "record": { "w": 4, "l": 13, "t": 0 },
    "offense": {
      "summary":       { /* points/yds/plays per game, epa_per_play, success_rate */ },
      "by_play_type":  { "pass": {}, "rush": {} },
      "fingerprint":   { /* proe, early_down_pass_rate, neutral_pace_sec,
                            shotgun_rate, adot, run_dir {left,middle,right} */ },
      "scheme_splits": { /* shotgun_vs_under_center, early_down_pass_vs_run,
                            pass_heavy_vs_balanced (game-level — coarser than
                            the others by construction), deep_shots */ },
      "down_distance": { /* "{down}_{short|medium|long}" -> epa/success/plays */ }
    },
    "defense": { /* results only, *_allowed keys; explosive_rate_allowed,
                    sack_rate; same down_distance grid */ },
    "percentiles": { "offense": { /* dotted keys */ }, "defense": {} }
  }]
}
```

Conventions:
- **A metric that cannot be computed honestly is `null`** (e.g. neutral pace
  with too few clean snap gaps), never a guess.
- **`down_distance` intentionally excludes no-down plays** (two-point
  conversion attempts — a 2pt try has no down). Cell play counts therefore sum
  slightly below total offensive plays; that is correct, not a leak.
- **`run_dir` normalizes over rushes with a known direction only.** Rushes with
  missing `run_location` (~1% league-wide) are excluded; the covered share is
  published alongside as `fingerprint.run_dir_known`.
- **Team percentile direction:** any dotted key containing `allowed` inverts
  (lower = better). Fingerprint axes rank raw — they are style, not quality
  (a high `proe` percentile means "more pass-happy than the league").
  `neutral_pace_sec` ranks raw seconds: high percentile = slower.
- Percentiles use the same `percentile_from_grid` contract via the
  `team_percentile()` wrapper in `build.py`.

### `team_baselines` — addition to `seasons/{year}.json`

Alongside the player `baselines`: `{"offense": {dotted_key: {mean, std, p}},
"defense": {…}}` over the 32 team values, same 7-point grid. Schema addition
within v1 — no version bump.

## `leaderboards/` (Phase 4)

Pre-computed rankings — the browser never sorts thousands of player files
itself. Reads only from already-written `players/`, `teams/`, `seasons/`
output; adds no new ingest path. Definitions: `docs/PHASE4_SPEC.md`.

Three scopes, each a flat file bounded to **~100 entries per category**:

- **`leaderboards/season/{year}.json`** — that single season's leaders.
- **`leaderboards/records.json`** — best single-season performances **pooled
  across 2015–2025** (a player can appear more than once, once per
  qualifying season — this is "best seasons ever in the window", not career
  totals).
- **`leaderboards/career.json`** — **career totals within 2015–2025 only.**
  Every entry in this file is implicitly truncated to the window; the UI
  must display "2015–2025" wherever this file's numbers appear, or a real
  career total will look wrong to anyone who knows the player.

All three share one shape: `{"boards": {position_group: {stat_key: board}}}`
(season/records also carry a `"TEAM"` group; season files add `"season"`,
records/career add `"window": [2015, 2025]`). A **board**:

```jsonc
{
  "label": "EPA per play",
  "direction": "desc",              // "asc" for a lower-is-better board
  "qualifier": "pass_att >= 2500",  // null when the stat needs none
  "entries": [
    { "id": "00-0033873", "name": "Patrick Mahomes", "team": "KC",
      "season": 2024,               // omitted on career.json entries
      "value": 0.251, "rank": 1 }
  ]
}
```

**Negative-rate boards** (interception rate, fumble rate, sack rate — see the
rules below) add three meta keys and two per-entry keys, so the UI can show the
volume behind the percentage rather than a bare rate:

```jsonc
{
  "label": "Interception rate",
  "direction": "asc",
  "qualifier": "pass_att >= 2500",
  "format": "pct",                  // value is a fraction; render 0.0125 as "1.3%"
  "count_label": "INT",             // -> "1.3% (66 INT / 5268 att)"
  "denom_label": "att",
  "entries": [
    { "id": "00-0023459", "name": "Aaron Rodgers", "team": "PIT",
      "value": 0.0125, "count": 66, "denom": 5268, "rank": 1 }
  ]
}
```

`format`/`count_label`/`denom_label` and `count`/`denom` appear **only** on
these boards; their absence means the value is a plain number. Additive, so
`schema_version` stays at 1 — no consumer reads these files yet (Phase 4 Part 3
builds the page).

Team entries use the same shape with `id` = franchise code (linking to
`/teams/{franchise}`) and no `team` field; team boards additionally carry
`"side": "offense"|"defense"` and `"style": true|false` — a `style` board
(the six fingerprint axes) must **never** use the red/blue quality palette
(see the Phase 3b style-vs-quality rule) since a high PROE means "more
pass-happy", not "better".

**Correctness rules baked into the build (`ingest/build.py`), not the UI:**

- **Ranking is always within one canonical position group** (`POSITION_GROUPS`
  / `POSITION_STAT_SETS`) — a stat never mixes positions, so a QB's two career
  catches can never surface on the WR receiving-yards board.
- **Any per-attempt/per-play stat carries a qualifier.** Season boards reuse
  the position's existing `QUALIFIERS` entry (e.g. QB `pass_att >= 224`);
  career boards use a separate, much larger `CAREER_QUALIFIERS` floor set at
  roughly **4+ full seasons of real volume** (QB `pass_att >= 2500`, RB
  `rush_att >= 1000`, WR `targets >= 450`, TE `targets >= 300`, K
  `fg_att >= 80`, DL/LB/DB `snaps >= 3000`). A thin career floor turns a
  "career" rate board into a list of short, low-volume careers.
  Pure counting stats (yards, TDs, tackles) carry no qualifier — most is most.
- **Bad-when-high stats are ranked as rates, never as raw counts.** A "fewest
  INTs" board just ranks whoever threw fewest passes, so `NEGATIVE_RATE_STATS`
  replaces those boards outright: `int_rate` = `pass_int / pass_att`,
  `fumble_rate` = `rush_fumbles / rush_att`, `sack_rate` =
  `sacks / (pass_att + sacks)` (dropbacks). They sort ascending, always carry
  the position qualifier — a 0% rate over 30 attempts is noise, and the
  min-attempts floor is what makes the board real — and each entry carries its
  `count` and `denom` alongside the rate. There is **no "most INTs" / "most
  fumbles" board**, and `sack_yds` gets no board of its own (derivative of
  sacks, which `sack_rate` covers). `NEGATIVE_STATS` still governs percentile
  inversion elsewhere in the schema.
- Regular season only, matching `career`/`QUALIFIERS` elsewhere in the
  schema; playoffs are out of scope for leaderboards.

## `trends.json` (Phase 4)

One league-wide value per metric per season — the "how the NFL changed"
series behind `/history`. Built by `build_trends()` from play-by-play under
**the same filter regime as the team build** (`_trend_frames` mirrors
`_team_season_metrics`: pass/rush plays, no `no_play`, no kneels or spikes;
"neutral" adds win probability 0.2–0.8 outside the final two minutes), so a
trend line and a team page can never disagree about what a play is.
Definitions are frozen across all 11 seasons — that is the point of a series.

```jsonc
{
  "schema_version": 1,
  "window": [2015, 2025],
  "groups": ["Scoring", "Passing", "Efficiency", "4th-down aggression", "Kicking", "Rushing"],
  "metrics": {
    "fourth_down_go_rate": {
      "label": "4th-down go-for-it rate (neutral)",
      "unit": "pct",              // pct (0–1 fraction) | yards | points | epa | count
      "group": "4th-down aggression",
      "about": "Share of neutral-situation 4th downs where …",  // shown under the chart
      "source": "pbp",            // never the new-format weekly fallback
      "flags": [],                // non-empty => render an asterisk
      "series": [{ "season": 2015, "value": 0.064 }, /* … one per season, value nullable */]
    }
  }
}
```

**The 2025 asterisk is measured, not assumed.** nflverse froze the legacy
weekly player-stats release after 2024, so 2025 *player* data comes from the
new-format fallback (see `fetch_weekly`) — but trends read play-by-play, which
has no such fallback. The build still checks rather than asserting: each
metric's inputs are scored for completeness **against that metric's own
denominator** (aDOT against pass attempts, not against every play — otherwise
the check just tracks the league pass rate), and any metric whose 2025
completeness falls below 98% of its 2015–2024 median gets a `flags` entry.
Currently every metric is clean, so all `flags` arrays are empty.

## `matchups/unit_ratings.json` and `matchups/schedule_2026.json` (Matchups product)

Inputs to the weekly unit-matchup tool (`docs/MATCHUPS_SPEC.md`, `src/lib/matchups.ts`).
Built by `ingest/build_matchups.py`, not `build.py` — it only reads the
already-built `teams/{fr}.json` files and the schedule, so it can be re-run on
its own once the ratings basis changes. Matchups themselves (edge, tags,
interest score) are **not** pre-baked; they are computed client-side from
these two files, so a future offseason-adjusted ratings file drops in with no
other changes.

```jsonc
// matchups/unit_ratings.json — 32 teams x 4 units, 2025 EPA/play + league rank
{
  "schema_version": 1,
  "season_basis": 2025,
  "teams": {
    "CIN": {
      "run_off":  { "epa": 0.014, "rank": 6, "sos": { "avg_opponent_rank": 19.5, "classification": "soft" } },
      "pass_off": { "epa": -0.02, "rank": 25, "sos": { "avg_opponent_rank": 15.1, "classification": "neutral" } },
      "run_def":  { "epa_allowed": 0.058, "rank": 31, "sos": { "avg_opponent_rank": 13.8, "classification": "tough" } },
      "pass_def": { "epa_allowed": 0.18, "rank": 28, "sos": { "avg_opponent_rank": 16.2, "classification": "neutral" } }
    }
    // … 32 teams total
  }
}
```
`epa`/`epa_allowed`/`rank` are as before (rank 1 = best; offence ranked by
higher EPA/play, defence by lower EPA/play allowed —
`offense.by_play_type.{rush,pass}.epa_per_play` and
`defense.by_play_type.{rush,pass}.epa_per_play_allowed` respectively).

`sos` (docs/MATCHUPS_SOS.md) is a **calibration hint, not a corrected
rank** — computed once, statically, alongside the ratings (not part of the
weekly refresh). For each unit, `avg_opponent_rank` is the mean raw rank of
the *specific opposing unit* (same kind: pass offence -> opposing pass
defences, etc.) it faced across its 2025 REG-season games; `classification`
buckets that average into terciles computed separately per unit type across
all 32 teams — `"tough"` (lowest third of avg-opponent-rank: it faced strong
opposition, so its own rank is earned or if anything understated),
`"soft"` (highest third: it faced weak opposition, so its own rank is likely
inflated), or `"neutral"` (middle third — not flagged in the UI).

```jsonc
// matchups/schedule_2026.json — from import_schedules(2026), REG season only
{
  "schema_version": 1,
  "season": 2026,
  "weeks": {
    "1": [
      {
        "game_id": "2026_01_NE_SEA", "away": "NE", "home": "SEA", "date": "2026-09-09",
        "away_score": 10, "home_score": 13  // null, null until the game is played
      }
      // … one entry per game, sorted by date then game_id
    ]
    // … "2" .. "18"
  }
}
```

Team codes match `teams/{fr}.json` franchise codes exactly (`LA`, `LAC`, `LV`,
etc.) — no remapping needed. If `import_schedules(2026)` ever returns no REG
rows (schedule not yet published), the build step aborts rather than writing
an empty file — the product has no fallback for a missing schedule.
`away_score`/`home_score` come straight off the same `import_schedules(2026)`
row (`pd.isna` -> `null` until the game has been played); the UI uses them to
tell a finished game from a scheduled one, e.g. on `/matchups` where a played
game's MARKET line shows the final score instead of a spread.

## `matchups/odds_2026.json` (Matchups product — betting lines)

Pull-and-commit, not build-time: `ingest/pull_odds.mjs` is a **local-only**
Node script that hits the-odds-api.com with a key from `.env.local`
(gitignored, never sent to Vercel) and writes this file, which the deployed
site then reads statically like any other `public/data/` file. Re-run it
locally and commit the refreshed JSON whenever you want newer lines — there
is no server-side fetch and no runtime secret.

```jsonc
// matchups/odds_2026.json
{
  "schema_version": 1,
  "season": 2026,
  "book": "draftkings",              // consistent single source; not a market consensus
  "generated_at": "2026-09-13T06:59:40.672Z",
  "weeks": {
    "1": [
      {
        "game_id": "2026_01_ARI_LAC", "away": "ARI", "home": "LAC",
        "odds": { "total": 47.5, "favorite": "LAC", "spread": 9.5 }
      },
      {
        "game_id": "2026_01_NE_SEA", "away": "NE", "home": "SEA",
        "odds": null                 // no DraftKings line posted yet — render as "lines not yet posted", never 0
      }
      // … one entry per scheduled game, every week 1-18
    ]
  }
}
```

Every game in `schedule_2026.json` gets an entry — games are never omitted
for lack of odds. `odds` is `null` for anything DraftKings hasn't priced yet
(already-played games, or teams/weeks the book hasn't opened lines for); the
UI must render that as "n/a" / "lines not yet posted", never as 0 — except for
an already-played game, which the UI detects from `schedule_2026.json`'s
`away_score`/`home_score` and renders as the final score instead of falling
through to "lines not yet posted". Games are
matched between the schedule and the odds feed **by away/home team-code
pair**, never by date — the feed's `commence_time` is UTC and late-window
games roll to the next calendar date versus the schedule's local kickoff
date. Full-name → code mapping for all 32 teams lives in
`TEAM_NAME_TO_CODE` in `pull_odds.mjs`; an unrecognized name from the feed
aborts the script rather than silently dropping that game.

## `matchups/team_players.json` (Matchups product — player spotlights)

Built by `ingest/build_spotlights.py`, folded into `npm run refresh:week`
(`ingest/refresh_week.ts`) since starters and injuries are this-week facts
(docs/MATCHUPS_SPOTLIGHTS.md, docs/MATCHUPS_INJURIES.md). Per 2026-roster
team, the key players by unit: QB and RB are the current **depth-chart**
starter, overridden by this week's **injury report** when the nominal
starter is Out/IR; WR/TE and defensive spotlights stay ranked by **2025**
production but carry the same injury flag. Never touches
`predictions/week_{N}.json` or the unit-level model — injuries inform
spotlights only.

```jsonc
// matchups/team_players.json
{
  "schema_version": 1,
  "roster_season": 2026,
  "production_season": 2025,
  "generated_at": "2026-09-14T14:20:00Z",
  "teams": {
    "ATL": {
      "pass_off": {
        "qb": {
          "gsis_id": "00-0033662", "name": "Cooper Rush", "pos": "QB",
          "headline": "311 yds, 2 TD in 4 games", "percentile": 22.1,
          "team_2025": "DAL", "games_2025": 4, "flag": null,
          "injury_status": null,         // Rush himself isn't on this week's report
          "depth_rank": 3,                // QB3 on the current depth chart...
          "starter_override": true,       // ...promoted because QB1 and QB2 are both Out
          "overridden_starters": [        // every depth-chart entry skipped, in order, each with its own status
            { "gsis_id": "00-0039917", "name": "Michael Penix Jr.", "injury_status": "Out" },
            { "gsis_id": "00-0036212", "name": "Tua Tagovailoa", "injury_status": "Out" }
          ]
        },
        "receivers": [ /* TeamPlayerEntry[], unchanged shape + injury_status */ ]
      },
      "run_off": { "rb": { /* TeamPlayerEntry, same QB-style fields */ } },
      "pass_def": { "rusher": { /* … */ }, "db": { /* … or null, optional slot */ } },
      "run_def": { "tackler": { /* … or null, optional slot */ } }
    }
    // … one entry per team
  }
}
```

**`TeamPlayerEntry`** (`src/lib/spotlights.ts`):
- `flag: "no_2025_data" | null` — set instead of a fabricated/zeroed stat line
  for a rookie or anyone with no 2025 REG record; `headline`/`percentile`/
  `team_2025`/`games_2025` are absent when `flag` is set.
- `injury_status: "Out" | "Doubtful" | "Questionable" | null` — this week's
  `import_injuries` report status for *this* player (the resolved starter,
  not the nominal one). `null` means not on the report, not "confirmed healthy".
- `depth_rank` / `starter_override` / `overridden_starters` — **QB and RB
  entries only**. `starter_override: true` means one or more depth-chart
  entries ranked above this player were Out/IR this week and this entry is
  the next-man-up who's actually resolved as the starter; `overridden_starters`
  lists every one of them, in depth-chart order, each with its own
  `injury_status` (there can be more than one — QB1 *and* QB2 both Out bumps
  QB3 in). WR/TE and defensive entries never carry these three fields — those
  slots stay production-ranked, not depth-chart-ranked.

**Starter resolution (QB/RB only):** depth-chart rank 1, unless this week's
injury report marks him `Out`/`IR` (`import_injuries` `report_status`, or
`import_seasonal_rosters` `status == "RES"` — the injury report itself never
carries an "IR" status string, so reserve/IR roster status is the second
signal), in which case the next depth-chart entry not Out/IR. If every
depth-chart entry at that position is Out/IR, falls back to the nominal
(rank-1) starter rather than showing nobody. `import_depth_charts` returns a
full multi-month time series (one row per player per scrape `dt`); "current"
means filtering to the max `dt`, not reading the table as-is.

## `predictions/week_{N}.json` and `predictions/meta.json` (Matchups product — frozen forecasts)

Written by `ingest/refresh_week.ts` (`npm run refresh:week`, docs/MATCHUPS_REFRESH.md),
the weekly orchestrator that git-pulls, refreshes `schedule_2026.json` and
`odds_2026.json`, then writes/refreshes the snapshot for whichever week
`defaultWeek()` (`src/lib/matchups.ts`) currently considers "upcoming" — the
same rule `/matchups` itself uses for its default week. Nothing else is
touched; a fully-past week's file is simply never revisited once the
"upcoming" week moves on.

```jsonc
// predictions/week_1.json
{
  "schema_version": 1,
  "season": 2026,
  "week": 1,
  "captured_at": "2026-09-13T21:36:49.283Z",
  "games": [
    {
      "game_id": "2026_01_ARI_LAC", "away": "ARI", "home": "LAC", "kickoff": "2026-09-13",
      "model": {
        "favourite": "LAC", "lean": "clear",   // "even" | "edge" | "clear" — same buckets the verdict prose uses
        "margin_est": 48,                      // rounded |pass-weighted offensive-edge diff| — a lean magnitude,
                                                // NOT a predicted scoreline (the product never predicts one)
        "tags": ["Even"], "verdict": "…frozen verdict text, byte-for-byte what the card showed at capture time…"
      },
      "market": { "favourite": "LAC", "spread": 2.5, "total": 45.5, "book": "draftkings" },
      "captured": true
    },
    {
      "game_id": "2026_01_NE_SEA", "away": "NE", "home": "SEA", "kickoff": "2026-09-09",
      "captured": false   // played before this pipeline ever ran for week 1 — no `model`/`market` keys at
                           // all, never reconstructed; the honest record starts from the first week captured
    }
    // … one entry per game in the week
  ]
}
```

```jsonc
// predictions/meta.json — merge-not-replace, same pattern as the top-level meta.json fix
{
  "schema_version": 1,
  "season": 2026,
  "generated_at": "2026-09-13T21:36:49.286Z",
  "weeks_captured": [1]   // every week a snapshot file has ever been written for, union'd in, never replaced —
                           // a run that only touches week_3.json must not make it look like weeks 1-2 never happened
}
```

**The freeze rule** (non-negotiable — see `docs/MATCHUPS_REFRESH.md`): a
game's `model`/`market` are only ever (re)computed while it hasn't kicked
off. "Kicked off" is read from `schedule_2026.json`'s `away_score`/`home_score`
(not a kickoff timestamp — this product has no such field, and the fixture
data doesn't advance with the wall clock, so score presence is the only
reliable signal). Concretely, each run:
- **Not yet kicked off:** always recomputes both forecasts fresh from
  whatever ratings/odds are live right now — a moving market line keeps
  winning right up to kickoff, and re-running the refresh several times
  before Sunday is expected and fine.
- **Already kicked off, had a prior snapshot:** that snapshot is carried over
  byte-for-byte, forever — never recomputed, never touched again.
- **Already kicked off, no prior snapshot** (the refresh didn't run before
  that game's kickoff): written once as `"captured": false` with no `model`/
  `market` keys, and never back-filled — a recomputed "prediction" for a
  finished game isn't ex ante, and the market line that existed pre-kickoff
  is gone for good.

`ingest/refresh_week.ts` exports `buildPredictionSnapshot()` for testing;
importing the module for that must never trigger the live pipeline (it hits
a quota-limited API), which is why the file guards its own `main()` behind
`require.main === module`.

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
