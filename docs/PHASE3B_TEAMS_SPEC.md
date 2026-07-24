# NFL Explorer — Phase 3b spec: full team build + team pages

Phase 3a proved the schema and ingest on three contrasting samples (CIN / GB /
DEN). Inspection passed: records externally correct (including CIN's 16-game
2022), play counts reconcile, defensive inversion works both directions, and
the fingerprint tells a real story across seasons (CIN PROE 0.01 → 0.11,
shotgun 0.63 → 0.85, aDOT 8.8 → 7.1 — a spread offence emerging in the data).

3b is: two small ingest checks, the full 32-franchise run, then the UI.

---

## Part 1 — Two checks before the full run

Both surfaced in the CIN inspection. Cheap now, annoying later.

**1a. Null-down plays.** CIN 2024's down×distance cells sum to 1,066 against
1,069 total offensive plays — three plays with no `down`. Almost certainly
two-point conversions. Confirm what they are; if so, document that the
down×distance grid intentionally excludes them (it should — a 2pt try has no
down). No fix needed if that's the cause, just an explicit note in the schema
doc so the discrepancy isn't rediscovered later.

**1b. `run_dir` middle share instability.** CIN middle-run share swings
0.213 (2015) → 0.095 (2016) → 0.265 (2024). Could be genuine scheme change, but
check whether rush attempts with a missing `run_location` / `run_gap` are being
dropped and silently redistributing the shares. If plays are being dropped,
either include an `unknown` bucket or document the exclusion and report the
share of rushes it covers. This is one of the six fingerprint axes, so it needs
to be trustworthy.

---

## Part 2 — Full build

Run all 32 franchises × 11 seasons (2015–2025), plus `team_baselines` for every
season. Relocations already handled (one file per franchise, current code as
key, season rows carrying the era `code`).

Report: franchise count (expect 32), total file size, any franchise-season that
failed or produced null-heavy output, and confirmation that every season has 32
teams (this is the check that caught the relocation bug — 2015 previously built
29).

---

## Part 3 — Team pages

Route: `/teams` (index) and `/teams/{franchise}` with a **season picker**
(default: most recent). One team, one season — trends deferred.

### ⭐ Hero: the down × distance heatmap

Grid: **rows = down (1–4)**, **columns = distance (short ≤3 / medium 4–6 /
long ≥7)**. Two grids — offence and defence — via toggle or side-by-side.
Colour by **EPA/play**, with a **success-rate toggle**.

**Small-sample handling — mandatory, not optional.** Cell play counts vary
enormously: CIN 2024 has 446 plays in `1_long` but 1 in `4_medium`, where a
single conversion produced EPA **+4.041**. Coloured naively, the two most
eye-catching cells on the hero visual would be single-play noise. So:

- **Desaturate below ~20 plays** — scale colour intensity by sample size so
  thin cells visibly recede rather than shouting.
- **Show the play count in every cell** alongside the value, so the reader can
  see *why* a cell is faded without hovering.
- **Empty cells (`plays: 0`, no EPA key) render as visibly empty** — never as
  zero, which would read as "average". Several exist (CIN 2015 `4_long`, 2016
  `4_medium`, 2022 `4_long`).
- Hover shows EPA, success rate, and play count together.

The goal is that "lethal on 3rd-and-short, falls apart on 2nd-and-long" is
readable at a glance — and that a one-play 4th-down cell never masquerades as a
team strength.

### Page sections (below the hero)

1. **Summary** — points/yds/plays per game, EPA/play, success rate; offence and
   defence side by side, each with its league percentile badge.
2. **Scheme fingerprint** — the six axes (PROE, early-down pass rate, neutral
   pace, shotgun rate, aDOT, run direction) as a radar or bar set.
   **See the palette rule below — this section is style, not quality.**
3. **Scheme cross-tabs** — the four splits (shotgun vs under-centre, early-down
   pass vs run, pass-heavy vs balanced, deep shots), each showing EPA/play,
   success rate, and sample size per side. This is the "how do they perform
   when they do X" layer — the tactical heart of the page.
4. **By play type** — pass vs rush efficiency, offence and defence.
5. **Defence results** — EPA/success allowed by play type, explosive rate
   allowed, sack rate. Label the section so it reads as *results allowed*, not
   scheme (the free data has no coverage/blitz/front).

