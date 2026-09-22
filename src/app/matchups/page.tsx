"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  computeSlateStrip, computeWeekDivergence, defaultWeek, ordinal,
  type GameWithDivergence, type ScheduleDoc, type SlateStrip, type UnitRatingsDoc,
} from "@/lib/matchups";
import type { OddsDoc } from "@/lib/odds";
import { formatGeneratedAt, type TeamPlayersDoc } from "@/lib/spotlights";
import type { TeamIndex, TeamIndexEntry } from "@/lib/types";
import GameCard from "@/components/matchups/GameCard";

type SortMode = "divergence" | "kickoff";

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
      <span>
        <sup className="text-[9px] font-bold opacity-70">T</sup>/
        <sup className="text-[9px] font-bold opacity-70">S</sup> = tough/soft 2025 schedule (calibration hint, not a corrected rank)
      </span>
    </div>
  );
}

// The week's 4 headline superlatives (docs/... divergence sort), each
// pointing at one game — a scan-in-5-seconds summary above the card list.
// Text only for now; not clickable (no in-page anchors to jump to yet).
function SlateStripView({ strip }: { strip: SlateStrip }) {
  const items: { label: string; content: string }[] = [];
  if (strip.topDivergence) {
    items.push({
      label: "Biggest divergence",
      content: `${strip.topDivergence.away} @ ${strip.topDivergence.home}`,
    });
  }
  if (strip.sharpestUnitMismatch) {
    const s = strip.sharpestUnitMismatch;
    items.push({
      label: "Sharpest unit mismatch",
      content: `${s.offTeam} ${s.kind} O (${ordinal(s.offRank)}) vs ${s.defTeam} ${s.kind} D (${ordinal(s.defRank)})`,
    });
  }
  if (strip.highestMarketTotal) {
    items.push({
      label: "Highest total",
      content: `${strip.highestMarketTotal.away} @ ${strip.highestMarketTotal.home} · ${strip.highestMarketTotal.value} pts`,
    });
  }
  if (strip.lowestMarketTotal) {
    items.push({
      label: "Lowest total",
      content: `${strip.lowestMarketTotal.away} @ ${strip.lowestMarketTotal.home} · ${strip.lowestMarketTotal.value} pts`,
    });
  }
  if (items.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map((it) => (
        <div key={it.label} className="rounded-lg border border-hairline bg-surface px-3 py-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{it.label}</p>
          <p className="mt-1 text-sm text-ink-secondary">{it.content}</p>
        </div>
      ))}
    </div>
  );
}

function TierHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{children}</h2>;
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
  const [oddsDoc, setOddsDoc] = useState<OddsDoc | null>(null);
  const [teamPlayersDoc, setTeamPlayersDoc] = useState<TeamPlayersDoc | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/data/matchups/schedule_2026.json").then((r) => { if (!r.ok) throw new Error(); return r.json(); }),
      fetch("/data/matchups/unit_ratings.json").then((r) => { if (!r.ok) throw new Error(); return r.json(); }),
      fetch("/data/teams/index.json").then((r) => { if (!r.ok) throw new Error(); return r.json(); }),
    ])
      .then(([s, r, t]) => { setScheduleDoc(s); setRatingsDoc(r); setTeamIndex(t); })
      .catch(() => setError(true));

    // Odds are supplementary — a missing/failed pull degrades to "lines not
    // yet posted" everywhere rather than blocking the core matchups page.
    fetch("/data/matchups/odds_2026.json")
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then(setOddsDoc)
      .catch(() => setOddsDoc(null));

    // Spotlights are supplementary too — missing team_players.json just
    // means no Watch line / no player breakdown, not a blocked page.
    fetch("/data/matchups/team_players.json")
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then(setTeamPlayersDoc)
      .catch(() => setTeamPlayersDoc(null));
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

  // The week's games with model-vs-market divergence computed and tiered
  // (hero/standard/tail) — odds are supplementary elsewhere on this page, but
  // here they're a real input: a game with no line can't be divergence-ranked
  // (computeWeekDivergence handles that by tiering it "tail" with a null
  // divergenceZ, never crashing on missing odds).
  const weekGames = useMemo(
    () => (scheduleDoc && ratingsDoc ? computeWeekDivergence(week, scheduleDoc, ratingsDoc, oddsDoc) : []),
    [scheduleDoc, ratingsDoc, oddsDoc, week]
  );

  const slateStrip = useMemo(
    () => computeSlateStrip(weekGames, oddsDoc, week),
    [weekGames, oddsDoc, week]
  );

  const sortParam = params.get("sort");
  const sort: SortMode = sortParam === "kickoff" ? "kickoff" : "divergence";

  // Kickoff order intentionally mixes tiers (that's the point of browsing by
  // time instead), so it's a flat list; divergence order keeps the
  // hero/standard/tail grouping used to render real visual weight.
  const kickoffGames: GameWithDivergence[] = useMemo(() => {
    if (sort !== "kickoff") return [];
    return [...weekGames].sort((a, b) =>
      a.game.date < b.game.date ? -1 : a.game.date > b.game.date ? 1 : a.game.game_id.localeCompare(b.game.game_id)
    );
  }, [weekGames, sort]);

  const heroGames = weekGames.filter((g) => g.divergence.tier === "hero");
  const standardGames = weekGames.filter((g) => g.divergence.tier === "standard");
  const tailGames = weekGames.filter((g) => g.divergence.tier === "tail");

  const loading = !scheduleDoc || !ratingsDoc || !teamIndex;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-10">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Matchups</h1>
        <p className="text-sm text-ink-muted">
          2026 season · sorted by {sort === "kickoff" ? "kickoff time" : "model-vs-market divergence"}
        </p>
      </div>

      <HonestyCaption />
      <RankLegend />
      {/* Baked pull time, not render time (docs/MATCHUPS_INJURIES.md) — a
          stale team_players.json must visibly say its own age rather than
          silently looking current. Supplementary like the rest of the
          spotlights layer: absent (not an error) when the file failed to load. */}
      {teamPlayersDoc && (
        <p className="text-xs text-ink-muted">
          Injury data as of {formatGeneratedAt(teamPlayersDoc.generated_at)}
        </p>
      )}

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
            <Select
              label="Sort"
              value={sort}
              onChange={(v) => {
                const q = new URLSearchParams(params.toString());
                q.set("sort", v);
                router.replace(`/matchups?${q}`);
              }}
            >
              <option value="divergence">Divergence (model vs. market)</option>
              <option value="kickoff">Kickoff time</option>
            </Select>
          </div>

          {weekGames.length === 0 && <p className="text-ink-muted">No games found for week {week}.</p>}

          <SlateStripView strip={slateStrip} />

          {sort === "kickoff" ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {kickoffGames.map((gm) => (
                <div key={gm.game.game_id} className={gm.divergence.tier === "hero" ? "md:col-span-2" : ""}>
                  <GameCard
                    gm={gm}
                    meta={teamMeta}
                    oddsDoc={oddsDoc}
                    teamPlayersDoc={teamPlayersDoc}
                    week={week}
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              {heroGames.map((gm) => (
                <GameCard
                  key={gm.game.game_id}
                  gm={gm}
                  meta={teamMeta}
                  oddsDoc={oddsDoc}
                  teamPlayersDoc={teamPlayersDoc}
                  week={week}
                />
              ))}

              {standardGames.length > 0 && (
                <div className="flex flex-col gap-3">
                  <TierHeading>Also diverges from the market</TierHeading>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {standardGames.map((gm) => (
                      <GameCard
                        key={gm.game.game_id}
                        gm={gm}
                        meta={teamMeta}
                        oddsDoc={oddsDoc}
                        teamPlayersDoc={teamPlayersDoc}
                        week={week}
                      />
                    ))}
                  </div>
                </div>
              )}

              {tailGames.length > 0 && (
                <div className="flex flex-col gap-3">
                  <TierHeading>Rest of the slate</TierHeading>
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                    {tailGames.map((gm) => (
                      <GameCard
                        key={gm.game.game_id}
                        gm={gm}
                        meta={teamMeta}
                        oddsDoc={oddsDoc}
                        teamPlayersDoc={teamPlayersDoc}
                        week={week}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
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
