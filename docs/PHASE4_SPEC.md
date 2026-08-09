# NFL Explorer — Phase 4 spec: history, leaderboards & league trends

Phase 4 reuses data that already exists and is proven — player files, season
baselines, team files. No new ingest path. It's two things: **pre-computed
leaderboard/record data** + **league-evolution trend series**, then the UI on
top.

Because it's lower-risk than Phase 3, the gate is light: build the data, **pause
to inspect two leaderboard categories** (the failure modes below), then build the
UI. One trap has bitten this project before — rate stats without a qualifier — so
that check is non-negotiable.

---

## Why this needs pre-computed data (not client-side ranking)

Ranking can't happen in the browser — it would mean loading thousands of player
files to sort them. So the build emits compact, bounded leaderboard files
(top ~100 per category) that the UI loads directly. Three leaderboard scopes,
because they answer different questions:

```
public/data/leaderboards/
  season/{year}.json     single-season leaders FOR that season (top QBs by yds, 2024)
  records.json           best single-season performances ACROSS 2015–2025 (all-time-in-window)
  career.json            career totals within 2015–2025
public/data/trends.json  league-wide metric series across all 11 seasons
```

Each leaderboard file is keyed `scope → position_group → stat → [entries]`, each
entry `{ id, name, team, season, value, rank }` (career entries omit `season`).
Bound each list to ~100. Player entries link to `/players/{id}`; team-leaderboard
entries link to `/teams/{franchise}`.

---

## Part 1 — Leaderboard & record data (build, then GATE)

Compute from existing player and team season data. **The correctness rules are
the whole job here** — a leaderboard that gets these wrong looks broken:

**1. Rate stats MUST carry a qualifier.** Completion %, Y/A, Y/C, Y/R, EPA/play,
CPOE, YAC-OE, passer-style metrics — any per-attempt stat. Without a minimum, the
leaderboard is topped by a player who went 1-for-1. Apply the position's existing
season qualifier (QB `pass_att >= 224`, etc.). For **career** rate leaderboards,
apply a career-attempts floor sized at roughly 4+ full seasons of real volume
(QB `pass_att >= 2500`, RB `rush_att >= 1000`, WR `targets >= 450`, TE
`targets >= 300`, K `fg_att >= 80`, DL/LB/DB `snaps >= 3000`), not the season
one — a thin floor rewards short, low-volume careers on a board that claims to
rank careers. Counting stats (yards, TDs, tackles) need no qualifier — most is
most, and those boards stay uncapped.

**2. Position filtering.** Rank each stat only within its canonical position
group (reuse `POSITION_STAT_SETS`). Mahomes must not appear on the receiving-yards
board for his 2 career catches.

**3. Negative stats are ranked as rates, not counts.** A raw "fewest INTs" board
ranks whoever threw fewest passes, so it is not the meaningful board either.
Bad-when-high stats become per-opportunity rates (`int_rate` =
`pass_int / pass_att`, `fumble_rate` = `rush_fumbles / rush_att`, `sack_rate` =
`sacks / (pass_att + sacks)`), sorted ascending, always gated by the position
qualifier, each entry carrying its raw count and denominator for display
("1.3% (66 INT / 5268 att)"). No "most INTs" or "most fumbles" board is produced
at all, and `sack_yds` gets no board (derivative of sacks).

**4. Window labelling is data, not just UI.** Every career and all-time entry is
**2015–2025 only**. A career-passing-yards board showing a truncated total will
look like a bug to anyone who knows the player's real career. Carry the window in
the data so the UI can't forget it (see the mandatory UI rule in Part 3).

**5. Team leaderboards.** Best offences/defences by EPA/play, points, PROE
(as *style*, not quality), explosive rate, etc. — single-season across the window
and per-season. Same negative-direction handling for defensive `*_allowed`.

### GATE — stop and report after Part 1

Report, and paste for inspection:
- **One rate-stat board** (e.g. career completion % or EPA/play) — proving the
  qualifier holds and no tiny-sample fluke tops it.
- **One negative-rate board** (INT rate, min attempts) — proving direction and
  qualifier both apply.
- The file sizes and per-category entry counts.

Do **not** build the UI until these two look right. This is the rate-stat trap
that's bitten the project before.

