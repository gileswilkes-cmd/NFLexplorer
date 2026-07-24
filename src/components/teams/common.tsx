import type { DDCell, EffBlock, TeamSeason } from "@/lib/types";
import type { HeatCell } from "./Heatmap";

export const fmtEpa = (v: number) => (v > 0 ? "+" : "") + v.toFixed(2);
export const fmtPct = (v: number) => `${Math.round(v * 100)}%`;

export type HeatMetric = "epa" | "success";

/** League-typical success rate, the neutral color point for success heatmaps. */
export const SUCCESS_CENTER = 0.45;

export function buildHeatCells(grid: Record<string, DDCell>, allowed: boolean,
  metric: HeatMetric): Record<string, HeatCell> {
  const epaKey = allowed ? "epa_per_play_allowed" : "epa_per_play";
  const sucKey = allowed ? "success_rate_allowed" : "success_rate";
  const out: Record<string, HeatCell> = {};
  for (const [k, cell] of Object.entries(grid)) {
    const epa = cell[epaKey as keyof EffBlock] as number | undefined;
    const suc = cell[sucKey as keyof EffBlock] as number | undefined;
    const v = metric === "epa" ? epa : suc;
    out[k] = {
      value: v === undefined ? null : v,
      plays: cell.plays,
      title: cell.plays === 0 ? "no plays" :
        `EPA/play ${epa !== undefined ? fmtEpa(epa) : "–"} · success ${suc !== undefined ? fmtPct(suc) : "–"} · ${cell.plays} plays`,
    };
  }
  return out;
}

/** Tendency wording for style axes — never bare "Nth percentile". */
export function tendencyLabel(axis: string, pct: number): string {
  const n = Math.round(pct);
  switch (axis) {
    case "proe": return `more pass-heavy than ${n}% of teams`;
    case "early_down_pass_rate": return `passes on early downs more than ${n}% of teams`;
    case "neutral_pace_sec": return `slower between snaps than ${n}% of teams`;
    case "shotgun_rate": return `in shotgun more than ${n}% of teams`;
    case "adot": return `throws deeper than ${n}% of teams`;
    default: return `${n}%`;
  }
}

/** Single-hue tendency bar — deliberately NOT the quality palette. */
export function StyleBar({ pct }: { pct: number }) {
  return (
    <span className="inline-block h-2 w-28 rounded-full align-middle" style={{ background: "var(--style-track)" }}>
      <span className="block h-2 rounded-full" style={{ width: `${pct}%`, background: "var(--style-bar)" }} />
    </span>
  );
}

export function seasonOf(doc: { seasons: TeamSeason[] }, year: number | null): TeamSeason {
  return doc.seasons.find((s) => s.season === year) ?? doc.seasons[doc.seasons.length - 1];
}

export function recordText(r: { w: number; l: number; t: number } | null): string {
  if (!r) return "";
  return r.t ? `${r.w}–${r.l}–${r.t}` : `${r.w}–${r.l}`;
}
