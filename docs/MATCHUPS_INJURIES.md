# /matchups — injuries + current-starter fix (depth charts)

Two interacting fixes, both driven by **current-status data that changes weekly**,
so both belong in the weekly refresh:

1. **Correct starters** — the QB spotlight currently ranks by 2025 production, so
   it names last year's passer, not the actual 2026 starter (Vikings: it should be
   the current QB1, not whoever threw most in 2025). The fix is the **depth chart**.
2. **Injuries** — flag Out/Doubtful key players, and — crucially — let an injury
   **override** the starter: if the depth-chart QB1 is Out this week, the backup is
   the real starter. This is the Murray→Wentz case and the reason these two fixes
   are one build.

**Why together:** "who actually plays QB this week" = depth-chart starter, unless
the injury report says he's Out, in which case the next man up. You need both
sources to answer it. Neither production nor game-history can — a static rule
always breaks on the next injury.

## The starter-resolution rule (the core fix)

For single-starter roles (**QB**, and **RB** for the lead back):
1. Start from the current **depth chart** (position rank 1).
2. If that player is **Out / IR** on this week's **injury report**, drop to the
   next available depth-chart player.
3. That resolved player is the spotlight starter. Their **2025 production** is
   still what's displayed (wherever they played); a starter with no 2025 data is
   flagged, not zeroed (the mechanism already exists).

This **replaces** the "rank by 2025 pass attempts + tie-break" logic for QB/RB —
delete that path; the depth chart + injury override is the single source of truth
for who starts.

For **WR/TE and defensive** spotlights: keep the existing 2025-production ranking
(depth-chart WR ordering is noisy; production is the better "who to watch"
signal), but **attach injury status as a flag** — don't reorder them on a
one-week absence, just show "Questionable/Out" so it's honest.

## Injuries on the page

- Each spotlight player carries a **status** when flagged: Out / Doubtful /
  Questionable (from the injury report, current week). Render as a small badge on
  the player (e.g. "Kittle — Q").
- Where a **starter** is Out and overridden, show the player who'll actually start
  (per the rule above), not the injured nominal starter.
- Optional light caveat: if a unit's headline spotlight player is Out, a small
  note by that unit. Don't overdo it.

## Boundary — injuries do NOT touch the model forecast (for now)

The model verdict/lean is **unit-level** (2025 EPA), player-agnostic — so an
injured star does **not** change the model forecast or the frozen snapshot. That's
correct for this build: injuries inform the **spotlights** (who to watch, who's
out), not the prediction. (Making "star QB out" move the model is
rating-adjustment territory — deferred.) So this build leaves
`predictions/week_N.json` logic untouched.

## Fold into the weekly refresh

Depth charts and injuries change weekly, so the pulls go into `refresh_week.ts`
and `team_players.json` becomes part of the weekly rebuild (it's currently static
from `build_spotlights.py`). After this build, `npm run refresh:week` also
refreshes depth charts + injuries and rebuilds spotlights with current starters
and injury flags — which is exactly right, since starters and injuries are
this-week facts.

## Data confirmation (gate step 1)

Confirm both nflverse sources return real 2026 data and inspect their actual
schemas before building — don't assume field names:
- `import_depth_charts([2026])` — how it encodes position rank / starter.
- `import_injuries([2026])` — the status field values (Out/Doubtful/Questionable)
  and how the week is keyed.
If either is empty for 2026, stop and report.

## Gate

1. Confirm both data sources + schemas.
2. Rebuild `team_players.json` with depth-chart starters + injury override + flags.
3. **STOP and report:** for the current week, **every team's resolved QB** (and
   RB), plus any key spotlight player flagged Out/Doubtful — so I can sanity-check
   the starters against reality league-wide (the Vikings case must resolve to the
   actual current starter, not last year's passer, and not a nominal starter who's
   injured). Do NOT build UI until confirmed.
4. On confirmation, build the injury badges + starter display on the cards.

## CC prompt

> **Build the injuries + current-starter fix for /matchups spotlights, following `docs/MATCHUPS_INJURIES.md`.** Start with `git pull`. Both inputs are free nflverse sources; fold the weekly pulls into `refresh_week.ts`.
>
> First confirm `import_depth_charts([2026])` and `import_injuries([2026])` return real 2026 data and inspect their actual schemas (don't assume field names) — if either is empty, stop and report.
>
> Then fix starter selection: for QB and RB, replace the current "rank by 2025 attempts + tie-break" logic with — take the current depth-chart starter (position rank 1); if that player is Out/IR on this week's injury report, drop to the next available depth-chart player; that resolved player is the spotlight starter, displayed with their 2025 production (flag, don't zero, a starter with no 2025 data). Keep WR/TE and defensive spotlights on 2025-production ranking, but attach each player's current injury status as a flag. Rebuild `team_players.json` as part of the weekly refresh (fold the depth-chart + injury pulls into `refresh_week.ts`).
>
> Do NOT change the model forecast or the prediction snapshot — injuries inform spotlights only, not the unit-level model.
>
> Then STOP and report, for the current week: every team's resolved QB and RB, plus any key player flagged Out/Doubtful — so I can sanity-check starters against reality league-wide before any UI. In particular the Vikings QB must resolve to the actual current starter, not last year's passer and not an injured nominal starter.
>
> Once I confirm, build the UI: injury-status badges on spotlight players (Out/Doubtful/Questionable), and show the resolved starter where an injury overrode the nominal one. Frame at unit level as before. Leave uncommitted for review; report judgment calls.

## Inspection checklist (at the gate)
- The Vikings QB resolves to the **actual current starter** (accounting for the
  injury churn), not last year's passer.
- Spot-check 4–5 other teams with known QB situations — each shows its real
  current starter.
- A nominal starter who's **Out** is correctly overridden to the backup.
- Injury flags match this week's report (a known Out player shows Out).
- The model forecast / snapshot is unchanged (injuries didn't leak into the
  prediction).