### ⚠️ Palette rule: style axes are NOT quality

The diverging red→neutral→blue quality palette used on player pages must **not**
be applied to fingerprint axes. A high PROE percentile means "more pass-happy
than the league", not "better". CIN 2023 sits at the 5th percentile for aDOT and
deep-shot rate — that's a short-passing identity, not a failing. Colouring it
red would state something false.

- **Quality metrics** (EPA, success rate, points, explosive rate allowed, sack
  rate, all `*_allowed`): diverging quality palette, as on player pages.
- **Style axes** (PROE, early-down pass rate, neutral pace, shotgun rate, aDOT,
  run direction): a **single-hue, non-judgemental** scale, visually distinct
  from the quality palette, labelled as tendency (e.g. "more pass-heavy than
  91% of teams" — never "91st percentile" bare, which implies rank).
- **Neutral pace needs a caption.** The metric excludes clock-stopped snaps, so
  it runs ~6s above published pace figures (league mean ~37s, not ~31s). Label
  it plainly — e.g. "seconds between snaps, clock-running plays only" — so
  nobody compares it to a number from elsewhere.

---

## Part 4 — Team comparison

Mirror the player compare page: `/teams/compare?a={fr}&b={fr}&season={year}`,
shareable via URL params, reusing the existing selection pattern.

- Side-by-side summary + percentile bars.
- **Fingerprint radar overlay** — two teams' six style axes on one radar. This
  is the payoff: CIN vs GB 2024 should look visibly, obviously different.
- **Heatmap diff** — optional but high value: cell-by-cell EPA difference
  between the two teams, same small-sample desaturation rules.
- Same-season comparison by default; allow cross-season selection (each team
  keeps its own season picker), since percentiles are computed within-season and
  therefore remain comparable across years.

---

## Out of scope for 3b

Special teams, roster/player click-through, drive metrics, opponent adjustment,
multi-season trend views. All deferred — do not add them.

---

## CC kickoff prompt

> **Build Phase 3b of NFL Explorer following `docs/PHASE3B_TEAMS_SPEC.md`.** Start with `git pull`.
>
> First do the two ingest checks in Part 1 (null-down plays in the down×distance grid; whether rushes with missing run location are being dropped from `run_dir` shares) and report findings before proceeding. Then run the full 32-franchise × 11-season build plus `team_baselines`, and confirm every season contains 32 teams.
>
> Then build the team pages per Part 3: `/teams` index and `/teams/{franchise}` with a season picker, hero down×distance heatmap (offence + defence, EPA with a success-rate toggle), summary, scheme fingerprint, the four scheme cross-tabs, by-play-type, and defence results.
>
> Two UI rules are mandatory. (1) **Small-sample handling in the heatmap**: desaturate cells below ~20 plays, show the play count in every cell, and render zero-play cells as visibly empty rather than zero — a one-play cell with EPA +4.0 must not read as a team strength. (2) **Style axes must not use the quality palette**: fingerprint metrics (PROE, early-down pass rate, neutral pace, shotgun rate, aDOT, run direction) get a separate non-judgemental single-hue treatment and tendency-worded labels, because a high PROE means "more pass-happy", not "better". Caption neutral pace to note it excludes clock-stopped snaps.
>
> Finally build `/teams/compare` per Part 4, mirroring the existing player compare: URL-shareable, side-by-side summary, fingerprint radar overlay, and a heatmap diff.
>
> Do not add special teams, player click-through, drive metrics, or opponent adjustment. Report what you built and any judgment calls. Deliver any fixes as runnable Node scripts where applicable.

---

## Inspection checklist (after 3b)

- Every season has **32 teams** (the relocation-bug canary).
- The heatmap's thin cells are **visibly faded** and a 1-play 4th-down cell does
  not draw the eye; zero-play cells read as empty, not average.
- Fingerprint axes render in the **style** palette, not red/green — check a team
  with low aDOT (CIN 2023) doesn't look "bad".
- **CIN vs GB 2024** on the compare radar look obviously different.
- Neutral pace carries its caption.
- Spot-check one team's record against reality (the strongest external check —
  CIN's 16-game 2022 was the tell in 3a).
