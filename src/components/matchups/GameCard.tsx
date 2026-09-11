"use client";

import { useState } from "react";
import Link from "next/link";
import type { GameMatchups, UnitMatchup } from "@/lib/matchups";
import type { TeamIndexEntry } from "@/lib/types";
import { RankPill, gameTagStyle, ordinal } from "./common";

type TeamMeta = Record<string, TeamIndexEntry>;

function TeamPill({ code, meta }: { code: string; meta: TeamMeta }) {
  const t = meta[code];
  return (
    <Link
      href={`/teams/${code}`}
      className="inline-flex items-center gap-1.5 rounded hover:underline decoration-hairline underline-offset-4"
      onClick={(e) => e.stopPropagation()}
    >
      <span
        className="h-3 w-3 shrink-0 rounded-full border border-hairline"
        style={{ background: t?.colors?.primary ?? "var(--hairline)" }}
      />
      <span className="text-[19px] font-semibold">{t?.name ?? code}</span>
    </Link>
  );
}

const fmtEdge = (v: number) => (v > 0 ? "+" : "") + v;

/** One 2×2-grid cell: offence rank, a small "v", defence rank, signed edge
 *  below. Left rank = offence, right rank = defence (see legend). */
function MatchupCell({ m }: { m: UnitMatchup }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-hairline bg-background px-2 py-2.5">
      <div className="flex items-center gap-1.5">
        <RankPill rank={m.offRank} />
        <span className="text-xs text-ink-muted">v</span>
        <RankPill rank={m.defRank} />
      </div>
      <span className="tabular text-[17px] font-medium leading-none">{fmtEdge(m.edge)}</span>
    </div>
  );
}

const fmtEpa = (v: number) => (v > 0 ? "+" : "") + v.toFixed(3);

export default function GameCard({ gm, meta }: { gm: GameMatchups; meta: TeamMeta }) {
  const [expanded, setExpanded] = useState(false);
  const { game, matchups, tags, interest } = gm;

  const awayPass = matchups.find((m) => m.offTeam === game.away && m.kind === "pass")!;
  const awayRun = matchups.find((m) => m.offTeam === game.away && m.kind === "run")!;
  const homePass = matchups.find((m) => m.offTeam === game.home && m.kind === "pass")!;
  const homeRun = matchups.find((m) => m.offTeam === game.home && m.kind === "run")!;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => setExpanded((v) => !v)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setExpanded((v) => !v); }}
      className="cursor-pointer rounded-xl border border-hairline bg-surface p-4 transition hover:border-ink-muted"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <TeamPill code={game.away} meta={meta} />
          <span className="text-ink-muted">@</span>
          <TeamPill code={game.home} meta={meta} />
        </div>
        <div className="flex items-center gap-2">
          <span className="tabular text-xs text-ink-muted" title="interest score">
            {interest.toFixed(1)}
          </span>
          <span className="text-xs text-ink-muted">{game.date}</span>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {tags.map((tag) => (
          <span
            key={tag}
            className="rounded-full px-2 py-0.5 text-[11px] font-medium"
            style={gameTagStyle(tag)}
          >
            {tag}
          </span>
        ))}
      </div>

      <p className="mb-3 text-[15px] leading-snug text-ink-secondary sm:text-[16px]">{gm.verdict}</p>

      <div className="grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] items-center gap-x-2.5 gap-y-2.5">
        <div />
        <div className="text-center text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Pass
        </div>
        <div className="text-center text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Run
        </div>

        <div className="pr-1 text-sm font-medium whitespace-nowrap text-ink-secondary">
          {game.away} <span className="font-normal text-ink-muted">att</span>
        </div>
        <MatchupCell m={awayPass} />
        <MatchupCell m={awayRun} />

        <div className="pr-1 text-sm font-medium whitespace-nowrap text-ink-secondary">
          {game.home} <span className="font-normal text-ink-muted">att</span>
        </div>
        <MatchupCell m={homePass} />
        <MatchupCell m={homeRun} />
      </div>

      {expanded && (
        <div className="mt-3 border-t border-hairline pt-3 text-xs text-ink-secondary">
          <p className="mb-1.5 font-medium text-ink-muted">2025 EPA/play (raw)</p>
          <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            {matchups.map((m) => (
              <li key={`${m.offTeam}-${m.defTeam}-${m.kind}`} className="tabular">
                {m.offTeam} {m.kind} O {fmtEpa(m.offEpa)} · {m.defTeam} {m.kind} D allowed{" "}
                {fmtEpa(m.defEpaAllowed)} (rank {ordinal(m.offRank)} vs {ordinal(m.defRank)})
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-2 text-center text-xs text-ink-muted">
        {expanded ? "hide" : "show"} EPA detail
      </p>
    </div>
  );
}
