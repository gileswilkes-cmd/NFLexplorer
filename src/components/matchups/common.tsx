import { percentileTier } from "@/lib/percentile";
import type { GameTag, PerMatchupTag } from "@/lib/matchups";

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

/** rank 1-32 -> the same diverging quality tier used for percentile badges
 *  (rank IS quality here, unlike the Phase 3 style axes — see MATCHUPS_SPEC.md). */
export function rankTier(rank: number, total = 32): -3 | -2 | -1 | 0 | 1 | 2 | 3 {
  const pseudoPct = ((total - rank + 1) / total) * 100;
  return percentileTier(pseudoPct);
}

export function rankTierVar(rank: number): string {
  const tier = rankTier(rank);
  return tier === 0 ? "var(--pct-mid)" : tier > 0 ? `var(--pct-hi-${tier})` : `var(--pct-lo-${-tier})`;
}

/** Rank chip: quality-tinted background (blue = strong, red = weak), like PctBadge. */
export function RankChip({ rank }: { rank: number }) {
  return (
    <span
      className="tabular inline-block min-w-[2.75em] rounded px-1 py-0.5 text-center text-[11px] font-medium leading-none"
      style={{ background: rankTierVar(rank) }}
    >
      {ordinal(rank)}
    </span>
  );
}

/** Edge chip: signed rank-gap, blue when the offence is favoured, red when the defence is. */
export function EdgeChip({ edge }: { edge: number }) {
  const tier = edge === 0 ? 0 : edge > 0 ? 2 : -2;
  const varName = tier === 0 ? "var(--pct-mid)" : tier > 0 ? "var(--pct-hi-2)" : "var(--pct-lo-2)";
  return (
    <span
      className="tabular inline-block min-w-[2.75em] rounded px-1 py-0.5 text-center text-[11px] font-medium leading-none"
      style={{ background: varName }}
      title={edge > 0 ? "offence favoured" : edge < 0 ? "defence favoured" : "even"}
    >
      {edge > 0 ? "+" : ""}{edge}
    </span>
  );
}

export const PER_MATCHUP_TAG_LABEL: Record<Exclude<PerMatchupTag, null>, string> = {
  "Points likely": "Points likely",
  "Shutdown likely": "Shutdown likely",
  "Elite clash": "Elite clash",
};

/** Game-tag chip styling — deliberately distinct hues per tag so the card
 *  scans at a glance; not the quality palette (these describe game
 *  character, not team quality). */
export function gameTagStyle(tag: GameTag): { background: string; color?: string } {
  switch (tag) {
    case "Shootout": return { background: "var(--pct-hi-1)" };
    case "Defensive struggle": return { background: "var(--pct-lo-1)" };
    case "Clash": return { background: "var(--style-track)", color: "var(--style-bar)" };
    case "Lopsided": return { background: "var(--pct-hi-2)" };
    case "Even": return { background: "var(--pct-mid)" };
  }
}
