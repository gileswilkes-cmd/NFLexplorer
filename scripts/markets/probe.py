"""Throwaway discovery probe for the /markets page (nfl_markets_page_cc_prompt.md
Stage 1). Hits the live Kalshi + Polymarket public APIs, finds the NFL
game-winner series/tag on each, fetches open games for the next 14 days,
and attempts to match them across venues by (away, home) team code.

Not wired into the app, not covered by CI, not meant to survive past Stage 1
review — scripts/markets/samples/ is gitignored and this file exists purely
to verify real API shapes before any TypeScript is written (see the prompt's
"do not trust any field name in this prompt over what the live API actually
returns").

Usage: ingest/.venv/Scripts/python.exe scripts/markets/probe.py
(uses the existing ingest venv purely for a stable Python 3.11 interpreter;
no project dependency on nfl_data_py/pandas here — stdlib only.)
"""

from __future__ import annotations

import json
import re
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
SAMPLES_DIR = SCRIPT_DIR / "samples"
HORIZON_DAYS = 14

# Canonical team codes mirrored from ingest/pull_odds.mjs's TEAM_NAME_TO_CODE
# (that file is the existing source of truth for "our" codes; Stage 2 should
# share one copy between the odds pull and lib/markets/ instead of each
# maintaining its own, this probe's copy included).
TEAM_NAME_TO_CODE = {
    "Arizona Cardinals": "ARI", "Atlanta Falcons": "ATL", "Baltimore Ravens": "BAL",
    "Buffalo Bills": "BUF", "Carolina Panthers": "CAR", "Chicago Bears": "CHI",
    "Cincinnati Bengals": "CIN", "Cleveland Browns": "CLE", "Dallas Cowboys": "DAL",
    "Denver Broncos": "DEN", "Detroit Lions": "DET", "Green Bay Packers": "GB",
    "Houston Texans": "HOU", "Indianapolis Colts": "IND", "Jacksonville Jaguars": "JAX",
    "Kansas City Chiefs": "KC", "Las Vegas Raiders": "LV", "Los Angeles Chargers": "LAC",
    "Los Angeles Rams": "LA", "Miami Dolphins": "MIA", "Minnesota Vikings": "MIN",
    "New England Patriots": "NE", "New Orleans Saints": "NO", "New York Giants": "NYG",
    "New York Jets": "NYJ", "Philadelphia Eagles": "PHI", "Pittsburgh Steelers": "PIT",
    "San Francisco 49ers": "SF", "Seattle Seahawks": "SEA", "Tampa Bay Buccaneers": "TB",
    "Tennessee Titans": "TEN", "Washington Commanders": "WAS",
}
CANON_CODES = set(TEAM_NAME_TO_CODE.values())

# Kalshi ticker-embedded team codes that don't match our canonical set.
# Discovered live (2026-10-04 probe run) by diffing every code seen in
# KXNFLGAME event tickers against CANON_CODES — everything else matched
# exactly (including LAC, which is NOT an override).
KALSHI_CODE_OVERRIDES = {
    "JAC": "JAX",  # Jacksonville — Kalshi tickers it JAC, we use JAX everywhere else
    "LAR": "LA",   # LA Rams — Kalshi tickers it LAR, we use LA everywhere else
}


def http_get_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "nfl-explorer-markets-probe/1"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))


def save_sample(venue: str, obj) -> None:
    SAMPLES_DIR.mkdir(parents=True, exist_ok=True)
    path = SAMPLES_DIR / f"{venue}_sample.json"
    path.write_text(json.dumps(obj, indent=2), encoding="utf-8")


@dataclass
class NormalizedGame:
    venue: str
    away: str | None
    home: str | None
    kickoff: str | None  # ISO UTC, when the venue actually provides one
    market_types: set[str] = field(default_factory=set)
    raw_names: tuple[str, str] = ("", "")  # (away_raw, home_raw) before normalising
    unmapped: list[str] = field(default_factory=list)


# --- Polymarket --------------------------------------------------------------


def find_polymarket_nfl_series_id() -> tuple[int, str]:
    sports = http_get_json("https://gamma-api.polymarket.com/sports")
    for s in sports:
        if s.get("sport") == "nfl":
            return int(s["series"]), s["name"]
    raise RuntimeError("Polymarket: no sport entry with sport == 'nfl' in /sports")


