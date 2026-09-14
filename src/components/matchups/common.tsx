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

// Same top-8 / bottom-8 thresholds as STRONG_RANK / WEAK_RANK in matchups.ts
// (kept in sync manually — those constants aren't exported).
const STRONG_RANK = 8;
const WEAK_RANK = 25;

/** rank 1-32 -> three-tier quality band (docs/MATCHUPS_CARD_RESTYLE.md): top 8
 *  strong, bottom 8 weak, everything else neutral. Deliberately coarser than
 *  the 7-bucket percentile scale used elsewhere — this restyle calls for a
 *  simple top-8/bottom-8 read, not a gradient. */
export function rankTier3(rank: number): "hi" | "mid" | "lo" {
  if (rank <= STRONG_RANK) return "hi";
  if (rank >= WEAK_RANK) return "lo";
  return "mid";
}

/** Rank pill: bare number, teal (top 8) / coral (bottom 8) / neutral grey
 *  (middle) tint — deliberately not the red/green or blue/red diverging
 *  palette used elsewhere, per the restyle brief (reduced colour vision). */
export function RankPill({ rank }: { rank: number }) {
  const tier = rankTier3(rank);
  const style =
    tier === "hi"
      ? { background: "var(--tier-hi-bg)", color: "var(--tier-hi-fg)" }
      : tier === "lo"
      ? { background: "var(--tier-lo-bg)", color: "var(--tier-lo-fg)" }
      : { background: "var(--pct-mid)", color: "var(--ink-secondary)" };
  return (
    <span
      className="tabular inline-flex min-w-[2.25em] items-center justify-center rounded-md px-1.5 py-1 text-[16px] font-medium leading-none"
      style={style}
    >
      {rank}
    </span>
  );
}

const INJURY_ABBR: Record<"Out" | "Doubtful" | "Questionable", string> = {
  Out: "O", Doubtful: "D", Questionable: "Q",
};

/** Injury-status badge (docs/MATCHUPS_INJURIES.md) — a health flag, not a
 *  quality signal, so it deliberately reuses the "attention" red tint
 *  (pct-lo-*) already used for game-character tags (gameTagStyle), not the
 *  teal/coral quality-tier palette RankPill/percentiles use. Severity by
 *  saturation: Out darkest, Questionable lightest. */
export function InjuryBadge({ status }: { status: "Out" | "Doubtful" | "Questionable" }) {
  const style =
    status === "Out"
      ? { background: "var(--pct-lo-3)", color: "var(--foreground)" }
      : status === "Doubtful"
      ? { background: "var(--pct-lo-2)", color: "var(--ink-secondary)" }
      : { background: "var(--pct-lo-1)", color: "var(--ink-secondary)" };
  return (
    <span
      className="tabular inline-flex h-[1.3em] min-w-[1.3em] items-center justify-center rounded px-1 text-[10px] font-semibold leading-none"
      style={style}
      title={status}
    >
      {INJURY_ABBR[status]}
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
