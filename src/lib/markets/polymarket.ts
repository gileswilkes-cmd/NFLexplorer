// Polymarket normalisation (pure) + live fetch (impure) for the /markets
// page. Shape verified live against https://gamma-api.polymarket.com on
// 2026-10-04 (Stage 1 probe, scripts/markets/probe.py) — see docs/MARKETS.md.
import { MARKETS_HORIZON_DAYS, REVALIDATE_SECONDS } from "./constants";
import { midPrice } from "./prices";
import { codeForFullTeamName, gameKey } from "./teams";
import type { VenueQuote } from "./types";

const GAMMA_BASE = "https://gamma-api.polymarket.com";

export interface PolymarketRawTeam {
  name: string;
  /** short mascot name matching the moneyline market's `outcomes` entries
   *  exactly, e.g. "Commanders" — NOT the venue's 2-3 letter `abbreviation`,
   *  which collides for two-team cities the same way Kalshi's titles do. */
  alias: string;
  ordering: "home" | "away";
}

export interface PolymarketRawMarket {
  sportsMarketType?: string;
  /** JSON-encoded string, e.g. '["Colts", "Commanders"]' */
  outcomes?: string;
  bestBid?: number | null;
  bestAsk?: number | null;
  lastTradePrice?: number | null;
  volume24hr?: number | null;
}

export interface PolymarketRawEvent {
  title: string;
  startTime?: string;
  teams?: PolymarketRawTeam[];
  markets: PolymarketRawMarket[];
}

export interface NormalizedPolymarketGame {
  key: string;
  away: string;
  home: string;
  kickoff: string | null;
  quote: VenueQuote;
}

/** Pure: raw Polymarket events -> one normalised game per event (using its
 *  moneyline market only — see docs/MARKETS.md for why spread/total aren't
 *  cross-venue matched in v1). Events with no recognised teams or no
 *  moneyline market are skipped. */
export function normalizePolymarketEvents(
  events: PolymarketRawEvent[],
  fetchedAt: string
): { games: NormalizedPolymarketGame[]; unmappedNames: string[] } {
  const games: NormalizedPolymarketGame[] = [];
  const unmappedNames = new Set<string>();

  for (const e of events) {
    const teams = e.teams ?? [];
    const awayTeam = teams.find((t) => t.ordering === "away") ?? null;
    const homeTeam = teams.find((t) => t.ordering === "home") ?? null;
    if (!awayTeam || !homeTeam) continue;

    const away = codeForFullTeamName(awayTeam.name);
    const home = codeForFullTeamName(homeTeam.name);
    if (!away) unmappedNames.add(awayTeam.name);
    if (!home) unmappedNames.add(homeTeam.name);
    if (!away || !home) continue;

    const moneyline = e.markets.find((m) => m.sportsMarketType === "moneyline");
    if (!moneyline) continue;

    let outcomes: string[];
    try {
      outcomes = JSON.parse(moneyline.outcomes ?? "[]");
    } catch {
      continue;
    }
    if (outcomes.length !== 2) continue;

    // bestBid/bestAsk/lastTradePrice are quoted for outcomes[0] — resolve
    // which index is home via the team's `alias` (its mascot name), never
    // by assuming array position.
    const homeIndex = outcomes.findIndex((o) => o === homeTeam.alias);
    if (homeIndex === -1) continue;

    const rawMid = midPrice(
      moneyline.bestBid ?? null,
      moneyline.bestAsk ?? null,
      moneyline.lastTradePrice ?? null
    );
    if (rawMid.mid == null) continue;
    const probHome = homeIndex === 0 ? rawMid.mid : 1 - rawMid.mid;
    const spreadWidth =
      moneyline.bestBid != null && moneyline.bestAsk != null
        ? moneyline.bestAsk - moneyline.bestBid
        : null;

    games.push({
      key: gameKey(away, home),
      away,
      home,
      kickoff: e.startTime ?? null,
      quote: {
        probHome,
        bid: moneyline.bestBid ?? null,
        ask: moneyline.bestAsk ?? null,
        spreadWidth,
        volume24h: moneyline.volume24hr ?? null,
        url: "https://polymarket.com/sports/nfl",
        fetchedAt,
        usedLastTradeFallback: rawMid.usedLastTradeFallback,
      },
    });
  }

  return { games, unmappedNames: [...unmappedNames] };
}

/** Impure: live fetch + horizon-window filter, then normalise.
 *  `active=true&closed=false` does NOT reliably exclude already-played
 *  games (a finished game's event can stay open because unrelated prop
 *  markets inside it haven't settled — found live on the Stage 1 probe), so
 *  the real filter is each event's own `startTime`. */
export async function fetchPolymarketGames(
  horizonDays: number = MARKETS_HORIZON_DAYS
): Promise<{ games: NormalizedPolymarketGame[]; unmappedNames: string[] }> {
  const seriesId = await findNflSeriesId();
  const now = new Date();
  const cutoff = new Date(now.getTime() + horizonDays * 86_400_000);

  const url = `${GAMMA_BASE}/events?series_id=${seriesId}&active=true&closed=false&limit=200`;
  const res = await fetch(url, { next: { revalidate: REVALIDATE_SECONDS } });
  if (!res.ok) throw new Error(`Polymarket /events request failed: ${res.status} ${res.statusText}`);
  const events = (await res.json()) as PolymarketRawEvent[];

  const inWindow = events.filter((e) => {
    if (!e.startTime) return false;
    const start = new Date(e.startTime);
    return start >= now && start <= cutoff;
  });

  return normalizePolymarketEvents(inWindow, new Date().toISOString());
}

async function findNflSeriesId(): Promise<number> {
  const res = await fetch(`${GAMMA_BASE}/sports`, { next: { revalidate: 86_400 } });
  if (!res.ok) throw new Error(`Polymarket /sports request failed: ${res.status} ${res.statusText}`);
  const sports = (await res.json()) as { sport: string; series: string }[];
  const nfl = sports.find((s) => s.sport === "nfl");
  if (!nfl) throw new Error("Polymarket: no /sports entry with sport == 'nfl'");
  return Number(nfl.series);
}
