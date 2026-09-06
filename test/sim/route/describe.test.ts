// SPEC-008 §4.2 — what an action did.
//
// `[D]` The rules that decide an action's kind are here; the sweep over every
// action in the corpus is in `test/ui/session.test.ts`, because it goes through
// the stop model that pairs an action with the state either side of it, and
// re-deriving that here would be a second copy of it to keep in step.

import { describe, expect, it } from "vitest";
import { describeAction, kindOf, type ActionKind } from "../../../src/sim/route/describe";
import type { Cell, HeldItem, Player, TowerJSON } from "../../../src/sim/types";

/** A one-floor tower whose single cell we set per case. */
function towerWith(cell: Cell): TowerJSON {
  const row = (y: number): Cell[] => Array.from({ length: 15 }, (_, x) => (x === 0 && y === 0 ? cell : 0));
  return {
    tower_id: "T",
    metadata: { name: "T", start_floor: 1, start_x: 1, start_y: 2, start_power: 100, computed_flags: {} },
    floors: [{ name: "F1", cells: Array.from({ length: 15 }, (_, y) => row(y)) }],
  } as unknown as TowerJSON;
}

const BASE: Player = {
  z: 1, x: 1, y: 2, power: 100, gold: 0, lightKeys: 0, darkKeys: 0, pickaxes: 0,
  gemsSpent: 0, held: null, pendingPopup: null, win: 0, submittedScore: 0,
};

function say(cell: Cell, before: Partial<Player> = {}, after: Partial<Player> = {}) {
  const b = { ...BASE, ...before };
  return describeAction(towerWith(cell), new Uint8Array(15 * 15), b, { ...b, ...after }, { z: 1, x: 1, y: 1 });
}

const enemy = (value: number): Cell => ({ type: "enemy", value, value_str: String(value) } as unknown as Cell);
const named = (type: string): Cell => ({ type, value: 0, value_str: "0" } as unknown as Cell);

describe("SPEC-008 §4.2 — an action's kind", () => {
  it("reads terrain: empty floor is a walk, walls are a dig, iron is blocked", () => {
    expect(kindOf(0)).toBe("walk");
    expect(kindOf(1)).toBe("dig");
    expect(kindOf(2)).toBe("dig");
    expect(kindOf(3)).toBe("blocked");
  });

  it("sorts every entity the rules resolve into a kind", () => {
    const cases: Array<[string, ActionKind]> = [
      ["enemy", "attack"], ["enemy_neg", "attack"],
      ["door", "gate"], ["dark_door", "gate"], ["money_door", "gate"], ["gem_door", "gate"],
      ["gate", "gate"], ["battle_gate", "gate"],
      ["spikes", "hazard"], ["popup", "hazard"], ["barrier_u", "hazard"], ["barrier_r", "hazard"],
      ["stairs_up", "stairs"], ["stairs_down", "stairs"],
      ["crown", "crown"], ["dark_crown", "crown"],
      ["key", "pickup"], ["dark_key", "pickup"], ["pickaxe", "pickup"], ["money", "pickup"],
      ["elixir", "pickup"], ["shield", "pickup"], ["vorpal", "pickup"], ["master_key", "pickup"],
    ];
    const wrong = cases.filter(([type, want]) => kindOf(named(type)) !== want).map(([t]) => t);
    expect(wrong).toEqual([]);
  });
});

describe("SPEC-008 §4.2 — what an action spent", () => {
  // `[F]` The rules set `held = null` exactly where the game consumes an item,
  // so the description reads the outcome rather than restating the rule (D33).
  it("reports an item the action consumed", () => {
    const cases: Array<[HeldItem, Cell]> = [
      ["master_key", named("door")],
      ["vorpal", enemy(9999)],
      ["light_rod", named("enemy_neg")],
      ["dark_rod", enemy(10)],
      ["hyper_pickaxe", 2],
    ];
    for (const [item, cell] of cases) {
      expect(say(cell, { held: item }, { held: null }).spent, item).toBe(item);
    }
  });

  it("reports a spent pickaxe from the counter, which is not a held item", () => {
    const s = say(1, { pickaxes: 3 }, { pickaxes: 2 });
    expect(s.spent).toBe("pickaxe");
    expect(s.kind).toBe("dig");
  });

  // `[D]` A Shield or a Keysmasher changes the arithmetic and survives, so it is
  // reported as `held` and not as `spent`: the row shows it as context, not as
  // a cost.
  it("separates an item that only changed the outcome from one that was used up", () => {
    const shielded = say(enemy(50), { held: "shield", power: 100 }, { power: 125 });
    expect(shielded.spent).toBeNull();
    expect(shielded.held).toBe("shield");
    expect(shielded.powerDelta).toBe(25);
  });

  it("reports the gold an attack earned", () => {
    expect(say(enemy(50), { gold: 4 }, { gold: 11 }).goldGained).toBe(7);
  });

  it("carries the failure through, where the action is the one that breaks", () => {
    const error = { waypointIndex: 3, stepIndex: 2, code: "ENEMY_TOO_STRONG" as const, at: { z: 1, x: 1, y: 1 }, have: 100, need: 4100 };
    expect(say(enemy(4100)).error).toBeUndefined();
    const s = describeAction(towerWith(enemy(4100)), new Uint8Array(225), BASE, BASE, { z: 1, x: 1, y: 1 }, { error });
    expect(s.error?.code).toBe("ENEMY_TOO_STRONG");
  });
});


/**
 * The 1-6 hover bug: a preview on a genuinely empty square must not revive
 * whatever the tower originally had there. Diagnostic for `hypothetical`
 * (D18) — take the flag out and the last expectation fails, because
 * `towerCell` still holds the pickaxe long after the route took it.
 */
describe("a hypothetical action never revives the initial tower cell", () => {
  const tower = towerWith(named("pickaxe"));
  const gone = new Uint8Array(15 * 15);
  // CellState.Gone is 1: the cell has been taken. addr() of (1,1,1) is 0.
  gone[0] = 1;
  const fresh = new Uint8Array(15 * 15);
  const at = { z: 1, x: 1, y: 1 };

  it("names the entity while it is still there, either way", () => {
    expect(describeAction(tower, fresh, BASE, BASE, at).cell).toMatchObject({ type: "pickaxe" });
    expect(describeAction(tower, fresh, BASE, BASE, at, { hypothetical: true }).cell)
      .toMatchObject({ type: "pickaxe" });
  });

  it("once taken, a recorded action still names it and a preview says empty floor", () => {
    // The pop-up rule: a recorded action on an empty square acted somewhere else.
    expect(describeAction(tower, gone, BASE, BASE, at).cell).toMatchObject({ type: "pickaxe" });
    // A hover preview has not happened, so that reasoning does not apply to it.
    expect(describeAction(tower, gone, BASE, BASE, at, { hypothetical: true }).cell).toBe(0);
  });
});
