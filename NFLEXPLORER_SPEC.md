# NFL Explorer — Build Spec

A father-and-son NFL statistics explorer: teams, players, comparisons, and history.
Location: `C:\Projects\NFLExplorer` · Deploy: Vercel · Sync: GitHub.

---

## 1. Decisions locked

| Question | Decision |
|---|---|
| Data source | **Free nflverse only** (`nfl-data-py`). Add BallDontLie GOAT ($40/mo) later *only* if a feature demands live data. No paid feed, no API key for v1. |
| History depth | **2015–2025.** (NGS-derived metrics only exist from 2016, so 2015 has standard + EPA/CPOE but no NGS tracking — handle gracefully.) |
| First build | **Players first.** Teams and history layer on after. |
| Updates | **Weekly refresh** during the season. No live/in-game data. |
| Scope | **Standalone.** No link to the existing `NFL_exploration` scouting project. |

**Why free is not a compromise:** nflverse gives play-by-play, seasonal/weekly aggregates, rosters, snap counts, combine, and NGS-derived advanced metrics (CPOE, air yards, separation, time-to-throw) at no cost — the same source the fantasy DB already uses. The providers originally considered don't sell consumer API keys anyway (PFF is B2B/CSV-only; Next Gen Stats is club-only).

---

## 2. Architecture

Mirrors the proven fantasyboard stack, with one deliberate constraint.

```
Python ingest (nfl-data-py)  ──►  build step  ──►  compact per-entity JSON  ──►  Next.js on Vercel
   (2015–2025 pulls)              (aggregate)        (committed to repo)          (reads JSON)
```

- **Never ship raw play-by-play to the browser.** 11 seasons of PBP is gigabytes. The build step aggregates PBP into small per-player / per-team / per-season JSON files. The client only ever loads compact, pre-computed JSON.
- **No runtime secrets for v1.** The free route needs no API key, so there is no `.env.local` to create per machine (unlike fantasyboard). If BallDontLie is added later, that changes.
- **Cross-platform paths everywhere.** Vercel builds on Linux — no Windows-specific paths in `next.config.ts` or build scripts, or deployment breaks.
- **JSON schema is decided up front** (Phase 0). It's the expensive thing to change later.

### Data pulled from `nfl-data-py`
- `import_weekly_data`, `import_seasonal_data` — core box + derived stats
- `import_seasonal_rosters` / `import_players` — identity, position, team, headshots
- `import_ngs_data` (passing / rushing / receiving) — NGS tracking, **2016+**
- `import_snap_counts` — usage / snap share
- `import_pbp_data` — for EPA, CPOE, air yards, situational splits (aggregated at build time)
- `import_schedules`, `import_team_desc` — context for the team phase later
- `import_combine_data` — optional player-profile enrichment

---

## 3. Phased build

### Phase 0 — Scaffolding
- Next.js app in `C:\Projects\NFLExplorer`, GitHub repo, first Vercel deploy (empty shell).
- Python ingest skeleton + a single `build.py` that writes JSON to a `/public/data` (or `/data`) tree.
- **Define and document the JSON schema** for players, player index, and season aggregates.
- Confirm cross-platform path handling; confirm `git pull` at session start on any machine.

### Phase 1 — Player core *(the addictive centre)*
- Ingest 2015–2025 weekly + seasonal + rosters + NGS + snap counts.
- Build: `players/index.json` (search), `players/{id}.json` (per-season + career + game logs).
- Front-end: fast search/autocomplete → player profile page.
- **Position-aware stat sets** (passing / rushing / receiving / defence / kicking / returns).
- Per-game · season · career views; game logs.
- **Percentile context on every metric** so a number always sits against the league.
- Advanced layer from free data: EPA/play, CPOE, air yards, aDOT, YAC(+over expected), target share, snap share, plus NGS speed/separation/time-to-throw (2016+; show "n/a" for 2015).

### Phase 2 — Player comparisons
- Side-by-side two-player tables.
- Radar / percentile-bar visuals.
- Career-arc overlay (two trajectories on one chart).
- **Era-adjusted comparison** — normalise each season against that year's league baseline so 2015 vs 2024 is fair.

### Phase 3 — Teams
- Team ingest → team pages: offence/defence splits, per-game, per-play.
- Efficiency layer: EPA/play both sides, success rate, pass/rush splits, neutral pace.
- Situational: red zone, third down, two-minute, by down/distance.
- League-context percentile ranking on every team metric.

### Phase 4 — History & league
- Leaderboards with filters; all-time records (within 2015–2025).
- League-evolution trend charts (e.g. passing rate over the window).
- Filterable record book.

### Phase 5 — Polish & automation
- Weekly refresh script (re-pull latest season, rebuild JSON, commit).
- UI polish pass; shareable comparison URLs; favourites for both users.

---

## 4. Working notes (carried from existing workflow)
- Deliver code fixes as **runnable Node.js scripts**, not manual copy-paste steps.
- `git pull` at the start of every session on any machine.
- `--dangerously-skip-permissions` on the home machine (`C:\Projects\`) only.
- Iterative phases; don't attempt everything at once.

---

## 5. Claude Code kickoff prompt

*Paste this at the start of the first Claude Code session (begins with an action verb by design; CC has no memory between sessions).*

> **Build the scaffolding for a new project, NFL Explorer, at `C:\Projects\NFLExplorer`.** It is a personal NFL statistics explorer (for me and my son) covering team stats, player stats, player/team comparisons, and history for seasons 2015–2025. Stack: Python for data ingest, Next.js for the web app, deployed to Vercel, synced via GitHub — the same pattern as my existing `fantasyboard` project. Data comes exclusively from the free `nfl-data-py` library (nflverse); there is **no external API key and no `.env.local` secret** for this project. Architecture: a Python `build.py` pulls 2015–2025 data and writes compact, pre-aggregated JSON per entity into the app; the Next.js client only ever reads that JSON. **Never ship raw play-by-play to the browser** — aggregate it at build time. All paths must be cross-platform (Vercel builds on Linux; no Windows-specific paths in `next.config.ts`).
>
> For this first session, do Phase 0 only: (1) scaffold the Next.js app and initialise the GitHub repo; (2) create the Python ingest skeleton and an empty `build.py`; (3) design and write out the JSON schema for a player index, per-player files, and season aggregates, and document it in the repo. Do not build UI features yet. Deliver any fixes as runnable Node scripts. Start by running `git pull`.

Then work through Phases 1–5 in order in later sessions.
