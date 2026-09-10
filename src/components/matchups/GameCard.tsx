"use client";

import { useState } from "react";
import Link from "next/link";
import type { GameMatchups, UnitMatchup } from "@/lib/matchups";
import type { TeamIndexEntry } from "@/lib/types";
import { EdgeChip, RankChip, gameTagStyle, ordinal } from "./common";

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
      <span className="font-medium">{t?.name ?? code}</span>
    </Link>
  );
}

function MatchupRow({ m }: { m: UnitMatchup }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-hairline bg-background px-2.5 py-2 text-xs">
      <span className="font-medium">{m.offTeam}</span>
      <span className="text-ink-muted">{m.kind} O</span>
      <RankChip rank={m.offRank} />
      <span className="text-ink-muted">vs</span>
      <span className="font-medium">{m.defTeam}</span>
      <span className="text-ink-muted">{m.kind} D</span>
      <RankChip rank={m.defRank} />
      <EdgeChip edge={m.edge} />
      {m.tag && (
        <span className="ml-auto rounded-full border border-hairline px-1.5 py-0.5 text-[10px] text-ink-secondary">
          {m.tag}
        </span>
      )}
    </div>
  );
}

const fmtEpa = (v: number) => (v > 0 ? "+" : "") + v.toFixed(3);

export default function GameCard({ gm, meta }: { gm: GameMatchups; meta: TeamMeta }) {
  const [expanded, setExpanded] = useState(false);
  const { game, matchups, tags, interest } = gm;

  const awayOff = matchups.filter((m) => m.offTeam === game.away);
  const homeOff = matchups.filter((m) => m.offTeam === game.home);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => setExpanded((v) => !v)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setExpanded((v) => !v); }}
      className="cursor-pointer rounded-xl border border-hairline bg-surface p-4 transition hover:border-ink-muted"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm">
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

      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {awayOff.map((m) => <MatchupRow key={`${m.offTeam}-${m.kind}`} m={m} />)}
        {homeOff.map((m) => <MatchupRow key={`${m.offTeam}-${m.kind}`} m={m} />)}
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
      <p className="mt-2 text-center text-[10px] text-ink-muted">
        {expanded ? "hide" : "show"} EPA detail
      </p>
    </div>
  );
}
