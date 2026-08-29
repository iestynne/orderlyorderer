// SPEC-002 §8.3 — named cells (exact, 1-based). Also the transpose/floor-index
// detector: floors are indexed by position (bottom-to-top), not by the label
// in the floor name, and walls/entities are stored [y][x] against the file's
// own row-major layout.

import { describe, expect, it } from "vitest";
import { loadTower } from "./helpers";

describe("named cells (SPEC-002 §8.3)", () => {
  it('2-1 floor 3 ("1F: Economics 101") (12,7) is stairs_up', () => {
    const { parsed } = loadTower("2-1");
    const floor = parsed.floors[2]!;
    expect(floor.name).toBe("1F: Economics 101");
    const e = floor.entities.find((x) => x.x === 12 && x.y === 7);
    expect(e?.type).toBe("stairs_up");
  });

  it('2-1 floor 3 ("1F: Economics 101") (10,10) is stairs_down', () => {
    const { parsed } = loadTower("2-1");
    const floor = parsed.floors[2]!;
    const e = floor.entities.find((x) => x.x === 10 && x.y === 10);
    expect(e?.type).toBe("stairs_down");
  });

  it('1-3 floor 3 ("1F: Entrapment") (4,11) is popup value 0', () => {
    const { parsed } = loadTower("1-3");
    const floor = parsed.floors[2]!;
    expect(floor.name).toBe("1F: Entrapment");
    const e = floor.entities.find((x) => x.x === 4 && x.y === 11);
    expect(e?.type).toBe("popup");
    expect(e?.value).toBe(0);
  });

  it('1-3 floor 3 ("1F: Entrapment") (6,8) is popup value 0', () => {
    const { parsed } = loadTower("1-3");
    const floor = parsed.floors[2]!;
    const e = floor.entities.find((x) => x.x === 6 && x.y === 8);
    expect(e?.type).toBe("popup");
    expect(e?.value).toBe(0);
  });

  it('1-3 floor 3 ("1F: Entrapment") (7,8) is key value 0', () => {
    const { parsed } = loadTower("1-3");
    const floor = parsed.floors[2]!;
    const e = floor.entities.find((x) => x.x === 7 && x.y === 8);
    expect(e?.type).toBe("key");
    expect(e?.value).toBe(0);
  });

  it('1-5 floor 1 ("A small step") (3,13) is spikes value 10', () => {
    const { parsed } = loadTower("1-5");
    const floor = parsed.floors[0]!;
    expect(floor.name).toBe("A small step");
    const e = floor.entities.find((x) => x.x === 3 && x.y === 13);
    expect(e?.type).toBe("spikes");
    expect(e?.value).toBe(10);
  });
});
