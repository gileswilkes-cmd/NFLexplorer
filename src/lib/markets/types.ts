import type { KalshiDisagreementFlag } from "./prices";

/** One venue's (or the books') quote on one game's home-win probability. */
export interface VenueQuote {
  probHome: number;
  bid: number | null;
  ask: number | null;
  /** ask - bid, in probability units (0-1); null when there's no two-sided quote. */
  spreadWidth: number | null;
  volume24h: number | null;
  url: string;
  /** when this quote was fetched (ISO UTC) — near-live for Kalshi/Polymarket. */
  fetchedAt: string;
  usedLastTradeFallback: boolean;
}

export interface BooksQuote {
  probHome: number | null;
  bookCount: number;
  /** odds_2026.json's generated_at — Tue/Fri cadence, not near-live (decision 2026-10). */
  generatedAt: string;
}

export interface MarketGame {
  gameId: string;
  week: string;
  /** ISO UTC, or null when neither the schedule nor Polymarket has a timestamp
   *  for this game (see docs/MARKETS.md — Kalshi's timestamps are never used). */
  kickoff: string | null;
  away: string;
  home: string;
  kalshi: VenueQuote | null;
  kalshiFlag: KalshiDisagreementFlag | null;
  /** false when Kalshi doesn't have this game's market open yet — shown as
   *  "Kalshi not yet listed" rather than treated as an error. */
  kalshiListed: boolean;
  polymarket: VenueQuote | null;
  books: BooksQuote | null;
  /** |Kalshi - Polymarket| in percentage points; null when either is missing. */
  gapPts: number | null;
}

export interface MarketsVenueError {
  venue: "kalshi" | "polymarket";
  message: string;
}

export interface MarketsResponse {
  generatedAt: string;
  games: MarketGame[];
  errors: MarketsVenueError[];
}
