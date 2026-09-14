# /matchups — player spotlights (nuance layer #1)

Turns "DAL pass O 7th" into the humans behind it: the key players who drive each
unit, their 2025 level, framed against the opposing unit's rank — and finally
wires the **player click-through** deferred since Phase 3 (spotlight →
`/players/{id}`). Makes the abstract unit ratings concrete and answers "who do I
watch."

## The value, and the honest limit (build both in)

**Value:** "Ja'Marr Chase (elite 2025 WR) faces Jacksonville's 3rd-ranked pass
defence" is a far richer read than "CIN pass O 4th." Star-vs-weak-unit is exactly
the watchable-game signal.

**⚠️ Honest limit — bake it into the framing.** You have players' *individual
production* but NOT *coverage assignment* — free data doesn't say who covers
whom. So a spotlight is "key player + their 2025 level + the opposing UNIT's
rank," **never** a projected one-on-one ("Chase beats their #1 corner"). Frame it
at unit level. Same discipline as the recent-form caveat: give the feature
honestly, don't let it imply precision the data can't support.

Also: the data is **rich for offensive skill players** (QB/RB/WR/TE) and **thin
for defence** (pass-rushers OK via sacks; coverage DBs have little beyond INTs/
PDs). So lead with offensive-star spotlights; include a pass-rusher per side where
notable; keep DB/run-defence spotlights minimal and cautious — don't manufacture a
defensive spotlight the data can't stand behind.

## Data dependency — confirm FIRST (this is the gate)

Player data is built through 2025; the matchup is 2026. So **who is on a team**
must come from 2026 rosters, or you'll spotlight a traded-away player on his old
team. First build step: confirm `import_seasonal_rosters([2026])` (or the roster
import) returns real 2026 rosters. The season has started, so they exist — but
verify before building.

**The reconciliation (the tricky bit):**
- **Team membership** comes from the 2026 roster.
- **Production level** comes from that player's **2025** record — *wherever he
  played*. A WR who moved CIN→KC in 2026 shows as a KC player with his 2025 (CIN)
  production.
- **Rookies / players with no 2025 data:** don't fabricate. Either omit, or
  include flagged as "rookie / no 2025 data" — never show a blank or zero as if
  it were production.

**Season-start sanity check (free validation):** a team's spotlight players
should match who actually played for them in Week 1. If the data puts a player on
KC but he played elsewhere in Week 1, the roster join is wrong. Use this at the
gate.

## Which players per unit

Pick from the 2026 roster, ranked by 2025 production (reuse the player files'
stats + percentiles):
- **pass O:** primary QB (top 2025 pass attempts) + top 1–2 receivers (targets /
  rec yds among WR/TE)
- **run O:** lead RB (top rush attempts / yards)
- **pass D:** top pass-rusher (sacks / QB hits); optionally a top DB (INT / PD) —
  cautious, thin data
- **run D:** weak individually — optional top tackler (DL/LB by tackles/TFL), or
  omit; don't force it

Each spotlight carries: name, position, a headline 2025 stat line (e.g. "1,100
yds, 8 TD"), the position percentile (already in the player files), and the
`gsis_id` for click-through.

## Data build

New build step → `public/data/matchups/team_players.json`: per team (2026
roster), the key players by unit with their 2025 headline stats, percentile, and
id. The matchup page pairs each with the relevant *opposing* unit rank (which it
already has) at render time. Reuses existing player files for production; no new
data source beyond the 2026 roster.

## UI — respect the scan-first design

The card face is already dense and the user prioritises a 2-second scan, so:

- **Card face: one compact "Watch:" line** naming the 1–2 most *notable*
  individual matchups for the game — a high-percentile player against a weak
  opposing unit (or a marquee player against a strong one). E.g.
  *"Watch: Chase (CIN) vs 30th-ranked pass D."* Notability = player's production
  percentile × how favourable/extreme the opposing unit rank is; surface the top
  1–2. Keep it to one line.
- **Expanded detail ("show detail"): the full breakdown** — key players per unit
  per team, each a clickable link to `/players/{gsis_id}`, each showing their
  2025 headline stat + percentile and the opposing unit rank they face.
- **Click-through everywhere** a player name appears → their profile. This is the
  deferred Phase 3 wiring; make it work on both the Watch line and the detail.

Do not colour player percentiles with anything that implies the *matchup*
outcome — a percentile badge shows the player's own quality (quality palette is
fine there), but the framing text stays unit-level per the honest limit.

## Gate

1. Confirm 2026 rosters exist.
2. Build `team_players.json`.
3. **STOP and report** one team's spotlight players (pick a team with known 2026
   roster change if you can) — verify: no traded-away players, free-agent
   additions show with their 2025 production, rookies handled, and the players
   match who played for that team in Week 1. Do NOT build UI until confirmed.
4. On confirmation, build the Watch line + expanded breakdown + click-through.

## CC prompt

> **Build the player-spotlights nuance feature for /matchups, following `docs/MATCHUPS_SPOTLIGHTS.md`.** Start with `git pull`. Reuses existing player data; the only new input is the 2026 roster (no new external source).
>
> First confirm `import_seasonal_rosters([2026])` returns real 2026 rosters — if not, stop and tell me. Then build `public/data/matchups/team_players.json`: per team (from the 2026 roster), the key players by unit — primary QB and top 1–2 receivers (pass O), lead RB (run O), top pass-rusher and optionally a top DB (pass D), optional top tackler (run D) — each with their **2025** headline stat line, position percentile (from the player files), and gsis_id. Team membership comes from the 2026 roster; production comes from that player's 2025 record wherever he played (a player who changed teams shows on his new team with his old production); rookies/no-2025-data players are flagged, never shown as zero.
>
> Then **stop and report** one team's spotlights (ideally a team with a known 2026 roster change): confirm no traded-away players appear, free-agent additions carry their 2025 production, rookies are handled, and the players match who actually played for that team in Week 1. Do not build UI yet.
>
> Once I confirm, build the UI: a compact "Watch:" line on each card face naming the 1–2 most notable individual matchups (high-percentile player vs a weak/extreme opposing unit), and the full per-unit player breakdown in the expanded detail, with every player name linking to `/players/{gsis_id}` (this wires the click-through deferred since Phase 3). Frame spotlights at UNIT level only — "faces a 30th-ranked pass D", never an implied one-on-one coverage matchup, because the free data has no coverage assignment.
>
> Leave uncommitted for review. Report judgment calls.

## Inspection checklist
- **At the gate:** the sample team's players are actually on that team in 2026 (cross-check Week 1) — no ghosts from 2025, FA moves handled, rookies flagged not zeroed.
- **After UI:** the Watch line names a genuinely notable matchup (a real star vs a real weak unit), reads in one glance, and doesn't clutter the card.
- Click-through from a spotlight lands on the right player page.
- The framing is unit-level — nothing implies "player X beats player Y."
- Reads cleanly on mobile.
