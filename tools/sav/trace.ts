// Trace a save record: show every step that changed power or spent a tool, so a
// hand-played experiment can be checked against the simulator move by move.
//
//   npx tsx tools/sav/trace.ts <sav-file> <tower-id> [recordName]

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSaveFile } from "../../src/sav/savefile";
import { hasOrbMoves, routeFromRecord } from "../../src/sav/route";
import { simulate } from "../../src/sim/simulate";
import { coords, towerCell, isEntity } from "../../src/sim/grid";
import type { TowerJSON } from "../../tools/maps/types";

const TOWER_DIR = join(process.cwd(), "data", "towers", "v0.7-455");

function main(): void {
  const [savPath, towerId, recordName] = process.argv.slice(2);
  const tower = JSON.parse(readFileSync(join(TOWER_DIR, `${towerId!}.json`), "utf8")) as TowerJSON;
  const file = parseSaveFile(new Uint8Array(readFileSync(savPath!)));

  for (const rec of file.records) {
    if (recordName && rec.name !== recordName) continue;
    if (hasOrbMoves(rec)) continue;
    const t = simulate({ tower, gemsOwned: Number.POSITIVE_INFINITY, route: routeFromRecord(rec) });
    const p = t.steps.at(-1)?.player ?? t.initial;
    console.log(
      `\n=== ${rec.name} (${rec.entries.length} entries) ${t.error ? "ERROR " + t.error.code : "clean"} ` +
        `final power=${p.power} gold=${p.gold} lk=${p.lightKeys} dk=${p.darkKeys} px=${p.pickaxes} held=${p.held}`,
    );
    if (!recordName) continue;

    let prevPower = t.initial.power;
    let prevHeld = t.initial.held;
    let prevPx = t.initial.pickaxes;
    for (const [i, s] of t.steps.entries()) {
      const { z, x, y } = coords(s.to);
      const c = towerCell(tower, z, x, y);
      const label = isEntity(c) ? `${c.type}${c.value ? " " + c.value_str : ""}` : `wall ${c}`;
      const dPower = s.player.power - prevPower;
      const heldChanged = s.player.held !== prevHeld;
      const pxChanged = s.player.pickaxes !== prevPx;
      if (dPower !== 0 || heldChanged || pxChanged) {
        console.log(
          `  step ${String(i).padStart(4)}  (z=${z},x=${x},y=${y}) ${label.padEnd(18)} ` +
            `power ${prevPower} -> ${s.player.power} (${dPower >= 0 ? "+" : ""}${dPower})` +
            (heldChanged ? `  held ${prevHeld} -> ${s.player.held}` : "") +
            (pxChanged ? `  pickaxes ${prevPx} -> ${s.player.pickaxes}` : "") +
            `  lk=${s.player.lightKeys} dk=${s.player.darkKeys}`,
        );
      }
      prevPower = s.player.power;
      prevHeld = s.player.held;
      prevPx = s.player.pickaxes;
    }
  }
}

main();
