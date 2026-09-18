// Weekly unit-matchup logic (docs/MATCHUPS_SPEC.md). Ratings live in
// public/data/matchups/unit_ratings.json, schedule in schedule_2026.json —
// both read as-is; everything here is computed client-side so a future
// (offseason-adjusted) unit_ratings.json drops in with zero other changes.

import { marketSpreadHome, oddsForGame, type OddsDoc } from "./odds";

export type SosClassification = "tough" | "soft" | "neutral";

/** Strength-of-schedule for one unit (docs/MATCHUPS_SOS.md) — the avg raw
 *  rank of the same-kind opposing units it faced in 2025, and a tercile
 *  classification. A calibration hint on the existing raw rank, not a
 *  corrected rank. */
export interface UnitSos {
  avg_opponent_rank: number;
  classification: SosClassification;
}

export interface UnitOffRating {
  epa: number;
  rank: number; // 1 = best in the league
  sos: UnitSos;
}

export interface UnitDefRating {
  epa_allowed: number;
  rank: number; // 1 = best (stingiest) in the league
  sos: UnitSos;
}

export interface TeamUnitRatings {
  run_off: UnitOffRating;
  pass_off: UnitOffRating;
  run_def: UnitDefRating;
  pass_def: UnitDefRating;
}

export interface UnitRatingsDoc {
  schema_version: number;
  season_basis: number;
  teams: Record<string, TeamUnitRatings>;
}

export interface ScheduleGame {
  game_id: string;
  away: string;
  home: string;
  date: string;
  /** null until the game has been played */
  away_score: number | null;
  /** null until the game has been played */
  home_score: number | null;
}

export interface ScheduleDoc {
  schema_version: number;
  season: number;
  weeks: Record<string, ScheduleGame[]>;
}

export type UnitKind = "run" | "pass";

export type PerMatchupTag = "Points likely" | "Shutdown likely" | "Elite clash" | null;

/** Rank tier thresholds from the spec: strong = top 8, weak = bottom 8 (of 32). */
export const STRONG_RANK = 8;
export const WEAK_RANK = 25;

export interface UnitMatchup {
  kind: UnitKind;
  /** team on offence for this matchup */
  offTeam: string;
  /** team on defence for this matchup */
  defTeam: string;
  offRank: number;
  defRank: number;
  offEpa: number;
  defEpaAllowed: number;
  offSos: UnitSos;
  defSos: UnitSos;
  /** defense_rank - offense_rank in offence-favoured terms: positive = offence favoured. */
  edge: number;
  tag: PerMatchupTag;
}

export type GameTag =
  | "Shootout"
  | "Defensive struggle"
  | "Clash"
  | "Lopsided"
  | "Even";

export interface GameMatchups {
  game: ScheduleGame;
  /** [home pass-O vs away pass-D, home run-O vs away run-D, away pass-O vs home pass-D, away run-O vs home run-D] */
  matchups: UnitMatchup[];
  tags: GameTag[];
  interest: number;
  /** Cautious 1-2 sentence readout of the matchup, derived from the four
   *  edges above — see computeVerdict. Hedged language only; no predicted
   *  winner or scoreline (docs/MATCHUPS_VERDICT.md). */
  verdict: string;
}

function tagForMatchup(offRank: number, defRank: number): PerMatchupTag {
  const offStrong = offRank <= STRONG_RANK;
  const offWeak = offRank >= WEAK_RANK;
  const defStrong = defRank <= STRONG_RANK;
  const defWeak = defRank >= WEAK_RANK;

  if (offStrong && defStrong) return "Elite clash";
  if (offStrong && defWeak) return "Points likely";
  if (defStrong && offWeak) return "Shutdown likely";
  return null;
}

function buildUnitMatchup(
  kind: UnitKind,
  offTeam: string,
  defTeam: string,
  ratings: Record<string, TeamUnitRatings>
): UnitMatchup {
  const off = kind === "pass" ? ratings[offTeam].pass_off : ratings[offTeam].run_off;
  const def = kind === "pass" ? ratings[defTeam].pass_def : ratings[defTeam].run_def;
  const edge = def.rank - off.rank; // positive = offence favoured (weak defence, strong offence)
  return {
    kind,
    offTeam,
    defTeam,
    offRank: off.rank,
    defRank: def.rank,
    offEpa: off.epa,
    defEpaAllowed: def.epa_allowed,
    offSos: off.sos,
    defSos: def.sos,
    edge,
    tag: tagForMatchup(off.rank, def.rank),
  };
}

