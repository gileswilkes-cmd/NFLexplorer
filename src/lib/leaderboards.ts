// Presentation helpers for public/data/leaderboards/*.json.
// The build owns correctness (qualifiers, direction, position filtering); this
// file only decides how a board's numbers and rules are worded.

import { columnFor } from "./stats";
import type { Board, BoardEntry, LeaderboardDoc } from "./types";

export const WINDOW_LABEL = "2015–2025";

export type Scope = "season" | "records" | "career";

export const SCOPES: { key: Scope; label: string; blurb: string }[] = [
  { key: "season", label: "One season", blurb: "Leaders for a single season." },
  {
    key: "records",
    label: "Best single seasons",
    blurb: `Best individual seasons pooled across ${WINDOW_LABEL} — a player can appear more than once, once per qualifying season.`,
  },
  {
    key: "career",
    label: "Career totals",
    blurb: `Career totals counted within ${WINDOW_LABEL} only. Anything before 2015 is not included, so totals for long careers are deliberately truncated.`,
  },
];

/** Career and all-time views are truncated to the window — the UI must say so. */
export function needsWindowLabel(scope: Scope): boolean {
  return scope === "career" || scope === "records";
}

export function scopePath(scope: Scope, season: number): string {
  if (scope === "season") return `/data/leaderboards/season/${season}.json`;
  return `/data/leaderboards/${scope}.json`;
}

export const GROUP_LABELS: Record<string, string> = {
  QB: "Quarterbacks", RB: "Running backs", WR: "Wide receivers",
  TE: "Tight ends", K: "Kickers", DL: "Defensive line",
  LB: "Linebackers", DB: "Defensive backs", TEAM: "Teams",
};

/** Qualifier stat key -> the noun a human would use for it. */
const QUALIFIER_NOUNS: Record<string, string> = {
  pass_att: "pass attempts",
  rush_att: "rush attempts",
  targets: "targets",
  fg_att: "field-goal attempts",
  snaps: "snaps",
};

/**
 * "pass_att >= 2500" -> "min 2,500 pass attempts". Mandatory on every rate
 * board: a filtered leaderboard whose inclusion rule is invisible is a
 * leaderboard nobody can check.
 */
export function qualifierText(qualifier: string | null): string | null {
  if (!qualifier) return null;
  const m = /^(\w+)\s*>=\s*(\d+)$/.exec(qualifier);
  if (!m) return qualifier;
  const [, key, n] = m;
  return `min ${Number(n).toLocaleString()} ${QUALIFIER_NOUNS[key] ?? key.replace(/_/g, " ")}`;
}

const EPA_KEYS = /epa_per_play/;
const PCT_KEYS = new Set([
  "cmp_pct", "fg_pct",
  "summary.success_rate", "summary.success_rate_allowed",
  "fingerprint.proe", "fingerprint.early_down_pass_rate", "fingerprint.shotgun_rate",
  "scheme_splits.deep_shots.rate", "explosive_rate_allowed", "sack_rate",
]);

/**
 * Board values are raw numbers of several kinds — a rate fraction, an EPA
 * average, a per-game count, a season total — so formatting reads the board's
 * own metadata first and only then falls back to the shared column defs.
 */
export function formatBoardValue(statKey: string, board: Board, v: number): string {
  // TEAM board keys are side-prefixed ("offense:fingerprint.proe"); the metric
  // identity is the part after the colon.
  const key = statKey.includes(":") ? statKey.slice(statKey.indexOf(":") + 1) : statKey;
  if (board.format === "pct" || PCT_KEYS.has(key)) return `${(v * 100).toFixed(1)}%`;
  if (EPA_KEYS.test(key)) return (v > 0 ? "+" : "") + v.toFixed(3);
  if (key === "fingerprint.neutral_pace_sec") return `${v.toFixed(1)}s`;
  const col = columnFor(key);
  if (col.fmt) return col.fmt(v);
  if (Number.isInteger(v)) return v.toLocaleString();
  return Math.abs(v) < 1 ? v.toFixed(3) : v.toFixed(1);
}

