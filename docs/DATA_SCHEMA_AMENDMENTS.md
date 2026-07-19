# NFL Explorer — schema amendments before Phase 1

These finalise the v1 contract in `docs/DATA_SCHEMA.md`. **No version bump** —
Phase 1 hasn't run, so no player or season files exist yet; this is getting v1
right before it's filled, not changing it after. Fold each into
`DATA_SCHEMA.md` and implement in `build.py`.

Priority order: **1 is the real gap** (hard to add once 11 seasons of player
files exist). 2–4 are "decide now, cheap now, expensive later."

---

## 1. Career advanced block *(critical)*

**Problem.** `career` stores counting sums only. Simple ratios (comp %, Y/A)
derive from those fine. But career **EPA/play, CPOE, aDOT, YAC-OE** cannot be
reconstructed — the denominators (total plays, the EPA sum) aren't stored.
Re-weighting season values client-side is an approximation everyone would
re-derive slightly differently. The build already has the play-by-play, so
compute it exactly there.

**Rule: pool the raw plays across the whole window, don't average season
numbers.** Career EPA/play = `sum(epa) / sum(plays)` over every 2015–2025 play
for that player — not the mean of the season figures.

**Add `career.advanced`,** storing each metric with the denominator it was
pooled over (keeps it auditable and lets a consumer re-derive):

```jsonc
"career": {
  "games": 128,
  "stats": { /* ALL counting keys the player's positions use — see below */ },
  "advanced": {
    "epa_per_play": 0.13, "n_plays": 4980,      // pooled sum(epa)/sum(plays)
    "cpoe":         2.1,  "n_att":   4523,       // pooled over attempts w/ cpoe
    "adot":         7.2,  // sum(air_yds)/sum(att)
    "yac_oe":       0.4
    // NGS is intentionally omitted from career — see note
  }
}
```

**`career.stats` completeness.** It must contain *every* counting key that
appears in any of the player's season rows, so all career ratios are
derivable. The schema example only shows three passing keys — confirm
`pass_cmp` is actually written, or career completion % is impossible. Same for
every position's ratio inputs.

**Career NGS — omit in v1.** NGS metrics are season-level aggregates, not
play-level, so a career figure means weighting season values by dropbacks etc.
— soft and low-value. Show NGS at season granularity only; document the
omission so it reads as a decision, not a bug.

---

## 2. Playoff aggregation

**Problem.** Season rows are REG-only; playoff games sit in `game_logs` but
aggregate nowhere. This is the NFL and the headline test case is Mahomes —
postseason production is a thing people compare. Deferring the *UI* is fine;
losing the *data* is the expensive mistake. Aggregate it now (the build
already has the games) and surface it whenever.

**Season rows:** emit up to two rows per season, tagged by `game_type`, POST
row only when the player played playoff games:

```jsonc
"seasons": [
  { "season": 2024, "game_type": "REG", /* … */ },
  { "season": 2024, "game_type": "POST", "games": 3, /* same shape */ }
]
```

**Career:** keep `career` meaning regular season (matches the current shape),
add a parallel `career_post`, omitted entirely if the player has no playoff
games. Regular-season code paths stay untouched if you never build the POST UI.

```jsonc
"career":      { "games": 128, "stats": {…}, "advanced": {…} },  // REG
"career_post": { "games": 21,  "stats": {…}, "advanced": {…} }   // omit if none
```

---

## 3. Split the defensive baseline group

**Problem.** `baselines` lumps all defence into one `"DEF"` group. A
cornerback's INTs and a defensive tackle's are different populations — any
defensive percentile computed against a merged group is misleading.

Doesn't block Phase 1 (the core is QB/RB/WR/TE, all clean), but define it
correctly now so it isn't forgotten when defence gets built. Replace `"DEF"`
in the baselines with three groups, mapped from the roster position:

```
DL  ← DE, DT, NT, EDGE      (pass rush / run stop)
LB  ← ILB, OLB, MLB, LB
DB  ← CB, S, FS, SS, DB
```

Edge rushers blur DL/OLB in nflverse positions — acceptable for v1; note it as
a known coarse edge. Each group keeps the same `{qualifier, n, stats:{mean,std,p}}`
shape as the offensive groups.

---

## 4. One percentile method, one direction convention

**Problem.** Season-row `percentiles` are pre-computed at build; Phase 2
era-adjustment computes them live from the baselines. If they use different
math, a player's profile badge won't match his standing in a comparison.

**Pick one:** empirical interpolation on the stored 7-point grid
`[p5, p10, p25, p50, p75, p90, p95]`. Linear-interpolate between points; it
handles skewed counting stats (TDs, sacks) far better than a mean/std z-score.
Use the *identical* function in both places. Keep `mean`/`std` stored — but for
context display ("1.2 SD above average"), not for the badge.

**Tail rule:** clamp to the grid edges. Below p5 → display `<5`; above p95 →
display `95+`. No fake precision at the extremes.

**Stat direction *(easy to miss, breaks badges).*** Higher isn't always better
— `pass_int`, `rush_fumbles`, `sacks` (taken) are bad when high. The badge must
show a low INT count as a *good* percentile. Add a direction annotation to the
stat dictionary — simplest is a `negative_stats` set the percentile function
inverts (`pct = 100 − raw_pct`). Document which keys are in it.

**Build ordering.** Compute all `seasons/{year}.json` baselines **first**, then
build the player files that reference them. Note the stage order in `build.py`.

---

## Hand-off

> Read `docs/DATA_SCHEMA_AMENDMENTS.md` and fold all four amendments into
> `docs/DATA_SCHEMA.md`, then implement them in `ingest/build.py`. These
> finalise schema v1 — do not bump the version. Do items in priority order;
> item 1 (career advanced block) is the one that must be right before any
> player files are generated. Don't build UI yet — this is still schema +
> ingest. Start with `git pull`.