---

## Part 2 — League-evolution trends

A single `trends.json`: league-wide series across 2015–2025 telling the "how the
NFL changed" story. Compute from PBP / existing season aggregates at build time.
Consistent metric definitions across all seasons (same filter regime as the team
build). Suggested series:

- Scoring: points per game
- Passing: league pass rate, early-down pass rate, completion %, aDOT / air yards
- Efficiency: yards per play, EPA/play, sack rate
- **4th-down aggression: go-for-it rate** (great evolution story — rises sharply)
- Two-point-attempt rate; field-goal rate and average made distance
- Rushing share

Structure: `{ "metric": { "series": [{ "season": 2015, "value": … }, … ], "label": …, "unit": … } }`.
Flag any metric whose 2025 value leans on the new-format fallback path, in case
it needs an asterisk.

---

## Part 3 — UI

### `/leaderboards`
Filter controls: **scope** (a season / all-time single-season / career / team),
**position group**, **stat**. Ranked table, click-through to player or team
pages. Two mandatory rules:

- **⚠️ Window label.** Career and all-time views must visibly state
  **"2015–2025"** somewhere unmissable. Non-negotiable — without it the numbers
  look wrong to anyone who knows the sport.
- **Show the qualifier.** When a rate-stat board is filtered, display the
  active qualifier (e.g. "min 224 pass attempts") so the filter is transparent,
  not mysterious.

### `/history` (or `/trends`)
League-evolution line charts over 2015–2025, one per trend metric (or a
selectable set). Reuse the hand-rolled SVG chart approach from the Phase 2 career
arcs — no chart library, consistent with the existing code. Each chart: clear
axis labels, hover readout, the metric's real-world story readable at a glance
(e.g. "go-for-it rate roughly doubled"). Group them so the passing-evolution
story and the 4th-down-aggression story each read clearly.

---

## Out of scope for Phase 4
Multi-season player trend pages, opponent adjustment, anything needing new
ingested data. Trends are league-wide only; per-team trends stay deferred.

---

## CC kickoff prompt

> **Build Phase 4 of NFL Explorer — history, leaderboards, and league trends — following `docs/PHASE4_SPEC.md`.** Start with `git pull`. This reuses existing player, season, and team data; no new ingest path.
>
> First do Part 1: compute the leaderboard and record data files (`leaderboards/season/{year}.json`, `leaderboards/records.json`, `leaderboards/career.json`) and team leaderboards, applying the correctness rules exactly — rate stats carry the position's qualifier (career rate boards use a career-attempts floor), rank only within canonical position groups, negative stats sort ascending, and every career/all-time entry is bounded to 2015–2025. Then **stop and report**: paste one rate-stat board and one negative-stat board for inspection, plus file sizes and entry counts. Do NOT build the UI yet — this is the rate-stat qualifier trap that's bitten the project before.
>
> Once I confirm, build Part 2 (`trends.json` — the league-evolution series, consistent definitions across seasons, flagging any 2025 metric on the fallback path) and Part 3 (the `/leaderboards` page with scope/position/stat filters and click-through, and the `/history` page with hand-rolled SVG trend charts reusing the Phase 2 chart approach). Two mandatory UI rules: career/all-time views must visibly state "2015–2025", and rate-stat boards must show the active qualifier.
>
> Do not add opponent adjustment, per-team trends, or anything needing new data. Deliver fixes as runnable Node scripts where applicable. Report what you built and any judgment calls.

---

## Inspection checklist (after the gate, and after the UI)

**At the gate:**
- The rate-stat board's top entry is a real qualified player, not a 1-attempt fluke.
- The negative-rate board sorts ascending (lowest rate) and respects the
  qualifier, and each row shows the count/denominator behind the rate.
- No out-of-position names (no QBs on receiving boards).

**After the UI:**
- Career/all-time views show the **2015–2025** label — spot-check a career
  passing board; the totals should look truncated-but-correctly-labelled, not
  mysteriously wrong.
- A rate-stat board shows its qualifier.
- Click-through from a leaderboard row lands on the right player/team page.
- The 4th-down go-for-it trend rises across the window (a good sanity check that
  the trend series is real, not flat noise).
