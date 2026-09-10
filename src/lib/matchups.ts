// Weekly unit-matchup logic (docs/MATCHUPS_SPEC.md). Ratings live in
// public/data/matchups/unit_ratings.json, schedule in schedule_2026.json —
// both read as-is; everything here is computed client-side so a future
// (offseason-adjusted) unit_ratings.json drops in with zero other changes.

export interface UnitOffRating {
  epa: number;
  rank: number; // 1 = best in the league
}

export interface UnitDefRating {
  epa_allowed: number;
  rank: number; // 1 = best (stingiest) in the league
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
}

export interface ScheduleDoc {
  schema_version: number;
  season: number;
  weeks: Record<string, ScheduleGame[]>;
}

export type UnitKind = "run" | "pass";

export type PerMatchupTag = "Points likely" | "Shutdown likely" | "Elite clash" | null;

/** Rank tier thresholds from the spec: strong = top 8, weak = bottom 8 (of 32). */
const STRONG_RANK = 8;
const WEAK_RANK = 25;

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

export function computeGameMatchups(
  game: ScheduleGame,
  ratings: Record<string, TeamUnitRatings>
): GameMatchups {
  const matchups = computeUnitMatchups(game, ratings);
  const tags = computeGameTags(matchups, game.home, game.away);
  const interest = computeInterestScore(matchups);
  return { game, matchups, tags, interest };
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
