// Pure price-conversion helpers for the /markets page. Every exported
// probability is 0-1. No fetching here — see kalshi.ts/polymarket.ts for
// the live calls that feed these.
import { KALSHI_DISAGREEMENT_THRESHOLD_PTS } from "./constants";

export interface MidPriceResult {
  mid: number | null;
  usedLastTradeFallback: boolean;
}

/** (bid+ask)/2, falling back to the last trade only when there's no
 *  two-sided quote — and saying so, so the UI can flag it (page spec). */
export function midPrice(
  bid: number | null,
  ask: number | null,
  lastTrade: number | null
): MidPriceResult {
  if (bid != null && ask != null) {
    return { mid: (bid + ask) / 2, usedLastTradeFallback: false };
  }
  if (lastTrade != null) {
    return { mid: lastTrade, usedLastTradeFallback: true };
  }
  return { mid: null, usedLastTradeFallback: false };
}

/** Kalshi prices as dollar strings ("0.3400"), not integer cents — verified
 *  live against the actual API (2026-10-04), contrary to what one might
 *  assume from older Kalshi docs. */
export function parseKalshiDollar(value: string | null | undefined): number | null {
  if (value == null) return null;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

export interface KalshiSideQuote {
  bid: number | null;
  ask: number | null;
  lastTrade: number | null;
}

export interface KalshiDisagreementFlag {
  disagreementPts: number;
  usedSide: "home" | "away";
}

export interface KalshiHomeProbabilityResult {
  prob: number | null;
  usedLastTradeFallback: boolean;
  flag: KalshiDisagreementFlag | null;
}

/** Kalshi has no single two-sided "home win" market — it has two
 *  independent one-sided markets (home-team YES, away-team YES), each with
 *  its own bid/ask, that can disagree. Average them when they're close;
 *  when they diverge by more than the threshold, trust whichever side has
 *  the tighter spread (the more liquid, more informative quote) rather than
 *  average in the noisier side, and flag it for the UI tooltip. */
export function kalshiHomeProbability(
  home: KalshiSideQuote,
  away: KalshiSideQuote
): KalshiHomeProbabilityResult {
  const homeMid = midPrice(home.bid, home.ask, home.lastTrade);
  const awayMid = midPrice(away.bid, away.ask, away.lastTrade);
  const fromHome = homeMid.mid;
  const fromAway = awayMid.mid != null ? 1 - awayMid.mid : null;

  if (fromHome == null && fromAway == null) {
    return { prob: null, usedLastTradeFallback: false, flag: null };
  }
  if (fromHome == null) {
    return { prob: fromAway, usedLastTradeFallback: awayMid.usedLastTradeFallback, flag: null };
  }
  if (fromAway == null) {
    return { prob: fromHome, usedLastTradeFallback: homeMid.usedLastTradeFallback, flag: null };
  }

  const diffPts = Math.abs(fromHome - fromAway) * 100;
  if (diffPts <= KALSHI_DISAGREEMENT_THRESHOLD_PTS) {
    return {
      prob: (fromHome + fromAway) / 2,
      usedLastTradeFallback: homeMid.usedLastTradeFallback || awayMid.usedLastTradeFallback,
      flag: null,
    };
  }

  const homeSpread = home.bid != null && home.ask != null ? home.ask - home.bid : Infinity;
  const awaySpread = away.bid != null && away.ask != null ? away.ask - away.bid : Infinity;
  const useSide: "home" | "away" = homeSpread <= awaySpread ? "home" : "away";
  return {
    prob: useSide === "home" ? fromHome : fromAway,
    usedLastTradeFallback: useSide === "home" ? homeMid.usedLastTradeFallback : awayMid.usedLastTradeFallback,
    flag: { disagreementPts: Math.round(diffPts * 10) / 10, usedSide: useSide },
  };
}
