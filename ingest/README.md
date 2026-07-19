# NFL Explorer — ingest

Python build step. Pulls 2015–2025 data from the free `nfl-data-py` library
(nflverse) and writes compact, pre-aggregated JSON into `public/data/`.
The Next.js app only ever reads that JSON — raw play-by-play never leaves
this directory.

No API key or `.env` is required.

## Setup (any machine, Windows or Linux/macOS)

```bash
cd ingest
python -m venv .venv

# Windows:
.venv\Scripts\activate
# macOS / Linux:
source .venv/bin/activate

pip install -r requirements.txt
```

## Run

```bash
python build.py                 # full build, all seasons (2015–2025)
python build.py --seasons 2025  # rebuild a single season (weekly refresh)
```

Output lands in `public/data/` (committed to the repo — that is the app's
database). The JSON layout is documented in `docs/DATA_SCHEMA.md`.

## Notes

- NGS-derived metrics (CPOE inputs, separation, time-to-throw, …) exist from
  **2016 only**. For 2015 the builder must emit `"ngs": null`, never fake zeros.
- All paths in `build.py` use `pathlib` relative to the repo root — no
  absolute or Windows-specific paths, so the same script runs on any machine
  and in CI.
