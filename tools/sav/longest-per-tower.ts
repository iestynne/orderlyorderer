// The save record with the most undo-history entries in each tower.
//
// Entries, not simulated steps: an entry is a recorded state change, so it is
// what bounds how much tower state a route can have altered. Passive walking
// reconstructed by the pathfinder changes nothing and is irrelevant to a map
// diff.
//
//   npx tsx tools/sav/longest-per-tower.ts <save-dir>

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { basename, join } from "node:path";
import { parseSaveFile } from "../../src/sav/savefile";
import { hasOrbMoves, routeFromRecord } from "../../src/sav/route";
import { simulate } from "../../src/sim/simulate";
import { CellState } from "../../src/sim/types";
import type { TowerJSON } from "../../tools/maps/types";

const TOWER_DIR = join(process.cwd(), "data", "towers", "v0.7-455");
const MAPS_DIR = join(process.cwd(), "data", "reference", "maps", "tests");

function main(): void {
  const dir = process.argv[2]!;
  const existing = existsSync(MAPS_DIR) ? readdirSync(MAPS_DIR).filter((f) => f.endsWith(".png")) : [];

  console.log(
    `\n${"tower".padEnd(6)}${"floors".padStart(7)}${"entries".padStart(9)}${"changed".padStart(9)}  save record`,
  );
  console.log("-".repeat(96));

  let totalCells = 0;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sav")).sort()) {
    const towerId = basename(f, ".sav");
    const tower = JSON.parse(readFileSync(join(TOWER_DIR, `${towerId}.json`), "utf8")) as TowerJSON;

    let best: { name: string; entries: number; changed: number } | null = null;
    for (const rec of parseSaveFile(new Uint8Array(readFileSync(join(dir, f)))).records) {
      if (hasOrbMoves(rec)) continue;
      if (best !== null && rec.entries.length <= best.entries) continue;
      const t = simulate({ tower, gemsOwned: Number.POSITIVE_INFINITY, route: routeFromRecord(rec) });
      if (t.error) continue;
      const final = new Map<number, CellState>();
      for (const s of t.steps) for (const e of s.edits) final.set(e.addr, e.after);
      best = { name: rec.name, entries: rec.entries.length, changed: final.size };
    }
    if (best === null) continue;

    const have = existing.find((p) => p === `${towerId}.${best!.name}.png`);
    const haveOther = existing.find((p) => p.startsWith(`${towerId}.`));
    totalCells += tower.floors.length * 225;
    console.log(
      `${towerId.padEnd(6)}${String(tower.floors.length).padStart(7)}${String(best.entries).padStart(9)}` +
        `${String(best.changed).padStart(9)}  "${best.name}"` +
        (have ? "   [PNG already present]" : haveOther ? `   [have a PNG, but for "${haveOther.slice(towerId.length + 1, -4)}"]` : ""),
    );
  }
  console.log("-".repeat(96));
  console.log(`total cells if all 14 are exported: ${totalCells}`);
}

main();
