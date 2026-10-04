import { test } from "node:test";
import assert from "node:assert/strict";
import { kalshiHomeProbability, midPrice, parseKalshiDollar } from "./prices";

test("midPrice averages a two-sided quote", () => {
  const r = midPrice(0.34, 0.36, 0.5);
  assert.equal(r.mid, 0.35);
  assert.equal(r.usedLastTradeFallback, false);
});

test("midPrice falls back to last trade and flags it when one side is missing", () => {
  const r = midPrice(null, 0.36, 0.33);
  assert.equal(r.mid, 0.33);
  assert.equal(r.usedLastTradeFallback, true);
});

test("midPrice falls back to last trade when both sides are missing", () => {
  const r = midPrice(null, null, 0.5);
  assert.equal(r.mid, 0.5);
  assert.equal(r.usedLastTradeFallback, true);
});

test("midPrice is null with nothing to go on", () => {
  const r = midPrice(null, null, null);
  assert.equal(r.mid, null);
  assert.equal(r.usedLastTradeFallback, false);
});

test("parseKalshiDollar reads Kalshi's dollar-string format", () => {
  assert.equal(parseKalshiDollar("0.3400"), 0.34);
  assert.equal(parseKalshiDollar(undefined), null);
  assert.equal(parseKalshiDollar(null), null);
});

test("kalshiHomeProbability averages the two sides when they agree", () => {
  // home-team YES mid 0.65, away-team YES mid 0.35 -> both imply home=0.65
  const r = kalshiHomeProbability(
    { bid: 0.64, ask: 0.66, lastTrade: 0.65 },
    { bid: 0.34, ask: 0.36, lastTrade: 0.35 }
  );
  assert.equal(r.prob, 0.65);
  assert.equal(r.flag, null);
});

test("kalshiHomeProbability falls back to the tighter-spread side when they disagree by >3pts", () => {
  // home-team YES mid 0.60 (home implies home=0.60), away-team YES mid 0.30
  // (away implies home=0.70) -> 10pt disagreement, so it should pick
  // whichever side has the narrower bid/ask.
  const home = { bid: 0.59, ask: 0.61, lastTrade: 0.60 }; // spread 0.02
  const away = { bid: 0.20, ask: 0.40, lastTrade: 0.30 }; // spread 0.20, much wider
  const r = kalshiHomeProbability(home, away);
  assert.equal(r.prob, 0.60); // home side, since its spread is tighter
  assert.ok(r.flag);
  assert.equal(r.flag?.usedSide, "home");
  assert.equal(r.flag?.disagreementPts, 10);
});

test("kalshiHomeProbability uses whatever side is available when the other has no quote at all", () => {
  const r = kalshiHomeProbability(
    { bid: null, ask: null, lastTrade: null },
    { bid: 0.34, ask: 0.36, lastTrade: null }
  );
  assert.equal(r.prob, 0.65);
  assert.equal(r.flag, null);
});

test("kalshiHomeProbability is null when neither side has any quote", () => {
  const r = kalshiHomeProbability(
    { bid: null, ask: null, lastTrade: null },
    { bid: null, ask: null, lastTrade: null }
  );
  assert.equal(r.prob, null);
});
