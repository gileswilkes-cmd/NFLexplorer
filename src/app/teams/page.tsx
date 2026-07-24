"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { TeamIndex } from "@/lib/types";
import { recordText } from "@/components/teams/common";

export default function TeamsIndexPage() {
  const [idx, setIdx] = useState<TeamIndex | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/data/teams/index.json")
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then(setIdx)
      .catch(() => setError(true));
  }, []);

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="mb-6 flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Teams</h1>
        <Link href="/teams/compare" className="text-sm underline decoration-hairline underline-offset-4 hover:decoration-inherit">
          Compare two teams →
        </Link>
      </div>
      {error && <p className="text-ink-muted">Couldn&apos;t load the team index.</p>}
      {!idx && !error && <p className="text-ink-muted">Loading…</p>}
      {idx && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {idx.teams.map((t) => (
            <li key={t.franchise}>
              <Link href={`/teams/${t.franchise}`}
                className="flex items-center gap-3 rounded-lg border border-hairline bg-surface p-3 hover:border-ink-muted">
                <span className="h-8 w-8 shrink-0 rounded-full border border-hairline"
                  style={{ background: t.colors?.primary ?? "var(--hairline)" }} />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{t.name}</span>
                  <span className="tabular block text-xs text-ink-muted">
                    {t.latest.season} · {recordText(t.latest.record)}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
