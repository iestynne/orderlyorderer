// SPEC-004 §11 oracle 3 / SPEC-005 §10 oracle 2, against real game exports.
//
// The fiercest check in the project. The hi-score oracle compares one number
// per tower; this compares every tile. A cell the simulator wrongly leaves
// alone fails just as loudly as one it wrongly changes.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decodePng, distinctColors } from "../../src/mapdiff/png";
import { panelGrid } from "../../src/mapdiff/geometry";
import { verifyFinalState, textboxMaskKeys } from "../../src/mapdiff/verify";
import { diffTowerJson, towerJsonFromPng, towerJsonFromSim } from "../../src/mapdiff/towerjson";
import { parseSaveFile } from "../../src/sav/savefile";
import { routeFromRecord } from "../../src/sav/route";
import { simulate } from "../../src/sim/simulate";
import type { TowerJSON } from "../../tools/maps/types";

const MAPS = join(process.cwd(), "data", "reference", "maps", "tests");
const SAVES = join(process.cwd(), "data", "saves", "iestyn.2026.08.28");
const TOWERS = join(process.cwd(), "data", "towers", "v0.7-455");

/** `<tower-id>.<save name>.png`, so the fixture names its own inputs. */
interface Fixture {
  file: string;
  towerId: string;
  record: string;
}

function fixtures(): Fixture[] {
  if (!existsSync(MAPS)) return [];
  return readdirSync(MAPS)
    .filter((f) => f.endsWith(".png"))
    .map((f) => {
      const stem = f.slice(0, -4);
      const dot = stem.indexOf(".");
      return { file: f, towerId: stem.slice(0, dot), record: stem.slice(dot + 1) };
    });
}

const found = fixtures();
const d = found.length > 0 ? describe : describe.skip;

d("map export golden oracle", () => {
  it("found the export fixtures", () => {
    expect(found.length).toBeGreaterThan(0);
  });

  for (const fx of found) {
    describe(`${fx.towerId} — "${fx.record}"`, () => {
      const tower = JSON.parse(readFileSync(join(TOWERS, `${fx.towerId}.json`), "utf8")) as TowerJSON;
      const png = decodePng(new Uint8Array(readFileSync(join(MAPS, fx.file))));
      const rec = parseSaveFile(new Uint8Array(readFileSync(join(SAVES, `${fx.towerId}.sav`)))).records.find((r) => r.name === fx.record);
      if (rec === undefined) throw new Error(`no save record "${fx.record}" in ${fx.towerId}.sav`);
      const timeline = simulate({ tower, gemsOwned: Number.POSITIVE_INFINITY, route: routeFromRecord(rec) });
      const end = timeline.steps.at(-1)!.player;
      const masked = new Set<string>(textboxMaskKeys(tower));
      masked.add(`${end.z},${end.x},${end.y}`);

      it("is a lossless palette PNG matching the tower's panel grid", () => {
        expect(png.colorType).toBe(3);
        expect(distinctColors(png).size).toBeLessThanOrEqual(16);
        const g = panelGrid(png);
        expect(g.slots).toBeGreaterThanOrEqual(tower.floors.length);
        expect(g.slots - tower.floors.length).toBeLessThan(g.cols); // unused slots trail
      });

      it("replays without error", () => {
        expect(timeline.error).toBeUndefined();
        expect(timeline.steps.length).toBeGreaterThan(0);
      });

      it("every predicted cell kind renders identically across the whole tower", () => {
        // The partition check: group the image's cells by what the sim says
        // they are, and assert each group is byte-identical. A single wrong
        // prediction puts that cell in the wrong group and shows as a variant.
        const r = verifyFinalState(png, tower, timeline, { playerCell: { z: end.z, x: end.x, y: end.y } });
        expect(r.inconsistent.map((g) => `${g.kind}: ${g.variants.length} variants`)).toEqual([]);
        expect(r.cellsChecked).toBe(tower.floors.length * 225 - r.masked);
        // Empty floor and a cell that became empty must render the same; that
        // collision is a confirmation, not a problem.
        expect(r.collisions.map((c) => c.kinds.slice().sort().join(" == "))).toEqual(["empty == wall:0"]);
      });

      it("the sim's tower JSON and the PNG's tower JSON are identical, cell for cell", () => {
        // (a) simulator -> tower JSON, (b) PNG -> tower JSON, (c) structural
        // diff. (b) consults the simulator for nothing: its sprite dictionary
        // is anchored on cells that cannot change, so agreement is evidence.
        const fromSim = towerJsonFromSim(tower, timeline, masked);
        const fromPng = towerJsonFromPng(png, tower, { masked });
        const diff = diffTowerJson(fromSim, fromPng);
        expect(diff.differences).toEqual([]);
        expect(diff.compared).toBe(tower.floors.length * 225 - masked.size);
        expect(diff.skipped).toBe(masked.size);
      });
    });
  }
});
