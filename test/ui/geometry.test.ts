// SPEC-007 §5 and §8 — the geometry constants and the repo-hygiene invariants.
//
// Stage 3 is deliberately NOT covered by the Verification Contract: UI is
// judged by looking at it. What IS covered is the arithmetic underneath it,
// which is what this file pins.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { abbreviate } from "../../src/ui/render/actions";
import { gridCapacity, gridFor, tileOrigin } from "../../src/ui/render/left";
import {
  CAPTION,
  CELL,
  FLOOR,
  GAP,
  MIN_TILES,

  ACTIONS_W,
  PANEL_PAD,
  PANEL_W,
  SLIDER_W,
  STACK_W,
  layoutFor,
  rowPitch,
  tileHeight,
} from "../../src/ui/render/screen";
import { powerToString } from "../../src/ui/render/right";

const ROOT = process.cwd();
const GAME_DIR = process.env["TOS_GAME_DIR"] ?? join(ROOT, "..", "local", "game", "v0.7-455");

describe("SPEC-007 §8 — named geometry", () => {
  it("cell 16x16, floor bitmap 240x240", () => {
    expect(CELL).toBe(16);
    expect(FLOOR).toBe(CELL * 15);
    expect(FLOOR).toBe(240);
  });

  // `[F]` Tiles used to be laid half a tile apart in two rows, so a sliding
  // strip could never put consecutive visits in the same horizontal range.
  // Nothing slides now, so the pitch is simply a tile and a gap.
  it("tiles are laid a tile and a gap apart", () => {
    expect(FLOOR + GAP).toBe(244);
  });

  // `[F]` The name strip is no longer optional: it is where the current
  // action's summary is drawn, and the alternative was drawing that over the
  // grid, on cells the player may want to click (docs/UI.md §6).
  it("a tile is 240x258 — the floor plus its name strip", () => {
    expect([FLOOR, tileHeight()]).toEqual([240, 258]);
    expect(CAPTION).toBe(18);
  });

  it("row pitch is 262", () => {
    expect(rowPitch()).toBe(262);
  });

  // `[F]` The panel was 434 with a 186 px status column, which was Power's
  // width spent on rows that never needed it: measured over the corpus, no
  // other value exceeds four digits — gold peaks at 3 343, gems at 230. Power
  // leads on its own line and the rest fit on one under it, so the column is
  // gone entirely and the stack runs to the panel's right edge.
  it("the panel is its three columns and nothing else", () => {
    expect(SLIDER_W + ACTIONS_W + STACK_W).toBe(PANEL_W);
    expect(PANEL_W).toBe(348);
  });

  it("tiles fill the panel in reading order, and the block is centred", () => {
    const s = { pixelPerfect: true, linearFilter: false, zoom: "auto" as const };
    const layout = layoutFor(1920, 1080, s);
    const grid = gridFor(layout, PANEL_W, 6);
    const at = (i: number) => tileOrigin(grid, i);
    // Left to right...
    expect(at(1).x - at(0).x).toBe(FLOOR + GAP);
    expect(at(1).y).toBe(at(0).y);
    // ...then down, if there is a row to come down to.
    if (grid.cols < 6) {
      expect(at(grid.cols).x).toBe(at(0).x);
      expect(at(grid.cols).y).toBeGreaterThan(at(0).y);
    }
    // Centred: the air either side of the block is equal to within a pixel.
    const used = Math.min(grid.cols, 6);
    const right = at(used - 1).x + FLOOR;
    const left = at(0).x;
    expect(Math.abs(left - PANEL_PAD - (layout.w - PANEL_W - PANEL_PAD - right))).toBeLessThanOrEqual(1);
  });

  // `[F]` The capacity and the layout must measure the same rectangle. They did
  // not: capacity took the whole window, so a 3 x 3 grid was handed ten floors
  // and the tenth had no cell to be drawn in at all.
  it("every tile the capacity promises has a cell inside the panel", () => {
    const s = { pixelPerfect: true, linearFilter: false, zoom: "auto" as const };
    const sizes: Array<[number, number]> = [[1280, 720], [1920, 1080], [2560, 1440], [800, 600], [3840, 1200]];
    for (const [w, h] of sizes) {
      const layout = layoutFor(w, h, s);
      const n = gridCapacity(layout, PANEL_W);
      const grid = gridFor(layout, PANEL_W, n);
      const last = tileOrigin(grid, n - 1);
      expect(last.x + FLOOR, `${w}x${h} right edge`).toBeLessThanOrEqual(layout.w - PANEL_W - PANEL_PAD);
      expect(last.y + tileHeight(), `${w}x${h} bottom edge`).toBeLessThanOrEqual(layout.h);
      expect(tileOrigin(grid, 0).x).toBeGreaterThanOrEqual(PANEL_PAD);
      expect(tileOrigin(grid, 0).y).toBeGreaterThanOrEqual(0);
    }
  });

  it("at least three tiles fit, and a wider window fits more", () => {
    const s = { pixelPerfect: true, linearFilter: false, zoom: "auto" as const };
    expect(gridCapacity(layoutFor(400, 300, s), PANEL_W)).toBeGreaterThanOrEqual(MIN_TILES);
    const narrow = gridCapacity(layoutFor(1280, 720, s), PANEL_W);
    const wide = gridCapacity(layoutFor(3840, 720, s), PANEL_W);
    expect(narrow).toBeGreaterThanOrEqual(MIN_TILES);
    expect(wide).toBeGreaterThan(narrow);
  });

  it("the scale is a whole number under pixel_perfect, and steps rather than slides", () => {
    const on = { pixelPerfect: true, linearFilter: false, captions: true, zoom: "auto" as const };
    const off = { pixelPerfect: false, linearFilter: false, captions: true, zoom: "auto" as const };
    for (const w of [1280, 1600, 1920, 2560, 3840]) {
      const l = layoutFor(w, Math.round(w * 0.56), on);
      expect(Number.isInteger(l.scale), `scale at ${w}`).toBe(true);
      expect(l.deviceW).toBeLessThanOrEqual(w);
    }
    expect(Number.isInteger(layoutFor(1500, 900, off).scale)).toBe(false);
  });

  // `[F]` §5: the shear is pixel-exact, one pixel of horizontal offset per row
  // of vertical drop. Only the vertical squash resamples.
  it("the ortho shear is exactly 1 px of horizontal offset per row of drop", () => {
    const h = 12;
    const offsets = Array.from({ length: h }, (_, r) => h - 1 - r);
    const deltas = offsets.slice(1).map((v, i) => offsets[i]! - v);
    expect(new Set(deltas)).toEqual(new Set([1]));
    expect(offsets[0]! - offsets.at(-1)!).toBe(h - 1);
  });

  // `[F]` util.lua:3-22. Not an abbreviation: the k/M/G forms belong to tile
  // labels, a different font and a different job.
  it("power prints with dot separators, never as 1.28M", () => {
    expect(powerToString(1284900)).toBe("1.284.900");
    expect(powerToString(1)).toBe("1");
    expect(powerToString(1000)).toBe("1.000");
    expect(powerToString(1000007)).toBe("1.000.007");
    expect(powerToString(999999999999)).toBe("999.999.999.999");
  });
});

