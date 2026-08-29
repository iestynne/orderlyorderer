// ParsedFloor -> TowerFloor: fold the wall grid and the entity list into one
// merged grid (SPEC-002 §5). The emitted JSON is a grid of values, not a grid
// you have to cross-reference against a separate list, so a consumer reads a
// cell by indexing it and nothing else.
//
// The merge is only sound because no cell ever holds two things at once. That
// is measured -- 0 collisions across all 16 towers -- and asserted here per
// cell, so a future game version that broke it would fail loudly at parse time
// rather than silently drop an entity.

import type { Cell, ParsedFloor, TowerFloor, WallValue } from "./types";

export class CellCollisionError extends Error {
  constructor(towerId: string, floor: number, x: number, y: number, detail: string) {
    super(`tower ${towerId}, floor ${floor}, cell (${x},${y}): ${detail}`);
    this.name = "CellCollisionError";
  }
}

export function mergeFloor(towerId: string, floorIndex: number, floor: ParsedFloor): TowerFloor {
  const cells: Cell[][] = floor.walls.map((row) => row.map((v) => v as WallValue));

  for (const e of floor.entities) {
    const row = cells[e.y - 1];
    if (row === undefined || e.x < 1 || e.x > row.length) {
      throw new CellCollisionError(towerId, floorIndex, e.x, e.y, `entity "${e.type}" is outside the 15x15 grid`);
    }
    const occupant = row[e.x - 1];
    if (typeof occupant === "object") {
      throw new CellCollisionError(towerId, floorIndex, e.x, e.y, `two entities on one cell: "${occupant.type}" and "${e.type}"`);
    }
    if (occupant !== 0) {
      throw new CellCollisionError(towerId, floorIndex, e.x, e.y, `entity "${e.type}" sits on wall value ${occupant}`);
    }
    row[e.x - 1] = { type: e.type, value_str: e.value_str, value: e.value };
  }

  return { name: floor.name, bgm: floor.bgm, cells, textboxes: floor.textboxes };
}
