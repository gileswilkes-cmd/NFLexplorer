// Position-aware stat presentation: which columns each position group shows,
// their labels, and formatting. Mirrors the spirit of POSITION_STAT_SETS in
// ingest/build.py (display subset — storage may hold more).

import type { SeasonRow, CareerBlock, StatMap, AdvancedBlock } from "./types";

export type PosGroup = "QB" | "RB" | "WR" | "TE" | "K" | "DL" | "LB" | "DB" | "OTHER";

const DEF_GROUPS: Record<string, PosGroup> = {
  DE: "DL", DT: "DL", NT: "DL", EDGE: "DL", DL: "DL",
  ILB: "LB", OLB: "LB", MLB: "LB", LB: "LB",
  CB: "DB", S: "DB", FS: "DB", SS: "DB", DB: "DB",
};

export function posGroup(pos: string | null | undefined): PosGroup {
  if (!pos) return "OTHER";
  if (pos === "QB" || pos === "K") return pos;
  if (pos === "RB" || pos === "FB") return "RB";
  if (pos === "WR") return "WR";
  if (pos === "TE") return "TE";
  return DEF_GROUPS[pos] ?? "OTHER";
}

type Source = StatMap; // flattened stats + advanced (+ ngs) for one row

export interface Column {
  key: string;          // percentile lookup key (real stat keys only)
  label: string;
  title?: string;       // hover explanation
  fmt?: (v: number) => string;
  derive?: (s: Source) => number | null; // derived columns have no percentile
  ngs?: boolean;        // comes from advanced.ngs → "n/a" when ngs is null
}

const int = (v: number) => String(Math.round(v));
const f1 = (v: number) => v.toFixed(1);
const f2 = (v: number) => v.toFixed(2);
const f3 = (v: number) => v.toFixed(3);
const pct0 = (v: number) => `${Math.round(v * 100)}%`;
const pct1 = (v: number) => `${(v * 100).toFixed(1)}%`;

const ratio = (num: string, den: string, scale = 1): ((s: Source) => number | null) =>
  (s) => (s[den] ? (s[num] ?? 0) / s[den] * scale : null);

export const SEASON_COLUMNS: Record<PosGroup, Column[]> = {
  QB: [
    { key: "pass_att", label: "Att" },
    { key: "pass_cmp", label: "Cmp" },
    { key: "cmp_pct", label: "Cmp%", derive: ratio("pass_cmp", "pass_att"), fmt: pct1 },
    { key: "pass_yds", label: "Yds" },
    { key: "ypa", label: "Y/A", derive: ratio("pass_yds", "pass_att"), fmt: f1 },
    { key: "pass_td", label: "TD" },
    { key: "pass_int", label: "INT" },
    { key: "sacks", label: "Sk" },
    { key: "rush_att", label: "RuAtt" },
    { key: "rush_yds", label: "RuYds" },
    { key: "rush_td", label: "RuTD" },
    { key: "epa_per_play", label: "EPA/p", title: "Expected points added per dropback", fmt: f3 },
    { key: "cpoe", label: "CPOE", title: "Completion % over expected", fmt: f1 },
    { key: "adot", label: "aDOT", title: "Average depth of target", fmt: f1 },
    { key: "avg_time_to_throw", label: "TTT", title: "Avg time to throw (NGS)", fmt: f2, ngs: true },
    { key: "avg_intended_air_yds", label: "IAY", title: "Avg intended air yards (NGS)", fmt: f1, ngs: true },
  ],
  RB: [
    { key: "rush_att", label: "Att" },
    { key: "rush_yds", label: "Yds" },
    { key: "ypc", label: "Y/C", derive: ratio("rush_yds", "rush_att"), fmt: f1 },
    { key: "rush_td", label: "TD" },
    { key: "targets", label: "Tgt" },
    { key: "rec", label: "Rec" },
    { key: "rec_yds", label: "RecYds" },
    { key: "rec_td", label: "RecTD" },
    { key: "snap_share", label: "Snap%", fmt: pct0 },
    { key: "epa_per_play", label: "EPA/p", title: "EPA per touch opportunity", fmt: f3 },
    { key: "yac_oe", label: "YAC+", title: "Yards after catch over expected, per reception", fmt: f2 },
    { key: "efficiency", label: "EFF", title: "Rushing efficiency (NGS; lower = more north-south)", fmt: f2, ngs: true },
  ],
  WR: [
    { key: "targets", label: "Tgt" },
    { key: "rec", label: "Rec" },
    { key: "rec_yds", label: "Yds" },
    { key: "ypr", label: "Y/R", derive: ratio("rec_yds", "rec"), fmt: f1 },
    { key: "rec_td", label: "TD" },
    { key: "target_share", label: "Tgt%", title: "Share of team targets", fmt: pct0 },
    { key: "air_yds_share", label: "AY%", title: "Share of team air yards", fmt: pct0 },
    { key: "snap_share", label: "Snap%", fmt: pct0 },
    { key: "epa_per_play", label: "EPA/p", title: "EPA per target", fmt: f3 },
    { key: "adot", label: "aDOT", title: "Average depth of target", fmt: f1 },
    { key: "yac_oe", label: "YAC+", title: "Yards after catch over expected, per reception", fmt: f2 },
    { key: "avg_separation", label: "SEP", title: "Avg separation at catch (NGS)", fmt: f1, ngs: true },
    { key: "avg_cushion", label: "CUSH", title: "Avg cushion at snap (NGS)", fmt: f1, ngs: true },
  ],
  TE: [] as Column[], // filled below (same as WR)
  K: [
    { key: "fg_att", label: "FGA" },
    { key: "fg_made", label: "FGM" },
    { key: "fg_pct", label: "FG%", derive: ratio("fg_made", "fg_att"), fmt: pct1 },
    { key: "fg_long", label: "Long" },
    { key: "xp_att", label: "XPA" },
    { key: "xp_made", label: "XPM" },
  ],
  DL: [] as Column[], // filled below
  LB: [] as Column[],
  DB: [] as Column[],
  OTHER: [
    { key: "snaps", label: "Snaps" },
    { key: "snap_share", label: "Snap%", fmt: pct0 },
  ],
};

