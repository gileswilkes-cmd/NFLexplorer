// Combines the two live venues with our own schedule + the (Tue/Fri)
// sportsbook snapshot into the MarketGame list the /markets page renders.
// Pure — all fetching happens in kalshi.ts/polymarket.ts and the API route.
import { GAP_HIGHLIGHT_THRESHOLD_PTS } from "./constants";
import type { NormalizedKalshiGame } from "./kalshi";
import type { NormalizedPolymarketGame } from "./polymarket";
import { gameKey } from "./teams";
import type { BooksQuote, MarketGame } from "./types";

export interface ScheduleGameLite {
  game_id: string;
  week: string;
  away: string;
  home: string;
  /** present only once nflverse has a final score for this game. */
  away_score: number | null;
  home_score: number | null;
}

export { GAP_HIGHLIGHT_THRESHOLD_PTS };

/** Builds every game that has a quote on at least one venue, excludes games
 *  whose kickoff has already passed (in-game prices would distort the view
 *  — decision 2026-10), and sorts by kickoff.
 *
 *  Kickoff resolution (decision 2026-10): our own schedule data first, if it
 *  ever carries a timestamp (`schedule_2026.json` is date-only today — see
 *  docs/MARKETS.md — so this branch is a no-op until that changes), then
 *  Polymarket's `startTime`. Kalshi's timestamps are never used — Stage 1
 *  found they track game *end*, not kickoff (~3h off). When neither source
 *  has a timestamp, fall back to the schedule's final-score fields to
 *  decide "has this already been played"; a game that's neither finished
 *  nor timestamped stays visible (never blank out on uncertainty). */
export function buildMarketGames(
  scheduleGames: ScheduleGameLite[],
  kalshiGames: NormalizedKalshiGame[],
  polymarketGames: NormalizedPolymarketGame[],
  booksByKey: ReadonlyMap<string, BooksQuote>,
  now: Date
): MarketGame[] {
  const kalshiByKey = new Map(kalshiGames.map((g) => [g.key, g]));
  const polyByKey = new Map(polymarketGames.map((g) => [g.key, g]));

  const games: MarketGame[] = [];
  for (const sg of scheduleGames) {
    const key = gameKey(sg.away, sg.home);
    const k = kalshiByKey.get(key) ?? null;
    const p = polyByKey.get(key) ?? null;
    if (!k && !p) continue;

    const kickoff: string | null = scheduleKickoff(sg) ?? p?.kickoff ?? null;
    const finished = sg.away_score != null && sg.home_score != null;
    const kickoffPassed = kickoff != null ? new Date(kickoff) <= now : finished;
    if (kickoffPassed) continue;

    const books = booksByKey.get(key) ?? null;
    const gapPts =
      k && p ? Math.round(Math.abs(k.quote.probHome - p.quote.probHome) * 1000) / 10 : null;

    games.push({
      gameId: sg.game_id,
      week: sg.week,
      kickoff,
      away: sg.away,
      home: sg.home,
      kalshi: k?.quote ?? null,
      kalshiFlag: k?.flag ?? null,
      kalshiListed: k != null,
      polymarket: p?.quote ?? null,
      books,
      gapPts,
    });
  }

  return games.sort((a, b) => {
    const ak = a.kickoff ?? "9999";
    const bk = b.kickoff ?? "9999";
    return ak < bk ? -1 : ak > bk ? 1 : a.gameId.localeCompare(b.gameId);
  });
}

// schedule_2026.json has no time-of-day field today (date only) — this
// checks defensively for one anyway so a future schema addition is picked
// up automatically with no change needed here.
function scheduleKickoff(sg: ScheduleGameLite & { kickoff_utc?: string }): string | null {
  return sg.kickoff_utc ?? null;
}

export function isHighlighted(gapPts: number | null): boolean {
  return gapPts != null && gapPts >= GAP_HIGHLIGHT_THRESHOLD_PTS;
}