/** "1.3% (66 INT / 5268 att)" — the volume behind a rate, or null if not a rate board. */
export function rateContext(board: Board, e: BoardEntry): string | null {
  if (board.format !== "pct" || e.count === undefined || e.denom === undefined) return null;
  return `${e.count.toLocaleString()} ${board.count_label ?? ""} / ${e.denom.toLocaleString()} ${board.denom_label ?? ""}`.replace(/\s+/g, " ").trim();
}

export function entryHref(group: string, e: BoardEntry): string {
  return group === "TEAM" ? `/teams/${e.id}` : `/players/${e.id}`;
}

/** Groups present in a file, in the canonical order rather than JSON order. */
export function groupsIn(doc: LeaderboardDoc): string[] {
  const order = Object.keys(GROUP_LABELS);
  return order.filter((g) => doc.boards[g] && Object.keys(doc.boards[g]).length > 0);
}

// --- Wide leaderboard tables (Teams + skill-position players) --------------
// Shared column/row machinery for every single-season wide table. Reads the
// exact same boards every single-stat board reads — no new data, no
// re-ranking (every column's `rank` comes straight from the board's own
// `_rank_entries` output, docs/DATA_SCHEMA.md).

export interface WideColumnDef {
  /** board tag — "{offense|defense}:{dotted key}" for TEAM, a bare stat key
   *  (e.g. "pass_yds") for players; matches `formatBoardValue`'s key format */
  tag: string;
  short: string;
  /** the table's OWN grouping for header bands + separators. "style" is the
   *  one group name every table's shading logic treats specially — see
   *  isStyleColumn: a column's group is the single source of truth for
   *  whether it's shaded, not a second lookup against the board's own
   *  `style` flag (which, e.g., misses plays_per_game — see TEAM_COLUMNS). */
  group: string;
}

/** A column with no backing board — Games, and (QB/RB only) the raw
 *  attempts/carries volume — neither of which ingest/build.py ranks as its
 *  own board. Sortable by raw value, sticky-adjacent, never shaded (there's
 *  no `direction` to shade by). WR/TE don't need one for volume: targets IS
 *  a real ranked board for them (LEADERBOARD_STATS), so it's just a normal
 *  column there. */
export interface SynthColumnDef {
  key: string;
  label: string;
  title: string;
  accessor: (row: WideRow) => number | undefined;
}

export interface QualifierConfig {
  /** flat full-season minimum — ingest/build.py QUALIFIERS[grp][1] — the
   *  reference a partial season's threshold scales down from (see
   *  scaledQualifierThreshold). */
  flatMin: number;
  /** "attempts" | "carries" | "targets" — for the "min N {label} to qualify" note */
  volumeLabel: string;
}

export interface WideTableConfig {
  columns: WideColumnDef[];
  synthColumns: SynthColumnDef[];
  groupOrder: string[];
  groupLabels: Record<string, string>;
  entityHref: (id: string) => string;
  entityColumnLabel: string;
  entityLabelPlural: string;
  filenamePrefix: string;
  /** initial sort column tag — a counting stat, so the table opens reading
   *  as a real leaderboard, not alphabetical. null keeps Teams' existing
   *  alphabetical-by-name default (unchanged). */
  defaultSortTag: string | null;
  /** absent for Teams — 32 teams never need a volume floor */
  qualifier?: QualifierConfig;
  enableTeamFilter?: boolean;
  enableSearch?: boolean;
}

/** Whether a column should render as a style (tendency) column — no heatmap
 *  shading, ever, regardless of direction. Driven entirely by which group a
 *  column is placed in (single source of truth per table), not re-derived
 *  from the board's own `style` flag at render time. */
export function isStyleColumn(col: WideColumnDef): boolean {
  return col.group === "style";
}

export interface WideRowCell {
  value: number;
  rank: number;
  games: number;
}

export interface WideRow {
  id: string;
  name: string;
  team?: string;
  /** min across every column that has a value this season — the honest
   *  per-row sample size; a row can have fewer games recorded on a column
   *  that dropped out (e.g. TEAM's neutral_pace_sec before ~50 qualifying
   *  snaps accumulate) than on the rest, so this is a floor, not a single
   *  authoritative count. */
  games: number;
  /** QB/RB/WR/TE only: that position's qualifier volume (pass_att/rush_att/
   *  targets) — the same value regardless of which cell it's read from
   *  (ingest/build.py attaches it to every stat entry for a player). */
  volume?: number;
  cells: Record<string, WideRowCell>;
}