const DEFENSE_COLUMNS: Column[] = [
  { key: "tackles", label: "Tkl", title: "Total tackles (solo + assists)" },
  { key: "tackles_solo", label: "Solo" },
  { key: "tfl", label: "TFL", title: "Tackles for loss" },
  { key: "def_sacks", label: "Sk", fmt: f1 },
  { key: "qb_hits", label: "QBH" },
  { key: "def_int", label: "INT" },
  { key: "pass_defended", label: "PD" },
  { key: "ff", label: "FF", title: "Forced fumbles" },
  { key: "fr", label: "FR", title: "Fumble recoveries (takeaways)" },
  { key: "def_td", label: "TD" },
  { key: "snaps", label: "Snaps" },
];
SEASON_COLUMNS.TE = SEASON_COLUMNS.WR;
SEASON_COLUMNS.DL = DEFENSE_COLUMNS;
SEASON_COLUMNS.LB = DEFENSE_COLUMNS;
SEASON_COLUMNS.DB = DEFENSE_COLUMNS;

// Game logs show the counting subset (no shares/advanced).
const LOG_KEYS: Record<PosGroup, string[]> = {
  QB: ["pass_att", "pass_cmp", "pass_yds", "pass_td", "pass_int", "sacks", "rush_att", "rush_yds", "rush_td"],
  RB: ["rush_att", "rush_yds", "rush_td", "targets", "rec", "rec_yds", "rec_td"],
  WR: ["targets", "rec", "rec_yds", "rec_td", "rush_att", "rush_yds"],
  TE: ["targets", "rec", "rec_yds", "rec_td"],
  K: ["fg_att", "fg_made", "xp_att", "xp_made"],
  DL: ["tackles", "tackles_solo", "tfl", "def_sacks", "qb_hits", "pass_defended", "ff"],
  LB: ["tackles", "tackles_solo", "tfl", "def_sacks", "qb_hits", "def_int", "pass_defended"],
  DB: ["tackles", "tackles_solo", "def_int", "pass_defended", "tfl", "ff"],
  OTHER: [],
};
export function logColumns(group: PosGroup): Column[] {
  const all = [...SEASON_COLUMNS[group], ...DEFENSE_COLUMNS];
  return LOG_KEYS[group].map((k) => all.find((c) => c.key === k) ?? { key: k, label: k });
}

/** Flatten a season row (or career block) into one lookup map for columns. */
export function flatten(row: SeasonRow | CareerBlock): Source {
  const adv: AdvancedBlock = row.advanced ?? {};
  const out: Source = { ...row.stats, games: row.games };
  for (const [k, v] of Object.entries(adv)) {
    if (k !== "ngs" && typeof v === "number") out[k] = v;
  }
  if (adv.ngs) {
    for (const [k, v] of Object.entries(adv.ngs)) out[k] = v;
  }
  return out;
}

/** true when the row's NGS block is explicitly null (not published) */
export function ngsIsNull(row: SeasonRow | CareerBlock): boolean {
  return "advanced" in row && !!row.advanced && "ngs" in row.advanced && row.advanced.ngs === null;
}

export function formatValue(col: Column, v: number): string {
  return (col.fmt ?? int)(v);
}

export function formatHeight(inches: number | null): string | null {
  if (!inches) return null;
  return `${Math.floor(inches / 12)}'${inches % 12}"`;
}
