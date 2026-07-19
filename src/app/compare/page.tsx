"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import PlayerSearch from "@/components/PlayerSearch";
import SideBySide from "@/components/compare/SideBySide";
import RadarCompare from "@/components/compare/RadarCompare";
import ArcCompare from "@/components/compare/ArcCompare";
import { regRows, type Side } from "@/components/compare/common";
import { posGroup } from "@/lib/stats";
import type { PlayerDoc } from "@/lib/types";

function usePlayerDoc(id: string | null): PlayerDoc | "loading" | "error" | null {
  const [doc, setDoc] = useState<PlayerDoc | "loading" | "error" | null>(id ? "loading" : null);
  useEffect(() => {
    if (!id) { setDoc(null); return; }
    let alive = true;
    setDoc("loading");
    fetch(`/data/players/${id}.json`)
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d) => alive && setDoc(d))
      .catch(() => alive && setDoc("error"));
    return () => { alive = false; };
  }, [id]);
  return doc;
}

function SlotCard({ label, id, doc, onClear, onPick }: {
  label: string; id: string | null; doc: PlayerDoc | "loading" | "error" | null;
  onClear: () => void; onPick: (id: string) => void;
}) {
  if (!id || doc === "error") {
    return (
      <div className="flex-1 min-w-64">
        <p className="mb-1 text-sm font-medium text-ink-secondary">{label}</p>
        {doc === "error" && <p className="mb-1 text-xs text-ink-muted">Couldn&apos;t load that player — pick another.</p>}
        <PlayerSearch onSelect={(p) => onPick(p.id)} placeholder="Search a player…" />
      </div>
    );
  }
  if (doc === "loading" || !doc) {
    return <div className="flex-1 min-w-64 text-sm text-ink-muted">Loading…</div>;
  }
  const rows = regRows(doc);
  return (
    <div className="flex flex-1 min-w-64 items-center gap-3 rounded-lg border border-hairline bg-surface p-3">
      {doc.profile.headshot ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={doc.profile.headshot} alt="" className="h-12 w-12 rounded-full bg-hairline object-cover" />
      ) : <span className="h-12 w-12 rounded-full bg-hairline" />}
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{doc.profile.name}</p>
        <p className="tabular text-xs text-ink-secondary">
          {doc.profile.pos} · {doc.profile.teams.join("/")}
          {rows.length > 0 && ` · ${rows[0].season}–${rows[rows.length - 1].season}`}
        </p>
      </div>
      <button onClick={onClear} className="rounded px-2 py-1 text-sm text-ink-muted hover:bg-hairline/40" aria-label={`Clear ${label}`}>
        ✕
      </button>
    </div>
  );
}

function CompareInner() {
  const params = useSearchParams();
  const router = useRouter();
  const aId = params.get("a");
  const bId = params.get("b");
  const aDoc = usePlayerDoc(aId);
  const bDoc = usePlayerDoc(bId);

  function setIds(nextA: string | null, nextB: string | null) {
    const q = new URLSearchParams();
    if (nextA) q.set("a", nextA);
    if (nextB) q.set("b", nextB);
    router.replace(`/compare${q.toString() ? `?${q}` : ""}`);
  }

  const ready = aDoc && bDoc && aDoc !== "loading" && aDoc !== "error"
    && bDoc !== "loading" && bDoc !== "error";

  let overlapNote: string | null = null;
  let sides: { a: Side; b: Side } | null = null;
  if (ready) {
    const a: Side = { doc: aDoc, group: posGroup(aDoc.profile.pos), color: "var(--series-1)" };
    const b: Side = { doc: bDoc, group: posGroup(bDoc.profile.pos), color: "var(--series-2)" };
    sides = { a, b };
    const ar = regRows(aDoc);
    const br = regRows(bDoc);
    if (ar.length && br.length) {
      const [a0, a1] = [ar[0].season, ar[ar.length - 1].season];
      const [b0, b1] = [br[0].season, br[br.length - 1].season];
      if (a1 < b0 || b1 < a0) {
        overlapNote = `${aDoc.profile.name} (${a0}–${a1}) and ${bDoc.profile.name} (${b0}–${b1}) never overlapped — views align by career season, and era-adjusted mode scores each season against its own year.`;
      }
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Compare players</h1>
      <div className="flex flex-wrap items-stretch gap-4">
        <SlotCard label="Player A" id={aId} doc={aDoc}
          onClear={() => setIds(null, bId)} onPick={(id) => setIds(id, bId)} />
        <span className="self-center text-ink-muted">vs</span>
        <SlotCard label="Player B" id={bId} doc={bDoc}
          onClear={() => setIds(aId, null)} onPick={(id) => setIds(aId, id)} />
      </div>

      {!ready && (
        <p className="text-sm text-ink-muted">
          Pick two players to compare. The comparison is shareable — the URL updates
          with your selection.
        </p>
      )}

      {ready && sides && (
        <>
          {overlapNote && (
            <p className="rounded-lg border border-hairline bg-surface px-3 py-2 text-sm text-ink-secondary">
              {overlapNote}
            </p>
          )}
          <SideBySide a={sides.a} b={sides.b} />
          <RadarCompare a={sides.a} b={sides.b} />
          <ArcCompare a={sides.a} b={sides.b} />
          <p className="text-xs text-ink-muted">
            All percentiles compare each player against qualifying players at their own
            position in that specific season. Data: nflverse, 2015–2025.
          </p>
        </>
      )}
    </main>
  );
}

export default function ComparePage() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-5xl px-6 py-10 text-ink-muted">Loading…</main>}>
      <CompareInner />
    </Suspense>
  );
}
