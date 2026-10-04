// Single source of truth for team-code normalisation across every consumer
// that needs it: ingest/pull_odds.mjs (the-odds-api full names) and this
// lib (Polymarket full names, Kalshi ticker codes). Moved here from a
// duplicate inline map in pull_odds.mjs (docs/MARKETS.md) — both now read
// the same team-codes.json so there is exactly one 32-team mapping to keep
// in sync when a franchise ever renames/relocates.
//
// Kalshi overrides exist because Kalshi's ticker-embedded codes differ from
// ours in exactly two places (found live during the Stage 1 probe,
// 2026-10-04): Jacksonville tickers as JAC (we use JAX everywhere else) and
// the LA Rams ticker as LAR (we use LA everywhere else, including for the
// Rams' own team page). Everything else Kalshi uses — including LAC for the
// Chargers — already matches.
import teamCodes from "./team-codes.json";

export const TEAM_NAME_TO_CODE: Record<string, string> = teamCodes.teamNameToCode;
export const KALSHI_CODE_OVERRIDES: Record<string, string> = teamCodes.kalshiCodeOverrides;
export const CANONICAL_CODES: ReadonlySet<string> = new Set(Object.values(TEAM_NAME_TO_CODE));

/** Full team name ("Washington Commanders") -> our code, or null if unrecognised. */
export function codeForFullTeamName(name: string): string | null {
  return TEAM_NAME_TO_CODE[name] ?? null;
}

/** Kalshi's ticker-embedded team code -> our code (identity unless overridden above). */
export function codeForKalshiTicker(rawCode: string): string {
  return KALSHI_CODE_OVERRIDES[rawCode] ?? rawCode;
}

/** The join key used everywhere two venues (or a venue and our schedule) are
 *  matched on one game — "AWAY@HOME", never by date (UTC rollover puts
 *  Sunday/Monday night games on the next calendar date for some feeds). */
export function gameKey(away: string, home: string): string {
  return `${away}@${home}`;
}
