# /matchups — weekly refresh + frozen prediction snapshot (the keystone)

Two jobs in one build:
1. **Keep the page current** — the season is live, "what's next" moves every few
   days, so schedule, scores, and odds must refresh weekly or the whole page goes
   stale.
2. **Capture the ex ante record** — freeze, each week before kickoff, what the
   model and the market predicted, so you can later compare *what was expected* vs
   *what happened*. This is the foundation for the look-back study.

**Urgency:** every week without the snapshot is ex ante data lost permanently —
a played game's pre-game forecast can't be reconstructed (market lines are gone;
and a recomputed model "prediction" isn't a prediction). So build Parts 1+2 first
and run them **before this coming week's games**, then build the look-back page.

## Decisions

| Choice | Decision |
|---|---|
| How it runs | **Manual weekly script**, not automation. Fits the pull-and-commit model, keeps the API key local, nothing in the cloud to break. |
| Ratings | **Stay pure-2025 for now.** Blending in current-season data (the self-correcting model) is a separate, bigger decision — deferred. The snapshot is built now anyway (see why below). |
| Snapshot timing | Captured at refresh time (lines posted, before kickoff). **Once a game has kicked off, its snapshot is frozen — never overwritten.** |
| meta.json | Fold in the **merge-not-replace** fix parked since Phase 1 — a weekly refresh that clobbers the seasons list is the exact bug that fix prevents. |

### Why snapshot now, even with static ratings
With static 2025 ratings the *model* portion doesn't change week to week — so why
freeze it? Because (a) the **market line is genuinely ephemeral** — it moves and
gets overwritten each pull, so freezing it is the only way to keep it; (b) it
establishes the frozen-record infrastructure **before** you ever make ratings
dynamic, so no ex ante data is lost when you do; and (c) even a static model's
calls are worth grading — does the 2025 rating actually predict 2026 games? The
ex ante/ex post study is meaningful from day one.

---

## Part 1 — the weekly refresh procedure

A single orchestrating script (e.g. `npm run refresh:week`) run manually once a
week, that:
1. `git pull`.
2. **Refresh schedule + scores** — re-pull `import_schedules(2026)` → update
   `schedule_2026.json` (scores fill in for played games).
3. **Refresh odds** — run the existing odds pull → `odds_2026.json`.
4. **Write the prediction snapshot** for the upcoming week (Part 2).
5. Report what changed and **stop for the user to review, commit, push** — do not
   auto-commit (the user reviews first, and the key must never be committed).

**meta.json merge fix (fold in):** the refresh must **merge** the seasons/build
metadata, never replace it — re-pulling one season must not drop the others from
`meta.json`. This is the Phase 1 backlog item; the weekly refresh is where it
bites, so fix it here.

---

## Part 2 — the frozen prediction snapshot (the ex ante capture)

Write `public/data/predictions/week_{N}.json` capturing, per game in the upcoming
week, **both forecasts as they stand now**:

```jsonc
{
  "week": 3, "captured_at": "2026-09-23T14:00:00Z",
  "games": [
    { "game_id": "...", "away": "CIN", "home": "MIN", "kickoff": "...",
      "model":  { "favourite": "CIN", "lean": "edge", "margin_est": 14,
                  "tags": ["Shootout"], "verdict": "…the frozen verdict text…" },
      "market": { "favourite": "CIN", "spread": 3.0, "total": 48.5, "book": "draftkings" },
      "captured": true }
  ]
}
```

**The freeze rule (non-negotiable — this is the whole point):**
- Capture only games **not yet kicked off**. For the upcoming week, write/refresh
  their forecasts (lines move, so re-running before kickoff updates them — the
  last pre-kickoff capture stands).
- **Once a game has kicked off, never overwrite its snapshot.** A played game's
  forecast is locked forever.
- **Do not back-fill** played games that were never captured (e.g. Week 1, already
  underway). Mark them `"captured": false` rather than reconstructing a forecast —
  a recomputed prediction isn't ex ante, and the market line is unrecoverable.
  The honest record simply starts from the first week you run this.

So: the model verdict/lean/margin is the value computed **at capture time** from
whatever ratings are live then, and the market total/spread is what was posted
**at capture time** — both frozen. The look-back later reads these frozen values;
it must **never recompute the model** for a past game.

---

## Part 3 — the look-back page (follow-up, once snapshots exist)

`/matchups/history` (or a look-back tab): for each past week, per game, show the
**three columns** side by side:
- **Model (ex ante):** the frozen verdict/favourite/margin.
- **Market (ex ante):** the frozen spread/total.
- **Actual:** the final result (from `schedule_2026.json` scores).

Then **grade both forecasts** against the actual:
- Did the model's favourite win? Did the market's favourite cover the spread?
- Was the total over/under? Which of model/market was closer on the game's
  character (e.g. did the "Shootout" tag match a high-scoring game)?
- A running tally over the season: model hit-rate vs market hit-rate — the
  genuine "does my EPA read have predictive value" answer.

Games marked `"captured": false` show actual result only, noted as "no pre-game
capture." Build this **after** Parts 1+2 have run at least once, so there's
snapshot data to display.

## Deferred (not this build)
- **Rating blending** (self-correcting model) — its own scoping decision.
- **`nflreadpy` migration** — the refresh runs on the current library for now to
  avoid coupling two hard changes; migrate as a focused follow-up (flag it).
- **Injuries** — plugs into this same weekly script later.

## Gates
1. Build Part 1 + Part 2. Run the refresh once. **Stop and report:** what the
   refresh updated (scores/odds), and the contents of the first
   `predictions/week_{N}.json` — confirm it captured the upcoming week's games
   with both forecasts, and correctly marked already-played games `captured:false`
   without back-filling.
2. On confirmation, commit that first snapshot (the ex ante record begins).
3. Build Part 3 (look-back page) once snapshots exist to display.

## CC prompt (Parts 1 + 2 — the immediate build)

> **Build the weekly refresh procedure and the frozen prediction snapshot for /matchups, following `docs/MATCHUPS_REFRESH.md`.** Start with `git pull`. Manual weekly script, not automation; ratings stay pure-2025 for now.
>
> Part 1 — a single script (`npm run refresh:week`) that: git-pulls, re-pulls `import_schedules(2026)` to update `schedule_2026.json` with played scores, runs the existing odds pull to refresh `odds_2026.json`, writes the prediction snapshot (Part 2), then reports what changed and stops for me to review/commit — no auto-commit. Fold in the parked meta.json fix: the refresh must MERGE the seasons/build metadata, never replace it (re-pulling one season must not drop the others).
>
> Part 2 — write `public/data/predictions/week_{N}.json` capturing, per upcoming-week game, the model forecast (favourite, lean, margin estimate, tags, the verdict text) AND the market forecast (favourite, spread, total, book) exactly as they stand at capture time. Freeze rule, non-negotiable: capture only games not yet kicked off; once a game has kicked off never overwrite its snapshot; do NOT back-fill already-played games that were never captured — mark them `captured:false` rather than reconstructing a forecast. The look-back will read these frozen values and must never recompute the model for a past game.
>
> Then STOP and report: what the refresh updated, and the contents of the first `week_{N}.json` — confirm it captured the upcoming week with both forecasts and marked already-played games `captured:false`. Do not build the look-back page yet.
>
> Leave uncommitted for review. Report judgment calls.

## Inspection checklist (at the gate)
- The refresh updated scores for played games and odds for upcoming ones, and
  meta.json still lists **all** seasons (the merge fix works).
- `week_{N}.json` exists, captures the upcoming week's games, and each game has
  both a model and a market forecast frozen in.
- Already-played games are `captured:false`, NOT back-filled with a reconstructed
  prediction.
- Re-running the refresh before kickoff updates an upcoming game's line but a
  played game's snapshot is untouched.
