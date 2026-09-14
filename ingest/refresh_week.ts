// Weekly refresh + frozen prediction snapshot for /matchups
// (docs/MATCHUPS_REFRESH.md). Manual script, not automation.
//
// Usage (from repo root):
//   npm run refresh:week
//
// Does, in order:
//   1. git pull
//   2. re-pull import_schedules(2026) -> schedule_2026.json (scores fill in
//      for played games)
//   3. re-pull the-odds-api -> odds_2026.json
//   4. re-pull import_depth_charts(2026) + import_injuries(2026) -> rebuild
//      public/data/matchups/team_players.json (docs/MATCHUPS_INJURIES.md) —
//      current-week QB/RB starters (with injury override) and injury-status
//      flags on every spotlight player. Player-agnostic; never touches the
//      model forecast below.
//   5. write/refresh public/data/predictions/week_{N}.json for the current
//      "upcoming" week (defaultWeek(), the same rule /matchups itself uses)
//   6. print a summary of what changed and stop — nothing is committed here.
//
// The freeze rule (non-negotiable, see docs/MATCHUPS_REFRESH.md Part 2): a
// game's forecast is only ever (re)computed while it hasn't kicked off yet
// ("kicked off" = schedule_2026.json shows a score for it — this fixture
// data doesn't advance with the wall clock, so score presence is the only
// reliable signal, not the game's calendar date). Once a game has a score,
// whatever is already on file for it is carried over untouched; a played
// game with no prior snapshot is written once as `captured: false` and is
// never reconstructed later.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  computeGameTags,
  computeModelForecast,
  computeUnitMatchups,
  computeVerdict,
  defaultWeek,
  type GameTag,
  type ModelLean,
  type ScheduleDoc,
  type UnitRatingsDoc,
} from "@/lib/matchups";
import { oddsForGame, type OddsDoc } from "@/lib/odds";

const REPO_ROOT = path.resolve(__dirname, "..");
const SCHEMA_VERSION = 1;
const SEASON = 2026;

const SCHEDULE_PATH = path.join(REPO_ROOT, "public/data/matchups/schedule_2026.json");
const ODDS_PATH = path.join(REPO_ROOT, "public/data/matchups/odds_2026.json");
const RATINGS_PATH = path.join(REPO_ROOT, "public/data/matchups/unit_ratings.json");
const PREDICTIONS_DIR = path.join(REPO_ROOT, "public/data/predictions");
const PREDICTIONS_META_PATH = path.join(PREDICTIONS_DIR, "meta.json");

function run(cmd: string, args: string[], label: string): void {
  console.log(`\n> ${label}`);
  execFileSync(cmd, args, { cwd: REPO_ROOT, stdio: "inherit" });
}

function pythonExe(): string {
  const venvPy = process.platform === "win32"
    ? path.join(REPO_ROOT, "ingest", ".venv", "Scripts", "python.exe")
    : path.join(REPO_ROOT, "ingest", ".venv", "bin", "python");
  if (existsSync(venvPy)) return venvPy;
  return process.platform === "win32" ? "python" : "python3";
}

function readJson<T>(p: string): T | null {
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf-8")) as T) : null;
}

function writeJson(p: string, obj: unknown): void {
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(obj) + "\n", "utf-8");
}

// ---- Part 1 step-by-step diffing (for the "what changed" report) ---------

function diffSchedule(before: ScheduleDoc | null, after: ScheduleDoc): string[] {
  const lines: string[] = [];
  for (const [week, games] of Object.entries(after.weeks)) {
    for (const g of games) {
      const prev = before?.weeks[week]?.find((x) => x.game_id === g.game_id);
      const wasPlayed = prev ? prev.home_score !== null : false;
      const nowPlayed = g.home_score !== null;
      if (!wasPlayed && nowPlayed) {
        lines.push(`  wk${week} ${g.game_id}: newly final — ${g.away} ${g.away_score}, ${g.home} ${g.home_score}`);
      }
    }
  }
  return lines;
}

/** Per-week counts plus the individually interesting lines (new or moved) —
 *  a line simply getting pulled (book no longer posting it) is common and
 *  not worth a line each, but is still counted so a week's coverage
 *  collapsing to 0 is visible. */
