// TypeScript port of percentile_from_grid() in ingest/build.py.
// CONTRACT (docs/DATA_SCHEMA.md): this must match the Python implementation
// case-for-case — build-time badges and any live computation (Phase 2
// era-adjusted comparisons) must never disagree.

export const PERCENTILE_GRID = [5, 10, 25, 50, 75, 90, 95] as const;

// Stats that are bad when high; percentile is inverted so a low interception
// count reads as a good percentile. Mirror of NEGATIVE_STATS in build.py.
export const NEGATIVE_STATS = new Set(["pass_int", "sacks", "sack_yds", "rush_fumbles"]);

export function percentileFromGrid(value: number, p: number[], statKey: string): number {
  let pct: number;
  if (value <= p[0]) {
    pct = PERCENTILE_GRID[0];
  } else if (value >= p[p.length - 1]) {
    pct = PERCENTILE_GRID[PERCENTILE_GRID.length - 1];
  } else {
    pct = PERCENTILE_GRID[PERCENTILE_GRID.length - 1];
    for (let i = 0; i < p.length - 1; i++) {
      if (p[i] <= value && value <= p[i + 1]) {
        const span = p[i + 1] - p[i];
        const frac = span ? (value - p[i]) / span : 0;
        pct = PERCENTILE_GRID[i] + frac * (PERCENTILE_GRID[i + 1] - PERCENTILE_GRID[i]);
        break;
      }
    }
  }
  return NEGATIVE_STATS.has(statKey) ? 100 - pct : pct;
}

/** Tail rule: clamp values render as "<5" / "95+", never fake precision. */
export function formatPercentile(pct: number): string {
  if (pct <= 5) return "<5";
  if (pct >= 95) return "95+";
  return String(Math.round(pct));
}

/** Diverging tier for badge tinting: negative = below median (red arm),
 *  positive = above (blue arm), 0 = neutral band around the median. */
export function percentileTier(pct: number): -3 | -2 | -1 | 0 | 1 | 2 | 3 {
  if (pct >= 90) return 3;
  if (pct >= 75) return 2;
  if (pct >= 60) return 1;
  if (pct > 40) return 0;
  if (pct > 25) return -1;
  if (pct > 10) return -2;
  return -3;
}
