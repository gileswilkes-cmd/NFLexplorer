import { formatPercentile, percentileTier } from "@/lib/percentile";

/** Percentile badge: diverging tint (blue above median, red below), primary-ink
 *  text, tail values displayed as <5 / 95+ per the percentile contract. */
export default function PctBadge({ pct, label }: { pct: number; label: string }) {
  const tier = percentileTier(pct);
  const varName = tier === 0 ? "--pct-mid" : tier > 0 ? `--pct-hi-${tier}` : `--pct-lo-${-tier}`;
  return (
    <span
      className="tabular ml-1 inline-block min-w-[2em] rounded px-1 text-center text-[10px] leading-4 font-medium align-middle"
      style={{ background: `var(${varName})` }}
      title={label}
    >
      {formatPercentile(pct)}
    </span>
  );
}
