# /matchups card restyle — instruction for Claude Code

Restyle the game cards on `/matchups` only. Data, tags, sort, interest score,
and the caption are all correct — this is **presentation of the four unit
matchups**, nothing else. Do not touch the matchup logic, the ratings, or the
page's data loading.

## The problem being fixed
Each card currently repeats "pass O / pass D / run O / run D" in every one of the
four cells — the same labels four times, in small grey type. That's the clutter.
The grid position already encodes which unit is which, so the labels are
redundant. Move them to column/row headers once and delete them from the cells.

## Target layout (per game card)

A compact **2×2 grid** with axes labelled once:

- **Columns = PASS | RUN** (two header labels above the grid, once).
- **Rows = each team attacking**: top row the away/first team on offence, bottom
  row the home/second team on offence. Each row is labelled on the left with the
  attacking team's code + a small "att" (e.g. `DAL att`).
- **Each of the four cells** shows only: the offence unit's rank, a small "v", the
  opposing defence unit's rank, then the signed edge. Nothing else — no "pass O",
  no "run D" text in the cell.
  - Left rank = offence, right rank = defence (state this in the legend, below).
  - Rank shown as a bare number (no "th/st/nd" suffix).
- **One small legend** under the grid, once per card: teal swatch = "top 8",
  coral swatch = "bottom 8", and "left number = offense rank".

Delete: the per-cell unit labels, and the edge bars (not wanted). Keep: the game
header (team codes + @ + tag chip), the date + interest line, the game-level tag,
the per-matchup tag (e.g. "Points likely") as a single line under the grid naming
which matchup it applies to, the "show EPA detail" expander, and the caption.

## Colour — rank quality, NOT red/green
Tint each rank by tier. **Do not use red/green** (fails for reduced colour
vision, which is the point — the user has failing sight). Use:
- **top 8 (strong):** teal — bg `#E1F5EE`, text `#0F6E56` (light). Dark mode:
  use the CDS teal ramp equivalents / existing quality tokens so it flips.
- **bottom 8 (weak):** coral — bg `#FAECE7`, text `#993C1D` (light).
- **middle (9–24):** neutral grey — bg `var(--surface-1)` / muted text.
- The rank **number** is the primary signal; colour is reinforcement. Make sure
  it's readable in dark mode — don't hardcode the light hexes only; reuse the
  existing quality palette tokens the player/team pages already use so it adapts.

## Legibility (this is the brief, not a nice-to-have)
The user is 54 with failing sight. Bias every size up:
- Rank numbers ~16px, weight 500, in roomy pills.
- Edge number ~17px, weight 500.
- Team code in the game header ~19px.
- Generous cell padding and row spacing; the grid should breathe, not cram.
- Minimum any text on the card: 12px (the legend). Nothing smaller.

## Mobile-first
It renders better on mobile and that's a primary use. Ensure:
- The 2×2 grid holds its shape on a phone (roughly 380px wide) without wrapping
  a cell's contents onto extra lines — the whole point is a clean block.
- On desktop the existing two-cards-across layout is fine; just don't let the
  desktop grid stretch the cells so wide they look empty. `minmax(0, 1fr)` on grid
  columns to prevent overflow.

## What NOT to change
- No change to `matchups.ts`, `unit_ratings.json`, `schedule_2026.json`, the tag
  thresholds, the interest sort, or the week picker.
- The mandatory caption stays exactly as-is and visible.
- Click-through (team code → `/teams/{code}`) stays.

## After
Restyle, verify locally on a narrow (mobile-width) viewport AND desktop, confirm
the 2×2 reads cleanly and the caption is still present, and report. Leave
uncommitted for review. Deliver any fix as a runnable script where applicable.

---

## CC prompt

> **Restyle the game cards on `/matchups` — presentation only, no logic changes.** Start with `git pull`. Follow `docs/MATCHUPS_CARD_RESTYLE.md`.
>
> Replace the current four-cell layout (which repeats "pass O / pass D / run O / run D" in every cell) with a compact 2×2 grid that labels the axes once: column headers PASS and RUN, and two rows labelled by the attacking team ("DAL att" / "NYG att"). Each cell shows only the offence rank, a small "v", the defence rank, and the signed edge — no per-cell unit-type labels. Ranks are bare numbers (no th/st suffix), tinted by tier: teal for top 8, coral for bottom 8, neutral grey for the middle — reusing the existing quality-palette tokens so it works in dark mode. NOT red/green. Add one small legend per card (teal = top 8, coral = bottom 8, left number = offense rank). Remove the edge bars — not wanted.
>
> Bias all sizes up for legibility (rank numbers ~16px, edge ~17px, team code ~19px, nothing under 12px, generous spacing) — the user has failing sight and this is the brief. Mobile-first: the 2×2 must hold its shape at ~380px wide without cells wrapping; use `minmax(0, 1fr)` so desktop columns don't overflow or stretch empty.
>
> Do not touch `matchups.ts`, the ratings/schedule data, the tags, the interest sort, the week picker, the click-through, or the caption — the caption stays visible exactly as-is. Keep the game header, date/interest line, game-level and per-matchup tags, and the "show EPA detail" expander. Verify on both a mobile-width and desktop viewport, leave uncommitted for review, and report any judgment calls.
