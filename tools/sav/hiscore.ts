// Hi-score oracle (SPEC-004 §11 oracle 2) as a CLI.
//
//   npx tsx tools/sav/hiscore.ts <save-dir>
//
// For each tower's AUTOSAVE_HISCORE, replay it and compare the score the sim
// says was submitted against the value in the player's `score` file. This is a
// genuine end-state check: it exercises every power-changing rule in the game
// compounded over a whole run, and one wrong rule anywhere moves the total.

import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { parseSaveFile } from "../../src/sav/savefile";
import { parseScoreFile } from "../../src/sav/score";
import { hasOrbMoves, routeFromRecord } from "../../src/sav/route";
import { simulate } from "../../src/sim/simulate";
import type { TowerJSON } from "../../tools/maps/types";
import { TOWER_DIR } from "../paths";


function main(): void {
  const dir = process.argv[2]!;
  const scores = parseScoreFile(readFileSync(join(dir, "score"), "utf8"));

  let pass = 0;
  let fail = 0;
  const rows: string[] = [];

  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sav")).sort()) {
    const towerId = basename(f, ".sav");
    const tower = JSON.parse(readFileSync(join(TOWER_DIR, `${towerId}.json`), "utf8")) as TowerJSON;
    const file = parseSaveFile(new Uint8Array(readFileSync(join(dir, f))));
    const rec = file.records.find((r) => r.name === "AUTOSAVE_HISCORE");

    const expected = scores.get(tower.metadata.name);
    if (rec === undefined || expected === undefined || hasOrbMoves(rec)) {
      rows.push(`${towerId.padEnd(5)} SKIP  ${rec === undefined ? "no AUTOSAVE_HISCORE" : "no score-file entry"}`);
      continue;
    }

    const t = simulate({ tower, gemsOwned: Number.POSITIVE_INFINITY, route: routeFromRecord(rec) });
    if (t.error) {
      fail++;
      rows.push(`${towerId.padEnd(5)} FAIL  replay error ${t.error.code} at waypoint ${t.error.waypointIndex}`);
      continue;
    }
    const p = t.steps.at(-1)?.player ?? t.initial;
    const got = p.submittedScore;
    const okRow = got === expected;
    if (okRow) pass++;
    else fail++;
    const crown = p.win === 2 ? "Dark Crown" : p.win === 1 ? "Crown" : "NO CROWN";
    rows.push(
      `${towerId.padEnd(5)} ${okRow ? "PASS" : "FAIL"}  expected=${String(expected).padStart(12)} ` +
        `got=${String(got).padStart(12)}  final power=${String(p.power).padStart(12)}  ${crown}` +
        (okRow ? "" : `  DELTA=${got - expected}`),
    );
  }

  console.log("\nhi-score oracle (SPEC-004 oracle 2)\n");
  for (const r of rows) console.log("  " + r);
  console.log(`\n  ${pass} pass, ${fail} fail`);
}

main();
