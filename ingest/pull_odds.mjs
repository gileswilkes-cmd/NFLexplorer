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

// Verified against a live pull on 2026-09-12 (all 32 names seen or confirmed
// by the-odds-api's standard naming; see conversation this shipped from).
// If the feed ever sends a name not in this map, the script aborts rather
// than silently dropping that game — team-name drift upstream must be caught
// here, not discovered later as a missing card on the page.
const TEAM_NAME_TO_CODE = {
  "Arizona Cardinals": "ARI",
  "Atlanta Falcons": "ATL",
  "Baltimore Ravens": "BAL",
  "Buffalo Bills": "BUF",
  "Carolina Panthers": "CAR",
  "Chicago Bears": "CHI",
  "Cincinnati Bengals": "CIN",
  "Cleveland Browns": "CLE",
  "Dallas Cowboys": "DAL",
  "Denver Broncos": "DEN",
  "Detroit Lions": "DET",
  "Green Bay Packers": "GB",
  "Houston Texans": "HOU",
  "Indianapolis Colts": "IND",
  "Jacksonville Jaguars": "JAX",
  "Kansas City Chiefs": "KC",
  "Las Vegas Raiders": "LV",
  "Los Angeles Chargers": "LAC",
  "Los Angeles Rams": "LA",
  "Miami Dolphins": "MIA",
  "Minnesota Vikings": "MIN",
  "New England Patriots": "NE",
  "New Orleans Saints": "NO",
  "New York Giants": "NYG",
  "New York Jets": "NYJ",
  "Philadelphia Eagles": "PHI",
  "Pittsburgh Steelers": "PIT",
  "San Francisco 49ers": "SF",
  "Seattle Seahawks": "SEA",
  "Tampa Bay Buccaneers": "TB",
  "Tennessee Titans": "TEN",
  "Washington Commanders": "WAS",
};

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
  url.searchParams.set("markets", "spreads,totals");
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

/** Extract { total, favorite, spread } from one game's DraftKings markets, or null. */
function extractOdds(game) {
  const dk = game.bookmakers.find((b) => b.key === BOOK);
  if (!dk) return null;

  const spreadsMarket = dk.markets.find((m) => m.key === "spreads");
  const totalsMarket = dk.markets.find((m) => m.key === "totals");
  if (!spreadsMarket || !totalsMarket) return null;

  const favoriteOutcome = spreadsMarket.outcomes.find((o) => o.point < 0);
  const favorite = favoriteOutcome ? codeFor(favoriteOutcome.name) : null;
  const spread = favoriteOutcome ? Math.abs(favoriteOutcome.point) : 0;

  const total = totalsMarket.outcomes[0]?.point ?? null;

  return { total, favorite, spread };
}

/** Index the feed by "AWAY@HOME" team-code pair — never by date (UTC rollover
 * puts Sunday/Monday night games on the next calendar date vs. the schedule's
 * local kickoff date). */
function indexByCodePair(oddsGames) {
  const index = new Map();
  for (const game of oddsGames) {
    const away = codeFor(game.away_team);
    const home = codeFor(game.home_team);
    index.set(`${away}@${home}`, extractOdds(game));
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

  console.log("Fetching NFL odds (spreads, totals; US region)...");
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
