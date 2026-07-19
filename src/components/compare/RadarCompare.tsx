"use client";

import { useMemo, useState } from "react";
import type { SeasonRow } from "@/lib/types";
import { columnFor } from "@/lib/stats";
import { formatPercentile } from "@/lib/percentile";
import { RADAR_KEYS, lastName, regRows, type Side } from "./common";

const SIZE = 340;
const CX = SIZE / 2;
const CY = SIZE / 2;
const R = 118;

function polar(angle: number, r: number): [number, number] {
  return [CX + r * Math.cos(angle - Math.PI / 2), CY + r * Math.sin(angle - Math.PI / 2)];
}

function qualifiedSeasons(rows: SeasonRow[]): SeasonRow[] {
  return rows.filter((r) => Object.keys(r.percentiles ?? {}).length > 0);
}

export default function RadarCompare({ a, b }: { a: Side; b: Side }) {
  const aQual = qualifiedSeasons(regRows(a.doc));
  const bQual = qualifiedSeasons(regRows(b.doc));
  const [aSeason, setASeason] = useState(aQual.at(-1)?.season);
  const [bSeason, setBSeason] = useState(bQual.at(-1)?.season);
  const [hover, setHover] = useState<string | null>(null);

  const rowA = aQual.find((r) => r.season === aSeason);
  const rowB = bQual.find((r) => r.season === bSeason);

  const sameGroup = a.group === b.group && a.group !== "OTHER";
  const axes = useMemo(() => {
    if (!rowA || !rowB) return [];
    if (sameGroup) {
      return (RADAR_KEYS[a.group] ?? []).filter(
        (k) => rowA.percentiles[k] !== undefined || rowB.percentiles[k] !== undefined);
    }
    // cross-group: only stats BOTH players have percentiles for (each vs their
    // own position's baseline — percentile space is the shared scale)
    return Object.keys(rowA.percentiles).filter((k) => rowB.percentiles[k] !== undefined);
  }, [rowA, rowB, sameGroup, a.group]);

  if (aQual.length === 0 || bQual.length === 0) {
    const missing = [aQual.length === 0 && a.doc.profile.name, bQual.length === 0 && b.doc.profile.name]
      .filter(Boolean).join(" and ");
    return (
      <section>
        <h2 className="mb-1 text-lg font-semibold">Percentile radar</h2>
        <p className="text-sm text-ink-muted">
          No radar: {missing} has no season meeting the position qualifier, so there
          are no percentiles to plot.
        </p>
      </section>
    );
  }
  if (!rowA || !rowB) return null;

  if (axes.length < 3) {
    return (
      <section>
        <h2 className="mb-1 text-lg font-semibold">Percentile radar</h2>
        <p className="text-sm text-ink-muted">
          Fewer than three shared percentile stats between a {a.group} and a {b.group} —
          not enough axes for a meaningful shape. See the side-by-side table for the
          stats that do compare.
        </p>
      </section>
    );
  }

  const step = (2 * Math.PI) / axes.length;
  const ringAt = (pct: number) => (pct / 100) * R;

  const poly = (row: SeasonRow) =>
    axes.map((k, i) => {
      const pct = row.percentiles[k] ?? 0;
      return polar(i * step, ringAt(pct)).join(",");
    }).join(" ");

  const seasonPicker = (side: Side, qual: SeasonRow[], value: number | undefined,
    set: (n: number) => void) => (
    <label className="flex items-center gap-1.5 text-sm">
      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: side.color }} />
      <span className="max-w-36 truncate">{lastName(side.doc.profile.name)}</span>
      <select
        value={value}
        onChange={(e) => set(Number(e.target.value))}
        className="rounded border border-hairline bg-surface px-1.5 py-0.5 text-sm"
        aria-label={`${side.doc.profile.name} radar season`}
      >
        {qual.map((r) => <option key={r.season} value={r.season}>{r.season}</option>)}
      </select>
    </label>
  );

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center gap-4">
        <h2 className="text-lg font-semibold">Percentile radar</h2>
        {seasonPicker(a, aQual, aSeason, setASeason)}
        {seasonPicker(b, bQual, bSeason, setBSeason)}
      </div>
      <div className="flex flex-wrap items-start gap-6">
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="max-w-full" width={SIZE} height={SIZE} role="img"
          aria-label="Percentile radar comparing the two players">
          {[25, 50, 75, 95].map((pct) => (
            <polygon
              key={pct}
              points={axes.map((_, i) => polar(i * step, ringAt(pct)).join(",")).join(" ")}
              fill="none"
              stroke="var(--hairline)"
              strokeWidth={pct === 50 ? 1.5 : 1}
            />
          ))}
          {axes.map((k, i) => {
            const [x2, y2] = polar(i * step, R);
            const [lx, ly] = polar(i * step, R + 18);
            return (
              <g key={k}>
                <line x1={CX} y1={CY} x2={x2} y2={y2} stroke="var(--hairline)" strokeWidth={1} />
                <text
                  x={lx} y={ly} textAnchor="middle" dominantBaseline="middle"
                  className="cursor-default"
                  fontSize={11}
                  fill={hover === k ? "var(--foreground)" : "var(--ink-muted)"}
                  onMouseEnter={() => setHover(k)}
                  onMouseLeave={() => setHover(null)}
                >
                  <title>{columnFor(k).title ?? columnFor(k).label}</title>
                  {columnFor(k).label}
                </text>
              </g>
            );
          })}
          {[{ row: rowA, side: a }, { row: rowB, side: b }].map(({ row, side }) => (
            <g key={side.doc.id}>
              <polygon points={poly(row)} fill={side.color} fillOpacity={0.14} stroke={side.color} strokeWidth={2} strokeLinejoin="round" />
              {axes.map((k, i) => {
                const pct = row.percentiles[k];
                if (pct === undefined) return null;
                const [x, y] = polar(i * step, ringAt(pct));
                return (
                  <circle key={k} cx={x} cy={y} r={hover === k ? 5 : 3.5} fill={side.color}
                    onMouseEnter={() => setHover(k)} onMouseLeave={() => setHover(null)}>
                    <title>{`${side.doc.profile.name} ${row.season} — ${columnFor(k).label}: ${formatPercentile(pct)} percentile`}</title>
                  </circle>
                );
              })}
            </g>
          ))}
        </svg>
        <div className="text-sm">
          <ul className="space-y-1">
            {[{ row: rowA, side: a }, { row: rowB, side: b }].map(({ row, side }) => (
              <li key={side.doc.id} className="flex items-center gap-2">
                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: side.color }} />
                {side.doc.profile.name} {row.season} ({side.group})
              </li>
            ))}
          </ul>
          {hover && (
            <p className="tabular mt-3 text-sm">
              {columnFor(hover).label}: {rowA.percentiles[hover] !== undefined ? formatPercentile(rowA.percentiles[hover]) : "–"}
              {" vs "}
              {rowB.percentiles[hover] !== undefined ? formatPercentile(rowB.percentiles[hover]) : "–"}
            </p>
          )}
          <p className="mt-3 max-w-56 text-xs text-ink-muted">
            Each vertex is that player&apos;s percentile vs their own position&apos;s
            qualified players in the selected season — never a merged pool. Rings at
            25 / 50 / 75 / 95.
          </p>
        </div>
      </div>
    </section>
  );
}