/** One row per entity, every configured column populated where the board
 *  has it — no re-ranking, no re-aggregation. A missing column for an
 *  entity just leaves that cell absent; callers render "—". */
export function wideTableRows(boards: Record<string, Board>, columns: WideColumnDef[]): WideRow[] {
  const byId = new Map<string, WideRow>();
  for (const col of columns) {
    const board = boards[col.tag];
    if (!board) continue;
    for (const e of board.entries) {
      let row = byId.get(e.id);
      if (!row) {
        row = { id: e.id, name: e.name, team: e.team ?? undefined, games: e.games ?? 0, volume: e.volume, cells: {} };
        byId.set(e.id, row);
      }
      row.cells[col.tag] = { value: e.value, rank: e.rank, games: e.games ?? 0 };
      if (e.games !== undefined) row.games = Math.min(row.games, e.games);
      if (e.volume !== undefined) row.volume = e.volume;
    }
  }
  return [...byId.values()];
}

function escapeDelimited(v: string, delimiter: string): string {
  return v.includes(delimiter) || v.includes('"') || v.includes("\n")
    ? `"${v.replace(/"/g, '""')}"`
    : v;
}

/** Name, every synth column, then one column per `columns` entry, in
 *  `rows`' given order (the caller's current sort/filter) — used by both
 *  the copy-as-TSV and download-CSV affordances so they always agree with
 *  what's on screen. */
export function wideTableToDelimited(
  rows: WideRow[], columns: WideColumnDef[], synthColumns: SynthColumnDef[], delimiter: "\t" | ","
): string {
  const header = ["Name", ...synthColumns.map((s) => s.label), ...columns.map((c) => c.short)];
  const lines = [header.join(delimiter)];
  for (const row of rows) {
    const cells = [
      row.name,
      ...synthColumns.map((s) => String(s.accessor(row) ?? "")),
      ...columns.map((c) => {
        const cell = row.cells[c.tag];
        return cell === undefined ? "" : String(cell.value);
      }),
    ];
    lines.push(cells.map((v) => escapeDelimited(v, delimiter)).join(delimiter));
  }
  return lines.join("\n");
}

/** Games-scaled qualifier threshold for one entity, from the position's flat
 *  full-season minimum (ingest/build.py QUALIFIERS). 17 is the current NFL
 *  season length, so a complete season reproduces the flat constant exactly
 *  (games=17 -> threshold=flatMin); a partial season scales it down.
 *  Computed fresh from the DISPLAYED season's own `games` value every call —
 *  never a cached or hardcoded week number, so viewing 2025 naturally
 *  applies the full 224/100/50/30 floors and viewing 2026 applies whatever
 *  that week's real games-played implies. */
export function scaledQualifierThreshold(flatMin: number, games: number): number {
  return Math.ceil((flatMin / 17) * games);
}

// --- Teams (single-season TEAM scope) ---------------------------------------

export const TEAM_GROUP_LABELS: Record<string, string> = {
  offence: "Offence", defence: "Defence", overall: "Overall", style: "Style",
};

/** Ordered, grouped column list (approved gate report + column-config
 *  ruling). The four unit-EPA columns are the spine, placed first — the
 *  Overall "allowed" summary columns partly restate them, so they sit right
 *  of the spine rather than competing for first eyeshot. Style (tendency,
 *  never shaded) sits furthest right. `group` here is the wide table's OWN
 *  grouping (Offence/Defence = the spine only; every other offense- or
 *  defense-side summary stat is "overall"), distinct from each board's own
 *  `side` field. plays_per_game and deep_shots.rate are placed in "style"
 *  despite the board's own `style: false` (a prefix-based check that misses
 *  them) — that placement IS the override now; see isStyleColumn above. */
