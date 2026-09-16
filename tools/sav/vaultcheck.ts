// Does any recorded route actually touch a cell that a level script changes?
// Distinguishes "the design is safe" from "the corpus got lucky".

import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { parseSaveFile } from "../../src/sav/savefile";
import { hasOrbMoves, routeFromRecord } from "../../src/sav/route";
import { simulate } from "../../src/sim/simulate";
import { coords } from "../../src/sim/grid";
import { LEVEL_SCRIPTS } from "../../src/sim/levelScripts";
import type { TowerJSON } from "../../tools/maps/types";
import { TOWER_DIR } from "../paths";


function main(): void {
  const dir = process.argv[2]!;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sav")).sort()) {
    const towerId = basename(f, ".sav");
    const script = LEVEL_SCRIPTS[towerId]?.rapier;
    if (!script) continue;
    const tower = JSON.parse(readFileSync(join(TOWER_DIR, `${towerId}.json`), "utf8")) as TowerJSON;

    const touched = new Map<string, number>();
    const watch = new Set<string>();
    for (const [[x, y]] of script.walls ?? []) watch.add(`${script.floor},${x},${y}`);
    watch.add(`${script.floor},${script.entity.x},${script.entity.y}`);

    let records = 0;
    for (const rec of parseSaveFile(new Uint8Array(readFileSync(join(dir, f)))).records) {
      if (hasOrbMoves(rec)) continue;
      records++;
      const t = simulate({ tower, gemsOwned: Number.POSITIVE_INFINITY, route: routeFromRecord(rec) });
      if (t.error) continue;
      for (const s of t.steps) {
        const { z, x, y } = coords(s.to);
        const k = `${z},${x},${y}`;
        if (watch.has(k)) touched.set(k, (touched.get(k) ?? 0) + 1);
      }
    }
    const cells = watch.size;
    console.log(
      `${towerId.padEnd(5)} floor ${String(script.floor).padStart(2)}  ${cells} script cells  ` +
        `${records} records  ->  ${touched.size === 0 ? "NEVER touched by any route" : `TOUCHED: ${[...touched.entries()].map(([k, n]) => k + " x" + n).join(", ")}`}`,
    );
  }
}

main();
