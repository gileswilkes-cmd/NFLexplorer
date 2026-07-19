"use client";

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { CareerBlock, PlayerDoc, SeasonRow } from "@/lib/types";
import {
  Column, SEASON_COLUMNS, flatten, formatHeight, formatValue,
  logColumns, ngsIsNull, posGroup,
} from "@/lib/stats";
import { formatPercentile } from "@/lib/percentile";
import PctBadge from "@/components/PctBadge";

// values that legitimately have no zero-fill: absence renders as "–"
const DASH_KEYS = new Set(["snap_share", "target_share", "air_yds_share",
  "epa_per_play", "cpoe", "adot", "yac_oe"]);

function Cell({ col, row, source, group }: {
  col: Column; row: SeasonRow | CareerBlock; source: Record<string, number>; group: string;
}) {
  const isSeason = "season" in row;
  let content: string;
  if (col.derive) {
    const v = col.derive(source);
    content = v === null ? "–" : formatValue(col, v);
  } else if (col.ngs && ngsIsNull(row)) {
    content = "n/a"; // NGS not published (pre-2016 or below tracking minimums)
  } else if (source[col.key] === undefined) {
    content = col.ngs || DASH_KEYS.has(col.key) ? "–" : "0";
  } else {
    content = formatValue(col, source[col.key]);
  }
  const pct = isSeason ? (row as SeasonRow).percentiles?.[col.key] : undefined;
  return (
    <td className="tabular px-2 py-1.5 text-right whitespace-nowrap">
      {content}
      {pct !== undefined && (
        <PctBadge
          pct={pct}
          label={`${formatPercentile(pct)} percentile vs qualifying ${group}s, ${(row as SeasonRow).season}`}
        />
      )}
    </td>
  );
}

