# NFL Explorer — Phase 3a spec: team stats (schema + sample)

Phase 3 is bigger than Phase 2 (which was pure UI). It needs a **new ingest
path**, a **new JSON schema**, and the pages on top. So it splits:

- **Phase 3a (this doc):** design the team schema, implement the ingest, build
  **2–3 contrasting sample teams**, and **stop for inspection**. No UI, no full
  32-team run. This is the gate — team-level EPA aggregation has its own traps
  (garbage-time filtering, situation definitions, relocation codes) that are far
  cheaper to catch on 3 teams than 32.
- **Phase 3b (later):** full 32-team × 11-season build, team pages with the
  heatmap hero, and a team-vs-team comparison page mirroring the player compare.

## Locked decisions

| Choice | Decision |
|---|---|
| Unit | One team, one season, season picker. Trends deferred. |
| Expression | Per-game for counting stats; per-play (EPA, success rate) for efficiency. |
| Backbone | EPA + success rate, **raw** (no opponent adjustment in v1). |
| Situational splits | **Down & distance only.** No red zone, two-minute, game script, etc. |
| Defence | **Results only** — what they allow. No coverage/blitz/front (not in free data). |
| Scheme fingerprint | Six axes (below). |
| Scheme cross-tabs | Four (below). |
| Baselines | Team baselines per season → league rank/percentile on every metric, reusing `percentile_from_grid`. |
| Hero | Down×distance **heatmap**. |
| Cut from v1 | Special teams, roster click-through, drive-level metrics, opponent adjustment. |

---

## Team file — `teams/{franchise}.json`

One file per **franchise**, seasons nested (mirrors the player-file pattern,
trend-ready for later). The page loads one season; the picker switches rows.

```jsonc
{
  "schema_version": 1,
  "franchise": "LV",              // current franchise code (see relocation note)
  "name": "Las Vegas Raiders",
  "colors": { "primary": "#000000", "secondary": "#A5ACAF" },  // from team_desc
  "seasons": [
    {
      "season": 2024,
      "code": "LV",               // the team's actual code THAT season (OAK pre-2020)
      "games": 17,
      "record": { "w": 4, "l": 13, "t": 0 },   // from schedules; null if unavailable

      "offense": {
        "summary": {              // per-game counting, per-play efficiency
          "points_per_game": 19.1, "yds_per_game": 316.4, "plays_per_game": 62.3,
          "epa_per_play": -0.03, "success_rate": 0.42
        },
        "by_play_type": {
          "pass": { "epa_per_play": 0.01, "success_rate": 0.45, "plays_per_game": 36.1 },
          "rush": { "epa_per_play": -0.08, "success_rate": 0.38, "plays_per_game": 24.0 }
        },
        "fingerprint": {          // the six scheme-identity axes (defs below)
          "proe": 0.021,
          "early_down_pass_rate": 0.548,
          "neutral_pace_sec": 27.9,
          "shotgun_rate": 0.71,
          "adot": 7.8,
          "run_dir": { "left": 0.34, "middle": 0.30, "right": 0.36 }
        },
        "scheme_splits": {        // performance-BY-scheme cross-tabs (defs below)
          "shotgun_vs_under_center": {
            "shotgun":       { "epa_per_play": 0.04, "success_rate": 0.46, "plays": 690 },
            "under_center":  { "epa_per_play": -0.09, "success_rate": 0.39, "plays": 320 }
          },
          "early_down_pass_vs_run": {
            "pass": { "epa_per_play": 0.06, "success_rate": 0.47, "plays": 410 },
            "rush": { "epa_per_play": -0.05, "success_rate": 0.40, "plays": 380 }
          },
          "pass_heavy_vs_balanced": {   // game-level buckets (def below — softest metric)
            "pass_heavy": { "epa_per_play": 0.02, "success_rate": 0.44, "games": 6 },
            "balanced":   { "epa_per_play": -0.06, "success_rate": 0.41, "games": 11 }
          },
          "deep_shots": { "rate": 0.118, "epa_per_play": 0.33, "success_rate": 0.41, "attempts": 72 }
        },
        "down_distance": {        // THE HEATMAP DATA — 4 downs × 3 distance buckets
          "1_short": { "epa_per_play": 0.05, "success_rate": 0.52, "plays": 40 },
          "1_medium":{ "epa_per_play": 0.02, "success_rate": 0.48, "plays": 60 },
          "1_long":  { "epa_per_play": -0.01,"success_rate": 0.45, "plays": 520 },
          "2_short": { /* … */ }, "2_medium": {}, "2_long": {},
          "3_short": {}, "3_medium": {}, "3_long": {},
          "4_short": {}, "4_medium": {}, "4_long": {}
        }
      },

      "defense": {                // RESULTS ONLY — everything is "allowed"
        "summary": {
          "points_allowed_per_game": 25.5, "yds_allowed_per_game": 348.0,
          "epa_per_play_allowed": 0.04, "success_rate_allowed": 0.46
        },
        "by_play_type": {
          "pass": { "epa_per_play_allowed": 0.08, "success_rate_allowed": 0.49 },
          "rush": { "epa_per_play_allowed": -0.02, "success_rate_allowed": 0.42 }
        },
        "explosive_rate_allowed": 0.11,   // share of plays 20+ yds allowed
        "sack_rate": 0.061,               // team sacks / opp dropbacks (pressure proxy)
        "down_distance": { /* same 4×3 grid, all "allowed" */ }
      },

      "percentiles": {            // vs that season's team baselines (0–100)
        "offense": { "epa_per_play": 47, "success_rate": 40, "proe": 62, "deep_shots.rate": 55 },
        "defense": { "epa_per_play_allowed": 38, "explosive_rate_allowed": 30, "sack_rate": 58 }
      }
    }
  ]
}
```

