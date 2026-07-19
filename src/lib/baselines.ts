// Loads seasons/{year}.json baseline files and computes live percentiles for
// era-adjusted views. Reuses percentileFromGrid() — the single percentile
// implementation — so live values always agree with build-time badges.

import { percentileFromGrid } from "./percentile";
import type { PosGroup } from "./stats";

export interface BaselineStat {
  mean: number;
  std: number;
  p: number[];
}

export interface SeasonFile {
  schema_version: number;
  season: number;
  league: { games: number; points: number; stats: Record<string, number> };
  baselines: Record<string, { qualifier: string; n: number; stats: Record<string, BaselineStat> }>;
}

const cache = new Map<number, Promise<SeasonFile | null>>();

export function getSeasonFile(year: number): Promise<SeasonFile | null> {
  let p = cache.get(year);
  if (!p) {
    p = fetch(`/data/seasons/${year}.json`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    cache.set(year, p);
  }
  return p;
}

/** "pass_att >= 224" -> ["pass_att", 224]; data-driven, no hardcoded rules. */
export function parseQualifier(q: string): [string, number] | null {
  const m = q.match(/^(\w+)\s*>=\s*([\d.]+)$/);
  return m ? [m[1], Number(m[2])] : null;
}

/**
 * Era-adjusted percentile for one stat in one season, against the player's own
 * position group. Returns null when it cannot be computed honestly: no
 * baseline for that group/stat, or the season fails the group qualifier
 * (matching how the build emits {} for sub-qualifier seasons).
 */
export function livePercentile(
  file: SeasonFile | null,
  group: PosGroup,
  statKey: string,
  flat: Record<string, number>,
): number | null {
  if (!file || group === "OTHER") return null;
  const bl = file.baselines[group];
  if (!bl) return null;
  const q = parseQualifier(bl.qualifier);
  if (q && (flat[q[0]] ?? 0) < q[1]) return null;
  const stat = bl.stats[statKey];
  const value = flat[statKey];
  if (!stat || value === undefined) return null;
  return percentileFromGrid(value, stat.p, statKey);
}
