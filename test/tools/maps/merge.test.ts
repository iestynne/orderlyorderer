// SPEC-002 §5.2 — the merged cell grid. The emitted TowerJSON is a grid of
// values rather than a wall grid plus a coordinate-keyed entity list, so these
// tests carry the two things that buys us: that the merge loses nothing, and
// that a collision -- the one thing that would make it lossy -- is detected
// rather than silently dropping an entity.

import { describe, expect, it } from "vitest";
import { CellCollisionError, mergeFloor } from "../../../tools/maps/merge";
import { isCellEntity, type Cell, type ParsedFloor } from "../../../tools/maps/types";
import { loadAllTowers, loadTower } from "./helpers";

function emptyFloor(): ParsedFloor {
  return {
    name: "test",
    bgm: "mus_none",
    walls: Array.from({ length: 15 }, () => Array.from({ length: 15 }, () => 0)),
    entities: [],
    textboxes: [],
  };
}

function cellAt(cells: Cell[][], x: number, y: number): Cell {
  return cells[y - 1]![x - 1]!;
}

describe("merged cell grid (SPEC-002 §5.2)", () => {
  it("1. merges every floor of every tower with no collision", () => {
    let floors = 0;
    for (const { id, parsed } of loadAllTowers()) {
      parsed.floors.forEach((f, i) => {
        mergeFloor(id, i + 1, f);
        floors++;
      });
    }
    expect(floors).toBe(325);
  });

  it("2. the merge is lossless: every wall value and every entity survives", () => {
    let entities = 0;
    let walls = 0;
    for (const { id, parsed } of loadAllTowers()) {
      parsed.floors.forEach((f, i) => {
        const { cells } = mergeFloor(id, i + 1, f);

        // Every entity is at its own (x, y), with type and both values intact.
        for (const e of f.entities) {
          const c = cellAt(cells, e.x, e.y);
          expect(isCellEntity(c)).toBe(true);
          expect(c).toEqual({ type: e.type, value_str: e.value_str, value: e.value });
          entities++;
        }

        // Every cell with no entity carries its original wall value.
        const occupied = new Set(f.entities.map((e) => `${e.x},${e.y}`));
        for (let y = 1; y <= 15; y++) {
          for (let x = 1; x <= 15; x++) {
            if (occupied.has(`${x},${y}`)) continue;
            expect(cellAt(cells, x, y)).toBe(f.walls[y - 1]![x - 1]);
            walls++;
          }
        }
      });
    }
    expect(entities).toBe(24468);
    expect(walls).toBe(325 * 225 - 24468);
  });

  it("3. an entity on a wall is a collision, not a silent overwrite", () => {
    const f = emptyFloor();
    f.walls[4]![9] = 2; // (10,5)
    f.entities.push({ x: 10, y: 5, type: "key", value_str: "0", value: 0 });
    expect(() => mergeFloor("T", 1, f)).toThrow(CellCollisionError);
    expect(() => mergeFloor("T", 1, f)).toThrow(/cell \(10,5\).*wall value 2/);
  });

  it("4. two entities on one cell is a collision", () => {
    const f = emptyFloor();
    f.entities.push({ x: 3, y: 7, type: "key", value_str: "0", value: 0 });
    f.entities.push({ x: 3, y: 7, type: "spikes", value_str: "10", value: 10 });
    expect(() => mergeFloor("T", 1, f)).toThrow(/two entities on one cell: "key" and "spikes"/);
  });

  it("5. named cells read correctly through the grid (the transpose detector)", () => {
    const { parsed } = loadTower("2-1");
    const { cells } = mergeFloor("2-1", 3, parsed.floors[2]!);
    expect(cellAt(cells, 12, 7)).toMatchObject({ type: "stairs_up" });
    expect(cellAt(cells, 10, 10)).toMatchObject({ type: "stairs_down" });

    const t15 = loadTower("1-5");
    const f1 = mergeFloor("1-5", 1, t15.parsed.floors[0]!);
    expect(cellAt(f1.cells, 3, 13)).toEqual({ type: "spikes", value_str: "10", value: 10 });
  });

  it("6. start cells are open floor in the merged grid, for all 16 towers", () => {
    for (const { id, parsed } of loadAllTowers()) {
      const { start_floor, start_x, start_y } = parsed.metadata;
      const { cells } = mergeFloor(id, start_floor, parsed.floors[start_floor - 1]!);
      expect(cellAt(cells, start_x, start_y), `${id} start cell`).toBe(0);
    }
  });
});
