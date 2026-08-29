// SPEC-004 §2 — the coordinate basis, and the one place 0-based indexing lives.
//
// Everything a human or a file can see is 1-based (D1). Addr is an opaque
// 0-based index built only here. Never do arithmetic on an Addr: the cell to
// the east is addr(z, x + 1, y), not a + 1, which would wrap a row and then a
// floor with no error.

import { CellState, W, type Addr, type Cell, type CellEntity, type TowerJSON } from "./types";

export class SimAssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SimAssertionError";
  }
}

export function depth(tower: TowerJSON): number {
  return tower.floors.length;
}

export function addr(tower: TowerJSON, z: number, x: number, y: number): Addr {
  if (z < 1 || z > tower.floors.length || x < 1 || x > W || y < 1 || y > W) {
    throw new SimAssertionError(`addr out of bounds: (z=${z}, x=${x}, y=${y}) in a ${tower.floors.length}-floor tower`);
  }
  return ((z - 1) * W + (y - 1)) * W + (x - 1);
}

export function inBounds(tower: TowerJSON, z: number, x: number, y: number): boolean {
  return z >= 1 && z <= tower.floors.length && x >= 1 && x <= W && y >= 1 && y <= W;
}

export function coords(a: Addr): { z: number; x: number; y: number } {
  const x = (a % W) + 1;
  const y = (Math.floor(a / W) % W) + 1;
  const z = Math.floor(a / (W * W)) + 1;
  return { z, x, y };
}

/** The tower's immutable record for a cell: a wall value, or the entity there. */
export function towerCell(tower: TowerJSON, z: number, x: number, y: number): Cell {
  return tower.floors[z - 1]!.cells[y - 1]![x - 1]!;
}

export function isEntity(c: Cell): c is CellEntity {
  return typeof c === "object";
}

/**
 * What the cell effectively is right now: a Gone cell is empty floor whatever
 * it started as, and a Reinforced one is a wall of value 2 (an ex-pop-up).
 * Returns a number for terrain, or the entity record.
 */
export function effectiveCell(tower: TowerJSON, state: Uint8Array, z: number, x: number, y: number): Cell {
  const s = state[addr(tower, z, x, y)]!;
  if (s === CellState.Gone) return 0;
  if (s === CellState.Reinforced) return 2;
  return towerCell(tower, z, x, y);
}
