# /matchups — strength-of-schedule context (nuance layer)

The unit ranks on the cards are **raw** — opponent adjustment was deferred in
Phase 3. So a "7th-ranked pass defence" that only faced weak passing offences is
overrated, and one that faced brutal offences is underrated. This adds a light
**soft/tough-schedule flag** so you know when to trust a rank and when to
discount it. It's the cheap, honest partial-answer to the opponent-adjustment gap
— and it's pure computation from data you already have.

## What it computes (backward SOS — transparent, one pass)

For each team's each unit, the **average raw rank of the opposing units it faced
in 2025**:
- A **pass offence** faces opposing **pass defences** — average their ranks.
- Low average opponent-rank = it faced *tough* units → its own rank is earned
  (if anything understated).
- High average opponent-rank = it faced *weak* units → its own rank is likely
  **inflated**.

One pass, no iteration: compute all raw ratings first, then for each unit average
the ranks of the specific opposing units it played. Not circular — it's just "how
strong, on average, were the units you lined up against."

**Classify (only flag the extremes, to avoid clutter):**
- avg opponent-rank in the toughest third (≈ ≤ 11) → **"tough schedule"** — rank trustworthy / if anything understated.
- avg opponent-rank in the softest third (≈ ≥ 22) → **"soft schedule"** — rank likely overstated, discount it.
- middle third → no flag.

## Honest caveat (build it in)

SOS here is a **heuristic**, computed from the same raw ratings — it says "this
rank was built against soft/tough competition," a calibration *hint*, not a
corrected rating. Don't present it as "the true rank." Frame it as context, same
discipline as the recent-form and unit-level-only framing elsewhere.

## Where it lives (static, not weekly)

SOS is derived from 2025 data, so it's **static** like the ratings — compute it in
`build_matchups.py` and fold it into `unit_ratings.json` (a `sos` field per unit:
the avg opponent-rank faced + the soft/tough/neutral classification). It does NOT
go in the weekly refresh — ratings and SOS are the static 2025 layer; schedule,
scores, odds, injuries, starters are the weekly layer. Keep that split clean.

## UI — light touch, respect the scan

The card is already dense, so don't mark every unit:
- On the card face, add a **subtle marker only on ranks flagged soft or tough** —
  e.g. a small "soft"/"tough" tag or an asterisk with a one-line legend. Neutral
  units get nothing. A soft-schedule marker on an impressive-looking rank is the
  high-value case (it warns you the number is inflated).
- In the **expanded detail**, the full line per unit: "faced pass defences
  averaging 24th — rank likely inflated (soft schedule)."
- Don't recolour the rank; the SOS marker is separate from the quality tint.

## Optional / deferred
**Forward SOS** (how tough each team's *2026* season is, from the schedule +
ratings) is a season-preview angle, less relevant to a single weekly matchup.
Skip for v1; note it as a possible later add.

## Gate (light — it's low-risk computation)
1. Compute SOS, fold into `unit_ratings.json`.
2. **Report a sample** — a few teams' unit SOS, and confirm the extremes make
   sense (e.g. a unit flagged "tough schedule" genuinely faced strong opposing
   units; a "soft" one faced weak). Do a quick sanity pass before UI.
3. On confirmation, build the markers + detail.

## CC prompt

> **Build strength-of-schedule context for /matchups, following `docs/MATCHUPS_SOS.md`.** Start with `git pull`. Pure computation from existing 2025 data — no new source, and this is a static addition to the ratings, NOT part of the weekly refresh.
>
> In `build_matchups.py`, for each team's each unit compute the average raw rank of the opposing units it faced in 2025 (a pass offence faces the opponents' pass defences, etc. — one pass, using the raw ranks already computed). Classify: toughest third of average opponent-rank = "tough schedule" (rank earned/understated), softest third = "soft schedule" (rank likely inflated), middle = neutral. Fold a `sos` field per unit into `unit_ratings.json` (avg opponent-rank + classification).
>
> Then STOP and report a sample of teams' unit SOS so I can sanity-check the extremes make sense (a "tough schedule" unit genuinely faced strong opponents, a "soft" one faced weak) before any UI.
>
> Once confirmed, build the UI: a subtle marker on card-face ranks flagged soft or tough only (neutral units unmarked), with a one-line legend, and the full SOS line per unit in the expanded detail ("faced pass defences averaging 24th — rank likely inflated"). Frame it as a calibration hint, not a corrected rank; don't recolour the quality tint. Leave uncommitted for review; report judgment calls.

## Inspection checklist
- The SOS classifications pass a smell test — units flagged "tough" faced strong
  opposition, "soft" faced weak; not random.
- Only flagged (soft/tough) units are marked on the card face; neutral units are
  clean — no new clutter.
- A soft-schedule flag lands on a rank that looks better than it deserves (the
  high-value case).
- The framing reads as context/hint, not a corrected rating.
- Still reads cleanly on mobile.
