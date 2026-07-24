"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { TeamDoc, TeamIndex, TeamSeason } from "@/lib/types";
import Heatmap, { HeatCell } from "@/components/teams/Heatmap";
import { fmtEpa, fmtPct, recordText, seasonOf } from "@/components/teams/common";

const SERIES = ["var(--series-1)", "var(--series-2)"];

// six style axes for the fingerprint radar (percentile space, style framing)
const RADAR_AXES: [string, string][] = [
  ["fingerprint.proe", "PROE"],
  ["fingerprint.early_down_pass_rate", "Early-down pass"],
  ["fingerprint.neutral_pace_sec", "Pace (slower →)"],
  ["fingerprint.shotgun_rate", "Shotgun"],
  ["fingerprint.adot", "aDOT"],
  ["scheme_splits.deep_shots.rate", "Deep shots"],
];

// summary rows: [label, dotted pct key, side, value getter]
type Getter = (s: TeamSeason) => number | undefined;
const SUMMARY_ROWS: [string, string, "offense" | "defense", Getter, (v: number) => string][] = [
  ["Points/g", "summary.points_per_game", "offense", (s) => s.offense.summary.points_per_game, (v) => v.toFixed(1)],
  ["EPA/play", "summary.epa_per_play", "offense", (s) => s.offense.summary.epa_per_play, fmtEpa],
  ["Success rate", "summary.success_rate", "offense", (s) => s.offense.summary.success_rate, fmtPct],
  ["Points allowed/g", "summary.points_allowed_per_game", "defense", (s) => s.defense.summary.points_allowed_per_game, (v) => v.toFixed(1)],
  ["EPA/play allowed", "summary.epa_per_play_allowed", "defense", (s) => s.defense.summary.epa_per_play_allowed, fmtEpa],
  ["Sack rate", "sack_rate", "defense", (s) => s.defense.sack_rate ?? undefined, fmtPct],
];

function useTeamDoc(fr: string | null): TeamDoc | null | "error" {
  const [doc, setDoc] = useState<TeamDoc | null | "error">(null);
  useEffect(() => {
    if (!fr) { setDoc(null); return; }
    let alive = true;
    setDoc(null);
    fetch(`/data/teams/${fr}.json`)
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d) => alive && setDoc(d))
      .catch(() => alive && setDoc("error"));
    return () => { alive = false; };
  }, [fr]);
  return doc;
}

function TeamRadar({ a, b, sa, sb, nameA, nameB }: {
  a: TeamSeason; b: TeamSeason; sa: number; sb: number; nameA: string; nameB: string;
}) {
  const SIZE = 320, CX = 160, CY = 160, R = 108;
  const step = (2 * Math.PI) / RADAR_AXES.length;
  const polar = (i: number, r: number): [number, number] =>
    [CX + r * Math.cos(i * step - Math.PI / 2), CY + r * Math.sin(i * step - Math.PI / 2)];
  const pctOf = (s: TeamSeason, key: string) => s.percentiles.offense[key];
  const poly = (s: TeamSeason) => RADAR_AXES.map(([key], i) =>
    polar(i, ((pctOf(s, key) ?? 0) / 100) * R).join(",")).join(" ");
  return (
    <div className="flex flex-wrap items-start gap-6">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width={SIZE} height={SIZE} className="max-w-full" role="img"
        aria-label="Scheme fingerprint radar for both teams">
        {[25, 50, 75].map((p) => (
          <polygon key={p} points={RADAR_AXES.map((_, i) => polar(i, (p / 100) * R).join(",")).join(" ")}
            fill="none" stroke="var(--hairline)" strokeWidth={p === 50 ? 1.5 : 1} />
        ))}
        {RADAR_AXES.map(([key, label], i) => {
          const [lx, ly] = polar(i, R + 20);
          return (
            <g key={key}>
              <line x1={CX} y1={CY} x2={polar(i, R)[0]} y2={polar(i, R)[1]} stroke="var(--hairline)" />
              <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" fontSize={10} fill="var(--ink-muted)">
                {label}
              </text>
            </g>
          );
        })}
        {[{ s: a, c: SERIES[0], name: nameA, yr: sa }, { s: b, c: SERIES[1], name: nameB, yr: sb }].map(({ s, c, name, yr }) => (
          <g key={name + yr}>
            <polygon points={poly(s)} fill={c} fillOpacity={0.14} stroke={c} strokeWidth={2} strokeLinejoin="round" />
            {RADAR_AXES.map(([key, label], i) => {
              const pct = pctOf(s, key);
              if (pct === undefined) return null;
              const [x, y] = polar(i, (pct / 100) * R);
              return (
                <circle key={key} cx={x} cy={y} r={3.5} fill={c}>
                  <title>{`${name} ${yr} — ${label}: ${Math.round(pct)}% of league`}</title>
                </circle>
              );
            })}
          </g>
        ))}
      </svg>
      <p className="max-w-56 text-xs text-ink-muted">
        Style axes in league-percentile space — identity, not quality. A big shape
        means &quot;more of that tendency than most teams&quot;, not &quot;better&quot;.
        Pace axis points outward = slower between snaps (clock-running plays only).
      </p>
    </div>
  );
}

