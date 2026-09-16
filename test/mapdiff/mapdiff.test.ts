// SPEC-005 §10 — Verification Contract.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decodePng, distinctColors, PngError } from "../../src/mapdiff/png";
import { BAND, TITLE_ROWS, cellOrigin, panelGrid, titleBox } from "../../src/mapdiff/geometry";
import { DiffError, diffExports } from "../../src/mapdiff/diff";
import { compareToSim } from "../../src/mapdiff/oracle";
import { simulate } from "../../src/sim/simulate";
import { CellState } from "../../src/sim/types";
import { coords } from "../../src/sim/grid";
import { Canvas, renderTower } from "./synth";
import type { TowerJSON } from "../../tools/maps/types";
import { TOWER_DIR } from "../../tools/paths";

const tower = (id: string): TowerJSON => JSON.parse(readFileSync(join(TOWER_DIR, `${id}.json`), "utf8")) as TowerJSON;

describe("PNG decoding (SPEC-005 §2)", () => {
  it("round-trips a synthetic export", () => {
    const c = new Canvas(2, 2);
    c.fillRect(3, 4, 5, 6, [1, 2, 3]);
    const png = decodePng(c.toPng());
    expect(png.width).toBe(512);
    expect(png.height).toBe(512);
    const o = (4 * 512 + 3) * 4;
    expect([png.pixels[o], png.pixels[o + 1], png.pixels[o + 2]]).toEqual([1, 2, 3]);
  });

  it("decodes the one real PNG in the repo", () => {
    const png = decodePng(new Uint8Array(readFileSync(join(process.cwd(), "data", "reference", "loot_36_clusters.png"))));
    expect(png.width).toBeGreaterThan(0);
    expect(png.height).toBeGreaterThan(0);
    expect(png.pixels.length).toBe(png.width * png.height * 4);
  });

  it("names a JPEG rather than failing obscurely", () => {
    // The failure mode §2 exists to catch: a bare .png upload transcoded once.
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
    expect(() => decodePng(jpeg)).toThrow(PngError);
    expect(() => decodePng(jpeg)).toThrow(/JPEG.*ZIP/);
  });

  it("rejects a non-PNG", () => {
    expect(() => decodePng(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow(/not a PNG/);
  });
});

describe("geometry (SPEC-005 §3, named cases)", () => {
  it("panel grid, 1-5 Tiny Tower (3 floors): 512x512, 2x2", () => {
    const g = panelGrid({ width: 512, height: 512 } as never);
    expect([g.cols, g.rows]).toEqual([2, 2]);
  });

  it("panel grid, 1-6 Adventurer's Exam (25 floors): 1280x1280, 5x5", () => {
    const g = panelGrid({ width: 1280, height: 1280 } as never);
    expect([g.cols, g.rows]).toEqual([5, 5]);
  });

  it("cell (1,1) of panel (0,0) is image pixel (8, 12)", () => {
    const g = panelGrid({ width: 512, height: 512 } as never);
    expect(cellOrigin(g, 0, 1, 1)).toEqual({ px: 8, py: 12 });
  });

  it("cell (15,15) of panel (1,0) is image pixel (488, 236)", () => {
    const g = panelGrid({ width: 512, height: 512 } as never);
    expect(cellOrigin(g, 1, 15, 15)).toEqual({ px: 488, py: 236 });
  });

  it("the comparison band is rows 2..10 inclusive", () => {
    expect([BAND.first, BAND.last]).toEqual([2, 10]);
  });

  it("title box rows are 1..7; row 8 is the full-width frame", () => {
    expect([TITLE_ROWS.first, TITLE_ROWS.last]).toEqual([1, 7]);
  });

  it("title box width for names of 12 / 17 / 11 chars is 89 / 124 / 82 px", () => {
    expect([12, 17, 11].map((n) => titleBox(n).width)).toEqual([89, 124, 82]);
    expect([12, 17, 11].map((n) => titleBox(n).left)).toEqual([84, 66, 87]);
  });

  it("2-5 The Orderly Order (32 floors) fits a 6x6 grid of panels", () => {
    const g = panelGrid({ width: 1536, height: 1536 } as never);
    expect(g.slots).toBe(36);
    expect(g.slots).toBeGreaterThanOrEqual(tower("2-5").floors.length);
  });
});

describe("the diff (SPEC-005 §5)", () => {
  const t = tower("1-5"); // 3 floors, 2x2 panels

  it("oracle 1 — an export diffed against itself yields zero changes", () => {
    const img = renderTower(t, 2, 2).toPng();
    const r = diffExports({ before: decodePng(img), after: decodePng(img), tower: t });
    expect(r.changes.filter((c) => c.kind !== "unknown")).toEqual([]);
    expect(r.panelToFloor.size).toBe(3);
  });

  it("a cell that became empty is classified empty", () => {
    const before = renderTower(t, 2, 2).toPng();
    const after = renderTower(t, 2, 2, { overrides: new Map([["1,8,13", "empty"]]) }).toPng();
    const r = diffExports({ before: decodePng(before), after: decodePng(after), tower: t });
    const real = r.changes.filter((c) => c.kind !== "unknown");
    expect(real).toEqual([{ z: 1, x: 8, y: 13, kind: "empty" }]);
  });

  it("a cell that became a Reinforced Wall is classified reinforced", () => {
    const before = renderTower(t, 2, 2).toPng();
    const after = renderTower(t, 2, 2, { overrides: new Map([["1,8,13", "reinforced"]]) }).toPng();
    const r = diffExports({ before: decodePng(before), after: decodePng(after), tower: t });
    const real = r.changes.filter((c) => c.kind !== "unknown");
    expect(real).toEqual([{ z: 1, x: 8, y: 13, kind: "reinforced" }]);
  });

  it("the band ignores badge digits, which is the whole point of rows 2..10", () => {
    // Same tower, every value badge redrawn at maximum width. A badge occupies
    // rows 11-15 of its own cell and rows 0-1 of the one below, so nothing in
    // rows 2..10 may move.
    const before = renderTower(t, 2, 2).toPng();
    const after = renderTower(t, 2, 2, { fatBadges: true }).toPng();
    expect(Buffer.from(before).equals(Buffer.from(after))).toBe(false); // the images DO differ
    const r = diffExports({ before: decodePng(before), after: decodePng(after), tower: t });
    expect(r.changes.filter((x) => x.kind !== "unknown")).toEqual([]);
  });

  // A real `before` export always contains a player marker too -- §7 requires
  // it to be at the tower's start cell -- so the synthetic must render one, or
  // the §2 colour-count guard correctly refuses the pair.
  const START = { z: t.metadata.start_floor, x: t.metadata.start_x, y: t.metadata.start_y };

  it("the player's cell is masked and reported unknown", () => {
    const before = renderTower(t, 2, 2, { player: START }).toPng();
    const after = renderTower(t, 2, 2, { player: { z: 2, x: 5, y: 5 } }).toPng();
    const r = diffExports({
      before: decodePng(before),
      after: decodePng(after),
      tower: t,
      expectedPlayerCell: { z: 2, x: 5, y: 5 },
    });
    expect(r.changes.find((c) => c.z === 2 && c.x === 5 && c.y === 5)?.kind).toBe("unknown");
    expect(r.changes.filter((c) => c.kind === "unexpected")).toEqual([]);
  });

  it("an unmasked player marker surfaces as unexpected, never silently", () => {
    const before = renderTower(t, 2, 2, { player: START }).toPng();
    const after = renderTower(t, 2, 2, { player: { z: 2, x: 5, y: 5 } }).toPng();
    const r = diffExports({ before: decodePng(before), after: decodePng(after), tower: t });
    // The start cell is always masked, so only the new position is a surprise.
    expect(r.changes.filter((c) => c.kind === "unexpected")).toHaveLength(1);
    expect(r.playerCell).toEqual({ z: 2, x: 5, y: 5 });
  });

  it("a pair with differing colour counts is refused", () => {
    const before = renderTower(t, 2, 2);
    const after = renderTower(t, 2, 2);
    after.fillRect(0, 0, 4, 4, [7, 7, 7]); // one extra colour
    expect(() => diffExports({ before: decodePng(before.toPng()), after: decodePng(after.toPng()), tower: t }))
      .toThrow(DiffError);
    expect(() => diffExports({ before: decodePng(before.toPng()), after: decodePng(after.toPng()), tower: t }))
      .toThrow(/palette or brightness/);
  });

  it("a pair of differing sizes is refused", () => {
    const before = renderTower(t, 2, 2).toPng();
    const after = renderTower(t, 3, 2).toPng();
    expect(() => diffExports({ before: decodePng(before), after: decodePng(after), tower: t })).toThrow(/differ in size/);
  });
});

describe("oracle 2 — the sim's prediction against the image diff", () => {
  it("agrees cell for cell on a synthetic end-state built from the sim itself", () => {
    // Closes the loop structurally: take a real replayed route, render its
    // predicted end state as an export, and assert the differ recovers exactly
    // the set of changes the sim made. A real export replaces `after` when one
    // exists; everything else in this path is already exercised.
    // The C1 experiment's first move: from the start cell (8,14) onto the
    // 2-power Slime at (9,13), via (9,14). Power 5 beats it.
    const t = tower("1-5");
    // ...then step back off it, so the cell the route changed is not the same
    // cell the player ends on. Otherwise the single change is masked and the
    // test asserts nothing.
    const route = [
      { z: 1, x: 9, y: 14 },
      { z: 1, x: 9, y: 13 },
      { z: 1, x: 9, y: 14 },
    ];
    const timeline = simulate({ tower: t, gemsOwned: Number.POSITIVE_INFINITY, route });
    expect(timeline.error).toBeUndefined();
    expect(timeline.steps.length).toBeGreaterThan(0);

    const overrides = new Map<string, "empty" | "reinforced">();
    for (const s of timeline.steps) {
      for (const e of s.edits) {
        const { z, x, y } = coords(e.addr);
        if (e.after === CellState.Gone) overrides.set(`${z},${x},${y}`, "empty");
        else if (e.after === CellState.Reinforced) overrides.set(`${z},${x},${y}`, "reinforced");
      }
    }
    const end = timeline.steps.at(-1)!.player;

    const before = renderTower(t, 2, 2, { player: { z: t.metadata.start_floor, x: t.metadata.start_x, y: t.metadata.start_y } }).toPng();
    const after = renderTower(t, 2, 2, { overrides, player: { z: end.z, x: end.x, y: end.y } }).toPng();

    const diff = diffExports({
      before: decodePng(before),
      after: decodePng(after),
      tower: t,
      expectedPlayerCell: { z: end.z, x: end.x, y: end.y },
    });
    const result = compareToSim(timeline, diff);
    expect(result.mismatches).toEqual([]);
    expect(result.unexpected).toEqual([]);
    expect(result.matched).toBeGreaterThan(0);
  });
});
