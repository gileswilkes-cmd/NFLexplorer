// Horizontal home-win-probability bar with one marker per source
// (Kalshi/Polymarket/books) — the point is making cross-source disagreement
// visible at a glance (nfl_markets_page_cc_prompt.md).

export interface BarMarker {
  key: string;
  label: string;
  probHome: number; // 0-1
  color: string; // CSS color/var
  muted?: boolean;
  title?: string; // tooltip, e.g. thin-market or disagreement explanation
}

export function ProbabilityBar({ markers }: { markers: BarMarker[] }) {
  return (
    <div className="relative h-2 w-full rounded-full" style={{ background: "var(--pct-mid)" }}>
      {/* 50% gridline — away/home pick'em reference point */}
      <div
        className="absolute top-0 h-full w-px"
        style={{ left: "50%", background: "var(--hairline)" }}
      />
      {markers.map((m) => (
        <span
          key={m.key}
          title={m.title ?? `${m.label}: ${Math.round(m.probHome * 100)}%`}
          className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2"
          style={{
            left: `${Math.min(100, Math.max(0, m.probHome * 100))}%`,
            background: m.muted ? "var(--surface)" : m.color,
            borderColor: m.color,
            opacity: m.muted ? 0.6 : 1,
          }}
        />
      ))}
    </div>
  );
}

export function SourceLegendDot({ color, muted }: { color: string; muted?: boolean }) {
  return (
    <span
      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border-2"
      style={{ background: muted ? "var(--surface)" : color, borderColor: color, opacity: muted ? 0.6 : 1 }}
    />
  );
}
