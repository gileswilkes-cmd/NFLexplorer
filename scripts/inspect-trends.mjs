#!/usr/bin/env node
// Prints public/data/trends.json as a table so the series can be sanity-checked
// (the spec's own check: 4th-down go-for-it rate should rise sharply).
//
//   node scripts/inspect-trends.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const doc = JSON.parse(readFileSync(join(ROOT, "public", "data", "trends.json"), "utf8"));
const seasons = doc.metrics[Object.keys(doc.metrics)[0]].series.map((p) => p.season);

const fmt = (v, unit) =>
  v === null ? "  n/a" : unit === "pct" ? `${(v * 100).toFixed(1)}%` : v.toFixed(unit === "epa" ? 3 : 1);

console.log(`trends.json — window ${doc.window.join("–")}, ${Object.keys(doc.metrics).length} metrics\n`);
console.log("".padEnd(32) + seasons.map((s) => String(s).padStart(7)).join("") + "   change");

for (const group of doc.groups) {
  console.log(`\n${group}`);
  for (const m of Object.values(doc.metrics)) {
    if (m.group !== group) continue;
    const vals = m.series.map((p) => p.value);
    const [first, last] = [vals[0], vals.at(-1)];
    // % change is nonsense for a metric that oscillates around zero (EPA/play),
    // so those report the absolute move instead.
    const delta =
      first === null || last === null
        ? "—"
        : m.unit === "epa" || Math.abs(first) < 1e-2
          ? `${last - first >= 0 ? "+" : ""}${(last - first).toFixed(3)}`
          : `${last >= first ? "+" : ""}${(((last - first) / first) * 100).toFixed(0)}%`;
    console.log(
      `  ${m.label.slice(0, 29).padEnd(30)}` +
        vals.map((v) => fmt(v, m.unit).padStart(7)).join("") +
        delta.padStart(9) +
        (m.flags.length ? "  *" : ""),
    );
  }
}

const flagged = Object.entries(doc.metrics).filter(([, m]) => m.flags.length);
console.log(`\n${seasons.at(-1)} flags: ${flagged.length ? "" : "none"}`);
for (const [key, m] of flagged) for (const f of m.flags) console.log(`  * ${key}: ${f}`);
