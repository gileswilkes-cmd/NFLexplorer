// Console report for a week's unit matchups, sorted by interest score.
// Used at the MATCHUPS_SPEC.md gate to inspect tags before the UI is built,
// and useful afterward for spot-checking any week without the browser.
//
// Usage: node scripts/report-week.ts [week]   (defaults to the next upcoming week)

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  computeWeekMatchups,
  defaultWeek,
  type ScheduleDoc,
  type UnitRatingsDoc,
} from "../src/lib/matchups.ts";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const dataDir = join(repoRoot, "public", "data", "matchups");

const ratingsDoc: UnitRatingsDoc = JSON.parse(
  readFileSync(join(dataDir, "unit_ratings.json"), "utf-8")
);
const scheduleDoc: ScheduleDoc = JSON.parse(
  readFileSync(join(dataDir, "schedule_2026.json"), "utf-8")
);

const week = process.argv[2] ?? defaultWeek(scheduleDoc);
console.log(`Week ${week} — unit matchups, sorted by interest score`);
console.log(`(ratings basis: ${ratingsDoc.season_basis} EPA/play, pure — no offseason adjustment)\n`);

const games = computeWeekMatchups(week, scheduleDoc, ratingsDoc);
if (games.length === 0) {
  console.log(`No games found for week ${week}.`);
  process.exit(1);
}

for (const { game, matchups, tags, interest } of games) {
  console.log(
    `${game.away} @ ${game.home}  (${game.date})  interest=${interest.toFixed(1)}  [${tags.join(", ")}]`
  );
  for (const m of matchups) {
    const dir = m.edge > 0 ? "offence favoured" : m.edge < 0 ? "defence favoured" : "even";
    const tagStr = m.tag ? `  -> ${m.tag}` : "";
    console.log(
      `    ${m.offTeam} ${m.kind} O (#${m.offRank}) vs ${m.defTeam} ${m.kind} D (#${m.defRank})` +
        `  edge=${m.edge >= 0 ? "+" : ""}${m.edge} (${dir})${tagStr}`
    );
  }
  console.log();
}
