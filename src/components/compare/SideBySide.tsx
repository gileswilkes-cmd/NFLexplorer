"use client";

import { useState } from "react";
import type { CareerBlock, SeasonRow } from "@/lib/types";
import { SEASON_COLUMNS, columnFor, flatten, formatValue, ngsIsNull, type Column } from "@/lib/stats";
import { NEGATIVE_STATS } from "@/lib/percentile";
import PctBadge from "@/components/PctBadge";
import { SHARED_KEYS, regRows, type Side } from "./common";

function cellValue(col: Column, source: Record<string, number>, row: SeasonRow | CareerBlock): {
  text: string; value: number | null;
} {
  if (col.derive) {
    const v = col.derive(source);
    return { text: v === null ? "–" : formatValue(col, v), value: v };
  }
  if (col.ngs && ngsIsNull(row)) return { text: "n/a", value: null };
  const v = source[col.key];
  if (v === undefined) return { text: "–", value: null };
  return { text: formatValue(col, v), value: v };
}

export default function SideBySide({ a, b }: { a: Side; b: Side }) {
  const sameGroup = a.group === b.group && a.group !== "OTHER";
  const cols: Column[] = sameGroup
    ? SEASON_COLUMNS[a.group]
    : SHARED_KEYS.map(columnFor);

  const aRows = regRows(a.doc);
  const bRows = regRows(b.doc);
  const maxSeasons = Math.max(aRows.length, bRows.length);
  const [scope, setScope] = useState<number>(-1); // -1 = career, else season index

  const pick = (rows: SeasonRow[], career: CareerBlock | undefined) =>
    scope === -1 ? career : rows[scope];
  const rowA = pick(aRows, a.doc.career);
  const rowB = pick(bRows, b.doc.career);

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold">Side by side</h2>
        <select
          value={scope}
          onChange={(e) => setScope(Number(e.target.value))}
          aria-label="Comparison scope"
          className="rounded border border-hairline bg-surface px-2 py-1 text-sm"
        >
          <option value={-1}>Career (regular season)</option>
          {Array.from({ length: maxSeasons }, (_, i) => (
            <option key={i} value={i}>
              Season {i + 1}
              {" — "}
              {aRows[i]?.season ?? "—"} vs {bRows[i]?.season ?? "—"}
            </option>
          ))}
        </select>
      </div>
      {!sameGroup && (
        <p className="mb-2 text-xs text-ink-muted">
          Different position groups ({a.group} vs {b.group}) — only shared stats are
          compared; position-specific stats are not comparable and are omitted.
        </p>
      )}
      <div className="overflow-x-auto rounded-lg border border-hairline bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-hairline text-ink-muted">
              <th className="px-3 py-1.5 text-left font-medium">Stat</th>
              {[a, b].map((s, i) => {
                const row = i === 0 ? rowA : rowB;
                return (
                  <th key={s.doc.id} className="px-3 py-1.5 text-right font-medium">
                    <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: s.color }} />
                    {s.doc.profile.name}
                    {scope !== -1 && (
                      <span className="tabular ml-1 text-xs">
                        {row && "season" in row ? `(${(row as SeasonRow).season})` : "(–)"}
                      </span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            <tr>
              <td className="px-3 py-1.5 text-ink-secondary">Games</td>
              {[rowA, rowB].map((row, i) => (
                <td key={i} className="tabular px-3 py-1.5 text-right">{row?.games ?? "–"}</td>
              ))}
            </tr>
            {cols.filter((c) => c.key !== "games").map((col) => {
              const srcA = rowA ? flatten(rowA) : {};
              const srcB = rowB ? flatten(rowB) : {};
              const va = rowA ? cellValue(col, srcA, rowA) : { text: "–", value: null };
              const vb = rowB ? cellValue(col, srcB, rowB) : { text: "–", value: null };
              let better: 0 | 1 | -1 = 0; // 1 = A, -1 = B
              if (va.value !== null && vb.value !== null && va.value !== vb.value) {
                const higherIsBetter = !NEGATIVE_STATS.has(col.key);
                better = (va.value > vb.value) === higherIsBetter ? 1 : -1;
              }
              return (
                <tr key={col.key}>
                  <td className="px-3 py-1.5 text-ink-secondary" title={col.title}>{col.label}</td>
                  {[{ v: va, row: rowA, side: 1 }, { v: vb, row: rowB, side: -1 }].map(({ v, row, side }, i) => (
                    <td key={i} className={`tabular px-3 py-1.5 text-right ${better === side ? "font-semibold" : ""}`}>
                      {v.text}
                      {row && "season" in row && (row as SeasonRow).percentiles?.[col.key] !== undefined && (
                        <PctBadge
                          pct={(row as SeasonRow).percentiles[col.key]}
                          label={`vs qualifying ${i === 0 ? a.group : b.group}s, ${(row as SeasonRow).season}`}
                        />
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {scope !== -1 && (
        <p className="mt-1 text-xs text-ink-muted">
          Seasons are aligned by career season number, so different calendar years
          compare at the same career stage. Badges are each player&apos;s percentile vs
          their own position and season.
        </p>
      )}
    </section>
  );
}