def fetch_polymarket_games(series_id: int, horizon: timedelta) -> list[NormalizedGame]:
    url = (
        f"https://gamma-api.polymarket.com/events"
        f"?series_id={series_id}&active=true&closed=false&limit=100"
    )
    events = http_get_json(url)
    if events:
        save_sample("polymarket", events[0])

    now = datetime.now(timezone.utc)
    cutoff = now + horizon
    games: list[NormalizedGame] = []

    for e in events:
        start_raw = e.get("startTime")
        if not start_raw:
            continue
        start = datetime.fromisoformat(start_raw.replace("Z", "+00:00"))
        # Polymarket's active=true/closed=false does NOT reliably exclude
        # already-played games (prop markets inside the event can stay open
        # after kickoff) — the real filter has to be the kickoff time itself.
        if start < now or start > cutoff:
            continue

        teams = e.get("teams") or []
        away_name = next((t["name"] for t in teams if t.get("ordering") == "away"), None)
        home_name = next((t["name"] for t in teams if t.get("ordering") == "home"), None)
        unmapped = [n for n in (away_name, home_name) if n and n not in TEAM_NAME_TO_CODE]
        away = TEAM_NAME_TO_CODE.get(away_name) if away_name else None
        home = TEAM_NAME_TO_CODE.get(home_name) if home_name else None

        market_types = {m.get("sportsMarketType") for m in e.get("markets", [])}
        games.append(
            NormalizedGame(
                venue="polymarket",
                away=away,
                home=home,
                kickoff=start_raw,
                market_types=market_types,
                raw_names=(away_name or "", home_name or ""),
                unmapped=unmapped,
            )
        )
    return games


def polymarket_moneyline_sample(series_id: int) -> dict | None:
    """One fully-inspected moneyline market, for the price-shape part of the report."""
    url = (
        f"https://gamma-api.polymarket.com/events"
        f"?series_id={series_id}&active=true&closed=false&limit=20"
    )
    events = http_get_json(url)
    now = datetime.now(timezone.utc)
    for e in events:
        start_raw = e.get("startTime")
        if not start_raw:
            continue
        start = datetime.fromisoformat(start_raw.replace("Z", "+00:00"))
        if start < now:
            continue
        for m in e.get("markets", []):
            if m.get("sportsMarketType") == "moneyline":
                return {
                    "event": e.get("title"),
                    "outcomes": m.get("outcomes"),
                    "outcomePrices": m.get("outcomePrices"),
                    "bestBid": m.get("bestBid"),
                    "bestAsk": m.get("bestAsk"),
                    "lastTradePrice": m.get("lastTradePrice"),
                    "spread": m.get("spread"),
                    "volume24hr": m.get("volume24hr"),
                    "liquidity": m.get("liquidity"),
                }
    return None


# --- Kalshi -------------------------------------------------------------------

KALSHI_BASE = "https://api.elections.kalshi.com/trade-api/v2"
# Event ticker shape: KXNFLGAME-26OCT04INDWAS (year, month-abbr, day, AWAYHOME)
TICKER_DATE_RE = re.compile(r"-(\d{2})([A-Z]{3})(\d{2})([A-Z]+)$")
MONTH_ABBR = {
    "JAN": 1, "FEB": 2, "MAR": 3, "APR": 4, "MAY": 5, "JUN": 6,
    "JUL": 7, "AUG": 8, "SEP": 9, "OCT": 10, "NOV": 11, "DEC": 12,
}


def find_kalshi_game_winner_series() -> tuple[str, str]:
    """Inspect /series rather than hard-coding a guessed ticker (per the
    prompt). Full-game moneyline candidates are tickers starting KXNFL that
    don't reference a quarter/half/OT slice."""
    series = http_get_json(f"{KALSHI_BASE}/series?category=Sports")["series"]
    period_markers = ("1H", "2H", "1Q", "2Q", "3Q", "4Q", "OT")
    candidates = [
        s
        for s in series
        if (s.get("ticker") or "").upper().startswith("KXNFL")
        and "WIN" not in (s.get("ticker") or "").upper().replace("KXNFLGAME", "")
        and not any(m in (s.get("ticker") or "").upper() for m in period_markers)
        and (s.get("title") or "").strip().lower() in ("nfl game", "pro football game")
    ]
    if not candidates:
        raise RuntimeError("Kalshi: no /series entry looked like the full-game winner market")
    best = candidates[0]
    return best["ticker"], best["title"]


