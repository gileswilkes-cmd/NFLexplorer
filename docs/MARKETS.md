# Markets (`/markets`)

At-a-glance NFL moneyline (home-win-probability) prices from Kalshi and
Polymarket side by side, plus the sportsbook consensus where available.
Built from the Stage 1 discovery probe (`scripts/markets/probe.py`, run live
2026-10-04) — see that script and its output for the raw shape evidence
behind every decision below.

## Data sources

- **Polymarket Gamma API** (`https://gamma-api.polymarket.com`, no key).
  `/sports` → find the entry with `sport === "nfl"` → its `series` id.
  `/events?series_id=...&active=true&closed=false` → each event carries
  every market for that game (quarter/half/team props, ~300+ per game); we
  only use the one with `sportsMarketType === "moneyline"`.
  - Prices (`bestBid`/`bestAsk`/`lastTradePrice`) are already probabilities
    (0-1 floats) — no cents conversion.
  - `active=true&closed=false` does **not** reliably exclude an
    already-kicked-off game (a finished game's event can stay "active"
    because unrelated prop markets inside it haven't settled) — the real
    "is this upcoming" filter is each event's own `startTime`.
  - The moneyline market's `outcomes` array holds mascot names ("Colts",
    "Commanders"), not full team names and not the venue's 2-3 letter
    `abbreviation` (which collides for two-team cities exactly like Kalshi's
    titles do — "LA" for both Rams and Chargers). `bestBid`/`bestAsk`/
    `lastTradePrice` are quoted for `outcomes[0]`. We resolve which index is
    home by matching each `teams[].alias` (mascot name) against `outcomes`,
    never by assuming array position or by ordering.
  - `teams[].name` is a full team name ("Washington Commanders") that
    matches `src/lib/markets/team-codes.json` byte-for-byte — zero
    Polymarket-specific overrides needed.

- **Kalshi** (`https://api.elections.kalshi.com/trade-api/v2`, no key).
  `/series?category=Sports` → found the full-game winner series by title,
  not a hard-coded ticker (**`KXNFLGAME`**, "NFL Game" — re-verify if Kalshi
  ever renames it). `/events?series_ticker=KXNFLGAME&with_nested_markets=true&status=open`
  → each event has exactly 2 nested one-sided binary markets, one per team
  ("Washington wins" / "Indianapolis wins"), each with its own bid/ask.
  - Prices are **dollar strings** (`yes_bid_dollars: "0.3400"`), not integer
    cents.
  - The event *title*'s leading city code is ambiguous for two-team cities:
    both Giants and Jets print "NY ...", both Rams and Chargers print
    "LA ...". The per-market **ticker suffix** is unambiguous
    (`KXNFLGAME-26OCT04INDWAS-WAS` → `WAS`) — team codes are always derived
    from there, never from the title. Covered by
    `src/lib/markets/kalshi.test.ts`.
  - Kalshi's ticker codes differ from ours in exactly two places:
    `JAC` → our `JAX`, `LAR` → our `LA` (both in
    `KALSHI_CODE_OVERRIDES`). Everything else, including `LAC`, matches.
  - No clean kickoff timestamp is exposed on this endpoint.
    `occurrence_datetime`/`expected_expiration_time` tracks game *end*, not
    kickoff — confirmed live by cross-checking Colts@Commanders: Polymarket
    kickoff 13:30Z vs. Kalshi's field at 16:30Z (+3h, a plausible game
    length). Kalshi's timestamps are never used for kickoff.
  - No full-game total market exists at all (only quarter/half totals). A
    full-game spread market (`KXNFLSPREAD`) exists but, like Polymarket's,
    is a strike ladder (~25 lines per game), not one posted line.

- **Sportsbooks** (`public/data/matchups/odds_2026.json`, via
  `ingest/pull_odds.mjs`). Extended to also request the `h2h` market from
  the-odds-api (`markets=spreads,totals,h2h`) and store a de-vigged
  consensus home-win probability: each bookmaker's own two-way vig is
  removed by proportional normalisation (its two American-odds implied
  probabilities scaled to sum to 1), then the **median** across every book
  with an h2h price is taken (resistant to one outlier book, unlike a
  mean). Stored as `consensusHomeWinProb` + `consensusBookCount` per game,
  alongside the existing DraftKings-only `total`/`favorite`/`spread` fields
  — see `docs/DATA_SCHEMA.md`. This only refreshes Tue/Fri with the rest of
  the site, so the page shows it muted with its own "Books (N books): X% as
  of ..." label, distinct from the near-live "Prices as of HH:MM" stamp.

## Why moneyline-only in v1

