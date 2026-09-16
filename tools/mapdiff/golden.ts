// SPEC-004 §11 oracle 3, as the three-step structure it was specified as:
//   (a) simulator     -> tower JSON
//   (b) PNG extractor -> tower JSON
//   (c) structural diff of the two
//
//   npx tsx tools/mapdiff/golden.ts <png> <tower-id> <sav> <record> [outDir]

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { decodePng } from "../../src/mapdiff/png";
import { towerJsonFromPng, towerJsonFromSim, diffTowerJson } from "../../src/mapdiff/towerjson";
import { textboxMaskKeys } from "../../src/mapdiff/verify";
import { parseSaveFile } from "../../src/sav/savefile";
import { routeFromRecord } from "../../src/sav/route";
import { simulate } from "../../src/sim/simulate";
import { toReviewableJson, type JSONValue } from "../../tools/maps/format";
import type { TowerJSON } from "../../tools/maps/types";
import { TOWER_DIR } from "../paths";

function main(): void {
  const [pngPath, towerId, savPath, record, outDir] = process.argv.slice(2);
  const tower = JSON.parse(readFileSync(join(TOWER_DIR, `${towerId!}.json`), "utf8")) as TowerJSON;
  const png = decodePng(new Uint8Array(readFileSync(pngPath!)));

  const rec = parseSaveFile(new Uint8Array(readFileSync(savPath!))).records.find((r) => r.name === record);
  if (!rec) throw new Error(`no record ${JSON.stringify(record)}`);
  const timeline = simulate({ tower, gemsOwned: Number.POSITIVE_INFINITY, route: routeFromRecord(rec) });
  if (timeline.error) throw new Error(`replay failed: ${timeline.error.code}`);
  const end = timeline.steps.at(-1)!.player;

  const masked = new Set<string>(textboxMaskKeys(tower));
  masked.add(`${end.z},${end.x},${end.y}`);

  const fromSim = towerJsonFromSim(tower, timeline, masked);
  const fromPng = towerJsonFromPng(png, tower, { masked });
  const d = diffTowerJson(fromSim, fromPng);

  console.log(`\ntower ${towerId}, route "${record}" (${timeline.steps.length} steps)`);
  console.log(`  player ends at (z=${end.z}, x=${end.x}, y=${end.y}); ${masked.size} cells masked`);
  console.log(`\n  (a) simulator     -> tower JSON`);
  console.log(`  (b) PNG extractor -> tower JSON   [dictionary learned from the image, sim not consulted]`);
  console.log(`  (c) structural diff`);
  console.log(`\n  cells compared: ${d.compared}   skipped (unknown either side): ${d.skipped}`);
  console.log(`  differences:    ${d.differences.length}`);
  for (const x of d.differences.slice(0, 25)) {
    console.log(`    (z=${x.z}, x=${x.x}, y=${x.y})  sim=${JSON.stringify(x.a)}  png=${JSON.stringify(x.b)}`);
  }
  if (d.differences.length > 25) console.log(`    ... and ${d.differences.length - 25} more`);
  console.log(`\n  RESULT: ${d.differences.length === 0 ? "IDENTICAL — every tile agrees" : "MISMATCH"}`);

  if (outDir) {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, `${towerId}.from-sim.json`), toReviewableJson(fromSim as unknown as JSONValue));
    writeFileSync(join(outDir, `${towerId}.from-png.json`), toReviewableJson(fromPng as unknown as JSONValue));
    console.log(`\n  wrote both tower JSONs to ${outDir}`);
  }
}

main();
