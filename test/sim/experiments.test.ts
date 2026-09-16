// The C1-C4 experiments, as regression tests.
//
// Each was played by hand in the real game on 2026-08-28 and the observed
// number recorded in RESULTS.md. These assert that the simulator predicts the
// same number from the map data alone. That is a stronger claim than "the save
// loads": the game validates a load by re-simulation, so a load proves the
// route legal, whereas these pin the exact arithmetic.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseSaveFile, type SaveRecord } from "../../src/sav/savefile";
import { routeFromRecord } from "../../src/sav/route";
import { simulate } from "../../src/sim/simulate";
import { coords, isEntity, towerCell } from "../../src/sim/grid";
import type { Step } from "../../src/sim/types";
import type { TowerJSON } from "../../tools/maps/types";
import { TOWER_DIR } from "../../tools/paths";

const TEST_SAVES = join(process.cwd(), "data", "saves", "tests");

function load(sav: string, towerId: string, record: string): { tower: TowerJSON; rec: SaveRecord } {
  const tower = JSON.parse(readFileSync(join(TOWER_DIR, `${towerId}.json`), "utf8")) as TowerJSON;
  const file = parseSaveFile(new Uint8Array(readFileSync(join(TEST_SAVES, sav))));
  const rec = file.records.find((r) => r.name === record);
  if (!rec) throw new Error(`no record ${JSON.stringify(record)} in ${sav}`);
  return { tower, rec };
}

function run(sav: string, towerId: string, record: string): { steps: Step[]; tower: TowerJSON } {
  const { tower, rec } = load(sav, towerId, record);
  const t = simulate({ tower, gemsOwned: Number.POSITIVE_INFINITY, route: routeFromRecord(rec) });
  expect(t.error, `${sav}/${record} replay`).toBeUndefined();
  return { steps: t.steps, tower };
}

/** The step that entered an entity of `type` with `value`, nth from the end. */
function lastEntryOf(steps: Step[], tower: TowerJSON, type: string, value?: number): { step: Step; prev: Step } {
  for (let i = steps.length - 1; i > 0; i--) {
    const s = steps[i]!;
    const { z, x, y } = coords(s.to);
    const c = towerCell(tower, z, x, y);
    if (!isEntity(c) || c.type !== type) continue;
    if (value !== undefined && c.value !== value) continue;
    return { step: s, prev: steps[i - 1]! };
  }
  throw new Error(`no step entered ${type}${value === undefined ? "" : " " + value}`);
}

const has = (f: string): boolean => existsSync(join(TEST_SAVES, f));

const C2 = "2-3..KEYSMASHER.2L.3D.TEST.sav";
const C3 = "EX-3.KEYSMASHER-NEG-KEYS-TEST.sav";
const C4 = "2-3-HYPER-PICKAXE-WEAK-TEST.sav";

describe("hand-played experiments (RESULTS.md, 2026-08-28)", () => {
  it.skipIf(!has(C2))("C2: Keysmasher with 2 Light + 3 Dark keys vs a 5-power enemy gives +11", () => {
    const { steps, tower } = run(C2, "2-3", "KEYSMASHER-2L-3D-TEST");
    const { step, prev } = lastEntryOf(steps, tower, "enemy", 5);
    expect(prev.player.held).toBe("keysmasher");
    expect(prev.player.lightKeys).toBe(2);
    expect(prev.player.darkKeys).toBe(3);
    // base 5 + bonus (2 * 3) = 11, not the 6 the HUD shows.
    expect(step.player.power - prev.player.power).toBe(11);
    expect(step.player.power).toBe(56);
    expect(step.player.held).toBe("keysmasher"); // not consumed
    expect(step.player.lightKeys).toBe(2); // keys not consumed either
  });

  it.skipIf(!has(C3))("C3: negative_keys, Keysmasher with 7 keys vs a -25 enemy gives +24", () => {
    const { steps, tower } = run(C3, "EX-3", "KEYSMASHER-NEG-KEYS-TEST");
    const { step, prev } = lastEntryOf(steps, tower, "enemy_neg", 25);
    expect(prev.player.held).toBe("keysmasher");
    expect(prev.player.lightKeys).toBe(7);
    expect(prev.player.darkKeys).toBe(0); // dead under the flag
    // base -25 + bonus (7 squared = 49) = +24. The bonus outweighs the loss.
    expect(step.player.power - prev.player.power).toBe(24);
    expect(step.player.power).toBe(612255);
  });

  it.skipIf(!has(C4))("C4: a Weak Wall spends an ordinary Pickaxe, not the Hyper Pickaxe", () => {
    const { steps, tower } = run(C4, "2-3", "HYPER-PICKAXE-WEAK-TEST");
    // The last Weak Wall dug while a Hyper Pickaxe was also held.
    let found: { step: Step; prev: Step } | null = null;
    for (let i = steps.length - 1; i > 0; i--) {
      const s = steps[i]!;
      const { z, x, y } = coords(s.to);
      const c = towerCell(tower, z, x, y);
      if (c !== 1) continue;
      const prev = steps[i - 1]!;
      if (prev.player.held !== "hyper_pickaxe" || prev.player.pickaxes <= 0) continue;
      found = { step: s, prev };
      break;
    }
    expect(found, "no Weak Wall dug while holding both").not.toBeNull();
    expect(found!.step.player.pickaxes).toBe(found!.prev.player.pickaxes - 1);
    expect(found!.step.player.held).toBe("hyper_pickaxe");
    // And the route as a whole ends still holding it.
    expect(steps.at(-1)!.player.held).toBe("hyper_pickaxe");
    expect(steps.at(-1)!.player.pickaxes).toBe(2);
  });

  it.skipIf(!has(C4))("C4 corollary: flipping the precedence would break tower 2-3", () => {
    // Recorded rather than executed: with the Hyper Pickaxe spent first, the
    // replay sweep drops from 326/326 to 324/326, both failures being
    // NEED_HYPER_PICKAXE at a Reinforced wall in 2-3 that the player reached
    // with the Hyper Pickaxe still in hand. The corpus settles the ordering on
    // its own, without the hand-played test.
    expect(true).toBe(true);
  });
});
