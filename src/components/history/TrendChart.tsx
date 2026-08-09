"use client";

import { useId, useState } from "react";
import type { TrendMetric } from "@/lib/types";

// Same hand-rolled SVG approach as the Phase 2 career arcs (ArcCompare): a
// fixed viewBox scaled by CSS, explicit margins, scales as plain functions.
// No chart library.
const W = 560, H = 210, ML = 50, MR = 16, MT = 14, MB = 30;
const IW = W - ML - MR, IH = H - MT - MB;

export function formatTrend(v: number, unit: TrendMetric["unit"]): string {
  switch (unit) {
    case "pct": return `${(v * 100).toFixed(1)}%`;
    case "epa": return (v > 0 ? "+" : "") + v.toFixed(3);
    case "yards": return `${v.toFixed(1)} yds`;
    case "points": return v.toFixed(1);
    case "sec": return `${v.toFixed(1)}s`;
    default: return v.toFixed(1);
  }
}

/**
 * Ticks on a round step covering the domain. Without this, a 60.1–62.1% band
 * split into four even ticks rounds to "62%, 62%, 61%, 60%" — two identical
 * labels on one axis, which is worse than no axis at all.
 * Values are in DISPLAY units (percent for `pct`), so callers divide back out.
 */
function niceTicks(min: number, max: number, count = 5): { values: number[]; decimals: number } {
  const raw = (max - min || Math.abs(max) || 1) / (count - 1);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  // Round the step to the NEAREST nice value, not up — rounding up can double
  // the step and leave a chart with a single lonely gridline.
  const step = (norm >= 7 ? 10 : norm >= 3 ? 5 : norm >= 1.5 ? 2 : 1) * mag;
  const values: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-6; v += step) {
    values.push(Number(v.toFixed(10)));
  }
  return { values, decimals: Math.max(0, -Math.floor(Math.log10(step) + 1e-9)) };
}

