// Betting-line lookup for the /matchups page. Data is pre-pulled and
// committed (public/data/matchups/odds_2026.json, docs/DATA_SCHEMA.md) by
// ingest/pull_odds.mjs — this module only reads it, no computation.

export interface GameOdds {
  total: number;
  /** team code, or null for a pick'em (spread 0, no favourite either way) */
  favorite: string | null;
  spread: number;
}

export interface OddsGame {
  game_id: string;
  away: string;
  home: string;
  /** null when DraftKings hasn't posted a line for this game yet */
  odds: GameOdds | null;
}

export interface OddsDoc {
  schema_version: number;
  season: number;
  book: string;
  generated_at: string;
  weeks: Record<string, OddsGame[]>;
}

export function oddsForGame(oddsDoc: OddsDoc | null, week: string, gameId: string): GameOdds | null {
  const game = oddsDoc?.weeks[week]?.find((g) => g.game_id === gameId);
  return game?.odds ?? null;
}

/** Market spread oriented toward the home team: positive = home favoured,
 *  negative = away favoured, 0 = pick'em. Null when no line is posted yet —
 *  callers must not treat that as a pick'em 0, it means "no data". */
export function marketSpreadHome(odds: GameOdds | null, home: string): number | null {
  if (!odds) return null;
  if (!odds.favorite) return 0;
  return odds.favorite === home ? odds.spread : -odds.spread;
}

/** "LAC favoured by 9.5 · ~48 pts expected", "Pick 'em · ~41 pts expected" or
 *  "Lines not yet posted". Plain language, no bettor conventions (no "-9.5",
 *  no "O/U") — the exact total is still available via the returned `exactTotal`
 *  for callers that want to show it (e.g. in an expanded detail view). */
export function formatMarketLine(odds: GameOdds | null): string {
  if (!odds) return "Lines not yet posted";
  const spreadPart = odds.favorite
    ? `${odds.favorite} favoured by ${odds.spread}`
    : "Pick 'em";
  return `${spreadPart} · ~${Math.round(odds.total)} pts expected`;
}

/** "FINAL — SEA 13, NE 10" — higher score first, home team first on a tie. */
export function formatFinalLine(
  away: string,
  home: string,
  awayScore: number,
  homeScore: number
): string {
  const [firstCode, firstScore, secondCode, secondScore] =
    homeScore >= awayScore ? [home, homeScore, away, awayScore] : [away, awayScore, home, homeScore];
  return `FINAL — ${firstCode} ${firstScore}, ${secondCode} ${secondScore}`;
}
