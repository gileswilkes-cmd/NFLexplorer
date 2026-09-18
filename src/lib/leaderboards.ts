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

// --- Teams wide table (single-season TEAM scope) ----------------------------
// Column config for the wide, Excel-like Teams table. Reads the exact same
// TEAM boards every single-stat board reads — no new data, no re-ranking
// (every column's `rank` comes straight from the board's own `_rank_entries`
// output, docs/DATA_SCHEMA.md).

export type TeamColumnGroup = "offence" | "defence" | "overall" | "style";

export interface TeamColumnDef {
  /** board tag: "{offense|defense}:{dotted key}", matches `formatBoardValue`'s key format */
  tag: string;
  short: string;
  group: TeamColumnGroup;
}

// Local-only style override for THIS table. `board.style` (from
// ingest/build.py) only flags a key style when it starts with "fingerprint." —
// these two tags are tendency/pace axes by the same reasoning (pace isn't
// quality; a scheme tendency isn't quality) but the prefix check misses them.
// Overridden here rather than in the Python metadata so the correction stays
// scoped to this table; every single-stat board elsewhere still reads
// `style: false` for these two, unchanged.
const STYLE_OVERRIDE_TAGS = new Set<string>([
  "offense:summary.plays_per_game",        // pace, not quality
  "offense:scheme_splits.deep_shots.rate", // tendency axis, same family as the fingerprint ones
]);

/** Whether a column should render as a style (tendency) column in the wide
 *  table — no heatmap shading, ever, regardless of direction. */
export function isStyleColumn(tag: string, boardStyle: boolean | undefined): boolean {
  return Boolean(boardStyle) || STYLE_OVERRIDE_TAGS.has(tag);
}

export const TEAM_GROUP_LABELS: Record<TeamColumnGroup, string> = {
  offence: "Offence", defence: "Defence", overall: "Overall", style: "Style",
};

/** Ordered, grouped column list (approved gate report + column-config
 *  ruling). The four unit-EPA columns are the spine, placed first — the
 *  Overall "allowed" summary columns partly restate them, so they sit right
 *  of the spine rather than competing for first eyeshot. Style (tendency,
 *  never shaded) sits furthest right. `group` here is the wide table's OWN
 *  grouping (Offence/Defence = the spine only; every other offense- or
 *  defense-side summary stat is "overall"), distinct from each board's own
 *  `side` field. */
export const TEAM_COLUMNS: TeamColumnDef[] = [
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

export interface TeamRowCell {
  value: number;
  rank: number;
  games: number;
}

export interface TeamRow {
  id: string;
  name: string;
  /** min across every column that has a value this season — the honest
   *  per-row sample size; a row can have fewer games recorded on a column
   *  that dropped out (e.g. neutral_pace_sec's own 50-sample floor) than on
   *  the rest, so this is a floor, not a single authoritative count. */
  games: number;
  cells: Record<string, TeamRowCell>;
}

/** One row per team, every configured column populated where the board has
 *  it — reads `boards.TEAM` as-is, no re-ranking, no re-aggregation. A
 *  missing column for a team (or for the whole season, like
 *  fingerprint.neutral_pace_sec before ~50 qualifying snaps accumulate)
 *  just leaves that cell absent; callers render "—". */
export function teamTableRows(teamBoards: Record<string, Board>): TeamRow[] {
  const byId = new Map<string, TeamRow>();
  for (const col of TEAM_COLUMNS) {
    const board = teamBoards[col.tag];
    if (!board) continue;
    for (const e of board.entries) {
      let row = byId.get(e.id);
      if (!row) {
        row = { id: e.id, name: e.name, games: e.games ?? 0, cells: {} };
        byId.set(e.id, row);
      }
      row.cells[col.tag] = { value: e.value, rank: e.rank, games: e.games ?? 0 };
      if (e.games !== undefined) row.games = Math.min(row.games, e.games);
    }
  }
  return [...byId.values()];
}

function escapeDelimited(v: string, delimiter: string): string {
  return v.includes(delimiter) || v.includes('"') || v.includes("\n")
    ? `"${v.replace(/"/g, '""')}"`
    : v;
}

/** Team name, Games, then one column per TEAM_COLUMNS entry, in `rows`'
 *  given order (the caller's current sort) — used by both the copy-as-TSV
 *  and download-CSV affordances so they always agree with what's on screen. */
export function teamTableToDelimited(rows: TeamRow[], delimiter: "\t" | ","): string {
  const header = ["Team", "Games", ...TEAM_COLUMNS.map((c) => c.short)];
  const lines = [header.join(delimiter)];
  for (const row of rows) {
    const cells = [
      row.name,
      String(row.games),
      ...TEAM_COLUMNS.map((c) => {
        const cell = row.cells[c.tag];
        return cell === undefined ? "" : String(cell.value);
      }),
    ];
    lines.push(cells.map((v) => escapeDelimited(v, delimiter)).join(delimiter));
  }
  return lines.join("\n");
}
