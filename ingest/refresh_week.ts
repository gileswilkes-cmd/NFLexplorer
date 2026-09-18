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
//
// `slate_strip` (the week's 4 divergence-sort superlatives) mirrors this at
// the WEEK level, anchored to the FIRST kickoff of the week rather than the
// last: freely recomputed while no game has kicked off, then locked at
// whatever the run that first observes a score computed. A version anchored
// to the last kickoff would blend in games that had already played, which
// isn't an ex ante claim and can't be graded as one.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  computeGameTags,
  computeModelForecast,
  computeSlateStrip,
  computeUnitMatchups,
  computeVerdict,
  computeWeekDivergence,
  defaultWeek,
  type DivergenceTier,
  type GameTag,
  type GameWithDivergence,
  type ModelLean,
  type ScheduleDoc,
  type SlateStrip,
  type UnitRatingsDoc,
} from "@/lib/matchups";
import { oddsForGame, type OddsDoc } from "@/lib/odds";

const REPO_ROOT = path.resolve(__dirname, "..");
const SCHEMA_VERSION = 1; // meta.json — shape unchanged, stays at 1
// predictions/week_{N}.json only — bumped because `divergence` and
// `slate_strip` are new required-shape additions to what a "captured" game
// means; a look-back reader needs to tell a pre-divergence snapshot (no
// `divergence` key, nothing to grade) from a divergence-era one by version,
// not by probing for key presence.
const PREDICTIONS_SCHEMA_VERSION = 2;
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

// Model-vs-market divergence at capture time (docs/... divergence sort) — the
// look-back page grades the divergence CALL, so this needs to freeze exactly
// what the card showed pre-kickoff, same as model/market above, not be
// reconstructable later from a moving market line.
interface PredictionDivergence {
  model_net: number;
  market_spread_home: number | null;
  model_z: number | null;
  market_z: number | null;
  divergence_z: number | null;
  tier: DivergenceTier;
  model_lean: string | null;
  market_lean: string | null;
}

interface PredictionGame {
  game_id: string;
  away: string;
  home: string;
  kickoff: string;
  model?: PredictionModel;
  market?: PredictionMarket | null;
  divergence?: PredictionDivergence;
  captured: boolean;
}

interface PredictionSlateSuperlative {
  game_id: string;
  away: string;
  home: string;
  value: number;
}

interface PredictionUnitMismatch extends PredictionSlateSuperlative {
  kind: string;
  off_team: string;
  def_team: string;
  off_rank: number;
  def_rank: number;
}

interface PredictionSlateStrip {
  top_divergence: PredictionSlateSuperlative | null;
  sharpest_unit_mismatch: PredictionUnitMismatch | null;
  highest_market_total: PredictionSlateSuperlative | null;
  lowest_market_total: PredictionSlateSuperlative | null;
}

interface PredictionDoc {
  schema_version: number;
  season: number;
  week: number;
  captured_at: string;
  games: PredictionGame[];
  slate_strip?: PredictionSlateStrip;
}

function toPredictionDivergence(d: GameWithDivergence["divergence"]): PredictionDivergence {
  return {
    model_net: d.modelNet, market_spread_home: d.marketSpreadHome, model_z: d.modelZ, market_z: d.marketZ,
    divergence_z: d.divergenceZ, tier: d.tier, model_lean: d.modelLean, market_lean: d.marketLean,
  };
}

function toPredictionSlateStrip(strip: SlateStrip): PredictionSlateStrip {
  return {
    top_divergence: strip.topDivergence
      ? { game_id: strip.topDivergence.gameId, away: strip.topDivergence.away, home: strip.topDivergence.home, value: strip.topDivergence.value }
      : null,
    sharpest_unit_mismatch: strip.sharpestUnitMismatch
      ? {
          game_id: strip.sharpestUnitMismatch.gameId, away: strip.sharpestUnitMismatch.away, home: strip.sharpestUnitMismatch.home,
          value: strip.sharpestUnitMismatch.value, kind: strip.sharpestUnitMismatch.kind,
          off_team: strip.sharpestUnitMismatch.offTeam, def_team: strip.sharpestUnitMismatch.defTeam,
          off_rank: strip.sharpestUnitMismatch.offRank, def_rank: strip.sharpestUnitMismatch.defRank,
        }
      : null,
    highest_market_total: strip.highestMarketTotal
      ? { game_id: strip.highestMarketTotal.gameId, away: strip.highestMarketTotal.away, home: strip.highestMarketTotal.home, value: strip.highestMarketTotal.value }
      : null,
    lowest_market_total: strip.lowestMarketTotal
      ? { game_id: strip.lowestMarketTotal.gameId, away: strip.lowestMarketTotal.away, home: strip.lowestMarketTotal.home, value: strip.lowestMarketTotal.value }
      : null,
  };
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

  // Computed once for the whole slate — divergence (unlike model/market
  // above) is inherently a slate-relative quantity (z-scored against every
  // other game this week), so it can't be recomputed one game at a time the
  // way the rest of this function does.
  const weekDivergence = computeWeekDivergence(week, scheduleDoc, ratingsDoc, oddsDoc);
  const divergenceByGameId = new Map(weekDivergence.map((gm) => [gm.game.game_id, gm.divergence]));

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
    const divergence = divergenceByGameId.get(g.game_id);
    if (!divergence) throw new Error(`computeWeekDivergence produced no entry for ${g.game_id}`);

    const odds = oddsForGame(oddsDoc, week, g.game_id);
    const market: PredictionMarket | null = odds
      ? { favourite: odds.favorite, spread: odds.spread, total: odds.total, book: oddsDoc!.book }
      : null;

    const verb = prior ? "refreshed" : "captured";
    const marketDesc = market ? (market.favourite ?? "pick'em") : "no line posted";
    summary.push(
      `  ${g.game_id}: ${verb} — model favours ${forecast.favourite ?? "neither (even)"}, market favours ${marketDesc}, ` +
      `divergence tier=${divergence.tier}${divergence.divergenceZ !== null ? ` (z=${divergence.divergenceZ.toFixed(2)})` : ""}`
    );

    return {
      game_id: g.game_id,
      away: g.away,
      home: g.home,
      kickoff: g.date,
      model: { favourite: forecast.favourite, lean: forecast.lean, margin_est: forecast.marginEst, tags, verdict },
      market,
      divergence: toPredictionDivergence(divergence),
      captured: true,
    };
  });

  // Slate strip freezes at the FIRST kickoff of the week, not the last — the
  // week-level mirror of the per-game freeze rule above. Before any game has
  // kicked off, every game's divergence is still ex ante, so recompute fresh
  // each run (a moving market line keeps winning, same as model/market
  // above). The run that first observes any score locks it in at whatever it
  // computed that run (the best available "at first kickoff" read, since
  // this only runs when invoked, not continuously) — a version anchored to
  // the LAST kickoff would mix in games that had already played by then,
  // which isn't an ex ante claim and can't be graded as one.
  const anyPlayed = games.some((g) => g.away_score !== null && g.home_score !== null);
  const slateStrip = anyPlayed && existing?.slate_strip
    ? existing.slate_strip
    : toPredictionSlateStrip(computeSlateStrip(weekDivergence, oddsDoc, week));

  return {
    doc: {
      schema_version: PREDICTIONS_SCHEMA_VERSION,
      season: SEASON,
      week: Number(week),
      captured_at: new Date().toISOString(),
      games: outGames,
      slate_strip: slateStrip,
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
