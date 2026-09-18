"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  TEAM_COLUMNS, TEAM_GROUP_LABELS, formatBoardValue, isStyleColumn,
  teamTableRows, teamTableToDelimited,
  type TeamColumnDef, type TeamColumnGroup, type TeamRowCell,
} from "@/lib/leaderboards";
import type { Board } from "@/lib/types";

// Same 7-step diverging tint ladder as src/components/teams/Heatmap.tsx
// (blue = above the column's own mid, red = below) — duplicated rather than
// imported since that component's props (down/distance cells, a fixed
// domain/center) don't fit a per-column min/max table; kept in sync manually.
const TIER_VARS = ["--pct-lo-3", "--pct-lo-2", "--pct-lo-1", "--pct-mid", "--pct-hi-1", "--pct-hi-2", "--pct-hi-3"];

function tierFor(value: number, min: number, max: number, higherIsBetter: boolean): number {
  const mid = (min + max) / 2;
  const domain = (max - min) / 2 || 1;
  let t = Math.max(-1, Math.min(1, (value - mid) / domain));
  if (!higherIsBetter) t = -t;
  return Math.round(t * 3) + 3; // 0..6 index into TIER_VARS
}

type SortTag = string; // a TEAM_COLUMNS tag, or the literal "games"

function defaultDirFor(tag: SortTag): "asc" | "desc" {
  // Every real column's `rank` is already oriented so 1 = best (docs/DATA_SCHEMA.md
  // _rank_entries) — ascending rank IS "that stat's better-direction" for every
  // column, quality or style, with zero per-column direction logic needed here.
  // Games has no rank (it isn't a ranked board); default to most-played first.
  return tag === "games" ? "desc" : "asc";
}

function SortIndicator({ active, dir }: { active: boolean; dir: "asc" | "desc" }) {
  if (!active) return null;
  return <span className="ml-1 text-ink-muted">{dir === "asc" ? "▲" : "▼"}</span>;
}

function groupBoundary(columns: TeamColumnDef[], i: number): boolean {
  return i === 0 || columns[i - 1].group !== columns[i].group;
}

function TeamCell({ col, cell, board, showRank, boundary }: {
  col: TeamColumnDef; cell: (TeamRowCell & { tint?: string }) | undefined; board: Board;
  showRank: boolean; boundary: boolean;
}) {
  const borderCls = boundary ? "border-l border-hairline" : "";
  if (!cell) {
    return <td className={`tabular px-2 py-1.5 text-right text-ink-muted ${borderCls}`}>—</td>;
  }
  const style = isStyleColumn(col.tag, board.style);
  const display = showRank ? `#${cell.rank}` : formatBoardValue(col.tag, board, cell.value);
  const polarity = style ? "style, not ranked for quality" : board.direction === "asc" ? "lower is better" : "higher is better";
  const title = `${board.label}: ${formatBoardValue(col.tag, board, cell.value)} · rank ${cell.rank} of 32 (${cell.games} games) · ${polarity}`;
  return (
    <td
      className={`tabular px-2 py-1.5 text-right ${borderCls}`}
      style={cell.tint ? { background: cell.tint } : undefined}
      title={title}
    >
      {display}
    </td>
  );
}