---

## Team baselines — extend `seasons/{year}.json`

Add a `team_baselines` block **alongside** the existing player `baselines` in
each `seasons/{year}.json` (schema addition, allowed within v1 — no bump). The
client already loads this file for era context, so team percentiles read from
one place. 32 teams per season → same 7-point grid, same `percentile_from_grid`.

```jsonc
"team_baselines": {
  "offense": {
    "epa_per_play": { "mean": 0.0, "std": 0.08, "p": [-0.14,-0.10,-0.05,0.0,0.06,0.11,0.15] },
    "proe": { /* … */ }, "deep_shots.rate": { /* … */ }
    // one entry per rankable offensive metric
  },
  "defense": {
    "epa_per_play_allowed": { /* … */ }, "explosive_rate_allowed": { /* … */ }
  }
}
```

**Direction.** Extend the `NEGATIVE_STATS` concept to teams: for defence, all
`*_allowed` metrics and `points_allowed_per_game`/`yds_allowed_per_game` invert
(lower = better → higher percentile). For offence, none invert (turnovers aren't
in this v1 set). Document the team negative-set explicitly.

---

## Metric definitions (precise — do not improvise these)

All aggregations **exclude** QB kneels, spikes, and no-play/penalty-only rows.
Use nflfastR PBP columns. Two filter regimes:

- **Neutral filter** (for fingerprint tempo/tendency axes): win probability
  `wp` between 0.20 and 0.80, and exclude the final 2:00 of each half. This
  strips garbage time and clock-driven behaviour so the number reflects
  *intent*, not score.
- **Competitive filter** (for all performance/efficiency numbers): all plays
  except the excluded row types above. No wp filter — you want real results.

**Success rate** = share of plays with `epa > 0`. (Same everywhere.)

**Fingerprint axes:**
1. **PROE** — pass rate over expected. Use nflfastR's `xpass`: `mean(pass) − mean(xpass)` over neutral-filter plays. (No modelling needed — `xpass` is in the data.)
2. **early_down_pass_rate** — pass share on 1st & 2nd down, neutral filter.
3. **neutral_pace_sec** — mean seconds between a team's consecutive offensive snaps, neutral filter, excluding plays after clock-stopping events. **This is the fiddliest axis — most likely to need iteration; if it comes out noisy, flag it rather than shipping garbage.**
4. **shotgun_rate** — `mean(shotgun)` over offensive plays, competitive filter.
5. **adot** — mean `air_yards` over pass attempts.
6. **run_dir** — distribution of `run_gap`/`run_location` (left/middle/right) over rush attempts, normalised to sum 1.

**Scheme cross-tabs:**
- **shotgun_vs_under_center** — split offensive plays by `shotgun`, report EPA/play + success + play count each side.
- **early_down_pass_vs_run** — on 1st/2nd down, split by pass/rush.
- **pass_heavy_vs_balanced** *(softest — define clearly)* — classify each of the team's games by its neutral-filter pass rate; the team's top third of games by pass rate = `pass_heavy`, the rest = `balanced`; report EPA/play + success + game count per bucket. Note in the schema doc this is a game-level split and inherently coarser than the others.
- **deep_shots** — attempts with `air_yards >= 20`: rate (deep attempts / all attempts), EPA/play, success.

