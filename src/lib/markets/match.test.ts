import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMarketGames, isHighlighted, type ScheduleGameLite } from "./match";
import type { NormalizedKalshiGame } from "./kalshi";
import type { NormalizedPolymarketGame } from "./polymarket";
import type { BooksQuote, VenueQuote } from "./types";

function quote(probHome: number): VenueQuote {
  return {
    probHome, bid: probHome - 0.01, ask: probHome + 0.01, spreadWidth: 0.02,
    volume24h: 10000, url: "https://example.com", fetchedAt: "2026-10-04T12:00:00Z",
    usedLastTradeFallback: false,
  };
}

const SCHEDULE: ScheduleGameLite[] = [
  { game_id: "2026_05_SEA_DEN", week: "6", away: "SEA", home: "DEN", away_score: null, home_score: null },
  { game_id: "2026_04_IND_WAS", week: "4", away: "IND", home: "WAS", away_score: null, home_score: null },
  { game_id: "2026_04_PIT_CLE", week: "4", away: "PIT", home: "CLE", away_score: 24, home_score: 27 },
];

test("buildMarketGames: includes a game present on only one venue, flagged kalshiListed=false", () => {
  const poly: NormalizedPolymarketGame[] = [
    { key: "SEA@DEN", away: "SEA", home: "DEN", kickoff: "2026-10-15T17:00:00Z", quote: quote(0.4) },
  ];
  const games = buildMarketGames(SCHEDULE, [], poly, new Map(), new Date("2026-10-04T00:00:00Z"));
  const g = games.find((x) => x.gameId === "2026_05_SEA_DEN");
  assert.ok(g);
  assert.equal(g?.kalshiListed, false);
  assert.equal(g?.kalshi, null);
  assert.ok(g?.polymarket);
  assert.equal(g?.gapPts, null); // can't compute a gap with only one venue
});

test("buildMarketGames: excludes a game whose kickoff has already passed", () => {
  const poly: NormalizedPolymarketGame[] = [
    { key: "IND@WAS", away: "IND", home: "WAS", kickoff: "2026-10-04T13:30:00Z", quote: quote(0.34) },
  ];
  const now = new Date("2026-10-04T14:00:00Z"); // 30 minutes after kickoff
  const games = buildMarketGames(SCHEDULE, [], poly, new Map(), now);
  assert.equal(games.find((g) => g.gameId === "2026_04_IND_WAS"), undefined);
});

test("buildMarketGames: excludes an already-finished game even with no kickoff timestamp available", () => {
  // PIT@CLE has final scores in the fixture and no venue quote carries a
  // kickoff timestamp here — must still be excluded, not shown as live.
  const kalshi: NormalizedKalshiGame[] = [
    { key: "PIT@CLE", away: "PIT", home: "CLE", quote: quote(0.4), flag: null },
  ];
  const games = buildMarketGames(SCHEDULE, kalshi, [], new Map(), new Date("2026-10-04T00:00:00Z"));
  assert.equal(games.find((g) => g.gameId === "2026_04_PIT_CLE"), undefined);
});

test("buildMarketGames: computes the Kalshi/Polymarket gap in points and books is attached by key", () => {
  const kalshi: NormalizedKalshiGame[] = [
    { key: "IND@WAS", away: "IND", home: "WAS", quote: quote(0.70), flag: null },
  ];
  const poly: NormalizedPolymarketGame[] = [
    { key: "IND@WAS", away: "IND", home: "WAS", kickoff: "2026-10-20T13:30:00Z", quote: quote(0.655) },
  ];
  const books: BooksQuote = { probHome: 0.66, bookCount: 5, generatedAt: "2026-10-01T08:00:00Z" };
  const booksByKey = new Map([["IND@WAS", books]]);
  const games = buildMarketGames(SCHEDULE, kalshi, poly, booksByKey, new Date("2026-10-04T00:00:00Z"));
  const g = games.find((x) => x.gameId === "2026_04_IND_WAS");
  assert.ok(g);
  assert.equal(g?.gapPts, 4.5); // |0.70 - 0.655| * 100
  assert.deepEqual(g?.books, books);
  assert.equal(isHighlighted(g?.gapPts ?? null), true); // >= 3pt threshold
});

test("isHighlighted is false below the threshold and for a null gap", () => {
  assert.equal(isHighlighted(2.9), false);
  assert.equal(isHighlighted(null), false);
  assert.equal(isHighlighted(3), true);
});
