import type { PlayerDoc, SeasonRow } from "@/lib/types";
import type { PosGroup } from "@/lib/stats";

export interface Side {
  doc: PlayerDoc;
  group: PosGroup;
  color: string; // CSS var reference
}

export function regRows(doc: PlayerDoc): SeasonRow[] {
  return doc.seasons.filter((s) => s.game_type === "REG");
}

export function lastName(name: string): string {
  const parts = name.split(" ");
  return parts.length > 1 ? parts.slice(1).join(" ") : name;
}

/** Radar axes per group — the shape-of-player stats (all percentile-backed). */
export const RADAR_KEYS: Record<string, string[]> = {
  QB: ["pass_yds", "pass_td", "pass_int", "epa_per_play", "cpoe", "adot", "sacks"],
  RB: ["rush_att", "rush_yds", "rush_td", "rec_yds", "epa_per_play", "yac_oe", "snap_share"],
  WR: ["targets", "rec", "rec_yds", "rec_td", "target_share", "epa_per_play", "yac_oe"],
  TE: ["targets", "rec", "rec_yds", "rec_td", "target_share", "epa_per_play", "yac_oe"],
  K: ["fg_att", "fg_made", "fg_long", "xp_made"],
  DL: ["tackles", "tfl", "def_sacks", "qb_hits", "ff", "snaps"],
  LB: ["tackles", "tfl", "def_sacks", "def_int", "pass_defended", "snaps"],
  DB: ["tackles", "def_int", "pass_defended", "tfl", "ff", "snaps"],
};

/** Cross-group comparisons only compare these (like-for-like everywhere). */
export const SHARED_KEYS = ["games", "snaps", "snap_share", "epa_per_play"];

/** Arc metric choices per group (raw mode); era mode restricts to baseline-backed. */
export const ARC_KEYS: Record<string, string[]> = {
  QB: ["epa_per_play", "pass_yds", "pass_td", "pass_int", "cpoe", "adot"],
  RB: ["epa_per_play", "rush_yds", "rush_td", "rec_yds", "yac_oe"],
  WR: ["epa_per_play", "rec_yds", "rec", "rec_td", "target_share", "yac_oe"],
  TE: ["epa_per_play", "rec_yds", "rec", "rec_td", "target_share", "yac_oe"],
  K: ["fg_made", "fg_att", "fg_long"],
  DL: ["tackles", "def_sacks", "tfl", "qb_hits"],
  LB: ["tackles", "def_sacks", "tfl", "def_int"],
  DB: ["tackles", "def_int", "pass_defended", "tfl"],
  OTHER: ["snaps", "snap_share"],
};
