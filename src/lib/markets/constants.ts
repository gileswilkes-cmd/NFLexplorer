// Tunable thresholds for the /markets page (docs/MARKETS.md has the
// reasoning + what to look at if these need adjusting).

/** Fetch window: how far ahead of "now" a game is still shown. */
export const MARKETS_HORIZON_DAYS = 14;

/** Row gets the disagreement highlight when |Kalshi - Polymarket| >= this
 *  many percentage points. */
export const GAP_HIGHLIGHT_THRESHOLD_PTS = 3;

/** Kalshi prices its two sides (home-team YES, away-team YES) as separate
 *  markets that can drift apart. When they imply home-win probabilities
 *  more than this many points apart, fall back to whichever side has the
 *  tighter bid/ask spread instead of blindly averaging (decision: 2026-10
 *  Markets page build). */
export const KALSHI_DISAGREEMENT_THRESHOLD_PTS = 3;

/** A quote is flagged "thin" (muted styling + tooltip) when its bid/ask
 *  width is at least this many percentage points... */
export const WIDE_SPREAD_THRESHOLD_PTS = 4;
/** ...or its 24h volume (USD for Polymarket; Kalshi's volume_24h_fp is also
 *  USD-denominated — each contract has $1 notional) is below this. Picked
 *  from the Stage 1 probe's live samples (most NFL moneyline markets showed
 *  tens-to-hundreds of thousands in 24h volume); revisit if that profile
 *  shifts, e.g. well outside the regular season. */
export const LOW_VOLUME_THRESHOLD_USD = 5000;

/** Next.js fetch cache lifetime for both venue calls, in seconds — "near-live,
 *  at most about 2 minutes old" per the page spec, and polite to both free
 *  public APIs. */
export const REVALIDATE_SECONDS = 120;

export function isThinMarket(spreadWidthProb: number | null, volume24hUsd: number | null): boolean {
  const wideSpread = spreadWidthProb != null && spreadWidthProb * 100 >= WIDE_SPREAD_THRESHOLD_PTS;
  const lowVolume = volume24hUsd != null && volume24hUsd < LOW_VOLUME_THRESHOLD_USD;
  return wideSpread || lowVolume;
}