def _parse_ticker_date_and_codes(event_ticker: str) -> tuple[str, str, str] | None:
    m = TICKER_DATE_RE.search(event_ticker)
    if not m:
        return None
    yy, mon, dd, codes = m.groups()
    month = MONTH_ABBR.get(mon)
    if not month:
        return None
    date_iso = f"20{yy}-{month:02d}-{int(dd):02d}"
    return date_iso, codes, mon


def fetch_kalshi_games(series_ticker: str, horizon: timedelta) -> list[NormalizedGame]:
    now = datetime.now(timezone.utc)
    cutoff = (now + horizon).date()
    games: list[NormalizedGame] = []
    cursor = ""
    first_event_saved = False

    while True:
        url = (
            f"{KALSHI_BASE}/events?series_ticker={series_ticker}"
            f"&with_nested_markets=true&status=open&limit=200"
        )
        if cursor:
            url += f"&cursor={cursor}"
        page = http_get_json(url)
        events = page.get("events", [])
        if events and not first_event_saved:
            save_sample("kalshi", events[0])
            first_event_saved = True

        for e in events:
            parsed = _parse_ticker_date_and_codes(e["event_ticker"])
            if not parsed:
                games.append(
                    NormalizedGame(
                        venue="kalshi", away=None, home=None, kickoff=None,
                        raw_names=(e.get("event_ticker", ""), ""),
                        unmapped=[e.get("event_ticker", "")],
                    )
                )
                continue
            date_iso, codes, _mon = parsed
            game_date = datetime.strptime(date_iso, "%Y-%m-%d").date()
            if game_date < now.date() or game_date > cutoff:
                continue

            # The event title's leading city codes are ambiguous for
            # multi-team cities ("NY Giants" vs "NY Jets" both show "NY";
            # "LA Rams" vs "LA Chargers" both show "LA") — discovered live on
            # this probe run, which is exactly why Stage 1 exists. Each
            # market's own ticker suffix (e.g. "...-NYG", "...-NYJ") IS
            # unambiguous, so derive the two team codes from there, then use
            # the event ticker's concatenated AWAYHOME block (which code it
            # *starts* with) to decide which of the two is away vs home.
            market_codes = [m["ticker"].rsplit("-", 1)[-1] for m in e.get("markets", [])]
            market_codes = list(dict.fromkeys(market_codes))  # de-dup, keep order
            away_raw = home_raw = None
            if len(market_codes) == 2:
                a, b = market_codes
                if codes.startswith(a):
                    away_raw, home_raw = a, b
                elif codes.startswith(b):
                    away_raw, home_raw = b, a
            unmapped = []
            away = home = None
            if away_raw:
                away = KALSHI_CODE_OVERRIDES.get(away_raw, away_raw)
                if away not in CANON_CODES:
                    unmapped.append(away_raw)
            if home_raw:
                home = KALSHI_CODE_OVERRIDES.get(home_raw, home_raw)
                if home not in CANON_CODES:
                    unmapped.append(home_raw)
            if not away_raw or not home_raw:
                unmapped.append(f"ticker={e['event_ticker']} market_codes={market_codes}")

            games.append(
                NormalizedGame(
                    venue="kalshi",
                    away=away,
                    home=home,
                    # Kalshi exposes no clean kickoff field on this endpoint —
                    # expected_expiration_time/occurrence_datetime is close to
                    # game END (kickoff + ~3h), confirmed by cross-checking
                    # Colts@Commanders: Polymarket kickoff 13:30Z, Kalshi
                    # expected_expiration_time 16:30Z (+3h). Leaving kickoff
                    # null here rather than reporting a wrong timestamp.
                    kickoff=None,
                    market_types={m.get("sportsMarketType", "moneyline") for m in e.get("markets", [])}
                    or {"moneyline"},
                    raw_names=(away_raw or "", home_raw or ""),
                    unmapped=unmapped,
                )
            )

        cursor = page.get("cursor") or ""
        if not cursor or not events:
            break

    return games


