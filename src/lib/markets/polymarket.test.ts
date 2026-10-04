import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePolymarketEvents, type PolymarketRawEvent } from "./polymarket";

const FETCHED_AT = "2026-10-04T12:00:00.000Z";

function moneylineEvent(opts: {
  awayName: string; awayAlias: string;
  homeName: string; homeAlias: string;
  outcomes: [string, string]; // [outcome0, outcome1], as the live API orders them
  bestBid: number; bestAsk: number;
  startTime?: string;
}): PolymarketRawEvent {
  return {
    title: `${opts.awayName} vs. ${opts.homeName}`,
    startTime: opts.startTime ?? "2026-10-04T17:00:00Z",
    teams: [
      { name: opts.awayName, alias: opts.awayAlias, ordering: "away" },
      { name: opts.homeName, alias: opts.homeAlias, ordering: "home" },
    ],
    markets: [
      {
        sportsMarketType: "moneyline",
        outcomes: JSON.stringify(opts.outcomes),
        bestBid: opts.bestBid,
        bestAsk: opts.bestAsk,
      },
    ],
  };
}

test("normalizePolymarketEvents: home resolved via alias, outcome[0] is away", () => {
  // outcomes[0] = "Titans" (away), bestBid/Ask quote outcome[0] -> away prob.
  const event = moneylineEvent({
    awayName: "Tennessee Titans", awayAlias: "Titans",
    homeName: "Baltimore Ravens", homeAlias: "Ravens",
    outcomes: ["Titans", "Ravens"],
    bestBid: 0.14, bestAsk: 0.15,
  });
  const { games } = normalizePolymarketEvents([event], FETCHED_AT);
  const [game] = games;
  assert.equal(game.away, "TEN");
  assert.equal(game.home, "BAL");
  // away mid = 0.145 -> home = 1 - 0.145 = 0.855
  assert.ok(Math.abs(game.quote.probHome - 0.855) < 1e-9);
});

test("normalizePolymarketEvents: home resolved via alias when home happens to be outcome[0]", () => {
  const event = moneylineEvent({
    awayName: "Seattle Seahawks", awayAlias: "Seahawks",
    homeName: "Washington Commanders", homeAlias: "Commanders",
    outcomes: ["Commanders", "Seahawks"], // home listed first this time
    bestBid: 0.60, bestAsk: 0.62,
  });
  const { games } = normalizePolymarketEvents([event], FETCHED_AT);
  const [game] = games;
  assert.equal(game.home, "WAS");
  // home is outcome[0] here -> probHome = mid directly = 0.61
  assert.ok(Math.abs(game.quote.probHome - 0.61) < 1e-9);
});

test("normalizePolymarketEvents: unrecognised team name is reported, not silently dropped", () => {
  const event = moneylineEvent({
    awayName: "Nowhere Nomads", awayAlias: "Nomads",
    homeName: "Washington Commanders", homeAlias: "Commanders",
    outcomes: ["Nomads", "Commanders"],
    bestBid: 0.5, bestAsk: 0.52,
  });
  const { games, unmappedNames } = normalizePolymarketEvents([event], FETCHED_AT);
  assert.equal(games.length, 0);
  assert.deepEqual(unmappedNames, ["Nowhere Nomads"]);
});

test("normalizePolymarketEvents: falls back to last trade and flags it when there's no two-sided quote", () => {
  const event = moneylineEvent({
    awayName: "Tennessee Titans", awayAlias: "Titans",
    homeName: "Baltimore Ravens", homeAlias: "Ravens",
    outcomes: ["Titans", "Ravens"],
    bestBid: 0, bestAsk: 0, // overwritten below — moneylineEvent requires numbers
  });
  // simulate a missing two-sided quote, with only a last-trade price
  event.markets[0].bestBid = null;
  event.markets[0].bestAsk = null;
  event.markets[0].lastTradePrice = 0.2;
  const { games } = normalizePolymarketEvents([event], FETCHED_AT);
  const [game] = games;
  assert.equal(game.quote.usedLastTradeFallback, true);
  assert.ok(Math.abs(game.quote.probHome - 0.8) < 1e-9); // 1 - 0.2
});
