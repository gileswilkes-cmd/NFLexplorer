// Player-spotlights nuance layer for /matchups (docs/MATCHUPS_SPOTLIGHTS.md).
// Reads public/data/matchups/team_players.json (built by
// ingest/build_spotlights.py) and pairs each spotlighted player with the
// *opposing unit's* rank from the game's already-computed UnitMatchup array
// — never an implied one-on-one, since the free data has no coverage
// assignment (see the doc's "honest limit").

import { ordinal, STRONG_RANK, WEAK_RANK, type GameMatchups, type UnitMatchup } from "./matchups";

export interface TeamPlayerEntry {
  gsis_id: string;
  name: string;
  pos: string;
  /** absent (flag set instead) when the player has no 2025 REG record */
  headline?: string;
  percentile?: number | null;
  team_2025?: string;
  games_2025?: number;
  flag: "no_2025_data" | null;
  note?: string;
  /** this week's injury report status, from import_injuries — null when the
   *  player isn't on the report at all (docs/MATCHUPS_INJURIES.md) */
  injury_status?: "Out" | "Doubtful" | "Questionable" | null;
  /** QB/RB entries only: current depth-chart rank of the resolved starter */
  depth_rank?: number;
  /** QB/RB entries only: true when one or more depth-chart entries ranked
   *  above this player were Out/IR and this entry is the next-man-up who
   *  actually starts */
  starter_override?: boolean;
  /** QB/RB entries only: every depth-chart entry ranked above the resolved
   *  starter that was Out/IR this week, in depth-chart order (can be more
   *  than one — e.g. QB1 and QB2 both Out bumps QB3 in); empty when
   *  starter_override is false */
  overridden_starters?: { gsis_id: string; name: string; injury_status: string | null }[];
}

export interface TeamPlayersUnit {
  pass_off: { qb: TeamPlayerEntry | null; receivers: TeamPlayerEntry[] };
  run_off: { rb: TeamPlayerEntry | null };
  pass_def: { rusher: TeamPlayerEntry | null; db: TeamPlayerEntry | null };
  run_def: { tackler: TeamPlayerEntry | null };
}

export interface TeamPlayersDoc {
  schema_version: number;
  roster_season: number;
  production_season: number;
  generated_at: string;
  teams: Record<string, TeamPlayersUnit>;
}

export type SpotlightUnit = "pass_off" | "run_off" | "pass_def" | "run_def";

export interface SpotlightSlot {
  unit: SpotlightUnit;
  /** the team this player plays for, as the home/away code in this game */
  team: string;
  /** the other team in this game — whose unit is being faced */
  oppTeam: string;
  player: TeamPlayerEntry;
  /** rank of the OPPOSING unit this player's unit faces — never a 1-on-1 */
  oppRank: number;
  /** "pass D" | "run D" for an offensive spotlight, "pass O" | "run O" for a defensive one */
  oppUnitLabel: string;
  /** percentile x rank-extremity; 0 for a flagged/no-percentile player (never ranked for the Watch line) */
  score: number;
}

function findMatchup(
  matchups: UnitMatchup[],
  side: "off" | "def",
  team: string,
  kind: "pass" | "run"
): UnitMatchup | undefined {
  return side === "off"
    ? matchups.find((m) => m.offTeam === team && m.kind === kind)
    : matchups.find((m) => m.defTeam === team && m.kind === kind);
}

/** Every spotlighted player in this game, each paired with the rank of the
 *  opposing unit they face. Players with no 2025 data are included (score 0)
 *  so the expanded detail can still show them, flagged — only the Watch line
 *  filters them out. */
export function computeSpotlightSlots(
  gm: GameMatchups,
  teamPlayersDoc: TeamPlayersDoc | null
): SpotlightSlot[] {
  if (!teamPlayersDoc) return [];
  const { game, matchups } = gm;
  const slots: SpotlightSlot[] = [];

  const addSlot = (team: string, unit: SpotlightUnit, player: TeamPlayerEntry | null | undefined) => {
    if (!player) return;
    let m: UnitMatchup | undefined;
    let oppUnitLabel: string;
    switch (unit) {
      case "pass_off": m = findMatchup(matchups, "off", team, "pass"); oppUnitLabel = "pass D"; break;
      case "run_off": m = findMatchup(matchups, "off", team, "run"); oppUnitLabel = "run D"; break;
      case "pass_def": m = findMatchup(matchups, "def", team, "pass"); oppUnitLabel = "pass O"; break;
      case "run_def": m = findMatchup(matchups, "def", team, "run"); oppUnitLabel = "run O"; break;
    }
    const oppRank = unit === "pass_off" || unit === "run_off" ? m?.defRank : m?.offRank;
    if (oppRank === undefined) return;
    const pct = player.percentile ?? null;
    const score = pct === null ? 0 : pct * Math.abs(oppRank - 16.5);
    const oppTeam = team === game.home ? game.away : game.home;
    slots.push({ unit, team, oppTeam, player, oppRank, oppUnitLabel, score });
  };

  for (const team of [game.home, game.away]) {
    const tp = teamPlayersDoc.teams[team];
    if (!tp) continue;
    addSlot(team, "pass_off", tp.pass_off.qb);
    for (const r of tp.pass_off.receivers) addSlot(team, "pass_off", r);
    addSlot(team, "run_off", tp.run_off.rb);
    addSlot(team, "pass_def", tp.pass_def.rusher);
    addSlot(team, "pass_def", tp.pass_def.db);
    addSlot(team, "run_def", tp.run_def.tackler);
  }

  return slots;
}

// A Watch-line pick must be an above-average producer (percentile) facing a
// unit at one of the existing rank tiers (STRONG_RANK/WEAK_RANK, same
// thresholds the per-matchup tags use) — otherwise most games would surface
// a "notable" pairing that isn't actually notable. No qualifying slot means
// no Watch line for that game, rather than manufacturing one.
const WATCH_MIN_PERCENTILE = 50;

const NAME_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

/** Last name for the compact Watch line — strips a trailing Jr./Sr./II etc. */
export function shortName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  while (parts.length > 1 && NAME_SUFFIXES.has(parts[parts.length - 1].replace(/\.$/, "").toLowerCase())) {
    parts.pop();
  }
  return parts[parts.length - 1];
}

/** The top 1-2 slots by score, unit-level framing only (never an implied
 *  1-on-1). Empty when nothing clears the bar (most games won't have a
 *  genuinely notable pairing, and that's fine — no line beats a forced one).
 *  Returns slots (not pre-formatted text) so a caller can attach an injury
 *  badge per player — GameCard renders each as a third MODEL/MARKET-style
 *  row rather than inline text. */
export function computeWatchSlots(slots: SpotlightSlot[]): SpotlightSlot[] {
  const qualifying = slots.filter(
    (s) =>
      s.player.percentile != null &&
      s.player.percentile >= WATCH_MIN_PERCENTILE &&
      (s.oppRank <= STRONG_RANK || s.oppRank >= WEAK_RANK)
  );
  if (qualifying.length === 0) return [];
  return [...qualifying].sort((a, b) => b.score - a.score).slice(0, 2);
}

/** "Chase (CIN) vs 30th-ranked pass D" — the text portion of one Watch-line
 *  slot; the caller adds any injury badge alongside it. */
export function formatWatchSlotText(slot: SpotlightSlot): string {
  return `${shortName(slot.player.name)} (${slot.team}) vs ${ordinal(slot.oppRank)}-ranked ${slot.oppUnitLabel}`;
}
