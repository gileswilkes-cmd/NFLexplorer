"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { isThinMarket, LOW_VOLUME_THRESHOLD_USD, WIDE_SPREAD_THRESHOLD_PTS } from "@/lib/markets/constants";
import { isHighlighted } from "@/lib/markets/match";
import type { MarketGame, MarketsResponse, VenueQuote } from "@/lib/markets/types";
import type { TeamIndex, TeamIndexEntry } from "@/lib/types";
import { ProbabilityBar, SourceLegendDot, type BarMarker } from "@/components/markets/ProbabilityBar";

type SortMode = "kickoff" | "gap" | "volume";

const KALSHI_COLOR = "var(--series-1)";
const POLYMARKET_COLOR = "var(--series-2)";
const BOOKS_COLOR = "var(--ink-muted)";

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

function pct(p: number): string {
  return `${Math.round(p * 100)}%`;
}

function londonTime(iso: string | null): string {
  if (!iso) return "Kickoff time unknown";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Kickoff time unknown";
  return d.toLocaleString("en-GB", {
    weekday: "short", day: "numeric", month: "short",
    hour: "numeric", minute: "2-digit",
    timeZone: "Europe/London", timeZoneName: "short",
  });
}

function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "numeric", minute: "2-digit", timeZone: "Europe/London", timeZoneName: "short",
  });
}

function quoteVolume(q: VenueQuote | null): number {
  return q?.volume24h ?? 0;
}

function gameVolume(g: MarketGame): number {
  return quoteVolume(g.kalshi) + quoteVolume(g.polymarket);
}

function TeamLabel({ code, meta }: { code: string; meta: Record<string, TeamIndexEntry> }) {
  const t = meta[code];
  return (
    <Link href={`/teams/${code}`} className="hover:underline decoration-hairline underline-offset-4">
      <span
        className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full border border-hairline align-middle"
        style={{ background: t?.colors?.primary ?? "var(--hairline)" }}
      />
      <span className="font-medium">{t?.name ?? code}</span>
    </Link>
  );
}

function thinTitle(q: VenueQuote): string {
  const reasons: string[] = [];
  if (q.spreadWidth != null && q.spreadWidth * 100 >= WIDE_SPREAD_THRESHOLD_PTS) {
    reasons.push(`bid/ask spread ${Math.round(q.spreadWidth * 100)}pts wide`);
  }
  if (q.volume24h != null && q.volume24h < LOW_VOLUME_THRESHOLD_USD) {
    reasons.push(`low 24h volume ($${Math.round(q.volume24h).toLocaleString()})`);
  }
  return `Thin market — ${reasons.join(", ") || "low liquidity"}`;
}

function VenueNumber({ label, quote, color, flagTitle }: {
  label: string; quote: VenueQuote | null; color: string; flagTitle?: string | null;
}) {
  if (!quote) return <span className="text-ink-muted">{label} —</span>;
  const thin = isThinMarket(quote.spreadWidth, quote.volume24h);
  return (
    <span
      className={thin ? "text-ink-muted" : ""}
      title={flagTitle ?? (thin ? thinTitle(quote) : undefined)}
    >
      <SourceLegendDot color={color} muted={thin} /> {label} {pct(quote.probHome)}
      {quote.usedLastTradeFallback && <sup className="ml-0.5 text-[9px]">†</sup>}
    </span>
  );
}