export default function TeamsWideTable({ teamBoards, season }: {
  teamBoards: Record<string, Board>; season: number;
}) {
  const [sortTag, setSortTag] = useState<SortTag | null>(null); // null = alphabetical by team
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [shading, setShading] = useState(true);
  const [showRank, setShowRank] = useState(false);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  const rows = useMemo(() => teamTableRows(teamBoards), [teamBoards]);

  const columnRanges = useMemo(() => {
    const ranges: Record<string, { min: number; max: number }> = {};
    for (const col of TEAM_COLUMNS) {
      const vals = rows.map((r) => r.cells[col.tag]?.value).filter((v): v is number => v !== undefined);
      if (vals.length >= 2) ranges[col.tag] = { min: Math.min(...vals), max: Math.max(...vals) };
    }
    return ranges;
  }, [rows]);

  const maxGames = rows.length ? Math.max(...rows.map((r) => r.games)) : 0;
  const minGames = rows.length ? Math.min(...rows.map((r) => r.games)) : 0;
  // 16 is the shortest a COMPLETE season has ever been in this window (17
  // seasons onward from 2021) — below that, the season is still in progress.
  const isThin = maxGames > 0 && maxGames < 16;

  // Tint every cell up front (not per-render-per-cell) so sort doesn't
  // recompute color math, and so the min/max domain is always the FULL
  // column, never just the currently-sorted slice. Intensity is a FIXED
  // blend, not modulated by games played: shading a thin-sample cell
  // fainter would read as "less good" rather than "less certain" — the same
  // style-vs-quality conflation this table exists to avoid, just on the
  // sample-size axis instead of the tendency axis. The colour channel
  // carries value only; the thin-sample note above the table carries the
  // sample-size caveat.
  const SHADE_STRENGTH = 70; // % — subtle, restrained per the product's aesthetic
  const tintedRows = useMemo(() => {
    return rows.map((row) => {
      const cells: Record<string, TeamRowCell & { tint?: string }> = {};
      for (const [tag, cell] of Object.entries(row.cells)) {
        const board = teamBoards[tag];
        const range = columnRanges[tag];
        const style = isStyleColumn(tag, board?.style);
        let tint: string | undefined;
        if (shading && !style && range && board) {
          const tier = tierFor(cell.value, range.min, range.max, board.direction === "desc");
          tint = `color-mix(in srgb, var(${TIER_VARS[tier]}) ${SHADE_STRENGTH}%, var(--surface))`;
        }
        cells[tag] = { ...cell, tint };
      }
      return { ...row, cells };
    });
  }, [rows, columnRanges, shading, teamBoards]);

  const sortedRows = useMemo(() => {
    if (!sortTag) return [...tintedRows].sort((a, b) => a.name.localeCompare(b.name));
    if (sortTag === "games") {
      return [...tintedRows].sort((a, b) => (sortDir === "asc" ? a.games - b.games : b.games - a.games));
    }
    const withValue = tintedRows.filter((r) => r.cells[sortTag] !== undefined);
    const withoutValue = tintedRows.filter((r) => r.cells[sortTag] === undefined);
    withValue.sort((a, b) => {
      const ra = a.cells[sortTag]!.rank, rb = b.cells[sortTag]!.rank;
      return sortDir === "asc" ? ra - rb : rb - ra;
    });
    return [...withValue, ...withoutValue];
  }, [tintedRows, sortTag, sortDir]);

  function handleSort(tag: SortTag) {
    if (sortTag === tag) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortTag(tag);
      setSortDir(defaultDirFor(tag));
    }
  }

  async function handleCopyTsv() {
    const tsv = teamTableToDelimited(sortedRows, "\t");
    try {
      await navigator.clipboard.writeText(tsv);
      setCopyStatus("Copied");
    } catch {
      setCopyStatus("Copy failed — try Download CSV");
    }
    setTimeout(() => setCopyStatus(null), 2000);
  }

  function handleDownloadCsv() {
    const csv = teamTableToDelimited(sortedRows, ",");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `teams-${season}.csv`;
    // Must be attached to the DOM for the click to reliably trigger a
    // download in every browser; removed right after, revoke on a tick so
    // the download has already started reading the blob URL.
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  if (rows.length === 0) {
    return <p className="text-ink-muted">No team data for {season}.</p>;
  }

  const groupCounts: Record<TeamColumnGroup, number> = { offence: 0, defence: 0, overall: 0, style: 0 };
  for (const col of TEAM_COLUMNS) groupCounts[col.group]++;
  const groupOrder: TeamColumnGroup[] = ["offence", "defence", "overall", "style"];

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-lg font-semibold">
          Teams <span className="text-sm font-normal text-ink-secondary">· {season}</span>
        </h2>
      </div>

      {isThin && (
        <p className="mb-2 text-xs text-ink-muted">
          {season} season-to-date — games played {minGames === maxGames ? maxGames : `${minGames}–${maxGames}`} so
          far. Small samples; values will move a lot week to week.
        </p>
      )}

      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={shading} onChange={(e) => setShading(e.target.checked)} />
          Shading
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={showRank} onChange={(e) => setShowRank(e.target.checked)} />
          Show rank
        </label>
        <button
          type="button"
          onClick={handleCopyTsv}
          className="rounded border border-hairline px-2 py-1 hover:bg-hairline/20"
        >
          Copy as TSV
        </button>
        <button
          type="button"
          onClick={handleDownloadCsv}
          className="rounded border border-hairline px-2 py-1 hover:bg-hairline/20"
        >
          Download CSV
        </button>
        {copyStatus && <span className="text-ink-muted">{copyStatus}</span>}
        <span className="text-ink-muted">
          Style columns (tendency, not quality) are never shaded — <span style={{ color: "var(--style-bar)" }}>violet</span> header.
        </span>
      </div>

      <div className="max-h-[75vh] overflow-auto rounded-lg border border-hairline bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="h-7 text-xs text-ink-muted">
              <th
                rowSpan={2}
                className="sticky top-0 left-0 z-30 w-10 border-b border-hairline bg-surface px-2 text-left font-medium"
              >
                #
              </th>
              <th
                rowSpan={2}
                className="sticky top-0 left-10 z-30 min-w-[11rem] border-b border-hairline bg-surface px-2 text-left font-medium"
              >
                Team
              </th>
              <th
                rowSpan={2}
                onClick={() => handleSort("games")}
                className="sticky top-0 z-20 cursor-pointer select-none border-b border-l border-hairline bg-surface px-2 text-right font-medium"
                title="Games played this season"
              >
                Games
                <SortIndicator active={sortTag === "games"} dir={sortDir} />
              </th>
              {groupOrder.map((g) => (
                <th
                  key={g}
                  colSpan={groupCounts[g]}
                  className="sticky top-0 z-20 h-7 border-b border-l border-hairline bg-surface px-2 text-center text-[11px] font-semibold tracking-wide"
                  style={g === "style" ? { color: "var(--style-bar)" } : undefined}
                >
                  {TEAM_GROUP_LABELS[g].toUpperCase()}
                </th>
              ))}
            </tr>
            <tr className="h-8 text-xs text-ink-muted">
              {TEAM_COLUMNS.map((col, i) => {
                const board = teamBoards[col.tag];
                const style = isStyleColumn(col.tag, board?.style);
                const polarity = style ? "style, not ranked for quality" : board?.direction === "asc" ? "lower is better" : "higher is better";
                return (
                  <th
                    key={col.tag}
                    onClick={() => handleSort(col.tag)}
                    title={`${board?.label ?? col.short} — ${polarity}`}
                    className={`sticky top-7 z-20 h-8 cursor-pointer select-none whitespace-nowrap border-b border-hairline bg-surface px-2 text-right font-medium ${groupBoundary(TEAM_COLUMNS, i) ? "border-l" : ""}`}
                    style={style ? { color: "var(--style-bar)" } : undefined}
                  >
                    {col.short}
                    <SortIndicator active={sortTag === col.tag} dir={sortDir} />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row, i) => (
              <tr key={row.id} className="border-b border-hairline last:border-0 hover:bg-hairline/10">
                <td className="tabular sticky left-0 z-[1] bg-surface px-2 py-1.5 text-ink-muted">{i + 1}</td>
                <td className="sticky left-10 z-[1] bg-surface px-2 py-1.5 font-medium">
                  <Link
                    href={`/teams/${row.id}`}
                    className="underline decoration-hairline underline-offset-4 hover:decoration-inherit"
                  >
                    {row.name}
                  </Link>
                </td>
                <td className="tabular border-l border-hairline px-2 py-1.5 text-right">{row.games}</td>
                {TEAM_COLUMNS.map((col, ci) => {
                  const board = teamBoards[col.tag];
                  const boundary = groupBoundary(TEAM_COLUMNS, ci);
                  if (!board) {
                    return (
                      <td key={col.tag} className={`px-2 py-1.5 text-right text-ink-muted ${boundary ? "border-l border-hairline" : ""}`}>
                        —
                      </td>
                    );
                  }
                  return (
                    <TeamCell
                      key={col.tag}
                      col={col}
                      cell={row.cells[col.tag]}
                      board={board}
                      showRank={showRank}
                      boundary={boundary}
                    />
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-xs text-ink-muted">
        {rows.length} teams · hover a cell for its rank and full stat name · regular season only · data: nflverse.
      </p>
    </section>
  );
}
