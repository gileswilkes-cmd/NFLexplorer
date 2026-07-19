# NFL Explorer

A father-and-son NFL statistics explorer: teams, players, comparisons, and
history for seasons **2015–2025**. Full spec: `NFLEXPLORER_SPEC.md`.

## How it works

```
Python ingest (nfl-data-py)  ──►  build step  ──►  compact per-entity JSON  ──►  Next.js on Vercel
   (2015–2025 pulls)              (aggregate)      (committed: public/data/)      (reads JSON)
```

- Data comes exclusively from the free **nflverse** via `nfl-data-py` — no API
  key, no `.env.local`, no runtime secrets.
- `ingest/build.py` aggregates everything (including play-by-play) into small
  per-player / per-team / per-season JSON files under `public/data/`, which are
  committed to the repo. **Raw play-by-play never ships to the browser.**
- The JSON contract is documented in `docs/DATA_SCHEMA.md` — read it before
  changing either side.

## Develop

```bash
git pull        # always, at the start of every session, on any machine
npm install
npm run dev     # http://localhost:3000
```

Data rebuilds (Python 3, no key needed): see `ingest/README.md`.

## Project layout

```
src/            Next.js app (App Router, TypeScript, Tailwind)
public/data/    the "database": build-generated JSON (committed)
ingest/         Python build step (build.py, requirements.txt)
docs/           DATA_SCHEMA.md — the JSON contract
```

## Status

Phase 0 (scaffolding + schema) complete. Next: Phase 1 — player ingest,
search, and profile pages. Phases are listed in the spec.
