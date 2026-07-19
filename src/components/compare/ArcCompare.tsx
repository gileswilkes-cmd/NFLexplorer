"use client";

import { useEffect, useMemo, useState } from "react";
import { columnFor, flatten } from "@/lib/stats";
import { getSeasonFile, livePercentile, type SeasonFile } from "@/lib/baselines";
import { formatPercentile } from "@/lib/percentile";
import { ARC_KEYS, lastName, regRows, type Side } from "./common";

const W = 720, H = 300, ML = 48, MR = 118, MT = 16, MB = 34;
const IW = W - ML - MR, IH = H - MT - MB;

interface Pt { x: number; year: number; raw: number | null; era: number | null }

export default function ArcCompare({ a, b }: { a: Side; b: Side }) {
  const [era, setEra] = useState(false);
  const [files, setFiles] = useState<Map<number, SeasonFile | null> | null>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);

  const aRows = regRows(a.doc);
  const bRows = regRows(b.doc);

  const metrics = useMemo(() => {
    const has = (side: Side, k: string) =>
      regRows(side.doc).some((r) => flatten(r)[k] !== undefined);
    const candidates = [...new Set([...(ARC_KEYS[a.group] ?? []), ...(ARC_KEYS[b.group] ?? [])])];
    return candidates.filter((k) => has(a, k) && has(b, k));
  }, [a, b]);
  const [metric, setMetric] = useState<string>("");
  const activeMetric = metrics.includes(metric) ? metric : (metrics.includes("epa_per_play") ? "epa_per_play" : metrics[0]);

  const years = useMemo(
    () => [...new Set([...aRows, ...bRows].map((r) => r.season))],
    [aRows, bRows]);

  useEffect(() => {
    if (!era || files) return;
    Promise.all(years.map((y) => getSeasonFile(y).then((f) => [y, f] as const)))
      .then((entries) => setFiles(new Map(entries)));
  }, [era, files, years]);

  if (metrics.length === 0) {
    return (
      <section>
        <h2 className="mb-1 text-lg font-semibold">Career arc</h2>
        <p className="text-sm text-ink-muted">No shared metric exists for these two positions.</p>
      </section>
    );
  }

  const series = [{ side: a, rows: aRows }, { side: b, rows: bRows }].map(({ side, rows }) => ({
    side,
    pts: rows.map((r, i): Pt => {
      const flat = flatten(r);
      const raw = flat[activeMetric] ?? null;
      const eraV = files ? livePercentile(files.get(r.season) ?? null, side.group, activeMetric, flat) : null;
      return { x: i + 1, year: r.season, raw, era: eraV };
    }),
  }));

  const val = (p: Pt) => (era ? p.era : p.raw);
  const maxN = Math.max(aRows.length, bRows.length, 1);
  const allVals = series.flatMap((s) => s.pts.map(val).filter((v): v is number => v !== null));
  const loading = era && !files;
  const yMin = era ? 0 : Math.min(0, ...allVals);
  const yMax = era ? 100 : (allVals.length ? Math.max(...allVals) : 1) * 1.08 || 1;
  const sx = (x: number) => ML + (maxN === 1 ? IW / 2 : ((x - 1) / (maxN - 1)) * IW);
  const sy = (v: number) => MT + IH - ((v - yMin) / (yMax - yMin || 1)) * IH;

  const col = columnFor(activeMetric);
  const fmtVal = (v: number) => (era ? formatPercentile(v) : (col.fmt ? col.fmt(v) : String(Math.round(v * 100) / 100)));
  const yTicks = era ? [0, 25, 50, 75, 100]
    : Array.from({ length: 5 }, (_, i) => yMin + ((yMax - yMin) / 4) * i);

  const oneSeason = series.filter((s) => s.pts.length === 1);

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center gap-4">
        <h2 className="text-lg font-semibold">Career arc</h2>
        <select
          value={activeMetric}
          onChange={(e) => setMetric(e.target.value)}
          aria-label="Arc metric"
          className="rounded border border-hairline bg-surface px-2 py-1 text-sm"
        >
          {metrics.map((k) => <option key={k} value={k}>{columnFor(k).label}{columnFor(k).title ? ` — ${columnFor(k).title}` : ""}</option>)}
        </select>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" checked={era} onChange={(e) => setEra(e.target.checked)} />
          Era-adjusted (percentile vs that season&apos;s baseline)
        </label>
      </div>
      <div className="relative overflow-x-auto rounded-lg border border-hairline bg-surface p-2">
        <svg viewBox={`0 0 ${W} ${H}`} className="min-w-[560px] w-full" role="img"
          aria-label={`Career arc of ${col.label} for both players`}
          onMouseLeave={() => setHoverX(null)}>
          {yTicks.map((t) => (
            <g key={t}>
              <line x1={ML} x2={W - MR} y1={sy(t)} y2={sy(t)}
                stroke="var(--hairline)" strokeWidth={era && t === 50 ? 1.5 : 1} />
              <text x={ML - 6} y={sy(t)} textAnchor="end" dominantBaseline="middle" fontSize={10} fill="var(--ink-muted)">
                {era ? t : fmtVal(t)}
              </text>
            </g>
          ))}
          {!era && yMin < 0 && (
            <line x1={ML} x2={W - MR} y1={sy(0)} y2={sy(0)} stroke="var(--ink-muted)" strokeWidth={1} />
          )}
          {Array.from({ length: maxN }, (_, i) => (
            <g key={i}>
              <rect x={sx(i + 1) - IW / (maxN * 2)} y={MT} width={IW / maxN} height={IH}
                fill="transparent" onMouseEnter={() => setHoverX(i + 1)} />
              <text x={sx(i + 1)} y={H - MB + 16} textAnchor="middle" fontSize={10} fill="var(--ink-muted)">
                S{i + 1}
              </text>
            </g>
          ))}
          {hoverX !== null && (
            <line x1={sx(hoverX)} x2={sx(hoverX)} y1={MT} y2={MT + IH} stroke="var(--ink-muted)" strokeWidth={1} strokeDasharray="3 3" />
          )}
          {!loading && series.map(({ side, pts }) => {
            const visible = pts.filter((p) => val(p) !== null);
            const path = visible.map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.x)},${sy(val(p)!)}`).join(" ");
            const last = visible.at(-1);
            return (
              <g key={side.doc.id}>
                {visible.length > 1 && (
                  <path d={path} fill="none" stroke={side.color} strokeWidth={2} strokeLinejoin="round" />
                )}
                {visible.map((p) => (
                  <circle key={p.x} cx={sx(p.x)} cy={sy(val(p)!)} r={hoverX === p.x ? 5 : 3.5} fill={side.color}>
                    <title>{`${side.doc.profile.name} ${p.year} (S${p.x}) — ${col.label}: ${fmtVal(val(p)!)}`}</title>
                  </circle>
                ))}
                {last && (
                  <text x={sx(last.x) + 8} y={sy(val(last)!)} dominantBaseline="middle" fontSize={11} fill={side.color}>
                    {lastName(side.doc.profile.name)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        {loading && <p className="absolute inset-0 flex items-center justify-center text-sm text-ink-muted">Loading season baselines…</p>}
        {hoverX !== null && !loading && (
          <div className="pointer-events-none absolute top-2 rounded border border-hairline bg-surface px-2 py-1 text-xs shadow-sm"
            style={{ left: `${Math.min(82, Math.max(2, ((hoverX - 0.5) / maxN) * 100))}%` }}>
            <div className="mb-0.5 font-medium">Season {hoverX}</div>
            {series.map(({ side, pts }) => {
              const p = pts.find((q) => q.x === hoverX);
              const v = p ? val(p) : null;
              return (
                <div key={side.doc.id} className="tabular flex items-center gap-1.5">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ background: side.color }} />
                  {p ? `${p.year}: ${v !== null ? fmtVal(v) : era ? "below qualifier" : "–"}` : "—"}
                </div>
              );
            })}
          </div>
        )}
      </div>
      <p className="mt-1 text-xs text-ink-muted">
        X-axis is career season number, so different eras align.
        {era && " Era mode: each season scored against that season's own position baseline; seasons below the qualifier show as gaps."}
        {oneSeason.length > 0 &&
          ` ${oneSeason.map((s) => s.side.doc.profile.name).join(" and ")} has only one season — a point, not an arc.`}
      </p>
    </section>
  );
}
