# /matchups — verdict line + legend relocation (step 1 of 3)

Two changes to the `/matchups` cards. Presentation + a small transparent
derivation from data already on the card. No new data, no API, no schedule
change. (Odds and the look-back memory are steps 2 and 3, not this.)

## Change A — a plain-English verdict line per card

Right now the card shows the *inputs* (ranks, edges) and a buried
"DAL run: Points likely" line, leaving the reader to synthesise. Add a
**prominent one- to two-sentence verdict** that states the takeaway, derived
transparently from the four edges — every claim traces to a number already
visible on the card, so nothing is a hidden model.

**Cautious by design.** The ratings are a 2025 extrapolation, so the verdict
uses hedged, matchup-language verbs — *should, likely, may, edge to, favoured* —
and **never** predicts a winner outright or a scoreline. It describes the
matchup, not a guaranteed result. The page-level caption already carries the
"2025 basis" disclaimer, so no per-card disclaimer is needed.

### Derivation (put this in `matchups.ts`, transparent and simple)

For each game, compute a `verdict` from the four unit matchups:

**1. Lean (who has the advantage):**
```
for each team: offEdgeSum = pass_off_edge * 1.5 + run_off_edge   // pass-weighted, as the interest score
advantage = teamA.offEdgeSum - teamB.offEdgeSum                   // + → A favoured
favourite = team with the higher offEdgeSum
by |advantage|:   < 10 → "even"   |   10–30 → "edge to <fav>"   |   > 30 → "<fav> clearly favoured"
```
(Sanity-check the thresholds against Week 1 and adjust if the buckets feel off —
report the values chosen.)

**2. Dominant matchup (the story):** the unit matchup with the largest `|edge|`.
- offence-favoured (Points-likely tier): *"<off>'s <pass/run> offence should move the ball against <def>'s <rank>-ranked <pass/run> defence"*
- defence-favoured (Shutdown-likely tier): *"<off>'s <pass/run> offence may struggle against <def>'s <rank>-ranked <pass/run> defence"*

**3. Character (from the existing game tag):**
Shootout → "points likely on both sides" · Defensive struggle → "low-scoring" ·
Clash → "elite units collide" · Lopsided/Even → nothing extra (the lean covers it).

**Compose** a cautious 1–2 sentence string from those parts. Worked examples
(these are the target voice):
- CLE @ JAX → *"Jacksonville's defence should dominate — Cleveland's offence (32nd pass, 26th run) faces a top-tier Jaguars unit. Low-scoring; edge to JAX."*
- DAL @ NYG → *"Both offences hold big edges over weak defences — points likely on both sides. Roughly even."*

### Placement
Directly under the team header and tag chip, **above the grid** — it's the
card's headline. Readable size (~15–16px), a touch more prominent than the
date/interest line. It **replaces** the current standalone
"DAL run: Points likely" summary line under the grid (that story now lives in
the verdict). Per-matchup tags inside cells, if any, can stay.

## Change B — move the legend out of every card

The "top 8 / bottom 8 / left number = offense rank" legend currently repeats on
every card, wasting space. Remove it from the cards and place it **once**, at the
top of the page — a single compact line near the caption / week picker. Same
information, shown once.

## What NOT to touch
Ratings, schedule, tags, interest sort, week picker, click-through, the 2×2 grid
styling just shipped, and the mandatory page caption (stays visible, unchanged).

## After
Restyle + derive, verify locally on mobile-width and desktop, confirm the
verdict reads cleanly and cautiously (no "will win", no scorelines) and the
legend now appears once at the top. Leave uncommitted for review; report the
lean thresholds chosen and any judgment calls.

---

## CC prompt

> **Add a verdict line to the `/matchups` cards and move the rank legend to the page top — following `docs/MATCHUPS_VERDICT.md`.** Start with `git pull`. No new data or API; this derives from the edges already computed.
>
> In `matchups.ts`, compute a per-game `verdict` transparently from the four unit edges: a **lean** (each team's pass-weighted offensive-edge sum — pass ×1.5 + run — the higher is the favourite; bucket the difference into even <10 / edge to X 10–30 / clearly favoured >30, and sanity-check those thresholds against Week 1), the **dominant matchup** (largest |edge|, phrased "should move the ball against Nth-ranked D" if offence-favoured or "may struggle against Nth-ranked D" if defence-favoured), and **character** from the existing game tag (Shootout → points both sides, Defensive struggle → low-scoring, Clash → elite units collide). Compose a cautious 1–2 sentence string — hedged verbs only (should/likely/may/edge to), never "will win" or a predicted scoreline, because the ratings are a 2025 extrapolation.
>
> Render it prominently under the team header/tag chip and above the grid (~15–16px), replacing the current standalone "DAL run: Points likely" summary line. Target voice, e.g. "Jacksonville's defence should dominate — Cleveland's offence (32nd pass, 26th run) faces a top-tier Jaguars unit. Low-scoring; edge to JAX."
>
> Separately, remove the "top 8 / bottom 8 / left number = offense rank" legend from every card and show it once at the top of the page near the caption/week picker.
>
> Do not touch ratings, schedule, tags, interest sort, week picker, click-through, the 2×2 grid styling, or the page caption. Verify on mobile-width and desktop, leave uncommitted for review, and report the lean thresholds chosen and any judgment calls.

## Check when it's back
- The verdict reads as a cautious matchup statement, not a prediction of victory — no "will win", no scorelines.
- CLE @ JAX names Cleveland's offence getting dominated (your own read of that game).
- A roughly-even game (DAL @ NYG) says so rather than forcing a favourite.
- The legend appears once at the top, not on every card, and the page looks less cluttered.
- Reads cleanly on your phone.
