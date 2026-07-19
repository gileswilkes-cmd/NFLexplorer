"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { IndexEntry, PlayerIndex } from "@/lib/types";

let indexCache: IndexEntry[] | null = null;

function rank(name: string, q: string): number {
  const n = name.toLowerCase();
  if (n.startsWith(q)) return 0;
  if (n.split(/\s+/).some((w) => w.startsWith(q))) return 1;
  if (n.includes(q)) return 2;
  return -1;
}

export default function PlayerSearch({ autoFocus = false, onSelect, placeholder }: {
  autoFocus?: boolean;
  /** when provided, rows call back instead of navigating to the profile */
  onSelect?: (p: IndexEntry) => void;
  placeholder?: string;
}) {
  const [players, setPlayers] = useState<IndexEntry[] | null>(indexCache);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (indexCache) return;
    fetch("/data/players/index.json")
      .then((r) => r.json())
      .then((idx: PlayerIndex) => {
        indexCache = idx.players;
        setPlayers(idx.players);
      })
      .catch(() => setPlayers([]));
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!players || q.length < 2) return [];
    return players
      .map((p) => ({ p, r: rank(p.name, q) }))
      .filter((x) => x.r >= 0)
      .sort((a, b) => a.r - b.r
        || Number(b.p.active) - Number(a.p.active)
        || b.p.last_season - a.p.last_season
        || a.p.name.localeCompare(b.p.name))
      .slice(0, 20)
      .map((x) => x.p);
  }, [players, query]);

  useEffect(() => setHighlight(0), [query]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter" && results[highlight]) {
      if (onSelect) {
        pick(results[highlight]);
      } else {
        const el = listRef.current?.querySelectorAll("a")[highlight];
        el?.click();
      }
    }
  }

  function pick(p: IndexEntry) {
    setQuery("");
    onSelect?.(p);
  }

  return (
    <div className="w-full max-w-xl">
      <input
        type="search"
        autoFocus={autoFocus}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={players ? placeholder ?? "Search players…" : "Loading player index…"}
        disabled={!players}
        aria-label="Search players"
        className="w-full rounded-lg border border-hairline bg-surface px-4 py-3 text-base outline-none focus:border-ink-muted"
      />
      {query.trim().length >= 2 && (
        <ul ref={listRef} className="mt-2 divide-y divide-hairline overflow-hidden rounded-lg border border-hairline bg-surface">
          {results.length === 0 && (
            <li className="px-4 py-3 text-sm text-ink-muted">No players match “{query.trim()}”.</li>
          )}
          {results.map((p, i) => {
            const rowContent = (
              <>
                {p.headshot ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.headshot} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" loading="lazy" />
                ) : (
                  <span className="h-8 w-8 shrink-0 rounded-full bg-hairline" />
                )}
                <span className="min-w-0 flex-1 truncate text-left">{p.name}</span>
                <span className="shrink-0 text-sm text-ink-secondary">
                  {p.pos ?? "—"}{p.team ? ` · ${p.team}` : ""}
                </span>
                <span className="shrink-0 text-xs text-ink-muted tabular">
                  {p.first_season === p.last_season ? p.first_season : `${p.first_season}–${p.last_season}`}
                </span>
              </>
            );
            const rowClass = "flex w-full items-center gap-3 px-4 py-2 hover:bg-hairline/40";
            return (
              <li key={p.id} className={i === highlight ? "bg-hairline/40" : undefined}>
                {onSelect ? (
                  <button type="button" className={rowClass} onClick={() => pick(p)} onMouseEnter={() => setHighlight(i)}>
                    {rowContent}
                  </button>
                ) : (
                  <Link href={`/players/${p.id}`} className={rowClass} onMouseEnter={() => setHighlight(i)}>
                    {rowContent}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
