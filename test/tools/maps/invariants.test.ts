// SPEC-002 §8.5 — invariants.

import { describe, expect, it } from "vitest";
import { ENTITY_TYPES, UNUSED_ENTITY_TYPES } from "../../../tools/maps/types";
import { loadAllTowers } from "./helpers";

describe("invariants (SPEC-002 §8.5)", () => {
  it("1. wall domain: every value in {0,1,2,3}, every row has 15 tokens", () => {
    const towers = loadAllTowers();
    const seen = new Set<number>();
    for (const t of towers) {
      for (const floor of t.parsed.floors) {
        expect(floor.walls.length).toBe(15);
        for (const row of floor.walls) {
          expect(row.length).toBe(15);
          for (const v of row) seen.add(v);
        }
      }
    }
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
  });

  it("2. closed vocabulary: 36 used entity types, exactly the 5 unused absent", () => {
    const towers = loadAllTowers();
    const used = new Set<string>();
    for (const t of towers) {
      for (const floor of t.parsed.floors) {
        for (const e of floor.entities) {
          expect(ENTITY_TYPES.has(e.type)).toBe(true);
          used.add(e.type);
        }
      }
    }
    expect(used.size).toBe(36);
    for (const unused of UNUSED_ENTITY_TYPES) {
      expect(used.has(unused)).toBe(false);
    }
    // and every used type really is one of the 41
    for (const type of used) {
      expect(ENTITY_TYPES.has(type)).toBe(true);
    }
  });

  it("3. start cells are open (walls[start_y][start_x] on start_floor is 0) for all 16 towers", () => {
    const towers = loadAllTowers();
    for (const t of towers) {
      const { start_floor, start_x, start_y } = t.parsed.metadata;
      const floor = t.parsed.floors[start_floor - 1];
      expect(floor, `tower ${t.id}: start_floor ${start_floor} out of range`).toBeDefined();
      const row = floor!.walls[start_y - 1];
      expect(row, `tower ${t.id}: start_y ${start_y} out of range`).toBeDefined();
      const cell = row![start_x - 1];
      expect(cell, `tower ${t.id}: start_x ${start_x} out of range`).toBeDefined();
      expect(cell, `tower ${t.id}: walls[${start_y}][${start_x}] on floor ${start_floor}`).toBe(0);
    }
  });

  it("4. no trailing content: exactly one trailing newline, nothing after the last declared floor", () => {
    const towers = loadAllTowers();
    for (const t of towers) {
      // parseTower already throws on non-whitespace trailing content; loadAllTowers
      // succeeding for every tower is itself part of this invariant. Additionally
      // confirm the file ends in exactly one newline (not zero, not two).
      expect(t.content.endsWith("\n"), `tower ${t.id} must end with a newline`).toBe(true);
      expect(t.content.endsWith("\n\n"), `tower ${t.id} must not have a blank line before EOF`).toBe(false);
    }
  });

  it("5. value shape: 24468 value_str values match ^\\d+[kMG]?$, shape census, no mantissa > 3 digits", () => {
    const towers = loadAllTowers();
    const shapeRe = /^(\d+)([kMG]?)$/;
    let total = 0;
    const census = { D: 0, Dk: 0, DM: 0, DG: 0 };
    for (const t of towers) {
      for (const floor of t.parsed.floors) {
        for (const e of floor.entities) {
          total++;
          const m = shapeRe.exec(e.value_str);
          expect(m, `tower ${t.id}: value_str "${e.value_str}" does not match ^\\d+[kMG]?$`).not.toBeNull();
          const [, mantissa, suffix] = m!;
          expect(mantissa!.length <= 3, `tower ${t.id}: mantissa "${mantissa}" longer than 3 digits`).toBe(true);
          if (suffix === "") census.D++;
          else if (suffix === "k") census.Dk++;
          else if (suffix === "M") census.DM++;
          else if (suffix === "G") census.DG++;
        }
      }
    }
    expect(total).toBe(24468);
    expect(census).toEqual({ D: 15508, Dk: 8532, DM: 359, DG: 69 });
  });
});