function CompareInner() {
  const params = useSearchParams();
  const router = useRouter();
  const [idx, setIdx] = useState<TeamIndex | null>(null);
  const [metricSide, setMetricSide] = useState<"offense" | "defense">("offense");

  const aFr = params.get("a");
  const bFr = params.get("b");
  const aDoc = useTeamDoc(aFr);
  const bDoc = useTeamDoc(bFr);

  useEffect(() => {
    fetch("/data/teams/index.json").then((r) => r.json()).then(setIdx).catch(() => setIdx(null));
  }, []);

  function setParam(k: string, v: string | null) {
    const q = new URLSearchParams(params.toString());
    if (v) q.set(k, v); else q.delete(k);
    router.replace(`/teams/compare?${q}`);
  }

  const ready = aDoc && bDoc && aDoc !== "error" && bDoc !== "error";
  const sa = ready ? seasonOf(aDoc, params.get("sa") ? Number(params.get("sa")) : null) : null;
  const sb = ready ? seasonOf(bDoc, params.get("sb") ? Number(params.get("sb")) : null) : null;

  const picker = (label: string, value: string | null, onChange: (v: string) => void) => (
    <label className="flex items-center gap-2 text-sm">
      {label}
      <select value={value ?? ""} onChange={(e) => onChange(e.target.value)}
        className="rounded border border-hairline bg-surface px-2 py-1 text-sm" aria-label={label}>
        <option value="" disabled>Pick a team…</option>
        {idx?.teams.map((t) => <option key={t.franchise} value={t.franchise}>{t.name}</option>)}
      </select>
    </label>
  );

  const diffCells = (): Record<string, HeatCell> => {
    if (!sa || !sb) return {};
    const ga = metricSide === "offense" ? sa.offense.down_distance : sa.defense.down_distance;
    const gb = metricSide === "offense" ? sb.offense.down_distance : sb.defense.down_distance;
    const key = (metricSide === "offense" ? "epa_per_play" : "epa_per_play_allowed") as keyof typeof ga[string];
    const out: Record<string, HeatCell> = {};
    for (const k of Object.keys(ga)) {
      const ca = ga[k];
      const cb = gb[k];
      const va = ca?.[key] as number | undefined;
      const vb = cb?.[key] as number | undefined;
      const plays = Math.min(ca?.plays ?? 0, cb?.plays ?? 0);
      out[k] = {
        value: va !== undefined && vb !== undefined ? va - vb : null,
        plays,
        title: plays === 0 ? "no shared sample" :
          `${aDoc && aDoc !== "error" ? aDoc.name : "A"} ${va !== undefined ? fmtEpa(va) : "–"} vs ${bDoc && bDoc !== "error" ? bDoc.name : "B"} ${vb !== undefined ? fmtEpa(vb) : "–"} · min sample ${plays}`,
      };
    }
    return out;
  };

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Compare teams</h1>
      <div className="flex flex-wrap items-center gap-4">
        {picker("A", aFr, (v) => setParam("a", v))}
        {ready && sa && (
          <select value={sa.season} onChange={(e) => setParam("sa", e.target.value)}
            className="rounded border border-hairline bg-surface px-2 py-1 text-sm" aria-label="Season A">
            {[...aDoc.seasons].reverse().map((r) => <option key={r.season} value={r.season}>{r.season}</option>)}
          </select>
        )}
        <span className="text-ink-muted">vs</span>
        {picker("B", bFr, (v) => setParam("b", v))}
        {ready && sb && (
          <select value={sb.season} onChange={(e) => setParam("sb", e.target.value)}
            className="rounded border border-hairline bg-surface px-2 py-1 text-sm" aria-label="Season B">
            {[...bDoc.seasons].reverse().map((r) => <option key={r.season} value={r.season}>{r.season}</option>)}
          </select>
        )}
      </div>

      {(aDoc === "error" || bDoc === "error") && (
        <p className="text-sm text-ink-muted">One of those teams didn&apos;t load — pick again.</p>
      )}
      {!ready && aDoc !== "error" && bDoc !== "error" && (
        <p className="text-sm text-ink-muted">
          Pick two teams (same season by default — each side also has its own season
          picker, since percentiles are within-season and stay comparable across years).
        </p>
      )}

      {ready && sa && sb && (
        <>
          <section>
            <h2 className="mb-2 text-lg font-semibold">Side by side</h2>
            <div className="overflow-x-auto rounded-lg border border-hairline bg-surface">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-hairline text-ink-muted">
                    <th className="px-3 py-1.5 text-left font-medium">Metric</th>
                    {[{ d: aDoc, s: sa, c: SERIES[0] }, { d: bDoc, s: sb, c: SERIES[1] }].map(({ d, s, c }) => (
                      <th key={d.franchise + s.season} className="px-3 py-1.5 text-right font-medium">
                        <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: c }} />
                        {d.franchise} {s.season} ({recordText(s.record)})
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline">
                  {SUMMARY_ROWS.map(([label, pctKey, side, get, fmt]) => (
                    <tr key={label}>
                      <td className="px-3 py-1.5 text-ink-secondary">{label}</td>
                      {[sa, sb].map((s, i) => {
                        const v = get(s);
                        const pct = s.percentiles[side][pctKey];
                        return (
                          <td key={i} className="px-3 py-1.5">
                            <div className="tabular flex items-center justify-end gap-2">
                              {v !== undefined ? fmt(v) : "–"}
                              {pct !== undefined && (
                                <span className="inline-block h-2 w-24 rounded-full bg-hairline/60"
                                  title={`${Math.round(pct)}th league percentile, ${s.season}`}>
                                  <span className="block h-2 rounded-full" style={{ width: `${pct}%`, background: SERIES[i] }} />
                                </span>
                              )}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-1 text-xs text-ink-muted">
              Bars are within-season league percentiles; defensive bars are already
              inverted (longer = stingier).
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold">Fingerprint radar</h2>
            <TeamRadar a={sa} b={sb} sa={sa.season} sb={sb.season} nameA={aDoc.name} nameB={bDoc.name} />
          </section>

          <section>
            <div className="mb-2 flex flex-wrap items-center gap-4">
              <h2 className="text-lg font-semibold">Heatmap diff</h2>
              <div className="flex overflow-hidden rounded border border-hairline text-sm">
                {(["offense", "defense"] as const).map((m) => (
                  <button key={m} onClick={() => setMetricSide(m)}
                    className={`px-3 py-1 ${metricSide === m ? "bg-hairline/60 font-medium" : "bg-surface"}`}>
                    {m === "offense" ? "Offense" : "Defense (allowed)"}
                  </button>
                ))}
              </div>
            </div>
            <Heatmap
              cells={diffCells()}
              domain={0.3}
              higherIsBetter={metricSide === "offense"}
              format={fmtEpa}
              caption={`EPA/play difference, ${aDoc.franchise} minus ${bDoc.franchise} — blue = ${aDoc.franchise} better. Fading uses the smaller of the two cell samples.`}
            />
          </section>
        </>
      )}
    </main>
  );
}

export default function TeamComparePage() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-5xl px-6 py-10 text-ink-muted">Loading…</main>}>
      <CompareInner />
    </Suspense>
  );
}