Both Kalshi and Polymarket publish spread/total as a full **strike ladder**
(many lines per game — Polymarket ~15-25 total lines and ~20 spread lines;
Kalshi ~25 spread lines, no full-game total at all), not one canonical
posted line the way a sportsbook does. "Match only where both venues list
the same line" would almost never find a hit by coincidence. Rather than
ship a feature that's silently empty, v1 does moneyline only, where both
venues post exactly one two-sided (Polymarket) or one-sided-pair (Kalshi)
price per game and matching is clean (30/31 games matched live on
2026-10-04).

**v2 idea, not built:** for spread/total, derive each venue's own *implied
line* (the strike whose price is closest to 50/50) and compare those two
derived lines with a tolerance (e.g. ±1 point), rather than requiring
literal equality of a posted line that doesn't exist on either venue.

## Matching

Every cross-venue/cross-source join uses the **away@home team-code key**
(`src/lib/markets/teams.ts#gameKey`), never kickoff date — the same
UTC-rollover-safe convention `pull_odds.mjs` already used. A game appears on
the page if it has a quote on *at least one* venue; a game Kalshi hasn't
listed yet shows a muted "Kalshi not yet listed" note rather than being
hidden (filterable away with the "only games on both venues" toggle).

## Kickoff resolution and exclusion

1. Our own `schedule_2026.json` timestamp, if it ever has one — **it
   doesn't today** (date-only, no time-of-day field); this branch exists so
   a future schema addition is picked up automatically with zero code
   changes elsewhere (`src/lib/markets/match.ts#scheduleKickoff`).
2. Otherwise, Polymarket's `startTime`.
3. Kalshi's timestamps are **never** used (see above — they track game end).

A game whose resolved kickoff is in the past is excluded entirely (in-game
prices would distort the view). When no timestamp is available from either
source, the schedule's final-score fields decide "has this been played" as
a fallback; a game that's neither finished nor timestamped stays visible —
uncertainty never means "hide it."

## Kalshi's two-sided probability

Kalshi has no single two-sided "home win" market — two independent
one-sided markets (home-team YES, away-team YES) that can disagree. When
they're within 3pts, the home-win probability is their average. When they
disagree by more than 3pts, the side with the **tighter bid/ask spread** is
used instead of averaging in the noisier side, and a flag
(`disagreementPts`, `usedSide`) is surfaced as a tooltip on the Kalshi
marker. See `src/lib/markets/prices.ts#kalshiHomeProbability` and its tests.

## Constants worth tuning (`src/lib/markets/constants.ts`)

| Constant | Value | What it controls |
|---|---|---|
| `MARKETS_HORIZON_DAYS` | 14 | How far ahead games are fetched/shown |
| `GAP_HIGHLIGHT_THRESHOLD_PTS` | 3 | Row highlight when \|Kalshi − Polymarket\| ≥ this |
| `KALSHI_DISAGREEMENT_THRESHOLD_PTS` | 3 | Kalshi's own two-sided disagreement cutoff (see above) |
| `WIDE_SPREAD_THRESHOLD_PTS` | 4 | Bid/ask width considered "thin" |
| `LOW_VOLUME_THRESHOLD_USD` | 5000 | 24h volume considered "thin" |
| `REVALIDATE_SECONDS` | 120 | Next.js fetch cache lifetime for both venues |

Volume/spread thresholds were picked from the Stage 1 probe's live sample
(most NFL moneyline markets showed tens-to-hundreds of thousands in 24h
volume); revisit if that liquidity profile changes, e.g. well outside the
regular season.

## Caching and failure handling

`src/app/api/markets/route.ts` is the only thing that calls Kalshi/
Polymarket directly (never the browser — no CORS exposure, no per-visitor
rate-limit pressure). The route itself is `force-dynamic` (always
re-executes, so the page's manual refresh button is meaningful), but the
two outbound venue `fetch()` calls each use
`next: { revalidate: 120 }` — "near-live, at most about 2 minutes old," and
polite to both free APIs regardless of how often the route itself is hit.

Each venue is fetched with `Promise.allSettled`; either one can fail
independently and the page still renders the other, with a visible error
banner naming which venue failed. The page never blanks out entirely.

## Code layout

- `src/lib/markets/team-codes.json` — the single 32-team name→code map and
  the 2 Kalshi overrides, shared by `ingest/pull_odds.mjs` and this lib
  (previously a second inline copy lived in `pull_odds.mjs`).
- `src/lib/markets/teams.ts`, `prices.ts`, `kalshi.ts`, `polymarket.ts`,
  `match.ts`, `constants.ts`, `types.ts` — pure normalisation/matching logic
  (each paired with a `*.test.ts`, `npm test`) plus the two venues' impure
  fetch functions.
- `src/app/api/markets/route.ts` — the only caller of the two fetch
  functions; combines with schedule + odds data.
- `src/app/markets/page.tsx`, `src/components/markets/ProbabilityBar.tsx` —
  the page itself.
