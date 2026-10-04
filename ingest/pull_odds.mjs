// Pull-and-commit odds fetch for the /matchups page (docs/MATCHUPS_SPEC.md).
//
// Single local run against the-odds-api.com; writes the committed
// public/data/matchups/odds_2026.json that the deployed site reads. The API
// key never goes to Vercel — only this script touches it, and only from
// .env.local (gitignored).
//
// Usage (from repo root):
//   node --env-file=.env.local ingest/pull_odds.mjs
//
// Re-run whenever you want fresher lines; it overwrites the whole file each
// time (one API call covers every game the book has posted so far).

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA_VERSION = 1;
const SEASON = 2026;
const BOOK = "draftkings";

// Shared with src/lib/markets/teams.ts (the /markets page's Polymarket
// normaliser) — one 32-team map instead of two copies to keep in sync. If
// the feed ever sends a name not in this map, the script aborts rather than
// silently dropping that game — team-name drift upstream must be caught
// here, not discovered later as a missing card on the page.
const TEAM_NAME_TO_CODE = JSON.parse(
  readFileSync(path.join(REPO_ROOT, "src/lib/markets/team-codes.json"), "utf-8")
).teamNameToCode;

function codeFor(teamName) {
  const code = TEAM_NAME_TO_CODE[teamName];
  if (!code) {
    throw new Error(
      `pull_odds: unmapped team name "${teamName}" in the-odds-api response — ` +
        `add it to TEAM_NAME_TO_CODE before re-running (refusing to silently drop the game)`
    );
  }
  return code;
}

function writeJson(filePath, obj) {
  writeFileSync(filePath, JSON.stringify(obj) + "\n", "utf-8");
}

async function fetchOdds(apiKey) {
  const url = new URL("https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds/");
  url.searchParams.set("apiKey", apiKey);
  url.searchParams.set("regions", "us");
  url.searchParams.set("markets", "spreads,totals,h2h");
  url.searchParams.set("oddsFormat", "american");
  url.searchParams.set("dateFormat", "iso");

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`the-odds-api request failed: ${res.status} ${res.statusText}\n${body}`);
  }
  const remaining = res.headers.get("x-requests-remaining");
  const used = res.headers.get("x-requests-used");
  console.log(`  the-odds-api: ${used} requests used, ${remaining} remaining this period`);
  return res.json();
}

/** American odds -> implied win probability (pre-devig, includes the vig). */
function americanToImpliedProb(price) {
  return price > 0 ? 100 / (price + 100) : -price / (-price + 100);
}

/** One bookmaker's two-way vig removed by proportional (multiplicative)
 * normalisation: scale both implied probabilities so they sum to 1. */
function devigHomeProb(homePrice, awayPrice) {
  const pHome = americanToImpliedProb(homePrice);
  const pAway = americanToImpliedProb(awayPrice);
  return pHome / (pHome + pAway);
}

function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** De-vigged consensus home-win probability across every bookmaker that has
 * posted a moneyline (h2h) for this game: devig each book individually, then
 * take the median across books — resistant to one outlier book, unlike a
 * mean. { prob: null, bookCount: 0 } when no book has h2h priced yet (never
 * 0 — "not posted" is not the same as "certain to lose"). */
function consensusHomeWinProb(game, homeCode) {
  const probs = [];
  for (const bk of game.bookmakers) {
    const h2h = bk.markets.find((m) => m.key === "h2h");
    if (!h2h || h2h.outcomes.length !== 2) continue;
    const homeOutcome = h2h.outcomes.find((o) => codeFor(o.name) === homeCode);
    const awayOutcome = h2h.outcomes.find((o) => codeFor(o.name) !== homeCode);
    if (!homeOutcome || !awayOutcome) continue;
    probs.push(devigHomeProb(homeOutcome.price, awayOutcome.price));
  }
  return { prob: probs.length ? median(probs) : null, bookCount: probs.length };
}

/** Extract { total, favorite, spread, consensusHomeWinProb, consensusBookCount }
 * from one game's markets, or null. total/favorite/spread stay
 * DraftKings-only (the existing single-book convention this file has always
 * used); the moneyline consensus is the one field that's deliberately
 * cross-book. */
function extractOdds(game, homeCode) {
  const dk = game.bookmakers.find((b) => b.key === BOOK);
  if (!dk) return null;

  const spreadsMarket = dk.markets.find((m) => m.key === "spreads");
  const totalsMarket = dk.markets.find((m) => m.key === "totals");
  if (!spreadsMarket || !totalsMarket) return null;

  const favoriteOutcome = spreadsMarket.outcomes.find((o) => o.point < 0);
  const favorite = favoriteOutcome ? codeFor(favoriteOutcome.name) : null;
  const spread = favoriteOutcome ? Math.abs(favoriteOutcome.point) : 0;

  const total = totalsMarket.outcomes[0]?.point ?? null;
  const consensus = consensusHomeWinProb(game, homeCode);

  return {
    total, favorite, spread,
    consensusHomeWinProb: consensus.prob,
    consensusBookCount: consensus.bookCount,
  };
}

/** Index the feed by "AWAY@HOME" team-code pair — never by date (UTC rollover
 * puts Sunday/Monday night games on the next calendar date vs. the schedule's
 * local kickoff date). */
function indexByCodePair(oddsGames) {
  const index = new Map();
  for (const game of oddsGames) {
    const away = codeFor(game.away_team);
    const home = codeFor(game.home_team);
    index.set(`${away}@${home}`, extractOdds(game, home));
  }
  return index;
}

async function main() {
  const apiKey = process.env.THE_ODDS_API_KEY;
  if (!apiKey) {
    throw new Error(
      "THE_ODDS_API_KEY not set — run with: node --env-file=.env.local ingest/pull_odds.mjs"
    );
  }

  const schedulePath = path.join(REPO_ROOT, "public/data/matchups/schedule_2026.json");
  const schedule = JSON.parse(readFileSync(schedulePath, "utf-8"));

  console.log("Fetching NFL odds (spreads, totals, h2h moneyline; US region)...");
  const oddsGames = await fetchOdds(apiKey);
  console.log(`  ${oddsGames.length} games returned by the feed`);

  const oddsIndex = indexByCodePair(oddsGames);

  const weeks = {};
  let totalGames = 0;
  let withOdds = 0;
  let withoutOdds = 0;
  const missing = [];

  for (const [week, games] of Object.entries(schedule.weeks)) {
    weeks[week] = games.map((g) => {
      totalGames += 1;
      const odds = oddsIndex.get(`${g.away}@${g.home}`) ?? null;
      if (odds) {
        withOdds += 1;
      } else {
        withoutOdds += 1;
        missing.push(g.game_id);
      }
      return { game_id: g.game_id, away: g.away, home: g.home, odds };
    });
  }

  const doc = {
    schema_version: SCHEMA_VERSION,
    season: SEASON,
    book: BOOK,
    generated_at: new Date().toISOString(),
    weeks,
  };

  const outPath = path.join(REPO_ROOT, "public/data/matchups/odds_2026.json");
  writeJson(outPath, doc);

  console.log(`  wrote ${path.relative(REPO_ROOT, outPath)}`);
  console.log(`  ${totalGames} scheduled games: ${withOdds} with odds, ${withoutOdds} without (null)`);
  console.log(`  games with no posted line: ${missing.join(", ")}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
