// Replay sweep harness (SPEC-004 §11 oracle 1) as a CLI, so a failing route can
// be inspected without a test runner in the way.
//
//   npx tsx tools/sav/replay.ts <save-dir> [towerFilter] [saveFilter]

import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { parseSaveFile } from "../../src/sav/savefile";
import { hasOrbMoves, routeFromRecord } from "../../src/sav/route";
import { simulate } from "../../src/sim/simulate";
import { coords } from "../../src/sim/grid";
import type { TowerJSON } from "../../tools/maps/types";

const TOWER_DIR = join(process.cwd(), "data", "towers", "v0.7-455");

export function loadTower(id: string): TowerJSON {
  return JSON.parse(readFileSync(join(TOWER_DIR, `${id}.json`), "utf8")) as TowerJSON;
}

function main(): void {
  const dir = process.argv[2]!;
  const towerFilter = process.argv[3];
  const saveFilter = process.argv[4];

  let ok = 0;
  let failed = 0;
  let skipped = 0;
  const failures: string[] = [];

  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sav")).sort()) {
    const towerId = basename(f, ".sav");
    if (towerFilter && towerId !== towerFilter) continue;
    const tower = loadTower(towerId);
    const file = parseSaveFile(new Uint8Array(readFileSync(join(dir, f))));

    for (const rec of file.records) {
      if (saveFilter && rec.name !== saveFilter) continue;
      if (hasOrbMoves(rec)) {
        skipped++;
        continue;
      }
      const route = routeFromRecord(rec);
      const t = simulate({ tower, gemsOwned: Number.POSITIVE_INFINITY, route });
      if (t.error) {
        failed++;
        const e = t.error;
        const c = e.at;
        const wp = route[e.waypointIndex];
        const prev = t.steps.at(-1);
        const pp = prev ? prev.player : t.initial;
        failures.push(
          `${towerId} / ${rec.name}\n` +
            `    ${e.code} at waypoint ${e.waypointIndex}/${route.length} -> (z=${c.z}, x=${c.x}, y=${c.y})` +
            (e.have !== undefined ? `  have=${e.have} need=${e.need}` : "") +
            `\n    waypoint was (z=${wp?.z}, x=${wp?.x}, y=${wp?.y}); player at (z=${pp.z}, x=${pp.x}, y=${pp.y}) ` +
            `power=${pp.power} gold=${pp.gold} lk=${pp.lightKeys} dk=${pp.darkKeys} px=${pp.pickaxes} held=${pp.held}` +
            `\n    steps simulated: ${t.steps.length}`,
        );
      } else {
        ok++;
      }
    }
  }

  console.log(`\nreplay sweep: ${ok} clean, ${failed} failed, ${skipped} skipped (orb moves)`);
  if (failures.length > 0) {
    console.log(`\nfirst ${Math.min(12, failures.length)} failures:\n`);
    for (const s of failures.slice(0, 12)) console.log("  " + s + "\n");
  }
  void coords;
}

main();
