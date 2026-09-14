"use client";

import { useState } from "react";
import Link from "next/link";
import type { GameMatchups, UnitMatchup } from "@/lib/matchups";
import { formatFinalLine, formatMarketLine, oddsForGame, type OddsDoc } from "@/lib/odds";
import {
  computeSpotlightSlots, computeWatchSlots, formatWatchSlotText, shortName,
  type SpotlightSlot, type SpotlightUnit, type TeamPlayersDoc,
} from "@/lib/spotlights";
import type { TeamIndexEntry } from "@/lib/types";
import { InjuryBadge, RankPill, gameTagStyle, ordinal } from "./common";

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

function PlayerLink({ slot }: { slot: SpotlightSlot }) {
  const { player } = slot;
  return (
    <li className="flex flex-col gap-0.5">
      <span className="flex flex-wrap items-center gap-1.5">
        <Link
          href={`/players/${player.gsis_id}`}
          className="font-medium text-ink-primary hover:underline decoration-hairline underline-offset-4"
          onClick={(e) => e.stopPropagation()}
        >
          {player.name}
        </Link>
        <span className="text-ink-muted">({player.pos})</span>
        {player.injury_status && <InjuryBadge status={player.injury_status} />}
      </span>
      {player.starter_override && player.overridden_starters && player.overridden_starters.length > 0 && (
        <span className="text-ink-muted">
          in for{" "}
          {player.overridden_starters
            .map((o) => `${shortName(o.name)}${o.injury_status ? ` (${o.injury_status})` : ""}`)
            .join(", ")}
        </span>
      )}
      {player.flag ? (
        <span className="text-ink-muted">{player.note}</span>
      ) : (
        <span className="tabular text-ink-muted">
          {player.headline} · {player.percentile != null ? `${Math.round(player.percentile)}th pctl` : "n/a"}
          {" · faces "}
          {slot.oppTeam}&apos;s {ordinal(slot.oppRank)}-ranked {slot.oppUnitLabel}
        </span>
      )}
    </li>
  );
}

const UNIT_LABELS: Record<SpotlightUnit, string> = {
  pass_off: "Pass offence", run_off: "Run offence",
  pass_def: "Pass defence", run_def: "Run defence",
};

/** The full per-unit player breakdown for one team — expanded-detail only
 *  (docs/MATCHUPS_SPOTLIGHTS.md). Framed at unit level throughout: every
 *  "faces" pairing names the opposing UNIT's rank, never a 1-on-1. */
function TeamSpotlights({ team, slots }: { team: string; slots: SpotlightSlot[] }) {
  const forTeam = slots.filter((s) => s.team === team);
  if (forTeam.length === 0) return null;
  const byUnit: Record<SpotlightUnit, SpotlightSlot[]> = { pass_off: [], run_off: [], pass_def: [], run_def: [] };
  for (const s of forTeam) byUnit[s.unit].push(s);

  return (
    <div className="flex flex-col gap-2">
      <p className="font-medium text-ink-muted">{team}</p>
      {(Object.keys(byUnit) as SpotlightUnit[]).map((unit) =>
        byUnit[unit].length === 0 ? null : (
          <div key={unit}>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              {UNIT_LABELS[unit]}
            </p>
            <ul className="flex flex-col gap-1">
              {byUnit[unit].map((s) => (
                <PlayerLink key={s.player.gsis_id} slot={s} />
              ))}
            </ul>
          </div>
        )
      )}
    </div>
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

export default function GameCard({ gm, meta, oddsDoc, teamPlayersDoc, week }: {
  gm: GameMatchups; meta: TeamMeta; oddsDoc: OddsDoc | null; teamPlayersDoc: TeamPlayersDoc | null; week: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const { game, matchups, tags, interest } = gm;
  const odds = oddsForGame(oddsDoc, week, game.game_id);
  const isFinal = game.away_score !== null && game.home_score !== null;
  const marketLine = isFinal
    ? formatFinalLine(game.away, game.home, game.away_score!, game.home_score!)
    : formatMarketLine(odds);

  const spotlightSlots = computeSpotlightSlots(gm, teamPlayersDoc);
  const watchSlots = computeWatchSlots(spotlightSlots);

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

      <div className="mb-3 flex flex-col gap-1.5 rounded-lg border border-hairline bg-background px-3 py-2.5">
        <p className="text-[15px] leading-snug text-ink-secondary sm:text-[16px]">
          <span className="mr-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
            Model
          </span>
          {gm.verdict}
        </p>
        <p className="tabular text-sm text-ink-secondary">
          <span className="mr-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
            Market
          </span>
          {marketLine}
        </p>
        {watchSlots.length > 0 && (
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-ink-secondary">
            <span className="mr-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              Watch
            </span>
            {watchSlots.map((s, i) => (
              <span key={s.player.gsis_id} className="inline-flex items-center gap-1">
                {i > 0 && <span className="text-ink-muted">·</span>}
                <span>{formatWatchSlotText(s)}</span>
                {s.player.injury_status && <InjuryBadge status={s.player.injury_status} />}
              </span>
            ))}
          </p>
        )}
      </div>

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

      {expanded && !isFinal && odds && (
        <p className="mt-3 border-t border-hairline pt-3 tabular text-xs text-ink-muted">
          Exact line: {odds.favorite ? `${odds.favorite} -${odds.spread}` : "pick 'em"} · O/U {odds.total}
        </p>
      )}
      {expanded && spotlightSlots.length > 0 && (
        <div className="mt-3 border-t border-hairline pt-3 text-xs text-ink-secondary">
          <p className="mb-1.5 font-medium text-ink-muted">Key players</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <TeamSpotlights team={game.away} slots={spotlightSlots} />
            <TeamSpotlights team={game.home} slots={spotlightSlots} />
          </div>
        </div>
      )}
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
        {expanded ? "hide" : "show"} detail
      </p>
    </div>
  );
}