/** The four unit matchups for one game: both teams' pass and run offences vs the other's defence. */
export function computeUnitMatchups(
  game: ScheduleGame,
  ratings: Record<string, TeamUnitRatings>
): UnitMatchup[] {
  return [
    buildUnitMatchup("pass", game.home, game.away, ratings),
    buildUnitMatchup("run", game.home, game.away, ratings),
    buildUnitMatchup("pass", game.away, game.home, ratings),
    buildUnitMatchup("run", game.away, game.home, ratings),
  ];
}

function teamHasTag(matchups: UnitMatchup[], team: string, tag: PerMatchupTag): boolean {
  return matchups.some((m) => m.offTeam === team && m.tag === tag);
}

// Shootout threshold: a team's offensive edge (see teamOffensiveEdge below)
// must clear this to count as "meaningfully out-rating" the opposing
// defence. Picked from the Week 1 2026 edge distribution: DAL @ NYG (the
// case that motivated this rule) has both teams' weaker unit at edge +12
// (NYG min(pass +15, run +19)=15, DAL min(pass +12, run +24)=12) — every
// other Week 1 team's weaker unit is either negative or, at best, +9 (IND,
// whose partner BAL was negative anyway). 10 sits in that gap: below the
// pair that should trigger the tag, above every other team's non-qualifying
// value that week.
const SHOOTOUT_EDGE_THRESHOLD = 10;

// Lopsided magnitude floor: every one of the favoured team's four edges
// (its 2 offensive + its 2 defensive matchups) must clear this, not just
// share a sign. Picked from Week 1: the genuine blowout (WAS @ PHI) has its
// smallest edge at magnitude 5 (PHI run D edge -5); the two marginal cases
// the floor is meant to exclude (ARI @ LAC, TB @ CIN) both bottom out at
// magnitude 1. 5 keeps the real case and drops both marginal ones.
const LOPSIDED_MIN_EDGE = 5;

/** The weaker of a team's two offensive-unit edges (pass, run) against this
 *  opponent — both units must be pulling in the team's favour, not just one
 *  masking a weak other, for the team to count as a two-way scoring threat. */
function teamOffensiveEdge(matchups: UnitMatchup[], team: string): number {
  const offMatchups = matchups.filter((m) => m.offTeam === team);
  return Math.min(...offMatchups.map((m) => m.edge));
}

/** Roll the four unit matchups up into game-level tags per the spec. */
export function computeGameTags(matchups: UnitMatchup[], home: string, away: string): GameTag[] {
  const tags: GameTag[] = [];

  // Shootout: edge-based, not rank-tier-based — both teams' offences must
  // clear SHOOTOUT_EDGE_THRESHOLD on their weaker unit, so a big edge on
  // only one side (e.g. a strong run game papering over a losing pass
  // matchup) doesn't count.
  const homeOffEdge = teamOffensiveEdge(matchups, home);
  const awayOffEdge = teamOffensiveEdge(matchups, away);
  if (homeOffEdge > SHOOTOUT_EDGE_THRESHOLD && awayOffEdge > SHOOTOUT_EDGE_THRESHOLD) {
    tags.push("Shootout");
  }

  const homeShutdown = teamHasTag(matchups, home, "Shutdown likely");
  const awayShutdown = teamHasTag(matchups, away, "Shutdown likely");
  if (homeShutdown && awayShutdown) tags.push("Defensive struggle");

  if (matchups.some((m) => m.tag === "Elite clash")) tags.push("Clash");

  // Lopsided: one team holds the offensive mismatches (its two offensive
  // matchups both favour it) AND its defence out-ranks the opponent's
  // offence on both sides — a blowout signal in one direction — and every
  // one of those four edges must clear LOPSIDED_MIN_EDGE, so direction
  // alone (e.g. a +1 edge) doesn't qualify as a "mismatch".
  const homeOffMatchups = matchups.filter((m) => m.offTeam === home);
  const awayOffMatchups = matchups.filter((m) => m.offTeam === away);
  const homeDefMatchups = matchups.filter((m) => m.defTeam === home);
  const awayDefMatchups = matchups.filter((m) => m.defTeam === away);

  const clearsFloor = (m: UnitMatchup) => Math.abs(m.edge) >= LOPSIDED_MIN_EDGE;

  const homeOffFavoured = homeOffMatchups.every((m) => m.edge > 0 && clearsFloor(m));
  const awayOffFavoured = awayOffMatchups.every((m) => m.edge > 0 && clearsFloor(m));
  const homeDefFavoured = homeDefMatchups.every((m) => m.edge < 0 && clearsFloor(m));
  const awayDefFavoured = awayDefMatchups.every((m) => m.edge < 0 && clearsFloor(m));

  if (homeOffFavoured && homeDefFavoured) tags.push("Lopsided");
  else if (awayOffFavoured && awayDefFavoured) tags.push("Lopsided");

  if (tags.length === 0) tags.push("Even");

  return tags;
}

