# Claude Code prompt — NFL Explorer: Prediction Markets page

Paste everything below the line into a fresh Claude Code session in `C:\Projects\NFLExplorer`.

---

Run `git pull` first.

## Context

NFL Explorer is a Next.js site with Python ingest scripts, deployed on Vercel at https://nfl-explorer-mu.vercel.app, with auto-deploy on push to main. Data lives in `public/data`. A GitHub Action runs `npm run refresh:week` every Tuesday and Friday at 08:00 Europe/London. It uses The Odds API (`THE_ODDS_API_KEY` secret). The site already has player pages, leaderboards, team pages and a weekly unit-matchup tool (spec in `docs/MATCHUPS_SPEC.md`).

The goal of this task is to add a **Markets** page. It gives an at-a-glance overview of prediction-market prices for upcoming NFL games, from Kalshi and Polymarket side by side. Where we already hold sportsbook odds, those appear too. Prices should be near-live, at most about 2 minutes old, rather than the twice-weekly snapshot cadence.

Both venues expose public read-only APIs with no key:
- **Polymarket Gamma API:** `https://gamma-api.polymarket.com`. Use `/sports` to find the NFL tag/series, then `/events?series_id=…&active=true&closed=false`. Events contain their markets. Note that `outcomes`, `outcomePrices` and `clobTokenIds` come back as JSON-encoded strings, paired by index.
- **Kalshi:** `https://api.elections.kalshi.com/trade-api/v2`. Use `/series`, `/events?series_ticker=…&with_nested_markets=true` and `/markets`. Find the NFL game-winner series by inspecting `/series` (do not hard-code a guessed ticker). Check whether prices come as integer cents (`yes_bid`, `yes_ask`, `last_price`) or dollar strings (`*_dollars`), and handle whichever the live API returns.

Do not trust any field name in this prompt over what the live API actually returns.

## Stage 1 — Discovery (STOP after this stage for my review)

1. Write `scripts/markets/probe.py`, a throwaway script that:
   - finds the NFL series/tag on each venue and prints the identifiers it used;
   - fetches all open NFL game markets for the next 14 days from each venue;
   - saves one raw sample event per venue to `scripts/markets/samples/` (gitignored);
   - for each venue, prints the market types found (moneyline / spread / total / other) with counts;
   - attempts to match games across venues by (home team, away team, kickoff date) using a team-name normaliser mapping every venue's naming to our team abbreviations (reuse whatever team lookup NFL Explorer already has);
   - prints a match report listing games matched on both venues, games on Kalshi only, and games on Polymarket only, plus any team names that failed to normalise.
2. Check whether the existing Odds API refresh already stores per-game moneylines in `public/data`. Report the file, its shape, and whether it can be joined on the same key.
3. Report back with the match report, the actual price field names and units for each venue, which market types exist on both venues, and whether the Next.js app uses the App Router or the Pages Router. **Stop here and wait for my go-ahead.**

## Stage 2 — Build (only after I approve Stage 1)

### Data layer
- Add a server-side route (`app/api/markets/route.ts` or the Pages equivalent). It should fetch both venues in parallel, normalise them, match the games, and return JSON. Use Next.js fetch caching with `revalidate: 120` so Vercel serves cached results and we stay polite to both APIs. Do not call the venues from the browser, to avoid CORS issues and rate-limit exposure.
- Put the normalisation and matching logic in a separate pure module (`lib/markets/`) with unit tests covering:
  - team-name normalisation, including the edge cases found in Stage 1;
  - price conversion, so everything ends up as a probability between 0 and 1;
  - the mid-price calculation, `(bid + ask) / 2`. Fall back to the last trade only when there is no two-sided quote, and flag it when that happens.
- Per game, return:
  - kickoff time (UTC), home and away teams, and week number;
  - for each venue: home win probability (mid), bid, ask, spread width, 24h volume, a market URL and a fetched-at timestamp;
  - Kalshi minus Polymarket gap in percentage points;
  - de-vigged sportsbook consensus probability, if the Stage 1 check found usable Odds API data;
  - spread and total lines, only where both venues list the same line; otherwise omit them.
- If one venue fails, still return the other venue with an `errors` field. The page must never blank out entirely.

### Page (`/markets`)
- Add the page to the main nav, in keeping with the existing site styling.
- Show one card or row per upcoming game, grouped by NFL week and sorted by kickoff. Display kickoff times in Europe/London time.
- In each row, show both teams, then a horizontal probability bar for the home-team win chance with a marker per source (Kalshi, Polymarket, books). The aim is for disagreement between sources to be visible at a glance.
- Show the numbers beside the bar: each source's probability to the nearest whole percent, plus the gap.
- Highlight the row when |Kalshi − Polymarket| ≥ 3 pts. Make that threshold a constant.
- Show a thin-market warning (muted styling plus a tooltip) when the bid/ask width is above 4 pts or the 24h volume is very low. Set those thresholds as constants after looking at the Stage 1 data.
- Above the list, add a small summary strip with the number of games covered, the biggest cross-venue gap this week, and the most-traded game.
- Add a "Prices as of HH:MM" stamp and a manual refresh button that re-queries the API route.
- Add sort and filter controls: by kickoff (default), by biggest gap, and by volume, plus a toggle for "only games on both venues".
- Make it work at phone width (a single column, with the bar still readable).
- Link the team names to the existing NFL Explorer team pages.
- Add a footer note: "Market prices are implied probabilities from public exchange data; not betting advice."

### Wrap-up
- Run the tests and the build. Fix any type errors.
- Check the page against the live APIs in dev and confirm at least one game shows both venues.
- Commit with a clear message and push to main.
- Write a short `docs/MARKETS.md` covering the data sources, the matching logic, the caching, and the constants worth tuning.
