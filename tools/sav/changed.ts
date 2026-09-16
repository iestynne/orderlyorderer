// Which route changes the most tower state? That -- not path length -- is what
// a final-state map diff actually validates: every changed cell is an assertion,
// and every unchanged cell is one too.

import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { parseSaveFile } from "../../src/sav/savefile";
import { hasOrbMoves, routeFromRecord } from "../../src/sav/route";
import { simulate } from "../../src/sim/simulate";
import { CellState } from "../../src/sim/types";
import type { TowerJSON } from "../../tools/maps/types";
import { TOWER_DIR } from "../paths";


function main(): void {
  const dir = process.argv[2]!;
  const rows: Array<{
    towerId: string; name: string; steps: number; floors: number;
    gone: number; reinforced: number; cells: number;
  }> = [];

  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sav")).sort()) {
    const towerId = basename(f, ".sav");
    const tower = JSON.parse(readFileSync(join(TOWER_DIR, `${towerId}.json`), "utf8")) as TowerJSON;
    for (const rec of parseSaveFile(new Uint8Array(readFileSync(join(dir, f)))).records) {
      if (hasOrbMoves(rec)) continue;
      const t = simulate({ tower, gemsOwned: Number.POSITIVE_INFINITY, route: routeFromRecord(rec) });
      if (t.error || t.steps.length === 0) continue;

      // Fold the journal to the final cell state.
      const final = new Map<number, CellState>();
      for (const s of t.steps) for (const e of s.edits) final.set(e.addr, e.after);
      let gone = 0;
      let reinforced = 0;
      for (const v of final.values()) {
        if (v === CellState.Gone) gone++;
        else if (v === CellState.Reinforced) reinforced++;
      }
      rows.push({
        towerId, name: rec.name, steps: t.steps.length, floors: tower.floors.length,
        gone, reinforced, cells: tower.floors.length * 225,
      });
    }
  }

  console.log("\n=== most tower state changed (the fiercest map-diff target) ===\n");
  for (const r of rows.sort((a, b) => b.gone + b.reinforced - (a.gone + a.reinforced)).slice(0, 10)) {
    const changed = r.gone + r.reinforced;
    console.log(
      `  ${String(changed).padStart(4)} cells changed  (${String(r.gone).padStart(4)} emptied, ` +
        `${String(r.reinforced).padStart(3)} reinforced)  of ${String(r.cells).padStart(4)}  ` +
        `${r.towerId.padEnd(5)} ${String(r.floors).padStart(2)}f  ${String(r.steps).padStart(5)} steps  "${r.name}"`,
    );
  }
}

main();