const PASS_WEIGHT = 1.5;
const RUN_WEIGHT = 1.0;
const CLASH_BONUS = 15;

/** Week sort key: sum of |edge| (pass weighted 1.5x) + a fixed bonus per Elite-clash matchup. */
export function computeInterestScore(matchups: UnitMatchup[]): number {
  let score = 0;
  for (const m of matchups) {
    const weight = m.kind === "pass" ? PASS_WEIGHT : RUN_WEIGHT;
    score += Math.abs(m.edge) * weight;
    if (m.tag === "Elite clash") score += CLASH_BONUS;
  }
  return score;
}

export function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

export type FullUnitKey = "run_off" | "pass_off" | "run_def" | "pass_def";

const SOS_OWN_LABEL: Record<FullUnitKey, string> = {
  run_off: "run offence", pass_off: "pass offence",
  run_def: "run defence", pass_def: "pass defence",
};
const SOS_OPPONENT_LABEL: Record<FullUnitKey, string> = {
  run_off: "run defences", pass_off: "pass defences",
  run_def: "run offences", pass_def: "pass offences",
};

/** The full SOS sentence for one team's unit (docs/MATCHUPS_SOS.md), e.g.
 *  "NE's pass defence faced pass offences averaging 22nd — rank likely
 *  inflated (soft schedule)." Null for a neutral unit — like the card-face
 *  marker, the expanded detail only calls out units where the schedule
 *  actually skews the rank, not all 8 per game. Explicitly a calibration
 *  hint on the existing raw rank, never framed as a corrected one. */
export function sosSentence(team: string, unitKey: FullUnitKey, sos: UnitSos): string | null {
  if (sos.classification === "neutral") return null;
  const avgOrdinal = ordinal(Math.round(sos.avg_opponent_rank));
  const verdict = sos.classification === "tough"
    ? "rank earned, if anything understated"
    : "rank likely inflated";
  return `${team}'s ${SOS_OWN_LABEL[unitKey]} faced ${SOS_OPPONENT_LABEL[unitKey]} averaging ${avgOrdinal} — ${verdict} (${sos.classification} schedule).`;
}

/** A team's pass-weighted offensive edge across both its matchups this game
 *  (same weighting as computeInterestScore) — the "lean" input from the spec. */
function teamLeanScore(matchups: UnitMatchup[], team: string): number {
  const pass = matchups.find((m) => m.offTeam === team && m.kind === "pass")!;
  const run = matchups.find((m) => m.offTeam === team && m.kind === "run")!;
  return pass.edge * PASS_WEIGHT + run.edge * RUN_WEIGHT;
}

// Lean bucket thresholds (docs/MATCHUPS_VERDICT.md), sanity-checked against
// the Week 1 2026 |homeLean - awayLean| distribution (0.5 to 59, roughly
// evenly spread): <10 keeps the near-coin-flip games (e.g. DAL @ NYG at 0.5)
// as "even"; >30 catches the real blowout leans (e.g. WAS @ PHI at 59, CLE @
// JAX at 46) as "clearly favoured"; 10-30 is the broad "edge to" middle.
const LEAN_EVEN_MAX = 10;
const LEAN_CLEAR_MIN = 30;

