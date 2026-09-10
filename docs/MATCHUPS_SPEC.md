# NFL Explorer — Matchup product spec (weekly unit matchups, v1)

A new product in the existing NFL Explorer project. Purpose: sit down before a
week and answer **"what's interesting coming up?"** — which games have dominant,
lopsided, or must-watch unit matchups.

Each team is read as **four units**: run offence, pass offence, run defence,
pass defence. Each game is those units colliding. The tool ranks the week by how
interesting the collisions are.

## Locked decisions

| Choice | Decision |
|---|---|
| Ratings basis | **2025 EPA/play, pure** — no offseason adjustment in v1. Honest caption everywhere (see below). |
| Units | Four per team: run off, pass off, run def, pass def. |
| Matchup atom | Offensive unit vs opposing defensive unit, contextualised by 2025 league rank (1–32). |
| Interesting-ness | **Tags**, not one blended score: *Mismatch*, *Clash (strength-on-strength)*, *Shootout*, *Defensive struggle*, *Even*. |
| Pass vs run weight | Pass matchups weighted **~1.5×** run in the game-level interest score (pass EPA is more stable and outcome-linked). |
| Primary view | **Week-by-week** — pick a week, games sorted most-interesting first. |
| New data | The **2026 schedule** (only genuinely new input; everything else exists from Phase 3). |

## Architecture — ratings as a swappable file

The whole design hinges on keeping ratings separate so the future adjusted /
self-correcting versions drop in without a redesign:

```
public/data/matchups/
  unit_ratings.json     32 teams × 4 units, each with EPA + 1–32 rank (from Phase 3 team data)
  schedule_2026.json    the 2026 schedule, keyed by week
src/lib/matchups.ts     the edge + tagging logic (computed client-side, like percentile.ts)
```

Matchups are **computed on the fly** in `matchups.ts` from ratings + schedule —
not pre-baked. So swapping `unit_ratings.json` for an adjusted version later
changes every matchup with zero other edits.

### `unit_ratings.json`
Sourced from each `teams/{fr}.json` 2025 season, then ranked 1–32 per unit:
- run_off = `offense.by_play_type.rush.epa_per_play`
- pass_off = `offense.by_play_type.pass.epa_per_play`
- run_def = `defense.by_play_type.rush.epa_per_play_allowed` (lower = better → rank 1)
- pass_def = `defense.by_play_type.pass.epa_per_play_allowed` (lower = better → rank 1)

```jsonc
{
  "season_basis": 2025,
  "teams": {
    "CIN": {
      "run_off":  { "epa": -0.066, "rank": 20 },
      "pass_off": { "epa": 0.165,  "rank": 4  },
      "run_def":  { "epa_allowed": 0.005, "rank": 22 },
      "pass_def": { "epa_allowed": 0.058, "rank": 25 }
    }
    // … 32 teams
  }
}
```

### `schedule_2026.json`
From `import_schedules(2026)`. **Step 1 of the build is confirming this exists in
the data** — the 2026 schedule releases in May, so by now it should be present,
but if `import_schedules` has no 2026 rows the product is blocked and CC should
stop and say so rather than build against nothing.

```jsonc
{ "season": 2026,
  "weeks": { "1": [ { "away": "DAL", "home": "PHI", "date": "2026-09-10" } ], "2": [ … ] } }
```

## Matchup logic (`matchups.ts`)

For one game, compute **four unit matchups** (home run-O vs away run-D, home
pass-O vs away pass-D, and the two mirrored). For each:

- **edge** = the offensive unit's expected advantage, from the rank gap. A
  simple, interpretable form: `edge = defense_rank − offense_rank` in
  offence-favoured terms (a top-3 offence vs a 30th defence → large positive
  edge; strong defence vs weak offence → large negative). Keep the raw EPA pair
  too, for display.
- **per-matchup tag** by rank tier (strong = rank ≤ 8, weak = rank ≥ 25):
  - **Points likely** — offence ≤ 8 and defence ≥ 25.
  - **Shutdown likely** — defence ≤ 8 and offence ≥ 25.
  - **Elite clash** — offence ≤ 8 and defence ≤ 8.
  - else untagged.

