"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  GROUP_LABELS, SCOPES, WINDOW_LABEL, entryHref, formatBoardValue, groupsIn,
  needsWindowLabel, qualifierText, rateContext, scopePath, type Scope,
} from "@/lib/leaderboards";
import type { LeaderboardDoc } from "@/lib/types";

const SEASONS = Array.from({ length: 11 }, (_, i) => 2015 + i);
const LATEST = SEASONS[SEASONS.length - 1];

const isScope = (s: string | null): s is Scope =>
  s === "season" || s === "records" || s === "career";

function Select({ label, value, onChange, children }: {
  label: string; value: string; onChange: (v: string) => void; children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-ink-muted">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border border-hairline bg-surface px-2 py-1.5 text-sm"
      >
        {children}
      </select>
    </label>
  );
}

function LeaderboardsInner() {
  const params = useSearchParams();
  const router = useRouter();

  const scope: Scope = isScope(params.get("scope")) ? (params.get("scope") as Scope) : "season";
  const season = Number(params.get("season")) || LATEST;
  const wantGroup = params.get("group") ?? "QB";
  const wantStat = params.get("stat") ?? "";

  // Keyed by the file being fetched, so the effect only ever setStates from its
  // own callback. A stale result is ignored rather than cleared up-front, and
  // nothing from the previous scope is ever shown under the new scope's
  // heading — which matters here, because the window label is part of it.
  const path = scopePath(scope, season);
  const [loaded, setLoaded] =
    useState<{ path: string; doc: LeaderboardDoc | null } | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(path)
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d: LeaderboardDoc) => alive && setLoaded({ path, doc: d }))
      .catch(() => alive && setLoaded({ path, doc: null }));
    return () => { alive = false; };
  }, [path]);

  const current = loaded?.path === path ? loaded : null;
  const doc = current?.doc ?? null;
  const error = current !== null && current.doc === null;

  function setParams(next: Record<string, string | null>) {
    const q = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null) q.delete(k); else q.set(k, v);
    }
    router.replace(`/leaderboards?${q}`);
  }

  const groups = useMemo(() => (doc ? groupsIn(doc) : []), [doc]);
  // The selected group/stat may not exist in a newly loaded scope (career has
  // no TEAM board; a QB stat isn't on the WR board), so both fall back rather
  // than rendering an empty table.
  const group = doc && groups.includes(wantGroup) ? wantGroup : groups[0] ?? wantGroup;
  const stats = doc?.boards[group] ? Object.keys(doc.boards[group]) : [];
  const stat = stats.includes(wantStat) ? wantStat : stats[0] ?? "";
  const board = doc?.boards[group]?.[stat] ?? null;

  const qualifier = qualifierText(board?.qualifier ?? null);
  const showWindow = needsWindowLabel(scope);
  const scopeMeta = SCOPES.find((s) => s.key === scope)!;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-10">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Leaderboards</h1>
        <Link href="/history" className="text-sm underline decoration-hairline underline-offset-4 hover:decoration-inherit">
          How the league changed →
        </Link>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Select label="Scope" value={scope} onChange={(v) => setParams({ scope: v })}>
          {SCOPES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </Select>
        {scope === "season" && (
          <Select label="Season" value={String(season)} onChange={(v) => setParams({ season: v })}>
            {[...SEASONS].reverse().map((y) => <option key={y} value={y}>{y}</option>)}
          </Select>
        )}
        <Select label="Position" value={group} onChange={(v) => setParams({ group: v, stat: null })}>
          {groups.map((g) => <option key={g} value={g}>{GROUP_LABELS[g] ?? g}</option>)}
        </Select>
        <Select label="Stat" value={stat} onChange={(v) => setParams({ stat: v })}>
          {stats.map((s) => (
            <option key={s} value={s}>{doc?.boards[group]?.[s]?.label ?? s}</option>
          ))}
        </Select>
      </div>

      {/* ⚠️ Mandatory: career and all-time numbers are window-truncated, and
          look like bugs to anyone who knows the sport unless we say so. */}
      {showWindow && (
        <div className="rounded-lg border border-hairline bg-surface px-4 py-3">
          <p className="text-sm font-semibold">{WINDOW_LABEL} only</p>
          <p className="mt-0.5 text-sm text-ink-secondary">{scopeMeta.blurb}</p>
        </div>
      )}

      {error && <p className="text-ink-muted">Couldn&apos;t load that leaderboard.</p>}
      {!doc && !error && <p className="text-ink-muted">Loading…</p>}

      {board && (
        <section>
          <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-lg font-semibold">
              {board.label}
              <span className="ml-2 text-sm font-normal text-ink-secondary">
                {GROUP_LABELS[group] ?? group}
                {scope === "season" ? ` · ${season}` : ` · ${WINDOW_LABEL}`}
              </span>
            </h2>
            {/* Mandatory: a filtered rate board must show its inclusion rule. */}
            {qualifier && (
              <span className="rounded-full border border-hairline px-2 py-0.5 text-xs text-ink-secondary">
                {qualifier}
              </span>
            )}
            {board.direction === "asc" && (
              <span className="text-xs text-ink-muted">lower is better</span>
            )}
          </div>

          {board.style && (
            <p className="mb-2 text-xs text-ink-muted">
              This is a <strong>style</strong> axis, not a quality one — a high value means
              a team does more of this, not that it is better at it.
            </p>
          )}

          <div className="overflow-x-auto rounded-lg border border-hairline bg-surface">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-hairline text-left text-xs text-ink-muted">
                  <th className="w-12 px-3 py-2 font-medium">#</th>
                  <th className="px-3 py-2 font-medium">{group === "TEAM" ? "Team" : "Player"}</th>
                  {scope !== "career" && group !== "TEAM" && <th className="px-3 py-2 font-medium">Team</th>}
                  {scope === "records" && <th className="px-3 py-2 font-medium">Season</th>}
                  <th className="px-3 py-2 text-right font-medium">{board.label}</th>
                  {board.format === "pct" && <th className="px-3 py-2 text-right font-medium">Volume</th>}
                </tr>
              </thead>
              <tbody>
                {board.entries.map((e) => {
                  const ctx = rateContext(board, e);
                  return (
                    <tr key={`${e.id}-${e.season ?? "c"}`} className="border-b border-hairline last:border-0 hover:bg-hairline/20">
                      <td className="tabular px-3 py-2 text-ink-muted">{e.rank}</td>
                      <td className="px-3 py-2">
                        <Link href={entryHref(group, e)} className="underline decoration-hairline underline-offset-4 hover:decoration-inherit">
                          {e.name}
                        </Link>
                      </td>
                      {scope !== "career" && group !== "TEAM" && (
                        <td className="px-3 py-2 text-ink-secondary">{e.team ?? "—"}</td>
                      )}
                      {scope === "records" && <td className="tabular px-3 py-2 text-ink-secondary">{e.season}</td>}
                      <td className="tabular px-3 py-2 text-right font-medium">
                        {formatBoardValue(stat, board, e.value)}
                      </td>
                      {board.format === "pct" && (
                        <td className="tabular px-3 py-2 text-right text-xs text-ink-muted">{ctx ?? "—"}</td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="mt-2 text-xs text-ink-muted">
            {board.entries.length} {board.entries.length === 1 ? "entry" : "entries"}
            {qualifier ? ` · qualified by ${qualifier}` : " · no qualifier (counting stat)"}
            {" · regular season only · data: nflverse, "}{WINDOW_LABEL}.
          </p>
        </section>
      )}

      {doc && !board && !error && (
        <p className="text-ink-muted">No board for that combination.</p>
      )}
    </main>
  );
}

export default function LeaderboardsPage() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-5xl px-6 py-10 text-ink-muted">Loading…</main>}>
      <LeaderboardsInner />
    </Suspense>
  );
}