export type ModelLean = "even" | "edge" | "clear";

export interface ModelForecast {
  /** null when the lean is "even" — no team is favoured */
  favourite: string | null;
  lean: ModelLean;
  /** rounded |pass-weighted offensive-edge diff| — a lean magnitude, not a
   *  literal predicted point margin (the product never predicts scorelines). */
  marginEst: number;
}

/** The model's favourite/lean/margin from the pass-weighted offensive-edge
 *  diff — same thresholds leanPhrase renders as prose, exported so the
 *  weekly prediction snapshot (ingest/refresh_week.ts) can freeze the same
 *  numbers the verdict text is built from, not a second computation. */
export function computeModelForecast(matchups: UnitMatchup[], home: string, away: string): ModelForecast {
  const diff = teamLeanScore(matchups, home) - teamLeanScore(matchups, away);
  const abs = Math.abs(diff);
  const marginEst = Math.round(abs);
  if (abs < LEAN_EVEN_MAX) return { favourite: null, lean: "even", marginEst };
  const favourite = diff > 0 ? home : away;
  const lean: ModelLean = abs <= LEAN_CLEAR_MIN ? "edge" : "clear";
  return { favourite, lean, marginEst };
}

function leanPhrase(forecast: ModelForecast): string {
  if (forecast.lean === "even") return "roughly even";
  if (forecast.lean === "edge") return `edge to ${forecast.favourite}`;
  return `${forecast.favourite} clearly favoured`;
}

function dominantMatchupPhrase(m: UnitMatchup): string {
  const defRank = ordinal(m.defRank);
  return m.edge > 0
    ? `${m.offTeam}'s ${m.kind} offence should move the ball against ${m.defTeam}'s ${defRank}-ranked ${m.kind} defence`
    : `${m.offTeam}'s ${m.kind} offence may struggle against ${m.defTeam}'s ${defRank}-ranked ${m.kind} defence`;
}