export default function TrendChart({ metric }: { metric: TrendMetric }) {
  const [hover, setHover] = useState<number | null>(null);
  const titleId = useId();

  const pts = metric.series.filter((p) => p.value !== null) as { season: number; value: number }[];
  const seasons = metric.series.map((p) => p.season);
  const n = seasons.length;

  if (pts.length < 2) {
    return (
      <figure className="rounded-lg border border-hairline bg-surface p-3">
        <figcaption className="text-sm font-medium">{metric.label}</figcaption>
        <p className="mt-2 text-sm text-ink-muted">Not enough data to plot.</p>
      </figure>
    );
  }

  const vals = pts.map((p) => p.value);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  // Time series get a data-driven range, not a forced zero baseline — a 58-61%
  // completion band flattens to nothing against zero. The axis is labelled, and
  // the table view underneath carries the exact numbers.
  const pad = (hi - lo || Math.abs(hi) || 1) * 0.18;
  const yMin = metric.unit === "pct" ? Math.max(0, lo - pad) : lo - pad;
  const yMax = metric.unit === "pct" ? Math.min(1, hi + pad) : hi + pad;

  const sx = (i: number) => ML + (n === 1 ? IW / 2 : (i / (n - 1)) * IW);
  const sy = (v: number) => MT + IH - ((v - yMin) / (yMax - yMin || 1)) * IH;
  const idx = (season: number) => seasons.indexOf(season);

  // Ticks are computed in display units (percent for `pct`) so the rounding is
  // done on the numbers the reader actually sees.
  const dScale = metric.unit === "pct" ? 100 : 1;
  const ticks = niceTicks(yMin * dScale, yMax * dScale);
  const tickSuffix = metric.unit === "pct" ? "%" : "";

  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"}${sx(idx(p.season))},${sy(p.value)}`).join(" ");
  const first = pts[0], last = pts[pts.length - 1];
  const hovered = hover === null ? null : metric.series.find((p) => p.season === hover) ?? null;
  const flagged = metric.flags.length > 0;

  return (
    <figure className="rounded-lg border border-hairline bg-surface p-3">
      <figcaption id={titleId} className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{metric.label}</span>
        <span className="tabular text-xs text-ink-muted">
          {formatTrend(first.value, metric.unit)} → {formatTrend(last.value, metric.unit)}
          {flagged && <span title={metric.flags.join("; ")}> *</span>}
        </span>
      </figcaption>

      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-labelledby={titleId}
          onMouseLeave={() => setHover(null)}>
          {/* recessive solid hairline grid — never dashed */}
          {ticks.values.map((t) => (
            <g key={t}>
              <line x1={ML} x2={W - MR} y1={sy(t / dScale)} y2={sy(t / dScale)}
                stroke="var(--hairline)" strokeWidth={1} />
              <text x={ML - 6} y={sy(t / dScale)} textAnchor="end" dominantBaseline="middle"
                fontSize={10} fill="var(--ink-muted)" className="tabular">
                {t.toFixed(ticks.decimals)}{tickSuffix}
              </text>
            </g>
          ))}

          {/* full-height hit columns: the target is the season band, not the 8px dot */}
          {seasons.map((s, i) => (
            <g key={s}>
              <rect x={sx(i) - IW / (n * 2)} y={MT} width={IW / n} height={IH}
                fill="transparent" onMouseEnter={() => setHover(s)} />
              {(i === 0 || i === n - 1 || i % 2 === 0) && (
                <text x={sx(i)} y={H - MB + 15} textAnchor="middle" fontSize={10}
                  fill="var(--ink-muted)" className="tabular">
                  {`’${String(s).slice(2)}`}
                </text>
              )}
            </g>
          ))}

          {hover !== null && (
            <line x1={sx(idx(hover))} x2={sx(idx(hover))} y1={MT} y2={MT + IH}
              stroke="var(--ink-muted)" strokeWidth={1} strokeDasharray="3 3" />
          )}

          <path d={path} fill="none" stroke="var(--series-1)" strokeWidth={2}
            strokeLinejoin="round" strokeLinecap="round" />

          {pts.map((p) => (
            <circle key={p.season} cx={sx(idx(p.season))} cy={sy(p.value)}
              r={hover === p.season ? 5 : 4} fill="var(--series-1)"
              stroke="var(--surface)" strokeWidth={2}>
              <title>{`${p.season}: ${formatTrend(p.value, metric.unit)}`}</title>
            </circle>
          ))}

          {/* No in-plot value labels: the endpoints are direct-labelled in the
              caption above ("62.1% → 60.2%"), where they can't collide with the
              line, and the axis, hover and table carry every other value. */}
        </svg>

        {hovered && (
          <div className="pointer-events-none absolute top-0 rounded border border-hairline bg-surface px-2 py-1 text-xs shadow-sm"
            style={{ left: `${Math.min(78, Math.max(2, ((idx(hovered.season) + 0.5) / n) * 100))}%` }}>
            <span className="tabular">
              {hovered.season}: {hovered.value === null ? "n/a" : formatTrend(hovered.value, metric.unit)}
            </span>
          </div>
        )}
      </div>

      <p className="mt-1 text-xs text-ink-muted">{metric.about}</p>
      {flagged && (
        <p className="mt-1 text-xs text-ink-secondary">
          * {metric.flags.join("; ")}.
        </p>
      )}

      {/* Tooltips enhance, never gate — every value is readable without hover. */}
      <details className="mt-1">
        <summary className="cursor-pointer text-xs text-ink-muted">Data table</summary>
        <div className="mt-1 overflow-x-auto">
          <table className="text-xs">
            <caption className="sr-only">{metric.label} by season</caption>
            <thead>
              <tr className="text-ink-muted">
                {metric.series.map((p) => (
                  <th key={p.season} scope="col" className="tabular px-1.5 py-0.5 font-medium">{p.season}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {metric.series.map((p) => (
                  <td key={p.season} className="tabular px-1.5 py-0.5">
                    {p.value === null ? "n/a" : formatTrend(p.value, metric.unit)}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
