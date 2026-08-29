// Verify a final-state map export against the simulator.
//
//   npx tsx tools/mapdiff/verify.ts <png> <tower-id> <sav> <record>

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decodePng, distinctColors } from "../../src/mapdiff/png";
import { verifyFinalState } from "../../src/mapdiff/verify";
import { panelGrid } from "../../src/mapdiff/geometry";
import { parseSaveFile } from "../../src/sav/savefile";
import { routeFromRecord } from "../../src/sav/route";
import { simulate } from "../../src/sim/simulate";
import type { TowerJSON } from "../../tools/maps/types";

function main(): void {
  const [pngPath, towerId, savPath, record] = process.argv.slice(2);
  const tower = JSON.parse(readFileSync(join("data", "towers", "v0.7-455", `${towerId!}.json`), "utf8")) as TowerJSON;
  const png = decodePng(new Uint8Array(readFileSync(pngPath!)));
  const grid = panelGrid(png);

  console.log(`\n${pngPath}`);
  console.log(`  ${png.width}x${png.height}, colour type ${png.colorType}, ${distinctColors(png).size} distinct colours`);
  console.log(`  panel grid ${grid.cols}x${grid.rows} = ${grid.slots} slots, tower has ${tower.floors.length} floors`);

  const rec = parseSaveFile(new Uint8Array(readFileSync(savPath!))).records.find((r) => r.name === record);
  if (!rec) throw new Error(`no record ${JSON.stringify(record)}`);
  const timeline = simulate({ tower, gemsOwned: Number.POSITIVE_INFINITY, route: routeFromRecord(rec) });
  if (timeline.error) throw new Error(`replay failed: ${timeline.error.code}`);
  const end = timeline.steps.at(-1)!.player;
  console.log(`  route "${record}": ${timeline.steps.length} steps, ends at (z=${end.z},x=${end.x},y=${end.y}) power=${end.power}`);

  const r = verifyFinalState(png, tower, timeline, { playerCell: { z: end.z, x: end.x, y: end.y } });
  console.log(`\n  cells checked: ${r.cellsChecked}   masked: ${r.masked}   distinct predicted kinds: ${r.groups.length}`);

  console.log(`\n  predicted kind                 cells   distinct bands`);
  for (const g of r.groups) {
    console.log(`    ${g.kind.padEnd(28)} ${String(g.count).padStart(5)}   ${g.variants.length}${g.variants.length > 1 ? "   <-- INCONSISTENT" : ""}`);
  }

  if (r.inconsistent.length === 0) {
    console.log(`\n  RESULT: every predicted kind is byte-identical across every cell. ${r.cellsChecked} cells agree.`);
  } else {
    console.log(`\n  RESULT: ${r.inconsistent.length} inconsistent group(s):`);
    for (const g of r.inconsistent) {
      console.log(`    ${g.kind}: ${g.variants.length} variants`);
      for (const v of g.variants) {
        const sample = v.cells.slice(0, 6).map((c) => `(${c.z},${c.x},${c.y})`).join(" ");
        console.log(`      ${String(v.cells.length).padStart(5)} cells  ${sample}${v.cells.length > 6 ? " ..." : ""}`);
      }
    }
  }
  if (r.collisions.length > 0) {
    console.log(`\n  kinds rendering identically (usually benign):`);
    for (const c of r.collisions) console.log(`    ${c.kinds.join(" == ")}`);
  }
}

main();