function diffOdds(before: OddsDoc | null, after: OddsDoc): string[] {
  const lines: string[] = [];
  for (const [week, games] of Object.entries(after.weeks)) {
    let gained = 0;
    let lost = 0;
    let moved = 0;
    const details: string[] = [];
    for (const g of games) {
      const prev = before?.weeks[week]?.find((x) => x.game_id === g.game_id);
      const prevOdds = prev?.odds ?? null;
      const nowOdds = g.odds ?? null;
      const prevStr = JSON.stringify(prevOdds);
      const nowStr = JSON.stringify(nowOdds);
      if (prevStr === nowStr) continue;
      if (!prevOdds && nowOdds) {
        gained += 1;
        details.push(`    + ${g.game_id}: ${nowStr}`);
      } else if (prevOdds && !nowOdds) {
        lost += 1;
      } else {
        moved += 1;
        details.push(`    ~ ${g.game_id}: ${prevStr} -> ${nowStr}`);
      }
    }
    if (gained || lost || moved) {
      lines.push(`  wk${week}: ${gained} new line(s), ${lost} pulled, ${moved} moved`);
      lines.push(...details);
    }
  }
  return lines;
}

// ---- Part 2: the frozen prediction snapshot -------------------------------

interface PredictionModel {
  favourite: string | null;
  lean: ModelLean;
  margin_est: number;
  tags: GameTag[];
  verdict: string;
}

interface PredictionMarket {
  favourite: string | null;
  spread: number;
  total: number;
  book: string;
}

interface PredictionGame {
  game_id: string;
  away: string;
  home: string;
  kickoff: string;
  model?: PredictionModel;
  market?: PredictionMarket | null;
  captured: boolean;
}

interface PredictionDoc {
  schema_version: number;
  season: number;
  week: number;
  captured_at: string;
  games: PredictionGame[];
}

export function buildPredictionSnapshot(
  week: string,
  scheduleDoc: ScheduleDoc,
  ratingsDoc: UnitRatingsDoc,
  oddsDoc: OddsDoc | null,
  existing: PredictionDoc | null
): { doc: PredictionDoc; summary: string[] } {
  const games = scheduleDoc.weeks[week] ?? [];
  const summary: string[] = [];

  const outGames: PredictionGame[] = games.map((g) => {
    const played = g.away_score !== null && g.home_score !== null;
    const prior = existing?.games.find((x) => x.game_id === g.game_id) ?? null;

    if (played) {
      if (prior) {
        summary.push(`  ${g.game_id}: kicked off — snapshot frozen as-is (captured=${prior.captured})`);
        return prior;
      }
      summary.push(`  ${g.game_id}: already played, no prior snapshot -> captured:false (not back-filled)`);
      return { game_id: g.game_id, away: g.away, home: g.home, kickoff: g.date, captured: false };
    }

    // Not yet kicked off: (re)compute the live forecast — this is always a
    // fresh read, never a merge with `prior`, so a moving market line always
    // wins right up to kickoff.
    const matchups = computeUnitMatchups(g, ratingsDoc.teams);
    const tags = computeGameTags(matchups, g.home, g.away);
    const verdict = computeVerdict(matchups, tags, g.home, g.away);
    const forecast = computeModelForecast(matchups, g.home, g.away);

    const odds = oddsForGame(oddsDoc, week, g.game_id);
    const market: PredictionMarket | null = odds
      ? { favourite: odds.favorite, spread: odds.spread, total: odds.total, book: oddsDoc!.book }
      : null;

    const verb = prior ? "refreshed" : "captured";
    const marketDesc = market ? (market.favourite ?? "pick'em") : "no line posted";
    summary.push(`  ${g.game_id}: ${verb} — model favours ${forecast.favourite ?? "neither (even)"}, market favours ${marketDesc}`);

    return {
      game_id: g.game_id,
      away: g.away,
      home: g.home,
      kickoff: g.date,
      model: { favourite: forecast.favourite, lean: forecast.lean, margin_est: forecast.marginEst, tags, verdict },
      market,
      captured: true,
    };
  });

  return {
    doc: {
      schema_version: SCHEMA_VERSION,
      season: SEASON,
      week: Number(week),
      captured_at: new Date().toISOString(),
      games: outGames,
    },
    summary,
  };
}