def kalshi_moneyline_sample(series_ticker: str) -> dict | None:
    url = f"{KALSHI_BASE}/events?series_ticker={series_ticker}&with_nested_markets=true&status=open&limit=1"
    page = http_get_json(url)
    events = page.get("events", [])
    if not events:
        return None
    e = events[0]
    out = {"event": e.get("title"), "markets": []}
    for m in e.get("markets", []):
        out["markets"].append(
            {
                "ticker": m.get("ticker"),
                "title": m.get("title"),
                "yes_bid_dollars": m.get("yes_bid_dollars"),
                "yes_ask_dollars": m.get("yes_ask_dollars"),
                "no_bid_dollars": m.get("no_bid_dollars"),
                "no_ask_dollars": m.get("no_ask_dollars"),
                "last_price_dollars": m.get("last_price_dollars"),
                "volume_24h_fp": m.get("volume_24h_fp"),
            }
        )
    return out


# --- Matching + report --------------------------------------------------------


def main() -> None:
    horizon = timedelta(days=HORIZON_DAYS)

    print("=== Polymarket ===")
    poly_series_id, poly_series_name = find_polymarket_nfl_series_id()
    print(f"  /sports -> sport == 'nfl': series_id={poly_series_id} ({poly_series_name!r})")
    poly_games = fetch_polymarket_games(poly_series_id, horizon)
    print(f"  {len(poly_games)} open games in the next {HORIZON_DAYS} days")
    poly_type_counts: dict[str, int] = {}
    for g in poly_games:
        for t in g.market_types:
            poly_type_counts[t] = poly_type_counts.get(t, 0) + 1
    print("  market types seen (count = games carrying at least one such market):")
    for t, c in sorted(poly_type_counts.items(), key=lambda kv: -kv[1])[:10]:
        print(f"    {t}: {c}")
    if len(poly_type_counts) > 10:
        print(f"    ... and {len(poly_type_counts) - 10} more sub-types (quarter/half props etc.)")
    ml_sample = polymarket_moneyline_sample(poly_series_id)
    print(f"  sample moneyline market: {ml_sample}")

    print("\n=== Kalshi ===")
    kalshi_ticker, kalshi_title = find_kalshi_game_winner_series()
    print(f"  /series -> full-game winner candidate: {kalshi_ticker!r} ({kalshi_title!r})")
    kalshi_games = fetch_kalshi_games(kalshi_ticker, horizon)
    print(f"  {len(kalshi_games)} open games in the next {HORIZON_DAYS} days")
    kalshi_type_counts: dict[str, int] = {}
    for g in kalshi_games:
        for t in g.market_types:
            kalshi_type_counts[t] = kalshi_type_counts.get(t, 0) + 1
    print("  market types seen:", kalshi_type_counts)
    ml_sample_k = kalshi_moneyline_sample(kalshi_ticker)
    print(f"  sample moneyline event: {json.dumps(ml_sample_k, indent=2)}")

    # --- match report ---
    print("\n=== Match report ===")
    poly_by_key = {f"{g.away}@{g.home}": g for g in poly_games if g.away and g.home}
    kalshi_by_key = {f"{g.away}@{g.home}": g for g in kalshi_games if g.away and g.home}

    both = sorted(set(poly_by_key) & set(kalshi_by_key))
    kalshi_only = sorted(set(kalshi_by_key) - set(poly_by_key))
    poly_only = sorted(set(poly_by_key) - set(kalshi_by_key))

    print(f"  matched on both venues ({len(both)}):")
    for key in both:
        print(f"    {key}")
    print(f"  Kalshi only ({len(kalshi_only)}):")
    for key in kalshi_only:
        print(f"    {key}")
    print(f"  Polymarket only ({len(poly_only)}):")
    for key in poly_only:
        print(f"    {key}")

    unmapped_names = set()
    for g in poly_games + kalshi_games:
        unmapped_names.update(g.unmapped)
    print(f"  team names/codes that failed to normalise: {sorted(unmapped_names) or 'none'}")

    SAMPLES_DIR.mkdir(parents=True, exist_ok=True)
    (SAMPLES_DIR / "match_report.json").write_text(
        json.dumps(
            {
                "both": both,
                "kalshi_only": kalshi_only,
                "polymarket_only": poly_only,
                "unmapped": sorted(unmapped_names),
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"\nRaw samples + match_report.json written to {SAMPLES_DIR}")


if __name__ == "__main__":
    main()
