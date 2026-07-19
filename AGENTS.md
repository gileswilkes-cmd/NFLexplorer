<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# NFL Explorer — project rules

Spec: `NFLEXPLORER_SPEC.md` (phases, decisions). Data contract: `docs/DATA_SCHEMA.md`.

- **Start every session with `git pull`** — this repo is synced across machines via GitHub.
- Data source is the free `nfl-data-py` (nflverse) only. **No API keys, no `.env.local`, no runtime secrets.**
- The Next.js client only reads pre-built JSON from `public/data/` (committed). Never ship or fetch raw play-by-play in the browser; aggregate in `ingest/build.py`.
- Any change to the JSON shapes must update `docs/DATA_SCHEMA.md` and, if breaking, bump `schema_version` in `ingest/build.py`.
- All paths must be cross-platform (Vercel builds on Linux): `pathlib` in Python, no Windows-specific paths in `next.config.ts` or scripts.
- NGS-derived metrics exist from 2016 only — 2015 gets `"ngs": null`, rendered as "n/a", never 0.
- Deliver fixes as runnable Node.js scripts, not manual copy-paste steps.
