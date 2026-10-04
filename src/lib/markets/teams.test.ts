import { test } from "node:test";
import assert from "node:assert/strict";
import { CANONICAL_CODES, codeForFullTeamName, codeForKalshiTicker, gameKey } from "./teams";

test("codeForFullTeamName maps every canonical full name", () => {
  assert.equal(codeForFullTeamName("Washington Commanders"), "WAS");
  assert.equal(codeForFullTeamName("Los Angeles Rams"), "LA");
  assert.equal(codeForFullTeamName("Los Angeles Chargers"), "LAC");
  assert.equal(codeForFullTeamName("New York Giants"), "NYG");
  assert.equal(codeForFullTeamName("New York Jets"), "NYJ");
});

test("codeForFullTeamName returns null for an unrecognised name", () => {
  assert.equal(codeForFullTeamName("Las Vegas Raiders FC"), null);
});

test("codeForKalshiTicker overrides the two known mismatches", () => {
  // Jacksonville: Kalshi tickers JAC, we use JAX everywhere else.
  assert.equal(codeForKalshiTicker("JAC"), "JAX");
  // LA Rams: Kalshi tickers LAR, we use LA everywhere else.
  assert.equal(codeForKalshiTicker("LAR"), "LA");
});

test("codeForKalshiTicker is identity for every other code, including LAC", () => {
  assert.equal(codeForKalshiTicker("LAC"), "LAC");
  assert.equal(codeForKalshiTicker("NYG"), "NYG");
  assert.equal(codeForKalshiTicker("NYJ"), "NYJ");
  assert.equal(codeForKalshiTicker("WAS"), "WAS");
});

test("gameKey joins away@home", () => {
  assert.equal(gameKey("IND", "WAS"), "IND@WAS");
});

test("every canonical code is 2-3 uppercase letters", () => {
  for (const code of CANONICAL_CODES) {
    assert.match(code, /^[A-Z]{2,3}$/);
  }
  assert.equal(CANONICAL_CODES.size, 32);
});