**Game-level tags** (roll up the four):
- **Shootout** — both teams have at least one "Points likely" matchup (both move the ball).
- **Defensive struggle** — both teams have at least one "Shutdown likely" (both offences stalled).
- **Clash / Marquee** — any "Elite clash" present (elite units colliding — watchable even at low edge).
- **Lopsided** — one team holds the offensive mismatches AND its defence out-ranks the opponent's offence (blowout signal, one direction).
- **Even** — none of the above.

**Interest score** (the week sort key) — so both lopsided *and* elite-clash games
float up, and only genuinely flat games sink:
```
interest = Σ |edge| over the 4 matchups, pass matchups ×1.5 / run ×1.0
         + clash_bonus (a fixed boost per Elite-clash present)
```
Elite clashes have low |edge| but high watchability, so the clash bonus is what
stops the sort burying the best games.

## UI — `/matchups`

- **Week picker** (default: the current or next upcoming week by date).
- **Games as cards, sorted by interest score descending.** Each card:
  - The two teams, their game-level tags as chips (Shootout / Clash / Lopsided / …).
  - The four unit matchups in a compact 2×2: each shows the two units with their
    ranks and the direction of edge (e.g. "CIN pass O (4th) ▸ vs pass D (28th) —
    Points likely"). Colour the **edge/quality** with the quality palette; do NOT
    colour rank as if a low rank were a style choice — rank here *is* quality, so
    the quality palette is correct (unlike the Phase 3 fingerprint axes).
  - Click a team → its `/teams/{fr}` page; click the game → expand full detail.
- **⚠️ Mandatory honesty caption**, visible on every view:
  *"Based on 2025 unit performance — offseason changes (personnel, coaching, scheme) are not reflected."*
  This is non-negotiable in pure mode: the tool is confidently wrong on exactly
  the teams that changed most (the Cowboys-defence case), and the caption is what
  keeps it honest rather than misleading.

## Out of scope for v1
Offseason adjustments, in-season updating, opponent-adjusted ratings, playoff
scenarios. All deferred — the swappable ratings file is what lets them slot in
later without a rebuild.

## Build sequence + gate

1. Confirm `import_schedules(2026)` returns a real schedule. If not, stop.
2. Build `unit_ratings.json` (ranks 1–32 per unit) and `schedule_2026.json`.
3. Write `matchups.ts` with the edge + tagging logic.
4. **GATE — stop and report.** Print **one week's** computed matchups (Week 1),
   sorted by interest, with tags, for inspection — before building the UI. A
   nonsense tag is cheap to catch on one week, annoying after the pages exist.
5. On confirmation, build the `/matchups` UI.

## CC kickoff prompt

> **Build a new product in NFL Explorer: a weekly unit-matchup tool, following `docs/MATCHUPS_SPEC.md`.** Start with `git pull`. It reuses the Phase 3 team data; the only new input is the 2026 schedule.
>
> First confirm `import_schedules(2026)` returns a real 2026 schedule — if it has no 2026 rows, stop and tell me, the product is blocked. Then build `public/data/matchups/unit_ratings.json` (each of the 32 teams' four units — run/pass offence and run/pass defence — as 2025 EPA/play with a 1–32 league rank; defensive ranks treat lower EPA-allowed as rank 1) and `schedule_2026.json` from the schedule. Write `src/lib/matchups.ts` computing, per game, the four unit matchups with a rank-gap edge and the per-matchup and game-level tags in the spec (Points likely / Shutdown likely / Elite clash → Shootout / Defensive struggle / Clash / Lopsided / Even), plus the interest score (pass matchups ×1.5, clash bonus).
>
> Then **stop and report Week 1's matchups**, sorted by interest score, with tags, for inspection. Do NOT build the UI yet.
>
> Once I confirm the tags look sensible, build `/matchups`: a week picker (default to the next upcoming week by date), games as interest-sorted cards showing the 2×2 unit matchups with ranks and edge direction, game-level tag chips, click-through to team pages, and the mandatory caption "Based on 2025 unit performance — offseason changes are not reflected" visible on every view.
>
> Deliver fixes as runnable Node scripts where applicable. Report judgment calls.

## Inspection checklist (at the gate)
- A team you know changed little year-over-year has believable unit ranks
  (sanity vs 2025 reality — e.g. a known-elite 2025 pass defence ranks in the top handful).
- "Shootout" games genuinely pair weak defences with strong offences on both sides.
- "Elite clash" surfaces at least a few marquee games, not zero and not everything.
- The Week-1 sort puts a plausibly-interesting game on top, not a flat one.
