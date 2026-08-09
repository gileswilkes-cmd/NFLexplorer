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
