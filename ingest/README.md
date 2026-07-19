# NFL Explorer — ingest

Python build step. Pulls 2015–2025 data from the free `nfl-data-py` library
(nflverse) and writes compact, pre-aggregated JSON into `public/data/`.
The Next.js app only ever reads that JSON — raw play-by-play never leaves
this directory.

No API key or `.env` is required.

## Setup (any machine, Windows or Linux/macOS)

**Python 3.11 required** — `nfl_data_py` pins `pandas<2.0`/`numpy<2.0`, which
have no wheels for 3.12+. On Windows: `winget install Python.Python.3.11`.

```bash
cd ingest
# Windows:
%LOCALAPPDATA%\Programs\Python\Python311\python.exe -m venv .venv
.venv\Scripts\activate
# macOS / Linux:
python3.11 -m venv .venv && source .venv/bin/activate

pip install -r requirements.txt
```

## Run

```bash
python build.py                       # full build: all seasons, all players
python build.py --seasons 2025        # rebuild one season (weekly refresh)
python build.py --sample              # baselines + inspection-sample players only
python build.py --players 00-0033873  # baselines + specific GSIS ids
```

Raw pulls are cached as parquet in `ingest/.cache/` (gitignored) — delete a
season's files there to force a re-download. Output lands in `public/data/`
(committed — that is the app's database). The JSON layout is documented in
`docs/DATA_SCHEMA.md`.

## Notes

- NGS-derived metrics exist from **2016 only**. For 2015 the builder emits
  `"ngs": null`, never fake zeros.
- Defensive, kicking, and return stats are aggregated from play-by-play
  events (they are not in the nflverse weekly player stats).
- All paths use `pathlib` relative to the repo root — no absolute or
  Windows-specific paths, so the same script runs on any machine and in CI.