function characterPhrase(tags: GameTag[]): string | null {
  if (tags.includes("Shootout")) return "points likely on both sides";
  if (tags.includes("Defensive struggle")) return "low-scoring";
  if (tags.includes("Clash")) return "elite units collide";
  return null;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Cautious 1-2 sentence verdict from the four edges already on the card:
 *  which matchup tells the story (largest |edge|), the game's character
 *  (from its tags), and the overall lean (pass-weighted offensive-edge
 *  difference). Hedged verbs only — never a predicted winner or scoreline,
 *  since the ratings are a 2025 extrapolation (docs/MATCHUPS_VERDICT.md). */
export function computeVerdict(matchups: UnitMatchup[], tags: GameTag[], home: string, away: string): string {
  const forecast = computeModelForecast(matchups, home, away);
  const dominant = matchups.reduce((a, b) => (Math.abs(b.edge) > Math.abs(a.edge) ? b : a));
  const headline = `${capitalize(dominantMatchupPhrase(dominant))}.`;
  const character = characterPhrase(tags);
  const lean = leanPhrase(forecast);
  const tail = character ? `${capitalize(character)}; ${lean}.` : `${capitalize(lean)}.`;
  return `${headline} ${tail}`;
}

export function computeGameMatchups(
  game: ScheduleGame,
  ratings: Record<string, TeamUnitRatings>
): GameMatchups {
  const matchups = computeUnitMatchups(game, ratings);
  const tags = computeGameTags(matchups, game.home, game.away);
  const interest = computeInterestScore(matchups);
  const verdict = computeVerdict(matchups, tags, game.home, game.away);
  return { game, matchups, tags, interest, verdict };
}

/** All games in a week, sorted most-interesting first. */
export function computeWeekMatchups(
  week: string,
  scheduleDoc: ScheduleDoc,
  ratingsDoc: UnitRatingsDoc
): GameMatchups[] {
  const games = scheduleDoc.weeks[week] ?? [];
  return games
    .map((g) => computeGameMatchups(g, ratingsDoc.teams))
    .sort((a, b) => b.interest - a.interest);
}

// ---- Model-vs-market divergence -------------------------------------------
//
// The interest score (above) is magnitude-only — it rewards agreement between
// model and market as readily as disagreement, so the loudest unit mismatch
// of the week can be a game both sides already agree on (boring pick). This
// section re-sorts on divergence instead: how far the model's lean strays
// from the market's, scale-free via z-scores across the week's slate.

/** Home-oriented, unweighted model edge: sum of home's two offensive-unit
 *  edges minus the sum of away's two offensive-unit edges. Positive = model
 *  leans home. Deliberately unweighted (unlike the pass-weighted lean behind
 *  the verdict/interest score) — this is a distinct, simpler sort key, not a
 *  restatement of the verdict's lean; it's a margin comparison against the
 *  market spread, not a "how watchable is this" score.
 *  TODO(B1): once the EPA→points calibration factor lands, convert this to a
 *  real points-margin estimate and revisit whether z-scoring against the
 *  market spread is still needed, or whether a raw points-gap (model margin
 *  minus market spread) is more honest than a scale-free z-score diff. */
export function computeModelNet(matchups: UnitMatchup[], home: string, away: string): number {
  const homePass = matchups.find((m) => m.offTeam === home && m.kind === "pass")!;
  const homeRun = matchups.find((m) => m.offTeam === home && m.kind === "run")!;
  const awayPass = matchups.find((m) => m.offTeam === away && m.kind === "pass")!;
  const awayRun = matchups.find((m) => m.offTeam === away && m.kind === "run")!;
  return homePass.edge + homeRun.edge - (awayPass.edge + awayRun.edge);
}

export type DivergenceTier = "hero" | "standard" | "tail";

export interface GameDivergence {
  /** home-oriented, unweighted (see computeModelNet) */
  modelNet: number;
  /** home-oriented signed spread: + = home favoured, - = away favoured, 0 =
   *  pick'em. Null when this game has no posted market line yet. */
  marketSpreadHome: number | null;
  /** z-scored across the slate of games that HAVE a market line — null when
   *  marketSpreadHome is null, since an unlined game can't be compared to a
   *  market it doesn't have. */
  modelZ: number | null;
  marketZ: number | null;
  /** modelZ - marketZ; null when either input is null. */
  divergenceZ: number | null;
  tier: DivergenceTier;
  /** team code the model leans toward, or null on a dead-even model_net.
   *  Always computable — the model always has an edge, line or no line. */
  modelLean: string | null;
  /** team code the market favours, or null for pick'em / no line posted. */
  marketLean: string | null;
}

export interface GameWithDivergence extends GameMatchups {
  divergence: GameDivergence;
}

/** home if v > 0, away if v < 0, null on an exact tie (dead-even model split
 *  or a pick'em market line) — neither team is "leaning" in that case. */
function sideOf(v: number, home: string, away: string): string | null {
  if (v > 0) return home;
  if (v < 0) return away;
  return null;
}

function zScorer(values: number[]): (v: number) => number {
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const sd = Math.sqrt(variance);
  return (v: number) => (sd === 0 ? 0 : (v - mean) / sd);
}

// Standard-band cutoff on |divergenceZ|, and how many games the band can
// hold. Fixed thresholds, not a per-week gap heuristic (that approach — take
// the largest gap in the sorted list — swept in ~half of a 16-game slate on
// Week 2 2026, which read as "most of the slate" rather than "a few notable
// games"). 0.75 plus a hard cap of 4 keeps the band a genuinely small set
// even on a week where several games diverge similarly.
export const DIVERGENCE_STANDARD_THRESHOLD = 0.75;
export const DIVERGENCE_STANDARD_MAX = 4;

/** Per-game model-vs-market divergence for a full week's games, z-scored
 *  across the slate and tiered (hero / standard / tail) by |divergenceZ|.
 *  `games` should be the raw per-game matchups for the week (e.g. from
 *  computeUnitMatchups + computeGameMatchups), in any order — this computes
 *  its own ranking independent of the interest-score sort. */
export function computeWeekDivergence(
  week: string,
  scheduleDoc: ScheduleDoc,
  ratingsDoc: UnitRatingsDoc,
  oddsDoc: OddsDoc | null
): GameWithDivergence[] {
  const scheduleGames = scheduleDoc.weeks[week] ?? [];
  const base = scheduleGames.map((g) => computeGameMatchups(g, ratingsDoc.teams));

  const modelNets = base.map((gm) => computeModelNet(gm.matchups, gm.game.home, gm.game.away));
  const marketSpreads = base.map((gm) =>
    marketSpreadHome(oddsForGame(oddsDoc, week, gm.game.game_id), gm.game.home)
  );

  // Both z-scores are computed over the SAME population (games with a posted
  // line) so the subtraction (divergenceZ) compares like with like — a
  // model_net z computed over all 16 games isn't comparable to a market z
  // computed over only the 12 that have lines.
  const linedIndices = marketSpreads
    .map((v, i) => (v !== null ? i : -1))
    .filter((i) => i >= 0);
  const modelZOf = zScorer(linedIndices.map((i) => modelNets[i]));
  const marketZOf = zScorer(linedIndices.map((i) => marketSpreads[i] as number));

  const withDivergence: GameWithDivergence[] = base.map((gm, i) => {
    const { home, away } = gm.game;
    const modelNet = modelNets[i];
    const modelLean = sideOf(modelNet, home, away);
    const spread = marketSpreads[i];
    if (spread === null) {
      return {
        ...gm,
        divergence: {
          modelNet, marketSpreadHome: null, modelZ: null, marketZ: null, divergenceZ: null,
          tier: "tail", modelLean, marketLean: null,
        },
      };
    }
    const modelZ = modelZOf(modelNet);
    const marketZ = marketZOf(spread);
    return {
      ...gm,
      divergence: {
        modelNet, marketSpreadHome: spread, modelZ, marketZ, divergenceZ: modelZ - marketZ,
        tier: "tail", modelLean, marketLean: sideOf(spread, home, away),
      },
    };
  });

  const lined = withDivergence.filter((g) => g.divergence.divergenceZ !== null);
  lined.sort((a, b) => Math.abs(b.divergence.divergenceZ!) - Math.abs(a.divergence.divergenceZ!));
  let standardCount = 0;
  lined.forEach((g, rank) => {
    if (rank === 0) {
      g.divergence.tier = "hero";
    } else if (standardCount < DIVERGENCE_STANDARD_MAX && Math.abs(g.divergence.divergenceZ!) >= DIVERGENCE_STANDARD_THRESHOLD) {
      g.divergence.tier = "standard";
      standardCount++;
    } else {
      g.divergence.tier = "tail";
    }
  });

  // Fallback so a week with zero posted lines still has exactly one hero
  // (the spec's "always >=1, even on a quiet week") — fall back to the
  // existing magnitude score since there's no market to diverge from.
  if (lined.length === 0 && withDivergence.length > 0) {
    const heroIdx = withDivergence.reduce(
      (best, g, i, arr) => (g.interest > arr[best].interest ? i : best),
      0
    );
    withDivergence[heroIdx].divergence.tier = "hero";
  }

  const unlined = withDivergence.filter((g) => g.divergence.divergenceZ === null);
  unlined.sort((a, b) => (a.game.date < b.game.date ? -1 : a.game.date > b.game.date ? 1 : 0));

  return [...lined, ...unlined];
}

/** The card headline (docs/... divergence sort): states plainly whether
 *  model and market disagree on WHO wins, or agree on who but differ on BY
 *  HOW MUCH — those read as different claims and shouldn't share one phrase.
 *  Hedged, no scoreline, consistent with computeVerdict's cautious voice. */
export function computeDivergenceHeadline(gm: GameWithDivergence): string {
  const { divergence } = gm;
  if (divergence.marketSpreadHome === null) {
    return "No market line posted yet — divergence can't be ranked against a market that doesn't exist.";
  }

  const { modelLean, marketLean } = divergence;
  if (modelLean && marketLean && modelLean !== marketLean) {
    return `Model leans ${modelLean}; market leans ${marketLean} — they disagree on the winner.`;
  }

  const favTeam = modelLean ?? marketLean;
  if (!favTeam) return "Model and market are both roughly even here — no lean either way.";

  const modelFurther = Math.abs(divergence.modelZ ?? 0) > Math.abs(divergence.marketZ ?? 0);
  return `Both favour ${favTeam} — model has it ${modelFurther ? "further" : "closer"} than the market.`;
}

export interface SlateSuperlative {
  gameId: string;
  away: string;
  home: string;
  value: number;
}

export interface UnitMismatchSuperlative extends SlateSuperlative {
  kind: UnitKind;
  offTeam: string;
  defTeam: string;
  offRank: number;
  defRank: number;
}

export interface SlateStrip {
  /** the hero game, i.e. the week's top model-vs-market divergence */
  topDivergence: SlateSuperlative | null;
  /** the single unit battle (across every game this week) with the largest
   *  |edge| — `edge` is the RANK-GAP (defense_rank - offense_rank, see
   *  buildUnitMatchup), the same quantity every other edge-based computation
   *  in this file uses (interest score, model_net, tags), NOT a raw EPA
   *  difference. `offRank`/`defRank` on the result are edge's own inputs,
   *  not a separate display-only pair — raw EPA (offEpa/defEpaAllowed) is
   *  tracked on UnitMatchup for the card's expanded detail only and never
   *  feeds this selection. */
  sharpestUnitMismatch: UnitMismatchSuperlative | null;
  highestMarketTotal: SlateSuperlative | null;
  lowestMarketTotal: SlateSuperlative | null;
}

/** The week's 4 headline superlatives (docs/... divergence sort) — each
 *  points at one game. True total-divergence (model total vs market total)
 *  waits on a model-side total from later calibration work; for now the
 *  total superlatives are market-total-only. */
export function computeSlateStrip(
  weekGames: GameWithDivergence[],
  oddsDoc: OddsDoc | null,
  week: string
): SlateStrip {
  const hero = weekGames.find((g) => g.divergence.tier === "hero") ?? null;
  const topDivergence: SlateSuperlative | null = hero
    ? { gameId: hero.game.game_id, away: hero.game.away, home: hero.game.home, value: hero.divergence.divergenceZ ?? hero.interest }
    : null;

  let sharpestUnitMismatch: UnitMismatchSuperlative | null = null;
  for (const gm of weekGames) {
    for (const m of gm.matchups) {
      if (!sharpestUnitMismatch || Math.abs(m.edge) > Math.abs(sharpestUnitMismatch.value)) {
        sharpestUnitMismatch = {
          gameId: gm.game.game_id, away: gm.game.away, home: gm.game.home,
          value: m.edge, kind: m.kind, offTeam: m.offTeam, defTeam: m.defTeam,
          offRank: m.offRank, defRank: m.defRank,
        };
      }
    }
  }

  let highestMarketTotal: SlateSuperlative | null = null;
  let lowestMarketTotal: SlateSuperlative | null = null;
  for (const gm of weekGames) {
    const odds = oddsForGame(oddsDoc, week, gm.game.game_id);
    if (!odds) continue;
    const entry = { gameId: gm.game.game_id, away: gm.game.away, home: gm.game.home, value: odds.total };
    if (!highestMarketTotal || odds.total > highestMarketTotal.value) highestMarketTotal = entry;
    if (!lowestMarketTotal || odds.total < lowestMarketTotal.value) lowestMarketTotal = entry;
  }

  return { topDivergence, sharpestUnitMismatch, highestMarketTotal, lowestMarketTotal };
}

/** Default week: the first week (by its games' earliest date) that hasn't fully passed yet. */
export function defaultWeek(scheduleDoc: ScheduleDoc, now: Date = new Date()): string {
  const weekNums = Object.keys(scheduleDoc.weeks).sort((a, b) => Number(a) - Number(b));
  for (const wk of weekNums) {
    const games = scheduleDoc.weeks[wk];
    const lastDate = games.reduce(
      (max, g) => (g.date > max ? g.date : max),
      games[0]?.date ?? ""
    );
    if (lastDate >= now.toISOString().slice(0, 10)) return wk;
  }
  return weekNums[weekNums.length - 1] ?? "1";
}
