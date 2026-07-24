"use client";

import { Suspense, use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { EffBlock, TeamDoc, TeamSeason } from "@/lib/types";
import Heatmap from "@/components/teams/Heatmap";
import {
  HeatMetric, StyleBar, SUCCESS_CENTER, buildHeatCells, fmtEpa, fmtPct,
  recordText, seasonOf, tendencyLabel,
} from "@/components/teams/common";
import PctBadge from "@/components/PctBadge";

function Eff({ e, allowed }: { e: EffBlock; allowed?: boolean }) {
  const epa = allowed ? e.epa_per_play_allowed : e.epa_per_play;
  const suc = allowed ? e.success_rate_allowed : e.success_rate;
  const n = e.plays ?? e.games;
  return (
    <span className="tabular">
      {epa !== undefined ? fmtEpa(epa) : "–"} EPA/p · {suc !== undefined ? fmtPct(suc) : "–"} succ
      {n !== undefined && <span className="text-ink-muted"> · n={n}</span>}
    </span>
  );
}

function SummarySection({ s }: { s: TeamSeason }) {
  const rows: [string, string, string | null, string, string | null][] = [
    // label, offense key, offense pct key, defense key, defense pct key
    ["Points/g", "points_per_game", "summary.points_per_game", "points_allowed_per_game", "summary.points_allowed_per_game"],
    ["Yards/g", "yds_per_game", "summary.yds_per_game", "yds_allowed_per_game", "summary.yds_allowed_per_game"],
    ["EPA/play", "epa_per_play", "summary.epa_per_play", "epa_per_play_allowed", "summary.epa_per_play_allowed"],
    ["Success rate", "success_rate", "summary.success_rate", "success_rate_allowed", "summary.success_rate_allowed"],
  ];
  const fmt = (k: string, v: number) =>
    k.startsWith("success") ? fmtPct(v) : k.startsWith("epa") ? fmtEpa(v) : v.toFixed(1);
  return (
    <section>
      <h2 className="mb-2 text-lg font-semibold">Summary</h2>
      <div className="overflow-x-auto rounded-lg border border-hairline bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-hairline text-ink-muted">
              <th className="px-3 py-1.5 text-left font-medium">Metric</th>
              <th className="px-3 py-1.5 text-right font-medium">Offense</th>
              <th className="px-3 py-1.5 text-right font-medium">Defense (allowed)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {rows.map(([label, ok, opk, dk, dpk]) => {
              const ov = s.offense.summary[ok];
              const dv = s.defense.summary[dk];
              return (
                <tr key={label}>
                  <td className="px-3 py-1.5 text-ink-secondary">{label}</td>
                  <td className="tabular px-3 py-1.5 text-right">
                    {ov !== undefined ? fmt(ok, ov) : "–"}
                    {opk && s.percentiles.offense[opk] !== undefined &&
                      <PctBadge pct={s.percentiles.offense[opk]} label={`league percentile, ${s.season}`} />}
                  </td>
                  <td className="tabular px-3 py-1.5 text-right">
                    {dv !== undefined ? fmt(dk, dv) : "–"}
                    {dpk && s.percentiles.defense[dpk] !== undefined &&
                      <PctBadge pct={s.percentiles.defense[dpk]} label={`league percentile (inverted — high = stingier), ${s.season}`} />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const STYLE_AXES: [string, string, (v: number) => string][] = [
  ["proe", "Pass rate over expected", (v) => (v > 0 ? "+" : "") + (v * 100).toFixed(1) + "pp"],
  ["early_down_pass_rate", "Early-down pass rate", fmtPct],
  ["neutral_pace_sec", "Neutral pace", (v) => `${v.toFixed(1)}s`],
  ["shotgun_rate", "Shotgun rate", fmtPct],
  ["adot", "aDOT", (v) => v.toFixed(1)],
];

function FingerprintSection({ s }: { s: TeamSeason }) {
  const fp = s.offense.fingerprint;
  const pcts = s.percentiles.offense;
  const rd = fp.run_dir;
  return (
    <section>
      <h2 className="mb-1 text-lg font-semibold">Scheme fingerprint</h2>
      <p className="mb-2 text-xs text-ink-muted">
        Style, not quality — these describe identity, and the violet scale is
        deliberately not the red/blue quality palette.
      </p>
      <div className="rounded-lg border border-hairline bg-surface p-3">
        <ul className="space-y-2 text-sm">
          {STYLE_AXES.map(([key, label, fmt]) => {
            const v = fp[key as keyof typeof fp] as number | null;
            const pct = pcts[`fingerprint.${key}`];
            return (
              <li key={key} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="w-44 text-ink-secondary">{label}</span>
                <span className="tabular w-16 text-right">{v === null || v === undefined ? "–" : fmt(v)}</span>
                {pct !== undefined && (
                  <>
                    <StyleBar pct={pct} />
                    <span className="text-xs text-ink-muted">{tendencyLabel(key, pct)}</span>
                  </>
                )}
              </li>
            );
          })}
          {rd && (
            <li className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="w-44 text-ink-secondary">Run direction</span>
              <span className="flex h-3 w-56 overflow-hidden rounded-full" title={`left ${fmtPct(rd.left)} · middle ${fmtPct(rd.middle)} · right ${fmtPct(rd.right)}`}>
                <span style={{ width: `${rd.left * 100}%`, background: "var(--style-bar)", opacity: 0.9 }} />
                <span style={{ width: `${rd.middle * 100}%`, background: "var(--style-bar)", opacity: 0.55 }} />
                <span style={{ width: `${rd.right * 100}%`, background: "var(--style-bar)", opacity: 0.3 }} />
              </span>
              <span className="tabular text-xs text-ink-muted">
                L {fmtPct(rd.left)} · M {fmtPct(rd.middle)} · R {fmtPct(rd.right)}
                {fp.run_dir_known !== null && fp.run_dir_known < 0.99 &&
                  ` (${fmtPct(fp.run_dir_known)} of rushes have a known direction)`}
              </span>
            </li>
          )}
        </ul>
        <p className="mt-2 text-xs text-ink-muted">
          Neutral pace = seconds between snaps on clock-running plays only (score
          close, outside the final two minutes). It runs ~6s above published pace
          figures, which include clock-stopped snaps.
        </p>
      </div>
    </section>
  );
}

function CrossTabs({ s }: { s: TeamSeason }) {
  const sp = s.offense.scheme_splits;
  const cards: [string, [string, EffBlock][], string?][] = [
    ["Shotgun vs under center", [["Shotgun", sp.shotgun_vs_under_center.shotgun], ["Under center", sp.shotgun_vs_under_center.under_center]]],
    ["Early-down pass vs run", [["Pass", sp.early_down_pass_vs_run.pass], ["Run", sp.early_down_pass_vs_run.rush]]],
    ["Pass-heavy vs balanced games", [["Pass-heavy", sp.pass_heavy_vs_balanced.pass_heavy], ["Balanced", sp.pass_heavy_vs_balanced.balanced]],
      "Game-level split (top third of games by neutral pass rate) — coarser than the play-level splits."],
    ["Deep shots (20+ air yds)", [["Deep attempts", sp.deep_shots]],
      sp.deep_shots.rate !== null ? `${fmtPct(sp.deep_shots.rate)} of attempts travel 20+ air yards.` : undefined],
  ];
  return (
    <section>
      <h2 className="mb-2 text-lg font-semibold">Scheme cross-tabs</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {cards.map(([title, rows, note]) => (
          <div key={title} className="rounded-lg border border-hairline bg-surface p-3">
            <h3 className="mb-1.5 text-sm font-medium">{title}</h3>
            <ul className="space-y-1 text-sm">
              {rows.map(([label, eff]) => (
                <li key={label} className="flex justify-between gap-2">
                  <span className="text-ink-secondary">{label}</span>
                  <Eff e={eff} />
                </li>
              ))}
            </ul>
            {note && <p className="mt-1.5 text-xs text-ink-muted">{note}</p>}
          </div>
        ))}
      </div>
    </section>
  );
}

function TeamPageInner({ franchise }: { franchise: string }) {
  const params = useSearchParams();
  const router = useRouter();
  const [doc, setDoc] = useState<TeamDoc | null>(null);
  const [error, setError] = useState(false);
  const [metric, setMetric] = useState<HeatMetric>("epa");

  useEffect(() => {
    fetch(`/data/teams/${franchise}.json`)
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then(setDoc)
      .catch(() => setError(true));
  }, [franchise]);

  if (error) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-24 text-center">
        <p>Team not found.</p>
        <Link href="/teams" className="mt-3 inline-block underline">All teams</Link>
      </main>
    );
  }
  if (!doc) return <main className="mx-auto max-w-4xl px-6 py-24 text-center text-ink-muted">Loading…</main>;

  const seasonParam = params.get("season");
  const s = seasonOf(doc, seasonParam ? Number(seasonParam) : null);
  const heat = (allowed: boolean) =>
    buildHeatCells(allowed ? s.defense.down_distance : s.offense.down_distance, allowed, metric);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-10">
      <header className="flex flex-wrap items-center gap-4">
        <span className="h-12 w-12 rounded-full border border-hairline"
          style={{ background: doc.colors?.primary ?? "var(--hairline)" }} />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{doc.name}</h1>
          <p className="tabular text-sm text-ink-secondary">
            {s.season}{s.code !== doc.franchise ? ` (as ${s.code})` : ""} · {recordText(s.record)} · {s.games} games
          </p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <select
            value={s.season}
            onChange={(e) => router.replace(`/teams/${franchise}?season=${e.target.value}`)}
            aria-label="Season"
            className="rounded border border-hairline bg-surface px-2 py-1 text-sm"
          >
            {[...doc.seasons].reverse().map((row) => (
              <option key={row.season} value={row.season}>
                {row.season}{row.code !== doc.franchise ? ` (${row.code})` : ""}
              </option>
            ))}
          </select>
          <Link href={`/teams/compare?a=${franchise}`} className="text-sm underline decoration-hairline underline-offset-4 hover:decoration-inherit">
            Compare →
          </Link>
        </div>
      </header>

      <section>
        <div className="mb-2 flex flex-wrap items-center gap-4">
          <h2 className="text-lg font-semibold">Down × distance</h2>
          <div className="flex overflow-hidden rounded border border-hairline text-sm">
            {(["epa", "success"] as const).map((m) => (
              <button key={m} onClick={() => setMetric(m)}
                className={`px-3 py-1 ${metric === m ? "bg-hairline/60 font-medium" : "bg-surface"}`}>
                {m === "epa" ? "EPA/play" : "Success rate"}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-8">
          <div>
            <h3 className="mb-1 text-sm font-medium">Offense</h3>
            <Heatmap cells={heat(false)} higherIsBetter
              domain={metric === "epa" ? 0.35 : 0.15}
              center={metric === "epa" ? 0 : SUCCESS_CENTER}
              format={metric === "epa" ? fmtEpa : fmtPct}
              caption="Blue = good for the offense. Thin samples fade; cells under 20 plays are mostly noise." />
          </div>
          <div>
            <h3 className="mb-1 text-sm font-medium">Defense (allowed)</h3>
            <Heatmap cells={heat(true)} higherIsBetter={false}
              domain={metric === "epa" ? 0.35 : 0.15}
              center={metric === "epa" ? 0 : SUCCESS_CENTER}
              format={metric === "epa" ? fmtEpa : fmtPct}
              caption="Blue = good for the defense (little allowed). Same fading rules." />
          </div>
        </div>
      </section>

      <SummarySection s={s} />
      <FingerprintSection s={s} />
      <CrossTabs s={s} />

      <section>
        <h2 className="mb-2 text-lg font-semibold">By play type</h2>
        <div className="rounded-lg border border-hairline bg-surface p-3 text-sm">
          <ul className="space-y-1">
            <li className="flex justify-between gap-2"><span className="text-ink-secondary">Offense — pass</span><Eff e={s.offense.by_play_type.pass} /></li>
            <li className="flex justify-between gap-2"><span className="text-ink-secondary">Offense — rush</span><Eff e={s.offense.by_play_type.rush} /></li>
          </ul>
        </div>
      </section>

      <section>
        <h2 className="mb-1 text-lg font-semibold">Defense — results allowed</h2>
        <p className="mb-2 text-xs text-ink-muted">
          What this defense gave up. The free data has no coverage/blitz/front detail,
          so this is results, not scheme.
        </p>
        <div className="rounded-lg border border-hairline bg-surface p-3 text-sm">
          <ul className="space-y-1">
            <li className="flex justify-between gap-2"><span className="text-ink-secondary">vs pass</span><Eff e={s.defense.by_play_type.pass} allowed /></li>
            <li className="flex justify-between gap-2"><span className="text-ink-secondary">vs rush</span><Eff e={s.defense.by_play_type.rush} allowed /></li>
            <li className="flex justify-between gap-2">
              <span className="text-ink-secondary">Explosive plays allowed (20+ yds)</span>
              <span className="tabular">
                {s.defense.explosive_rate_allowed !== null ? fmtPct(s.defense.explosive_rate_allowed) : "–"}
                {s.percentiles.defense["explosive_rate_allowed"] !== undefined &&
                  <PctBadge pct={s.percentiles.defense["explosive_rate_allowed"]} label="league percentile (high = fewer allowed)" />}
              </span>
            </li>
            <li className="flex justify-between gap-2">
              <span className="text-ink-secondary">Sack rate</span>
              <span className="tabular">
                {s.defense.sack_rate !== null ? fmtPct(s.defense.sack_rate) : "–"}
                {s.percentiles.defense["sack_rate"] !== undefined &&
                  <PctBadge pct={s.percentiles.defense["sack_rate"]} label="league percentile" />}
              </span>
            </li>
          </ul>
        </div>
      </section>

      <p className="text-xs text-ink-muted">
        Percentiles are within-season vs all 32 teams. Two-point tries have no down
        and are excluded from the down×distance grid. Data: nflverse, regular season.
      </p>
    </main>
  );
}

export default function TeamPage({ params }: { params: Promise<{ franchise: string }> }) {
  const { franchise } = use(params);
  return (
    <Suspense fallback={<main className="mx-auto max-w-4xl px-6 py-24 text-center text-ink-muted">Loading…</main>}>
      <TeamPageInner franchise={franchise} />
    </Suspense>
  );
}