**Down×distance buckets** (the heatmap): down ∈ {1,2,3,4}; distance bucket
short = `ydstogo <= 3`, medium = `4–6`, long = `>= 7`. Key = `{down}_{bucket}`.
Each cell: EPA/play, success_rate, plays. (1st down will concentrate in
`1_long` since 1st-and-10 dominates — that's correct, not a bug.)

**Defence:** every offensive performance metric above, recomputed from the
plays where this team is on defence, labelled `*_allowed`. `explosive_rate_allowed`
= share of plays 20+ yards allowed. `sack_rate` = team sacks / opponent dropbacks.

---

## The heatmap hero (drives Phase 3b UI, spec'd now so the data supports it)

A grid: **rows = down (1–4), columns = distance bucket (short/medium/long)**,
each cell shaded by **EPA/play** (diverging red→neutral→blue, reusing the
player-page percentile palette), with a **success-rate toggle**. Cell shows the
value; hover shows all three (EPA, success, play count). Purpose: instantly read
"lethal on 3rd-and-short, falls apart on 2nd-and-long." Offence and defence each
get one; a toggle or side-by-side flips between them. The `down_distance` blocks
above are exactly this grid — no extra computation needed in 3b.

---

## Franchise / relocation handling

Within 2015–2025: **STL→LA Rams (2016)**, **SD→LAC (2017)**, **OAK→LV (2020)**.
One file per franchise keyed by the **current** code (`LA`, `LAC`, `LV`); each
season row carries `code` = the code used *that* season. This keeps one file per
franchise and makes the deferred trend view span the relocation cleanly. Pull
names/colours from `nfl_data_py.import_team_desc()`.

---

## Phase 3a task

1. Design the team schema above into `docs/DATA_SCHEMA.md` (addition, no version bump).
2. Implement the team ingest in `build.py` (new stage; reuse the PBP already cached).
3. Compute the `team_baselines` blocks into `seasons/{year}.json`.
4. Build **sample teams only**: pick, from the data, the **most pass-heavy offence** and the **most run-heavy offence** by PROE, plus the **best defence** by EPA/play allowed, in a recent season (2023 or 2024) — so the samples span the schematic range and stress-test the fingerprint. Write those 2–3 franchise files.
5. **Stop and report.** No full 32-team run, no UI.

---

## CC kickoff prompt

> **Build Phase 3a of NFL Explorer — the team data layer — following the team schema and metric definitions in `docs/PHASE3A_TEAMS_SPEC.md`.** Start with `git pull`. This is data + schema only: no UI, and do NOT run the full 32-team build yet.
>
> Design the `teams/{franchise}.json` schema and the `team_baselines` addition to `seasons/{year}.json` into `docs/DATA_SCHEMA.md` (schema addition — do not bump the version). Implement the team ingest as a new stage in `build.py`, reusing the play-by-play already cached; respect the exact metric definitions in the spec (PROE via `xpass`, the neutral vs competitive filter regimes, success rate = EPA>0, the down×distance buckets, the four scheme cross-tabs). Handle the STL/SD/OAK relocations per the spec (one file per franchise, current code as key, season `code` field). Extend the team negative-stats set so defensive `*_allowed` metrics invert in percentiles.
>
> Then build sample teams ONLY: from the data, select the most pass-heavy and most run-heavy offences by PROE plus the best defence by EPA/play allowed in 2023 or 2024, write those 2–3 franchise files, and **stop and report** — list the files, the teams chosen and why, and flag any metric (especially neutral pace) that came out noisy or needed a judgment call. Do not generate the other teams and do not build UI.

Deliver any fixes as runnable Node scripts where applicable.

---

### Morning inspection checklist (after 3a runs)
- The **pass-heavy vs run-heavy** samples show visibly different `fingerprint` blocks — PROE, shotgun rate, early-down pass rate should clearly separate them. If they look similar, the neutral filter or PROE calc is off.
- **Neutral pace** is a believable ~26–31 sec range, not wild.
- **Down×distance** cells are populated and `1_long` holds most first-down plays.
- **Defensive percentiles invert correctly** — the best-defence sample should show *high* percentiles for `epa_per_play_allowed`, not low.
- **Team baselines** grids are monotonic (same check as the player baselines).
