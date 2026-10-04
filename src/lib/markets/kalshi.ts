// Kalshi normalisation (pure) + live fetch (impure) for the /markets page.
// Shape verified live against https://api.elections.kalshi.com/trade-api/v2
// on 2026-10-04 (Stage 1 probe, scripts/markets/probe.py) — see docs/MARKETS.md.
import { MARKETS_HORIZON_DAYS, REVALIDATE_SECONDS } from "./constants";
import { kalshiHomeProbability, parseKalshiDollar, type KalshiDisagreementFlag } from "./prices";
import { codeForKalshiTicker, gameKey } from "./teams";
import type { VenueQuote } from "./types";

const KALSHI_BASE = "https://api.elections.kalshi.com/trade-api/v2";
// Confirmed by inspecting /series?category=Sports (not hard-coded blind) —
// the full-game winner market. Kalshi has no full-game total market at all;
// its full-game spread market (KXNFLSPREAD) is a strike ladder like
// Polymarket's, not a single line, so neither is matched here (v1 is
// moneyline-only — docs/MARKETS.md).
const GAME_WINNER_SERIES_TICKER = "KXNFLGAME";

// Event ticker shape: KXNFLGAME-26OCT04INDWAS (2-digit year, 3-letter month,
// 2-digit day, then the two teams' codes concatenated with no separator).
const TICKER_SUFFIX_RE = /-(\d{2})([A-Z]{3})(\d{2})([A-Z]+)$/;
const MONTH_ABBR: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};

export interface KalshiRawMarket {
  ticker: string;
  yes_bid_dollars?: string;
  yes_ask_dollars?: string;
  last_price_dollars?: string;
  volume_24h_fp?: string;
}

export interface KalshiRawEvent {
  event_ticker: string;
  title: string;
  markets: KalshiRawMarket[];
}

export interface NormalizedKalshiGame {
  key: string;
  away: string;
  home: string;
  quote: VenueQuote;
  flag: KalshiDisagreementFlag | null;
}

function ticketDate(eventTicker: string): Date | null {
  const m = TICKER_SUFFIX_RE.exec(eventTicker);
  if (!m) return null;
  const [, yy, mon, dd] = m;
  const month = MONTH_ABBR[mon];
  if (!month) return null;
  return new Date(Date.UTC(2000 + Number(yy), month - 1, Number(dd)));
}

/** Pure: raw Kalshi events -> one normalised game per event. Events that
 *  don't parse cleanly (unexpected ticker shape, not exactly 2 nested
 *  markets, no two-sided-or-last-trade price on either side) are skipped
 *  rather than guessed at. */
export function normalizeKalshiEvents(
  events: KalshiRawEvent[],
  fetchedAt: string
): NormalizedKalshiGame[] {
  const out: NormalizedKalshiGame[] = [];

  for (const e of events) {
    const m = TICKER_SUFFIX_RE.exec(e.event_ticker);
    if (!m || e.markets.length !== 2) continue;
    const awayHomeBlock = m[4];

    // The event title's own leading city codes are ambiguous for
    // multi-team cities ("NY Giants" / "NY Jets" both print "NY"; "LA Rams"
    // / "LA Chargers" both print "LA") — found live on the Stage 1 probe.
    // Each market's own ticker suffix is unambiguous, so derive the two
    // team codes from there, then use the event ticker's concatenated
    // AWAYHOME block to decide which one is away vs home.
    const marketCodes = e.markets.map((mkt) => mkt.ticker.split("-").pop() ?? "");
    const [a, b] = marketCodes;
    let awayRaw: string | null = null;
    let homeRaw: string | null = null;
    if (awayHomeBlock.startsWith(a)) { awayRaw = a; homeRaw = b; }
    else if (awayHomeBlock.startsWith(b)) { awayRaw = b; homeRaw = a; }
    if (!awayRaw || !homeRaw) continue;

    const awayMarket = e.markets.find((mkt) => mkt.ticker.endsWith(`-${awayRaw}`));
    const homeMarket = e.markets.find((mkt) => mkt.ticker.endsWith(`-${homeRaw}`));
    if (!awayMarket || !homeMarket) continue;

    const away = codeForKalshiTicker(awayRaw);
    const home = codeForKalshiTicker(homeRaw);

    const homeSide = {
      bid: parseKalshiDollar(homeMarket.yes_bid_dollars),
      ask: parseKalshiDollar(homeMarket.yes_ask_dollars),
      lastTrade: parseKalshiDollar(homeMarket.last_price_dollars),
    };
    const awaySide = {
      bid: parseKalshiDollar(awayMarket.yes_bid_dollars),
      ask: parseKalshiDollar(awayMarket.yes_ask_dollars),
      lastTrade: parseKalshiDollar(awayMarket.last_price_dollars),
    };
    const result = kalshiHomeProbability(homeSide, awaySide);
    if (result.prob == null) continue;

    const vol =
      (parseKalshiDollar(homeMarket.volume_24h_fp) ?? 0) +
      (parseKalshiDollar(awayMarket.volume_24h_fp) ?? 0);
    const spreadWidth =
      homeSide.bid != null && homeSide.ask != null ? homeSide.ask - homeSide.bid : null;

    out.push({
      key: gameKey(away, home),
      away,
      home,
      quote: {
        probHome: result.prob,
        bid: homeSide.bid,
        ask: homeSide.ask,
        spreadWidth,
        volume24h: vol,
        url: "https://kalshi.com/markets/kxnflgame",
        fetchedAt,
        usedLastTradeFallback: result.usedLastTradeFallback,
      },
      flag: result.flag,
    });
  }

  return out;
}

/** Impure: live fetch + pagination + horizon-window filter, then normalise. */
export async function fetchKalshiGames(
  horizonDays: number = MARKETS_HORIZON_DAYS
): Promise<NormalizedKalshiGame[]> {
  const now = new Date();
  const cutoff = new Date(now.getTime() + horizonDays * 86_400_000);
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  const events: KalshiRawEvent[] = [];
  let cursor = "";
  for (let page = 0; page < 10; page++) {
    const url =
      `${KALSHI_BASE}/events?series_ticker=${GAME_WINNER_SERIES_TICKER}` +
      `&with_nested_markets=true&status=open&limit=200` +
      (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "");
    const res = await fetch(url, { next: { revalidate: REVALIDATE_SECONDS } });
    if (!res.ok) throw new Error(`Kalshi /events request failed: ${res.status} ${res.statusText}`);
    const body = (await res.json()) as { events?: KalshiRawEvent[]; cursor?: string };
    const pageEvents = body.events ?? [];
    events.push(...pageEvents);
    cursor = body.cursor ?? "";
    if (!cursor || pageEvents.length === 0) break;
  }

  const inWindow = events.filter((e) => {
    const d = ticketDate(e.event_ticker);
    return d != null && d >= todayUtc && d <= cutoff;
  });

  return normalizeKalshiEvents(inWindow, new Date().toISOString());
}
