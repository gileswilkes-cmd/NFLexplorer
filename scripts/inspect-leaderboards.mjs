#!/usr/bin/env node
// Prints a leaderboard from public/data/leaderboards/ so a board can be eyeballed
// without opening a 300 KB JSON file.
//
//   node scripts/inspect-leaderboards.mjs career QB int_rate
//   node scripts/inspect-leaderboards.mjs season/2024 RB fumble_rate 15
//   node scripts/inspect-leaderboards.mjs records QB sack_rate
//   node scripts/inspect-leaderboards.mjs career            # list groups/boards
//
// Rate boards (meta.format === "pct") print the raw count and denominator that
// produced the rate, which is the whole point of carrying them in the data.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const [scope = "career", group, stat, limit = "10"] = process.argv.slice(2);

const path = join(ROOT, "public", "data", "leaderboards", `${scope}.json`);
let doc;
try {
  doc = JSON.parse(readFileSync(path, "utf8"));
} catch {
  console.error(`Cannot read ${path} — scope should be "career", "records", or "season/2024".`);
  process.exit(1);
}

const boards = doc.boards ?? {};
if (!group || !stat) {
  console.log(`${scope}.json — ${doc.window ? `window ${doc.window.join("–")}` : `season ${doc.season}`}`);
  for (const [g, b] of Object.entries(boards)) console.log(`  ${g}: ${Object.keys(b).join(", ")}`);
  process.exit(0);
}

const board = boards[group]?.[stat];
if (!board) {
  console.error(`No board ${group}/${stat} in ${scope}.json. Available: ${Object.keys(boards[group] ?? {}).join(", ") || "(no such group)"}`);
  process.exit(1);
}

const pct = board.format === "pct";
const fmt = (v) => (pct ? `${(v * 100).toFixed(1)}%` : String(v));

console.log(`${board.label} — ${group}, ${scope}${doc.window ? ` (${doc.window.join("–")})` : ""}`);
console.log(`direction: ${board.direction}   qualifier: ${board.qualifier ?? "none"}   entries: ${board.entries.length}`);
console.log("");
for (const e of board.entries.slice(0, Number(limit))) {
  const context = pct && e.count !== undefined
    ? `  (${e.count} ${board.count_label} / ${e.denom} ${board.denom_label})`
    : "";
  const season = e.season ? ` ${e.season}` : "";
  console.log(
    `${String(e.rank).padStart(3)}. ${(e.name + season).padEnd(26)} ${(e.team ?? "").padEnd(4)} ${fmt(e.value).padStart(8)}${context}`,
  );
}