/** Merge (never replace) the set of weeks a snapshot exists for — the same
 *  bug class as the parked meta.json fix in ingest/build.py: a run that only
 *  touches this week's file must not drop earlier weeks from the index. */
function mergeWeeksCaptured(week: number): void {
  const existing = readJson<{ weeks_captured?: number[] }>(PREDICTIONS_META_PATH);
  const weeks = new Set<number>(existing?.weeks_captured ?? []);
  weeks.add(week);
  writeJson(PREDICTIONS_META_PATH, {
    schema_version: SCHEMA_VERSION,
    season: SEASON,
    generated_at: new Date().toISOString(),
    weeks_captured: [...weeks].sort((a, b) => a - b),
  });
}

function main(): void {
  console.log("=== /matchups weekly refresh (docs/MATCHUPS_REFRESH.md) ===");

  run("git", ["pull"], "git pull");

  const scheduleBefore = readJson<ScheduleDoc>(SCHEDULE_PATH);
  run(pythonExe(), [path.join(REPO_ROOT, "ingest", "build_matchups.py")], "refresh schedule + scores (import_schedules)");
  const scheduleAfter = readJson<ScheduleDoc>(SCHEDULE_PATH);
  if (!scheduleAfter) throw new Error("schedule_2026.json missing after build_matchups.py ran");

  const oddsBefore = readJson<OddsDoc>(ODDS_PATH);
  run("node", ["--env-file=.env.local", path.join(REPO_ROOT, "ingest", "pull_odds.mjs")], "refresh odds (the-odds-api)");
  const oddsAfter = readJson<OddsDoc>(ODDS_PATH);
  if (!oddsAfter) throw new Error("odds_2026.json missing after pull_odds.mjs ran");

  // Depth charts + injuries change weekly like schedule/odds, so this is a
  // weekly-refresh input, not a one-off build step — it runs after the
  // schedule refresh above (starter resolution reads schedule_2026.json to
  // find the current week) but doesn't touch predictions/model logic at all.
  run(
    pythonExe(),
    [path.join(REPO_ROOT, "ingest", "build_spotlights.py")],
    "refresh depth charts + injuries, rebuild spotlights (team_players.json)"
  );

  const ratingsDoc = readJson<UnitRatingsDoc>(RATINGS_PATH);
  if (!ratingsDoc) throw new Error("unit_ratings.json missing");

  const week = defaultWeek(scheduleAfter);
  const predPath = path.join(PREDICTIONS_DIR, `week_${week}.json`);
  const existingPred = readJson<PredictionDoc>(predPath);

  const { doc: predDoc, summary: predSummary } = buildPredictionSnapshot(
    week, scheduleAfter, ratingsDoc, oddsAfter, existingPred
  );
  writeJson(predPath, predDoc);
  mergeWeeksCaptured(Number(week));

  console.log("\n=== Schedule: newly-final games this run ===");
  const schedDiff = diffSchedule(scheduleBefore, scheduleAfter);
  console.log(schedDiff.length ? schedDiff.join("\n") : "  none");

  console.log("\n=== Odds: lines that changed this run ===");
  const oddsDiff = diffOdds(oddsBefore, oddsAfter);
  console.log(oddsDiff.length ? oddsDiff.join("\n") : "  none");

  console.log(`\n=== Prediction snapshot: week ${week} (${path.relative(REPO_ROOT, predPath)}) ===`);
  console.log(predSummary.join("\n"));

  console.log(
    "\nDone. Nothing committed — review with `git status` / `git diff`, then commit and push yourself."
  );
}

// Guard so this only runs when executed directly (`npm run refresh:week`),
// not when another script imports buildPredictionSnapshot etc. for testing —
// this pipeline hits a live, quota-limited API and must never run as a
// side effect of an import.
if (require.main === module) {
  main();
}
