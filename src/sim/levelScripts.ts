// GAME_MECHANICS.md §9.1 — level_scripts.lua as data.
//
// game.lua:525 runs a per-tower script immediately after loading level data,
// and 13 of the 16 towers have one. They inject entities and edit walls based
// on ACCOUNT state, so a tower's initial state is a function of
// (map file, unlock flags, per-tower crown tier) and `data/towers/` holds only
// the first.
//
// Transcribed from the Lua rather than derived. Note the game indexes
// `walls[x][y]`, so every pair below is (x, y), 1-based, matching the entity
// coordinates alongside them.

import type { Cell, TowerJSON, WallValue } from "../../tools/maps/types";

export interface AccountState {
  royalBoon1: boolean;
  royalBoon2: boolean;
  /** Tower METADATA NAME (e.g. "2-1: Tower of Loot") -> 1 Crown, 2 Dark Crown. */
  crownTier: Map<string, number>;
}

type XY = readonly [number, number];

interface Injection {
  floor: number;
  entity: { x: number; y: number; type: string };
  /** Wall cells forced to a value, applied after the entity is placed. */
  walls?: ReadonlyArray<readonly [XY, WallValue]>;
}

interface TowerScript {
  /** Present only while the named boon is NOT yet unlocked. */
  boonPickup?: { flag: "royal_boon1" | "royal_boon2"; inject: Injection };
  /** Present iff royal_boon2 is unlocked AND this tower's crown tier is 2. */
  rapier?: Injection;
}

const zero = (...cells: XY[]): ReadonlyArray<readonly [XY, WallValue]> => cells.map((c) => [c, 0] as const);
const reinforce = (...cells: XY[]): ReadonlyArray<readonly [XY, WallValue]> => cells.map((c) => [c, 2] as const);

export const LEVEL_SCRIPTS: Readonly<Record<string, TowerScript>> = {
  "1-1": {
    rapier: {
      floor: 4,
      entity: { x: 11, y: 8, type: "rapier" },
      walls: zero([10, 7], [11, 7], [12, 7], [10, 8], [11, 8], [12, 8], [10, 9], [11, 9], [12, 9], [9, 8], [8, 8], [7, 8], [6, 8], [5, 8]),
    },
  },
  "1-2": {
    rapier: { floor: 10, entity: { x: 5, y: 15, type: "rapier" }, walls: zero([4, 14], [5, 14], [4, 15], [5, 15], [6, 15]) },
  },
  "1-3": {
    rapier: { floor: 11, entity: { x: 15, y: 8, type: "rapier" }, walls: zero([14, 7], [15, 7], [15, 8]) },
  },
  "1-4": {
    rapier: { floor: 4, entity: { x: 14, y: 8, type: "rapier" }, walls: zero([14, 8]) },
  },
  "1-5": {
    rapier: { floor: 2, entity: { x: 13, y: 2, type: "rapier" }, walls: zero([13, 2]) },
  },
  "1-6": {
    boonPickup: { flag: "royal_boon1", inject: { floor: 25, entity: { x: 8, y: 8, type: "royal_boon1" } } },
    rapier: { floor: 6, entity: { x: 1, y: 7, type: "rapier" }, walls: zero([1, 7]) },
  },
  "2-1": {
    rapier: {
      floor: 2,
      entity: { x: 8, y: 5, type: "rapier" },
      // The only script that RAISES walls: ten Weak Walls become Reinforced,
      // hardening the vault around the carved passage.
      walls: [
        ...zero([8, 5], [8, 6], [8, 7], [8, 8]),
        ...reinforce([6, 5], [7, 5], [7, 4], [7, 6], [8, 4], [9, 4], [9, 6], [8, 3], [9, 5], [10, 5]),
      ],
    },
  },
  "2-2": {
    rapier: {
      floor: 7,
      entity: { x: 8, y: 8, type: "rapier" },
      walls: zero([7, 7], [8, 7], [9, 7], [10, 7], [11, 7], [12, 7], [8, 8], [7, 8], [9, 8], [4, 9], [5, 9], [6, 9], [7, 9], [8, 9], [9, 9]),
    },
  },
  "2-3": {
    rapier: { floor: 11, entity: { x: 6, y: 6, type: "rapier" }, walls: zero([6, 6], [6, 7], [7, 6]) },
  },
  "2-4": {
    rapier: { floor: 17, entity: { x: 8, y: 8, type: "rapier" }, walls: zero([8, 8]) },
  },
  "2-5": {
    rapier: { floor: 8, entity: { x: 14, y: 3, type: "rapier" }, walls: zero([14, 3]) },
  },
  "2-6": {
    boonPickup: { flag: "royal_boon2", inject: { floor: 75, entity: { x: 5, y: 8, type: "royal_boon2" } } },
    rapier: { floor: 20, entity: { x: 15, y: 7, type: "rapier" }, walls: zero([15, 7]) },
  },
  "3-1": {
    rapier: { floor: 8, entity: { x: 2, y: 3, type: "rapier" }, walls: zero([2, 3]) },
  },
};

/** A structural copy deep enough that cell writes cannot touch the input. */
function copyTower(tower: TowerJSON): TowerJSON {
  return {
    ...tower,
    floors: tower.floors.map((f) => ({ ...f, cells: f.cells.map((row) => [...row]) })),
  };
}

function applyInjection(tower: TowerJSON, inj: Injection): void {
  const floor = tower.floors[inj.floor - 1];
  if (floor === undefined) throw new Error(`level script names floor ${inj.floor}, tower has ${tower.floors.length}`);
  floor.cells[inj.entity.y - 1]![inj.entity.x - 1] = { type: inj.entity.type, value_str: "", value: 0 };
  for (const [[x, y], v] of inj.walls ?? []) {
    const existing = floor.cells[y - 1]![x - 1]!;
    // The wall edits assume terrain; an entity there would be silently lost,
    // which is exactly the kind of thing to fail loudly on.
    if (typeof existing === "object" && !(x === inj.entity.x && y === inj.entity.y)) {
      throw new Error(`level script wall edit at (${x},${y}) would overwrite entity "${existing.type}"`);
    }
    if (!(x === inj.entity.x && y === inj.entity.y)) floor.cells[y - 1]![x - 1] = v as Cell;
  }
}

/**
 * Returns the tower as the game would actually build it for this account.
 * Leaves the input untouched.
 */
export function applyLevelScripts(towerId: string, tower: TowerJSON, account: AccountState): TowerJSON {
  const script = LEVEL_SCRIPTS[towerId];
  if (script === undefined) return tower;

  const out = copyTower(tower);
  if (script.boonPickup && !account[script.boonPickup.flag === "royal_boon1" ? "royalBoon1" : "royalBoon2"]) {
    applyInjection(out, script.boonPickup.inject);
  }
  if (script.rapier && account.royalBoon2 && account.crownTier.get(tower.metadata.name) === 2) {
    applyInjection(out, script.rapier);
  }
  return out;
}
