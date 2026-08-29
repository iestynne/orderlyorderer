// SPEC-002 A1 — metadata.computed_flags carries all five keys the game's own
// table carries, not just the three decoded from the flags int.
//
// Diagnostic, per D18: the expected sets below are pinned literals, not a
// second copy of the derivation. A wrong rule changes which towers appear.
//   - EX-2 is the load-bearing case. It has money_door but no money, so an
//     implementation that scanned only for "money" passes on all 15 other
//     towers and fails here alone.
//   - money_system towers span floors far from floor 1, so a scan that
//     stopped early would drop towers from the set.

import { describe, expect, it } from "vitest";
import { TOWER_IDS } from "../../../tools/maps/types";
import { loadAllTowers, loadTower } from "./helpers";

const MONEY_SYSTEM = new Set(["2-1", "2-2", "2-3", "2-4", "2-5", "2-6", "EX-2"]);
const ORBS_EXIST = new Set(["3-1"]);

describe("computed_flags (SPEC-002 A1)", () => {
  it.each(TOWER_IDS)("tower %s has the expected money_system / orbs_exist", (id) => {
    const { parsed } = loadTower(id);
    const flags = parsed.metadata.computed_flags;
    expect(flags.money_system).toBe(MONEY_SYSTEM.has(id) ? true : undefined);
    expect(flags.orbs_exist).toBe(ORBS_EXIST.has(id) ? true : undefined);
  });

  it("EX-2 sets money_system from money_door alone, with no money entity", () => {
    const { parsed } = loadTower("EX-2");
    const types = new Set(parsed.floors.flatMap((f) => f.entities.map((e) => e.type)));
    expect(types.has("money_door")).toBe(true);
    expect(types.has("money")).toBe(false);
    expect(parsed.metadata.computed_flags.money_system).toBe(true);
  });

  it("omits false keys rather than storing false", () => {
    const { parsed } = loadTower("1-1");
    expect(Object.keys(parsed.metadata.computed_flags)).toEqual([]);
    expect("money_system" in parsed.metadata.computed_flags).toBe(false);
  });

  it("is tower-level: a flag set on any floor holds for the tower", () => {
    // 3-1's orbs are not on floor 1, so a floor-1-only scan would miss them.
    const { parsed } = loadTower("3-1");
    const orbFloors = parsed.floors
      .map((f, i) => (f.entities.some((e) => e.type.startsWith("orb_")) ? i + 1 : 0))
      .filter((n) => n > 0);
    expect(orbFloors.length).toBeGreaterThan(0);
    expect(orbFloors).not.toContain(1);
    expect(parsed.metadata.computed_flags.orbs_exist).toBe(true);
  });

  it("leaves the three flag-bit keys untouched across all 16 towers", () => {
    // Guards the amendment itself: adding two scanned keys must not perturb
    // the decoded ones. flags & 7 reproduces exactly the bit-derived subset.
    for (const { id, parsed } of loadAllTowers()) {
      const { flags, computed_flags: cf } = parsed.metadata;
      expect({ id, n: cf.negative_keys === true ? 1 : 0 }).toEqual({ id, n: flags & 1 });
      expect({ id, u: cf.uncapped_elixirs === true ? 2 : 0 }).toEqual({ id, u: flags & 2 });
      expect({ id, p: cf.non_persistent_items_ex_4 === true ? 4 : 0 }).toEqual({ id, p: flags & 4 });
    }
  });
});