function MarketRow({ g, meta }: { g: MarketGame; meta: Record<string, TeamIndexEntry> }) {
  const highlighted = isHighlighted(g.gapPts);
  const markers: BarMarker[] = [];
  if (g.kalshi) {
    markers.push({
      key: "kalshi", label: "Kalshi", probHome: g.kalshi.probHome, color: KALSHI_COLOR,
      muted: isThinMarket(g.kalshi.spreadWidth, g.kalshi.volume24h),
      title: g.kalshiFlag
        ? `Kalshi: ${pct(g.kalshi.probHome)} — home/away markets disagreed by ${g.kalshiFlag.disagreementPts}pts, showing the tighter-quoted (${g.kalshiFlag.usedSide}) side`
        : undefined,
    });
  }
  if (g.polymarket) {
    markers.push({
      key: "polymarket", label: "Polymarket", probHome: g.polymarket.probHome, color: POLYMARKET_COLOR,
      muted: isThinMarket(g.polymarket.spreadWidth, g.polymarket.volume24h),
    });
  }
  if (g.books?.probHome != null) {
    markers.push({
      key: "books", label: "Books", probHome: g.books.probHome, color: BOOKS_COLOR, muted: true,
      title: `Books (${g.books.bookCount} book${g.books.bookCount === 1 ? "" : "s"}): ${pct(g.books.probHome)} as of ${new Date(g.books.generatedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Europe/London" })}`,
    });
  }

  return (
    <div
      className="flex flex-col gap-3 rounded-lg border border-hairline px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
      style={highlighted ? { background: "var(--tier-hi-bg)" } : { background: "var(--surface)" }}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex items-center gap-1 text-[15px]">
          <TeamLabel code={g.away} meta={meta} />
          <span className="text-ink-muted">@</span>
          <TeamLabel code={g.home} meta={meta} />
        </div>
        <p className="text-xs text-ink-muted">{londonTime(g.kickoff)}</p>
        {!g.kalshiListed && (
          <p className="text-xs italic text-ink-muted">Kalshi not yet listed</p>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2 sm:max-w-md">
        <ProbabilityBar markers={markers} />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <VenueNumber label="Kalshi" quote={g.kalshi} color={KALSHI_COLOR} />
          <VenueNumber label="Polymarket" quote={g.polymarket} color={POLYMARKET_COLOR} />
          {g.books?.probHome != null && (
            <span className="text-ink-muted" title={`Books refresh Tue/Fri only — as of ${new Date(g.books.generatedAt).toLocaleString("en-GB", { day: "numeric", month: "short" })}`}>
              <SourceLegendDot color={BOOKS_COLOR} muted /> Books {pct(g.books.probHome)}
            </span>
          )}
          {g.gapPts != null && (
            <span
              className={highlighted ? "font-semibold" : "text-ink-muted"}
              title="|Kalshi − Polymarket|"
            >
              Δ {g.gapPts.toFixed(1)}pts
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryStrip({ games }: { games: MarketGame[] }) {
  if (games.length === 0) return null;
  const firstWeek = games.reduce((min, g) => (g.week < min ? g.week : min), games[0].week);
  const thisWeekGames = games.filter((g) => g.week === firstWeek);

  const biggestGap = thisWeekGames.reduce<MarketGame | null>((best, g) => {
    if (g.gapPts == null) return best;
    if (!best || best.gapPts == null || g.gapPts > best.gapPts) return g;
    return best;
  }, null);

  const mostTraded = thisWeekGames.reduce<MarketGame | null>((best, g) => {
    if (!best || gameVolume(g) > gameVolume(best)) return g;
    return best;
  }, null);

  const items: { label: string; content: string }[] = [
    { label: "Games covered", content: String(games.length) },
  ];
  if (biggestGap) {
    items.push({
      label: "Biggest gap this week",
      content: `${biggestGap.away} @ ${biggestGap.home} · ${biggestGap.gapPts?.toFixed(1)}pts`,
    });
  }
  if (mostTraded && gameVolume(mostTraded) > 0) {
    items.push({
      label: "Most-traded this week",
      content: `${mostTraded.away} @ ${mostTraded.home} · $${Math.round(gameVolume(mostTraded)).toLocaleString()}`,
    });
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {items.map((it) => (
        <div key={it.label} className="rounded-lg border border-hairline bg-surface px-3 py-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{it.label}</p>
          <p className="mt-1 text-sm text-ink-secondary">{it.content}</p>
        </div>
      ))}
    </div>
  );
}

function MarketsInner() {
  const params = useSearchParams();
  const router = useRouter();

  const [data, setData] = useState<MarketsResponse | null>(null);
  const [teamIndex, setTeamIndex] = useState<TeamIndex | null>(null);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // No setState synchronously in the effect body itself (only inside the
  // eventual .then()/.catch(), same pattern as /matchups) — the mount
  // effect below calls this without touching `refreshing` at all; only the
  // manual refresh button (an event handler, not an effect) sets it.
  const fetchMarkets = useCallback(() => {
    return fetch("/api/markets", { cache: "no-store" })
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d: MarketsResponse) => { setData(d); setError(false); })
      .catch(() => setError(true));
  }, []);

  useEffect(() => {
    fetchMarkets();
    fetch("/data/teams/index.json")
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then(setTeamIndex)
      .catch(() => setTeamIndex(null));
  }, [fetchMarkets]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchMarkets().finally(() => setRefreshing(false));
  };

  const meta: Record<string, TeamIndexEntry> = useMemo(() => {
    const out: Record<string, TeamIndexEntry> = {};
    for (const t of teamIndex?.teams ?? []) out[t.franchise] = t;
    return out;
  }, [teamIndex]);

  const sortParam = params.get("sort");
  const sort: SortMode = sortParam === "gap" || sortParam === "volume" ? sortParam : "kickoff";
  const bothOnly = params.get("both") === "1";

  const setParam = (key: string, value: string | null) => {
    const q = new URLSearchParams(params.toString());
    if (value == null) q.delete(key);
    else q.set(key, value);
    router.replace(`/markets?${q}`);
  };

  const allGames = useMemo(() => data?.games ?? [], [data]);
  const filtered = useMemo(
    () => (bothOnly ? allGames.filter((g) => g.kalshiListed && g.polymarket) : allGames),
    [allGames, bothOnly]
  );

  const sorted = useMemo(() => {
    const copy = [...filtered];
    if (sort === "gap") {
      copy.sort((a, b) => (b.gapPts ?? -1) - (a.gapPts ?? -1));
    } else if (sort === "volume") {
      copy.sort((a, b) => gameVolume(b) - gameVolume(a));
    } else {
      copy.sort((a, b) => {
        const ak = a.kickoff ?? "9999";
        const bk = b.kickoff ?? "9999";
        return ak < bk ? -1 : ak > bk ? 1 : a.gameId.localeCompare(b.gameId);
      });
    }
    return copy;
  }, [filtered, sort]);

  // Grouped by week, but only when sorting by kickoff — a gap/volume sort
  // is explicitly asking to see the flat cross-week ranking instead.
  const grouped = useMemo(() => {
    if (sort !== "kickoff") return null;
    const byWeek = new Map<string, MarketGame[]>();
    for (const g of sorted) {
      if (!byWeek.has(g.week)) byWeek.set(g.week, []);
      byWeek.get(g.week)!.push(g);
    }
    return [...byWeek.entries()].sort((a, b) => Number(a[0]) - Number(b[0]));
  }, [sorted, sort]);

  const loading = !data && !error;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-10">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Markets</h1>
        <div className="flex items-center gap-3 text-sm text-ink-muted">
          {data && <span>Prices as of {hhmm(data.generatedAt)} (Europe/London)</span>}
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="rounded border border-hairline bg-surface px-2.5 py-1 text-xs font-medium hover:bg-[var(--pct-mid)] disabled:opacity-50"
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      <p className="rounded-lg border border-hairline bg-surface px-4 py-2.5 text-xs text-ink-secondary">
        Kalshi and Polymarket prices are near-live (cached up to ~2 minutes). Sportsbook (&quot;Books&quot;) prices
        refresh only Tuesday/Friday with the rest of the site — shown muted, with their own as-of date.
      </p>

      {data?.errors && data.errors.length > 0 && (
        <p className="rounded-lg border border-hairline px-4 py-2.5 text-xs" style={{ background: "var(--pct-lo-1)" }}>
          {data.errors.map((e) => `${e.venue}: ${e.message}`).join(" · ")}
        </p>
      )}

      {error && <p className="text-ink-muted">Couldn&apos;t load market data.</p>}
      {loading && !error && <p className="text-ink-muted">Loading…</p>}

      {!loading && !error && (
        <>
          <SummaryStrip games={allGames} />

          <div className="flex flex-wrap items-end gap-3">
            <Select label="Sort" value={sort} onChange={(v) => setParam("sort", v === "kickoff" ? null : v)}>
              <option value="kickoff">Kickoff (default)</option>
              <option value="gap">Biggest gap</option>
              <option value="volume">Volume</option>
            </Select>
            <label className="flex items-center gap-2 pb-1.5 text-sm">
              <input
                type="checkbox"
                checked={bothOnly}
                onChange={(e) => setParam("both", e.target.checked ? "1" : null)}
              />
              Only games on both venues
            </label>
          </div>

          {sorted.length === 0 && (
            <p className="text-ink-muted">No upcoming games with a market price right now.</p>
          )}

          {grouped ? (
            <div className="flex flex-col gap-5">
              {grouped.map(([week, games]) => (
                <div key={week} className="flex flex-col gap-2">
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Week {week}</h2>
                  <div className="flex flex-col gap-2">
                    {games.map((g) => <MarketRow key={g.gameId} g={g} meta={meta} />)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {sorted.map((g) => <MarketRow key={g.gameId} g={g} meta={meta} />)}
            </div>
          )}
        </>
      )}

      <p className="text-xs text-ink-muted">
        Market prices are implied probabilities from public exchange data; not betting advice.
      </p>
    </main>
  );
}

export default function MarketsPage() {
  return (
    <Suspense fallback={
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Markets</h1>
        <p className="text-ink-muted">Loading…</p>
      </main>
    }>
      <MarketsInner />
    </Suspense>
  );
}