// docs/UI.md §6. A deficit is the useful half of a failure report -- "21 gold
// short" rather than "not enough gold" -- so the number has to be readable at
// a glance, and Power reaches twelve digits.
describe("a deficit, four significant figures", () => {
  it("is exact below ten thousand", () => {
    expect(abbreviate(-21)).toBe("-21");
    expect(abbreviate(-1234)).toBe("-1234");
    expect(abbreviate(-9999)).toBe("-9999");
  });

  it("abbreviates above it, with the game's own suffixes", () => {
    expect(abbreviate(-23456)).toBe("-23.46k");
    expect(abbreviate(-10000)).toBe("-10k");
    expect(abbreviate(-123456)).toBe("-123.5k");
    expect(abbreviate(-1234567)).toBe("-1.235M");
    expect(abbreviate(-1234567890)).toBe("-1.235G");
  });

  it("never spends more than seven characters on it", () => {
    for (const n of [-1, -9999, -10000, -99999, -999999, -1e6, -1e9, -999999999999]) {
      expect(abbreviate(n).length, String(n)).toBeLessThanOrEqual(7);
    }
  });
});

describe("SPEC-007 §8 — invariants 5 and 6", () => {
  // Invariant 5, and SPEC-008 invariant 9, which is the same claim about the
  // same tree. D7: the simulation engine is a pure module with no UI imports.
  //
  // `[F]` It walks subdirectories, and did not use to: src/sim/route/ arrived
  // with SPEC-008 and readdirSync handed the loop a directory to read as a file.
  it("5. nothing under src/sim/ imports the UI", () => {
    const offenders: string[] = [];
    const walk = (rel: string): void => {
      for (const e of readdirSync(join(ROOT, rel))) {
        const child = `${rel}/${e}`;
        if (statSync(join(ROOT, child)).isDirectory()) {
          walk(child);
          continue;
        }
        for (const m of readFileSync(join(ROOT, child), "utf8").matchAll(/froms+"([^"]+)"/g)) {
          const spec = m[1]!;
          if (/ui|react|.css$/.test(spec)) offenders.push(`${child} -> ${spec}`);
        }
      }
    };
    walk("src/sim");
    expect(offenders).toEqual([]);
  });

  // Invariant 6. D14b: Towers of Scale is not open source. Its assets are
  // permitted for use in this tool only, never for redistribution -- so no byte
  // of res/ may exist inside the repository.
  it("6. no file under data/, src/ or docs/ matches a hash in the game archive", () => {
    if (!existsSync(join(GAME_DIR, "res"))) return;

    const hashes = new Map<string, string>();
    const walk = (dir: string, into: (p: string) => void): void => {
      for (const e of readdirSync(dir)) {
        const p = join(dir, e);
        if (statSync(p).isDirectory()) walk(p, into);
        else into(p);
      }
    };
    walk(join(GAME_DIR, "res"), (p) => {
      hashes.set(createHash("sha256").update(readFileSync(p)).digest("hex"), relative(GAME_DIR, p));
    });

    const hits: string[] = [];
    for (const dir of ["data", "src", "docs"]) {
      walk(join(ROOT, dir), (p) => {
        const h = createHash("sha256").update(readFileSync(p)).digest("hex");
        const from = hashes.get(h);
        if (from) hits.push(`${relative(ROOT, p)} is byte-identical to ${from}`);
      });
    }
    expect(hits).toEqual([]);
    expect(hashes.size).toBeGreaterThan(70);
  });

  // D34. Invariant 5 stops src/sim/ importing the UI, so the dependency cannot
  // run the wrong way. What it does not catch is the WORD leaking downward --
  // and the collision that prompted D34 was a name, not an import.
  it("D34. `WorkingSet` is a view concept and never appears below the UI", () => {
    const offenders: string[] = [];
    const scan = (dir: string): void => {
      for (const e of readdirSync(join(ROOT, dir))) {
        const rel = `${dir}/${e}`;
        if (statSync(join(ROOT, rel)).isDirectory()) scan(rel);
        else if (/\.tsx?$/.test(e) && readFileSync(join(ROOT, rel), "utf8").includes("WorkingSet")) {
          offenders.push(rel);
        }
      }
    };
    scan("src/sim");
    scan("src/sav");
    scan("tools");
    expect(offenders).toEqual([]);

    // ...and it is defined in exactly one place, so there is one thing to rename
    // if the boundary ever moves.
    const defs = readFileSync(join(ROOT, "src/ui/render/left.ts"), "utf8");
    // `[F]` It was `ScrollUnit` while the panel scrolled. It does not any more
    // -- it shows one set of floors at a time and jumps between them -- so the
    // name went with the behaviour rather than outliving it (D31 rule 3).
    expect(defs).toContain("export interface WorkingSet");
  });

  // The other half of D34: the layout device must not have quietly adopted the
  // word it was renamed away from.
  it("D34. the UI does not call a working set a segment", () => {
    const hits: string[] = [];
    for (const f of ["left.ts", "trail.ts", "right.ts", "screen.ts", "floor.ts", "atlas.ts"]) {
      const src = readFileSync(join(ROOT, "src/ui/render", f), "utf8");
      // A segment of a drawn LINE is a legitimate third meaning, so only
      // identifiers are policed, not prose.
      for (const m of src.matchAll(/\b(?:const|let|function|interface|type)\s+(\w*[Ss]egment\w*)/g)) {
        hits.push(`src/ui/render/${f}: ${m[1]}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("the asset build output is gitignored", () => {
    expect(readFileSync(join(ROOT, ".gitignore"), "utf8")).toMatch(/^build\/$/m);
  });
});
