// Which recorded route is the longest? Two measures, because they differ:
// recorded entries (2S+1, the actions) and simulated steps (the actual path,
// with passive walking reconstructed).

import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { parseSaveFile } from "../../src/sav/savefile";
import { hasOrbMoves, routeFromRecord } from "../../src/sav/route";
import { simulate } from "../../src/sim/simulate";
import type { TowerJSON } from "../../tools/maps/types";

const TOWER_DIR = join(process.cwd(), "data", "towers", "v0.7-455");

interface Row {
  towerId: string;
  name: string;
  entries: number;
  steps: number;
  floors: number;
  finalPower: number;
  win: number;
}

function main(): void {
  const dir = process.argv[2]!;
  const rows: Row[] = [];

  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sav")).sort()) {
    const towerId = basename(f, ".sav");
    const tower = JSON.parse(readFileSync(join(TOWER_DIR, `${towerId}.json`), "utf8")) as TowerJSON;
    for (const rec of parseSaveFile(new Uint8Array(readFileSync(join(dir, f)))).records) {
      if (hasOrbMoves(rec)) continue;
      const t = simulate({ tower, gemsOwned: Number.POSITIVE_INFINITY, route: routeFromRecord(rec) });
      if (t.error) continue;
      const last = t.steps.at(-1) ?? { player: t.initial };
      rows.push({
        towerId,
        name: rec.name,
        entries: rec.entries.length,
        steps: t.steps.length,
        floors: tower.floors.length,
        finalPower: last.player.power,
        win: last.player.win,
      });
    }
  }

  const show = (label: string, key: "steps" | "entries"): void => {
    console.log(`\n=== longest by ${label} ===`);
    for (const r of [...rows].sort((a, b) => b[key] - a[key]).slice(0, 8)) {
      console.log(
        `  ${String(r.steps).padStart(6)} steps  ${String(r.entries).padStart(5)} entries  ` +
          `${r.towerId.padEnd(5)} (${String(r.floors).padStart(2)} floors)  ` +
          `power=${String(r.finalPower).padStart(12)}  win=${r.win}  "${r.name}"`,
      );
    }
  };
  show("simulated steps (actual path length)", "steps");
  show("recorded entries (actions)", "entries");
  console.log(`\ntotal records considered: ${rows.length}`);
}

main();
