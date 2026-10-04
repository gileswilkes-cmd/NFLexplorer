import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeKalshiEvents, type KalshiRawEvent } from "./kalshi";

const FETCHED_AT = "2026-10-04T12:00:00.000Z";

test("normalizeKalshiEvents: ordinary game (IND @ WAS)", () => {
  const events: KalshiRawEvent[] = [
    {
      event_ticker: "KXNFLGAME-26OCT04INDWAS",
      title: "IND Colts vs WAS Commanders",
      markets: [
        {
          ticker: "KXNFLGAME-26OCT04INDWAS-WAS",
          yes_bid_dollars: "0.3400",
          yes_ask_dollars: "0.3500",
          last_price_dollars: "0.3500",
          volume_24h_fp: "351657.17",
        },
        {
          ticker: "KXNFLGAME-26OCT04INDWAS-IND",
          yes_bid_dollars: "0.6500",
          yes_ask_dollars: "0.6600",
          last_price_dollars: "0.6600",
          volume_24h_fp: "369778.44",
        },
      ],
    },
  ];
  const [game] = normalizeKalshiEvents(events, FETCHED_AT);
  assert.equal(game.away, "IND");
  assert.equal(game.home, "WAS");
  assert.equal(game.key, "IND@WAS");
  // home (WAS) mid = 0.345, away (IND) mid = 0.655 -> 1-0.655 = 0.345 -> agree
  assert.ok(Math.abs(game.quote.probHome - 0.345) < 1e-9);
});

test("normalizeKalshiEvents: ambiguous city NY (Giants vs Jets) resolved via ticker suffix, not title", () => {
  // Both Giants and Jets print "NY" in the title — only the per-market
  // ticker suffix (NYG vs NYJ) disambiguates them.
  const events: KalshiRawEvent[] = [
    {
      event_ticker: "KXNFLGAME-26OCT11NYGWAS",
      title: "NY Giants vs WAS Commanders", // title's own "NY" alone is ambiguous
      markets: [
        {
          ticker: "KXNFLGAME-26OCT11NYGWAS-WAS",
          yes_bid_dollars: "0.4000",
          yes_ask_dollars: "0.4200",
        },
        {
          ticker: "KXNFLGAME-26OCT11NYGWAS-NYG",
          yes_bid_dollars: "0.5800",
          yes_ask_dollars: "0.6000",
        },
      ],
    },
  ];
  const [game] = normalizeKalshiEvents(events, FETCHED_AT);
  assert.equal(game.away, "NYG");
  assert.equal(game.home, "WAS");
  assert.equal(game.key, "NYG@WAS");
});

test("normalizeKalshiEvents: ambiguous city LA (Rams vs Chargers) resolved via ticker suffix, with the Rams override applied", () => {
  // Both Rams and Chargers print "LA" in the title; Rams ticker as LAR
  // (overridden to our LA), Chargers ticker as LAC (no override).
  const events: KalshiRawEvent[] = [
    {
      event_ticker: "KXNFLGAME-26OCT12BUFLAR",
      title: "BUF Bills vs LA Rams",
      markets: [
        {
          ticker: "KXNFLGAME-26OCT12BUFLAR-LAR",
          yes_bid_dollars: "0.3000",
          yes_ask_dollars: "0.3200",
        },
        {
          ticker: "KXNFLGAME-26OCT12BUFLAR-BUF",
          yes_bid_dollars: "0.6900",
          yes_ask_dollars: "0.7100",
        },
      ],
    },
  ];
  const [game] = normalizeKalshiEvents(events, FETCHED_AT);
  assert.equal(game.away, "BUF");
  assert.equal(game.home, "LA"); // LAR override -> LA, never left as LAR
  assert.equal(game.key, "BUF@LA");
});

test("normalizeKalshiEvents: LA Chargers (LAC) is not mistaken for LA Rams", () => {
  const events: KalshiRawEvent[] = [
    {
      event_ticker: "KXNFLGAME-26OCT11DENLAC",
      title: "DEN Broncos vs LA Chargers",
      markets: [
        {
          ticker: "KXNFLGAME-26OCT11DENLAC-LAC",
          yes_bid_dollars: "0.5500",
          yes_ask_dollars: "0.5700",
        },
        {
          ticker: "KXNFLGAME-26OCT11DENLAC-DEN",
          yes_bid_dollars: "0.4400",
          yes_ask_dollars: "0.4600",
        },
      ],
    },
  ];
  const [game] = normalizeKalshiEvents(events, FETCHED_AT);
  assert.equal(game.away, "DEN");
  assert.equal(game.home, "LAC"); // no override — must stay LAC, not collapse to LA
});

test("normalizeKalshiEvents: skips an event with an unparseable ticker rather than guessing", () => {
  const events: KalshiRawEvent[] = [
    { event_ticker: "KXNFLGAME-weird", title: "?", markets: [] },
  ];
  assert.deepEqual(normalizeKalshiEvents(events, FETCHED_AT), []);
});
