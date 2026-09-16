// What the replay sweep actually exercises. An oracle that passes is only as
// good as the rules it touches, so this counts entity entries per type across
// every replayed record.

import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { parseSaveFile } from "../../src/sav/savefile";
import { hasOrbMoves, routeFromRecord } from "../../src/sav/route";
import { simulate } from "../../src/sim/simulate";
import { coords, towerCell, isEntity } from "../../src/sim/grid";
import type { TowerJSON } from "../../tools/maps/types";
import { TOWER_DIR } from "../paths";


function main(): void {
  const dir = process.argv[2]!;
  const counts = new Map<string, number>();
  const towers = new Map<string, Set<string>>();
  let steps = 0;
  let records = 0;
  const bump = (k: string, towerId: string): void => {
    counts.set(k, (counts.get(k) ?? 0) + 1);
    if (!towers.has(k)) towers.set(k, new Set());
    towers.get(k)!.add(towerId);
  };

  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sav")).sort()) {
    const towerId = basename(f, ".sav");
    const tower = JSON.parse(readFileSync(join(TOWER_DIR, `${towerId}.json`), "utf8")) as TowerJSON;
    for (const rec of parseSaveFile(new Uint8Array(readFileSync(join(dir, f)))).records) {
      if (hasOrbMoves(rec)) continue;
      const t = simulate({ tower, gemsOwned: Number.POSITIVE_INFINITY, route: routeFromRecord(rec) });
      if (t.error) continue;
      records++;
      steps += t.steps.length;
      for (const s of t.steps) {
        const { z, x, y } = coords(s.to);
        const c = towerCell(tower, z, x, y);
        if (isEntity(c)) bump(c.type, towerId);
        else if (c !== 0) bump(`wall_${c}`, towerId);
        if (s.edits.some((e) => e.after === 2)) bump("popup_converted", towerId);
      }
    }
  }

  console.log(`\nreplay coverage: ${records} records, ${steps} steps\n`);
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  for (const [k, n] of rows) {
    console.log(`  ${k.padEnd(20)} ${String(n).padStart(7)}   towers: ${[...towers.get(k)!].sort().join(" ")}`);
  }
}

main();
