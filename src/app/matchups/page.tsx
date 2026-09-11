"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  computeWeekMatchups, defaultWeek, type ScheduleDoc, type UnitRatingsDoc,
} from "@/lib/matchups";
import type { TeamIndex, TeamIndexEntry } from "@/lib/types";
import GameCard from "@/components/matchups/GameCard";

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

// Legend for the rank pills inside every card's grid — shown once here
// instead of repeating on each card (docs/MATCHUPS_VERDICT.md).
function RankLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
      <span className="inline-flex items-center gap-1">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: "var(--tier-hi-bg)" }} />
        top 8
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: "var(--tier-lo-bg)" }} />
        bottom 8
      </span>
      <span>left number = offense rank</span>
    </div>
  );
}

function weekDateRange(games: { date: string }[]): string {
  const dates = games.map((g) => g.date).sort();
  const first = dates[0], last = dates[dates.length - 1];
  if (!first) return "";
  return first === last ? first : `${first} – ${last}`;
}

// ⚠️ Mandatory (MATCHUPS_SPEC.md): pure 2025 ratings, no offseason
// adjustment — visible on every view, not just once the data loads.
function HonestyCaption() {
  return (
    <p className="rounded-lg border border-hairline bg-surface px-4 py-2.5 text-xs text-ink-secondary">
      Based on 2025 unit performance — offseason changes (personnel, coaching, scheme) are not reflected.
    </p>
  );
}

function MatchupsInner() {
  const params = useSearchParams();
  const router = useRouter();

  const [scheduleDoc, setScheduleDoc] = useState<ScheduleDoc | null>(null);
  const [ratingsDoc, setRatingsDoc] = useState<UnitRatingsDoc | null>(null);
  const [teamIndex, setTeamIndex] = useState<TeamIndex | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/data/matchups/schedule_2026.json").then((r) => { if (!r.ok) throw new Error(); return r.json(); }),
      fetch("/data/matchups/unit_ratings.json").then((r) => { if (!r.ok) throw new Error(); return r.json(); }),
      fetch("/data/teams/index.json").then((r) => { if (!r.ok) throw new Error(); return r.json(); }),
    ])
      .then(([s, r, t]) => { setScheduleDoc(s); setRatingsDoc(r); setTeamIndex(t); })
      .catch(() => setError(true));
  }, []);

  const weekParam = params.get("week");

  // Redirect to the default (next-upcoming) week once the schedule loads,
  // if no week was explicitly chosen — mirrors the leaderboards season default.
  useEffect(() => {
    if (scheduleDoc && !weekParam) {
      const q = new URLSearchParams(params.toString());
      q.set("week", defaultWeek(scheduleDoc));
      router.replace(`/matchups?${q}`);
    }
  }, [scheduleDoc, weekParam, params, router]);

  const weeks = useMemo(
    () => (scheduleDoc ? Object.keys(scheduleDoc.weeks).sort((a, b) => Number(a) - Number(b)) : []),
    [scheduleDoc]
  );
  const week = weekParam && scheduleDoc?.weeks[weekParam] ? weekParam
    : scheduleDoc ? defaultWeek(scheduleDoc) : "1";

  const teamMeta: Record<string, TeamIndexEntry> = useMemo(() => {
    const out: Record<string, TeamIndexEntry> = {};
    for (const t of teamIndex?.teams ?? []) out[t.franchise] = t;
    return out;
  }, [teamIndex]);

  const games = useMemo(
    () => (scheduleDoc && ratingsDoc ? computeWeekMatchups(week, scheduleDoc, ratingsDoc) : []),
    [scheduleDoc, ratingsDoc, week]
  );

  const loading = !scheduleDoc || !ratingsDoc || !teamIndex;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-10">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Matchups</h1>
        <p className="text-sm text-ink-muted">2026 season · sorted by interest</p>
      </div>

      <HonestyCaption />
      <RankLegend />

      {error && <p className="text-ink-muted">Couldn&apos;t load matchup data.</p>}
      {loading && !error && <p className="text-ink-muted">Loading…</p>}

      {!loading && !error && (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <Select
              label="Week"
              value={week}
              onChange={(v) => {
                const q = new URLSearchParams(params.toString());
                q.set("week", v);
                router.replace(`/matchups?${q}`);
              }}
            >
              {weeks.map((w) => (
                <option key={w} value={w}>
                  Week {w} ({weekDateRange(scheduleDoc!.weeks[w])})
                </option>
              ))}
            </Select>
          </div>

          {games.length === 0 && <p className="text-ink-muted">No games found for week {week}.</p>}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {games.map((gm) => (
              <GameCard key={gm.game.game_id} gm={gm} meta={teamMeta} />
            ))}
          </div>
        </>
      )}
    </main>
  );
}

export default function MatchupsPage() {
  return (
    <Suspense fallback={
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Matchups</h1>
        <HonestyCaption />
        <p className="text-ink-muted">Loading…</p>
      </main>
    }>
      <MatchupsInner />
    </Suspense>
  );
}