function SeasonTable({ rows, career, group, title, note }: {
  rows: SeasonRow[]; career?: CareerBlock; group: ReturnType<typeof posGroup>;
  title: string; note?: string;
}) {
  const cols = SEASON_COLUMNS[group];
  if (rows.length === 0 && !career) return null;
  return (
    <section className="w-full">
      <h2 className="mb-1 text-lg font-semibold">{title}</h2>
      {note && <p className="mb-2 text-xs text-ink-muted">{note}</p>}
      <div className="overflow-x-auto rounded-lg border border-hairline bg-surface">
        <table className="w-full min-w-max text-sm">
          <thead>
            <tr className="border-b border-hairline text-ink-muted">
              <th className="px-2 py-1.5 text-left font-medium">Season</th>
              <th className="px-2 py-1.5 text-left font-medium">Team</th>
              <th className="tabular px-2 py-1.5 text-right font-medium">G</th>
              {cols.map((c) => (
                <th key={c.key} title={c.title} className="px-2 py-1.5 text-right font-medium">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {rows.map((row) => (
              <tr key={`${row.season}-${row.game_type}`}>
                <td className="px-2 py-1.5">{row.season}</td>
                <td className="px-2 py-1.5">{row.teams.join("/")}</td>
                <td className="tabular px-2 py-1.5 text-right">{row.games}</td>
                {cols.map((c) => (
                  <Cell key={c.key} col={c} row={row} source={flatten(row)} group={group} />
                ))}
              </tr>
            ))}
            {career && (
              <tr className="border-t border-hairline font-medium">
                <td className="px-2 py-1.5" colSpan={2}>Career</td>
                <td className="tabular px-2 py-1.5 text-right">{career.games}</td>
                {cols.map((c) => (
                  <Cell key={c.key} col={c} row={career} source={flatten(career)} group={group} />
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function GameLogs({ doc, group }: { doc: PlayerDoc; group: ReturnType<typeof posGroup> }) {
  const seasons = useMemo(
    () => [...new Set(doc.game_logs.map((l) => l.season))].sort((a, b) => b - a),
    [doc.game_logs]);
  const [season, setSeason] = useState(seasons[0]);
  const cols = logColumns(group);
  if (doc.game_logs.length === 0 || cols.length === 0) return null;
  const logs = doc.game_logs.filter((l) => l.season === season);
  return (
    <section className="w-full">
      <div className="mb-2 flex items-center gap-3">
        <h2 className="text-lg font-semibold">Game logs</h2>
        <select
          value={season}
          onChange={(e) => setSeason(Number(e.target.value))}
          aria-label="Game log season"
          className="rounded border border-hairline bg-surface px-2 py-1 text-sm"
        >
          {seasons.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <div className="overflow-x-auto rounded-lg border border-hairline bg-surface">
        <table className="w-full min-w-max text-sm">
          <thead>
            <tr className="border-b border-hairline text-ink-muted">
              <th className="px-2 py-1.5 text-left font-medium">Wk</th>
              <th className="px-2 py-1.5 text-left font-medium">Date</th>
              <th className="px-2 py-1.5 text-left font-medium">Opp</th>
              {cols.map((c) => (
                <th key={c.key} title={c.title} className="px-2 py-1.5 text-right font-medium">{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {logs.map((l) => (
              <tr key={`${l.season}-${l.week}`} className={l.game_type !== "REG" ? "bg-hairline/30" : undefined}>
                <td className="px-2 py-1.5">
                  {l.game_type === "REG" ? l.week : l.game_type}
                </td>
                <td className="px-2 py-1.5 whitespace-nowrap text-ink-secondary">{l.date ?? "–"}</td>
                <td className="px-2 py-1.5 whitespace-nowrap">
                  {l.home === false ? "@" : ""}{l.opp ?? "–"}
                </td>
                {cols.map((c) => (
                  <td key={c.key} className="tabular px-2 py-1.5 text-right">
                    {l.stats[c.key] !== undefined ? formatValue(c, l.stats[c.key]) : "0"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function PlayerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [doc, setDoc] = useState<PlayerDoc | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/data/players/${id}.json`)
      .then((r) => {
        if (!r.ok) throw new Error(r.status === 404 ? "Player not found." : `Failed to load (${r.status}).`);
        return r.json();
      })
      .then((d) => alive && setDoc(d))
      .catch((e) => alive && setError(String(e.message ?? e)));
    return () => { alive = false; };
  }, [id]);

  if (error) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-24 text-center">
        <p className="text-lg">{error}</p>
        <Link href="/" className="mt-4 inline-block underline">Back to search</Link>
      </main>
    );
  }
  if (!doc) {
    return <main className="mx-auto max-w-3xl px-6 py-24 text-center text-ink-muted">Loading…</main>;
  }

  const { profile } = doc;
  const group = posGroup(profile.pos);
  const regRows = doc.seasons.filter((s) => s.game_type === "REG");
  const postRows = doc.seasons.filter((s) => s.game_type === "POST");
  const height = formatHeight(profile.height_in);
  const hasNullNgs = doc.seasons.some((s) => s.advanced && s.advanced.ngs === null);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-10">
      <header className="flex items-center gap-5">
        {profile.headshot ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={profile.headshot} alt={profile.name} className="h-24 w-24 rounded-full bg-hairline object-cover" />
        ) : (
          <span className="h-24 w-24 rounded-full bg-hairline" />
        )}
        <div className="min-w-0">
          <h1 className="truncate text-3xl font-semibold tracking-tight">{profile.name}</h1>
          <p className="text-ink-secondary">
            {profile.pos} · {profile.teams.join(" → ")}
            {regRows.length > 0 && (
              <span className="tabular"> · {regRows[0].season}–{regRows[regRows.length - 1].season}</span>
            )}
          </p>
          <p className="mt-1 text-sm text-ink-muted">
            {[height, profile.weight_lb && `${profile.weight_lb} lb`, profile.college,
              profile.draft
                ? `Draft ${profile.draft.year} R${profile.draft.round} #${profile.draft.pick} (${profile.draft.team})`
                : "Undrafted",
            ].filter(Boolean).join(" · ")}
          </p>
          <Link href={`/compare?a=${doc.id}`} className="mt-1 inline-block text-sm underline decoration-hairline underline-offset-4 hover:decoration-inherit">
            Compare with another player →
          </Link>
        </div>
      </header>

      <SeasonTable
        rows={regRows}
        career={doc.career}
        group={group}
        title="Regular season"
        note={hasNullNgs ? "NGS tracking metrics are published from 2016 — earlier seasons show n/a." : undefined}
      />
      {(postRows.length > 0 || doc.career_post) && (
        <SeasonTable
          rows={postRows}
          career={doc.career_post}
          group={group}
          title="Playoffs"
          note="Percentile badges apply to qualified regular-season rows only."
        />
      )}
      <GameLogs doc={doc} group={group} />

      <p className="text-xs text-ink-muted">
        Percentiles compare against qualifying players at the same position that season
        (tail values shown as &lt;5 / 95+). Data: nflverse, 2015–2025.
      </p>
    </main>
  );
}
