"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import TrendChart from "@/components/history/TrendChart";
import { WINDOW_LABEL } from "@/lib/leaderboards";
import type { TrendsDoc } from "@/lib/types";

/** The one-line story each group tells, so the charts aren't just shapes. */
const GROUP_STORIES: Record<string, string> = {
  Scoring: "Scoring is the flattest line here — the league's other changes have largely cancelled out.",
  Passing:
    "The passing boom is not what people assume. Volume peaked mid-window and drifted back, while the ball is thrown noticeably shorter than it was in 2015 — more efficient, not more aggressive.",
  Efficiency: "Per-play output is roughly flat; sacks are the line that moved.",
  "4th-down aggression":
    "The clearest evolution in the window: coaches now go for it on 4th down nearly three times as often as they did in 2015.",
  Kicking: "Attempt volume is unchanged, but the average made field goal keeps getting longer.",
  Rushing: "The mirror image of pass rate — the run has quietly come back a little.",
};

export default function HistoryPage() {
  const [doc, setDoc] = useState<TrendsDoc | null>(null);
  const [error, setError] = useState(false);
  const [group, setGroup] = useState<string>("all");

  useEffect(() => {
    fetch("/data/trends.json")
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then(setDoc)
      .catch(() => setError(true));
  }, []);

  const groups = useMemo(
    () => (doc ? doc.groups.filter((g) => group === "all" || g === group) : []),
    [doc, group]);

  const flagged = doc
    ? Object.values(doc.metrics).filter((m) => m.flags.length > 0).length
    : 0;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-10">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">How the league changed</h1>
        <Link href="/leaderboards" className="text-sm underline decoration-hairline underline-offset-4 hover:decoration-inherit">
          Leaderboards →
        </Link>
      </div>

      <p className="max-w-2xl text-sm text-ink-secondary">
        League-wide averages for every season from {WINDOW_LABEL}. Every metric uses one
        frozen definition across all eleven seasons and the same play filters as the team
        pages, so the lines show the league changing rather than the method changing.
      </p>

      {error && <p className="text-ink-muted">Couldn&apos;t load the trend data.</p>}
      {!doc && !error && <p className="text-ink-muted">Loading…</p>}

      {doc && (
        <>
          {/* One filter row above everything it scopes — never per-chart. */}
          <div className="flex flex-wrap items-center gap-2">
            {["all", ...doc.groups].map((g) => (
              <button
                key={g}
                onClick={() => setGroup(g)}
                className={`rounded-full border px-3 py-1 text-sm ${
                  group === g
                    ? "border-foreground bg-foreground text-background"
                    : "border-hairline text-ink-secondary hover:border-ink-muted"
                }`}
              >
                {g === "all" ? "All" : g}
              </button>
            ))}
          </div>

          {groups.map((g) => {
            const metrics = Object.entries(doc.metrics).filter(([, m]) => m.group === g);
            return (
              <section key={g}>
                <h2 className="text-lg font-semibold">{g}</h2>
                {GROUP_STORIES[g] && (
                  <p className="mb-3 max-w-2xl text-sm text-ink-secondary">{GROUP_STORIES[g]}</p>
                )}
                <div className="grid gap-4 sm:grid-cols-2">
                  {metrics.map(([key, m]) => <TrendChart key={key} metric={m} />)}
                </div>
              </section>
            );
          })}

          <p className="text-xs text-ink-muted">
            Regular season only. Metrics are computed from play-by-play, under the same
            filters as the team pages: pass and run plays, excluding kneels and spikes;
            &ldquo;neutral&rdquo; additionally means win probability between 20% and 80%
            outside the final two minutes of a half.{" "}
            {flagged === 0
              ? `No metric's ${doc.window[1]} value depends on a fallback data source or thinner inputs than earlier seasons.`
              : `${flagged} metric${flagged === 1 ? "" : "s"} carry a note about ${doc.window[1]} data quality — see the asterisks above.`}
            {" "}Data: nflverse, {WINDOW_LABEL}.
          </p>
        </>
      )}
    </main>
  );
}
