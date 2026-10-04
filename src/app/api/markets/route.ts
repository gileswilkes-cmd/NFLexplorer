// Server-side combination point for the /markets page (nfl_markets_page_cc_prompt.md).
// Fetches Kalshi + Polymarket in parallel, normalises + matches them with
// our own schedule and the Tue/Fri sportsbook snapshot, and returns one
// JSON payload. Never called from the browser directly against either
// venue — this route is the only thing that talks to Kalshi/Polymarket, so
// there's no CORS exposure and no per-visitor rate-limit pressure on them.
import { NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildMarketGames, type ScheduleGameLite } from "@/lib/markets/match";
import { fetchKalshiGames } from "@/lib/markets/kalshi";
import { fetchPolymarketGames } from "@/lib/markets/polymarket";
import { gameKey } from "@/lib/markets/teams";
import type { MarketsResponse, MarketsVenueError, BooksQuote } from "@/lib/markets/types";
import type { OddsDoc } from "@/lib/odds";

// This route re-combines on every request (cheap: local fs reads + two
// already-cached outbound fetches) so a manual refresh is meaningful; the
// outbound fetches are what's actually rate-limited, via their own
// `next: { revalidate: 120 }` (lib/markets/constants.ts).
export const dynamic = "force-dynamic";

interface ScheduleDoc {
  weeks: Record<string, { game_id: string; away: string; home: string; away_score: number | null; home_score: number | null }[]>;
}

// Each call site below passes a literal path (not a runtime-built one) so
// Next's file tracer bundles only these two exact files into the function,
// not the whole public/data tree (~23k files) — a `path.join(cwd, variable)`
// here traces as a broad glob and bloats the deployed function.
function readPublicJson<T>(absolutePath: string): T | null {
  try {
    return JSON.parse(readFileSync(absolutePath, "utf-8")) as T;
  } catch {
    return null;
  }
}

function flattenSchedule(doc: ScheduleDoc | null): ScheduleGameLite[] {
  if (!doc) return [];
  const out: ScheduleGameLite[] = [];
  for (const [week, games] of Object.entries(doc.weeks)) {
    for (const g of games) {
      out.push({
        game_id: g.game_id, week, away: g.away, home: g.home,
        away_score: g.away_score, home_score: g.home_score,
      });
    }
  }
  return out;
}

function buildBooksByKey(oddsDoc: OddsDoc | null): Map<string, BooksQuote> {
  const map = new Map<string, BooksQuote>();
  if (!oddsDoc) return map;
  for (const games of Object.values(oddsDoc.weeks)) {
    for (const g of games) {
      if (!g.odds || g.odds.consensusHomeWinProb == null) continue;
      map.set(gameKey(g.away, g.home), {
        probHome: g.odds.consensusHomeWinProb,
        bookCount: g.odds.consensusBookCount ?? 0,
        generatedAt: oddsDoc.generated_at,
      });
    }
  }
  return map;
}

export async function GET() {
  const scheduleDoc = readPublicJson<ScheduleDoc>(
    path.join(process.cwd(), "public/data/matchups/schedule_2026.json")
  );
  const oddsDoc = readPublicJson<OddsDoc>(
    path.join(process.cwd(), "public/data/matchups/odds_2026.json")
  );
  const scheduleGames = flattenSchedule(scheduleDoc);
  const booksByKey = buildBooksByKey(oddsDoc);

  const errors: MarketsVenueError[] = [];
  const [kalshiResult, polymarketResult] = await Promise.allSettled([
    fetchKalshiGames(),
    fetchPolymarketGames(),
  ]);

  const kalshiGames = kalshiResult.status === "fulfilled" ? kalshiResult.value : [];
  if (kalshiResult.status === "rejected") {
    errors.push({ venue: "kalshi", message: String(kalshiResult.reason?.message ?? kalshiResult.reason) });
  }

  const polymarketGames = polymarketResult.status === "fulfilled" ? polymarketResult.value.games : [];
  if (polymarketResult.status === "rejected") {
    errors.push({ venue: "polymarket", message: String(polymarketResult.reason?.message ?? polymarketResult.reason) });
  }

  const games = buildMarketGames(scheduleGames, kalshiGames, polymarketGames, booksByKey, new Date());

  const body: MarketsResponse = {
    generatedAt: new Date().toISOString(),
    games,
    errors,
  };
  // Never blank out entirely: even if BOTH venues failed, this still
  // returns 200 with games: [] and errors populated — the page renders
  // that as a visible message, not a hard failure.
  return NextResponse.json(body);
}