export const TEAM_COLUMNS: WideColumnDef[] = [
  { tag: "offense:by_play_type.pass.epa_per_play", short: "Pass EPA off", group: "offence" },
  { tag: "offense:by_play_type.rush.epa_per_play", short: "Rush EPA off", group: "offence" },
  { tag: "defense:by_play_type.pass.epa_per_play_allowed", short: "Pass EPA def", group: "defence" },
  { tag: "defense:by_play_type.rush.epa_per_play_allowed", short: "Rush EPA def", group: "defence" },

  { tag: "offense:summary.points_per_game", short: "Points/G", group: "overall" },
  { tag: "defense:summary.points_allowed_per_game", short: "Pts allow/G", group: "overall" },
  { tag: "offense:summary.epa_per_play", short: "EPA/play", group: "overall" },
  { tag: "defense:summary.epa_per_play_allowed", short: "EPA/play def", group: "overall" },
  { tag: "offense:summary.success_rate", short: "Success%", group: "overall" },
  { tag: "defense:summary.success_rate_allowed", short: "Success% def", group: "overall" },
  { tag: "offense:summary.yds_per_game", short: "Yards/G", group: "overall" },
  { tag: "defense:summary.yds_allowed_per_game", short: "Yards/G def", group: "overall" },
  { tag: "defense:explosive_rate_allowed", short: "Explosive% def", group: "overall" },
  { tag: "defense:sack_rate", short: "Sack%", group: "overall" },

  { tag: "offense:summary.plays_per_game", short: "Plays/G", group: "style" },
  { tag: "offense:fingerprint.proe", short: "PROE", group: "style" },
  { tag: "offense:fingerprint.early_down_pass_rate", short: "ED pass%", group: "style" },
  { tag: "offense:fingerprint.shotgun_rate", short: "Shotgun%", group: "style" },
  { tag: "offense:fingerprint.adot", short: "ADOT", group: "style" },
  { tag: "offense:scheme_splits.deep_shots.rate", short: "Deep-shot%", group: "style" },
  { tag: "offense:fingerprint.neutral_pace_sec", short: "Pace (s)", group: "style" },
];

const GAMES_SYNTH: SynthColumnDef = {
  key: "games", label: "Games", title: "Games played this season", accessor: (r) => r.games,
};

const TEAM_TABLE_CONFIG: WideTableConfig = {
  columns: TEAM_COLUMNS,
  synthColumns: [GAMES_SYNTH],
  groupOrder: ["offence", "defence", "overall", "style"],
  groupLabels: TEAM_GROUP_LABELS,
  entityHref: (id) => `/teams/${id}`,
  entityColumnLabel: "Team",
  entityLabelPlural: "teams",
  filenamePrefix: "teams",
  defaultSortTag: null,
};

// --- Skill-position players (single-season QB/RB/WR/TE scope) --------------
// Column lists straight from ingest/build.py LEADERBOARD_STATS — nothing
// invented. WR and TE share this exact column set (_WR_TE_STATS) but are
// SEPARATE boards/tables: each ranks 1-N within its own position, with its
// own qualifier floor (50 targets vs 30) — never merged.

const QB_COLUMNS: WideColumnDef[] = [
  { tag: "pass_yds", short: "Pass Yds", group: "passing" },
  { tag: "pass_td", short: "Pass TD", group: "passing" },
  { tag: "cmp_pct", short: "Cmp%", group: "passing" },
  { tag: "ypa", short: "Y/A", group: "passing" },
  { tag: "epa_per_play", short: "EPA/play", group: "passing" },
  { tag: "cpoe", short: "CPOE", group: "passing" },
  { tag: "int_rate", short: "Int%", group: "passing" },   // asc — lower better
  { tag: "sack_rate", short: "Sack%", group: "passing" }, // asc — lower better
  { tag: "rush_yds", short: "Rush Yds", group: "rushing" },
  { tag: "rush_td", short: "Rush TD", group: "rushing" },
];

const RB_COLUMNS: WideColumnDef[] = [
  { tag: "rush_yds", short: "Rush Yds", group: "rushing" },
  { tag: "rush_td", short: "Rush TD", group: "rushing" },
  { tag: "ypc", short: "YPC", group: "rushing" },
  { tag: "epa_per_play", short: "EPA/play", group: "rushing" },
  { tag: "yac_oe", short: "YAC-OE", group: "rushing" },
  { tag: "fumble_rate", short: "Fumble%", group: "rushing" }, // asc — lower better
  { tag: "rec", short: "Rec", group: "receiving" },
  { tag: "rec_yds", short: "Rec Yds", group: "receiving" },
  { tag: "rec_td", short: "Rec TD", group: "receiving" },
];

