"use client";

// Down×distance heatmap — the team-page hero.
// Small-sample rules (mandatory per PHASE3B_TEAMS_SPEC):
//  - cells below FULL_SAMPLE plays are desaturated toward the surface
//  - every cell shows its play count
//  - zero-play / no-value cells render visibly empty, never as "average"

export interface HeatCell {
  value: number | null; // null = no data
  plays: number;
  title: string;
}

const DOWNS = ["1", "2", "3", "4"] as const;
const BUCKETS = ["short", "medium", "long"] as const;
const BUCKET_LABELS: Record<string, string> = { short: "short (≤3)", medium: "medium (4–6)", long: "long (7+)" };
const FULL_SAMPLE = 20;

// diverging tint ladder (shared with percentile badges)
const TIER_VARS = ["--pct-lo-3", "--pct-lo-2", "--pct-lo-1", "--pct-mid", "--pct-hi-1", "--pct-hi-2", "--pct-hi-3"];

function cellStyle(value: number, plays: number, domain: number, center: number,
  higherIsBetter: boolean): React.CSSProperties {
  let t = Math.max(-1, Math.min(1, (value - center) / domain));
  if (!higherIsBetter) t = -t;
  const tier = Math.round(t * 3) + 3; // 0..6
  const strength = Math.round(Math.min(1, plays / FULL_SAMPLE) * 100);
  return {
    background: `color-mix(in srgb, var(${TIER_VARS[tier]}) ${strength}%, var(--surface))`,
  };
}

export default function Heatmap({ cells, domain, center = 0, higherIsBetter, format, caption }: {
  cells: Record<string, HeatCell>;   // keys "{down}_{bucket}"
  domain: number;                    // |value - center| mapped to full tint
  center?: number;                   // neutral point (0 for EPA, ~league success rate)
  higherIsBetter: boolean;           // false for defense-allowed views
  format: (v: number) => string;
  caption: string;
}) {
  return (
    <figure className="min-w-0">
      <div className="overflow-x-auto">
        <table className="border-separate text-center" style={{ borderSpacing: 2 }}>
          <thead>
            <tr>
              <th className="pr-1 text-left text-xs font-medium text-ink-muted">Down</th>
              {BUCKETS.map((b) => (
                <th key={b} className="px-1 pb-1 text-xs font-medium text-ink-muted">{BUCKET_LABELS[b]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DOWNS.map((d) => (
              <tr key={d}>
                <th className="pr-2 text-left text-xs font-medium text-ink-muted">{d}</th>
                {BUCKETS.map((b) => {
                  const cell = cells[`${d}_${b}`];
                  const empty = !cell || cell.value === null || cell.plays === 0;
                  if (empty) {
                    return (
                      <td key={b} title={cell?.title ?? "no plays"}
                        className="h-14 w-24 rounded border border-dashed border-hairline text-xs text-ink-muted">
                        —
                      </td>
                    );
                  }
                  return (
                    <td key={b} title={cell.title}
                      className="h-14 w-24 rounded"
                      style={cellStyle(cell.value!, cell.plays, domain, center, higherIsBetter)}>
                      <div className="tabular text-sm font-medium leading-tight">{format(cell.value!)}</div>
                      <div className="tabular text-[10px] leading-tight text-ink-secondary">{cell.plays} plays</div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <figcaption className="mt-1 text-xs text-ink-muted">{caption}</figcaption>
    </figure>
  );
}