// WR and TE (_WR_TE_STATS in ingest/build.py) — identical column set,
// distinct board data per group. Targets is a real ranked board here
// (LEADERBOARD_STATS includes it for WR/TE, unlike QB pass_att / RB
// rush_att), so it's a normal shaded column, not a synth one.
const RECEIVER_COLUMNS: WideColumnDef[] = [
  { tag: "rec", short: "Rec", group: "receiving" },
  { tag: "rec_yds", short: "Rec Yds", group: "receiving" },
  { tag: "rec_td", short: "Rec TD", group: "receiving" },
  { tag: "targets", short: "Targets", group: "receiving" },
  { tag: "ypr", short: "YPR", group: "receiving" },
  { tag: "epa_per_play", short: "EPA/play", group: "receiving" },
  { tag: "yac_oe", short: "YAC-OE", group: "receiving" },
  { tag: "adot", short: "ADOT", group: "style" }, // tendency (deep vs. possession), not quality
];

export const PLAYER_GROUP_LABELS: Record<string, string> = {
  passing: "Passing", rushing: "Rushing", receiving: "Receiving", style: "Style",
};

/** One config per wide-table-eligible group — looked up by the Position
 *  dropdown's value. Keys double as WIDE_TABLE_GROUPS (which positions get
 *  the wide table vs. the single-stat fallback). DL/LB/DB/K deliberately
 *  absent — a later pass, no 2026 data for them yet either. */
export const WIDE_TABLE_CONFIGS: Record<string, WideTableConfig> = {
  TEAM: TEAM_TABLE_CONFIG,
  QB: {
    columns: QB_COLUMNS,
    synthColumns: [GAMES_SYNTH, { key: "volume", label: "Attempts", title: "Pass attempts this season", accessor: (r) => r.volume }],
    groupOrder: ["passing", "rushing"],
    groupLabels: PLAYER_GROUP_LABELS,
    entityHref: (id) => `/players/${id}`,
    entityColumnLabel: "Player",
    entityLabelPlural: "quarterbacks",
    filenamePrefix: "qb",
    defaultSortTag: "pass_yds",
    qualifier: { flatMin: 224, volumeLabel: "attempts" },
    enableTeamFilter: true,
    enableSearch: true,
  },
  RB: {
    columns: RB_COLUMNS,
    synthColumns: [GAMES_SYNTH, { key: "volume", label: "Carries", title: "Rush attempts this season", accessor: (r) => r.volume }],
    groupOrder: ["rushing", "receiving"],
    groupLabels: PLAYER_GROUP_LABELS,
    entityHref: (id) => `/players/${id}`,
    entityColumnLabel: "Player",
    entityLabelPlural: "running backs",
    filenamePrefix: "rb",
    defaultSortTag: "rush_yds",
    qualifier: { flatMin: 100, volumeLabel: "carries" },
    enableTeamFilter: true,
    enableSearch: true,
  },
  WR: {
    columns: RECEIVER_COLUMNS,
    synthColumns: [GAMES_SYNTH],
    groupOrder: ["receiving", "style"],
    groupLabels: PLAYER_GROUP_LABELS,
    entityHref: (id) => `/players/${id}`,
    entityColumnLabel: "Player",
    entityLabelPlural: "wide receivers",
    filenamePrefix: "wr",
    defaultSortTag: "rec_yds",
    qualifier: { flatMin: 50, volumeLabel: "targets" },
    enableTeamFilter: true,
    enableSearch: true,
  },
  TE: {
    columns: RECEIVER_COLUMNS,
    synthColumns: [GAMES_SYNTH],
    groupOrder: ["receiving", "style"],
    groupLabels: PLAYER_GROUP_LABELS,
    entityHref: (id) => `/players/${id}`,
    entityColumnLabel: "Player",
    entityLabelPlural: "tight ends",
    filenamePrefix: "te",
    defaultSortTag: "rec_yds",
    qualifier: { flatMin: 30, volumeLabel: "targets" },
    enableTeamFilter: true,
    enableSearch: true,
  },
};

export const WIDE_TABLE_GROUPS = new Set(Object.keys(WIDE_TABLE_CONFIGS));
