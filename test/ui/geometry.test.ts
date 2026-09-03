// SPEC-007 §5 and §8 — the geometry constants and the repo-hygiene invariants.
//
// Stage 3 is deliberately NOT covered by the Verification Contract: UI is
// judged by looking at it. What IS covered is the arithmetic underneath it,
// which is what this file pins.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CAPTION,
  CELL,
  FLOOR,
  GAP,
  MIN_TILES,
  SAME_ROW_PITCH,
  STAGGER,
  ACTIONS_W,
  PANEL_W,
  SLIDER_W,
  STACK_W,
  STATUS_W,
  layoutFor,
  rowPitch,
  tileHeight,
  visibleTiles,
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

  it("stagger pitch is 122, exactly half of 240 + 4", () => {
    expect(STAGGER).toBe(122);
    expect(STAGGER * 2).toBe(FLOOR + GAP);
  });

  it("same-row pitch is 244", () => {
    expect(SAME_ROW_PITCH).toBe(244);
    expect(SAME_ROW_PITCH).toBe(FLOOR + GAP);
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

  // `[F]` The column used to be 186, the game's own 426 minus a 240 floor. It
  // is 48 now: Power leads on its own line across the top of the panel, and no
  // other row ever needs more than four digits, a gap and a 16 px sprite —
  // measured over the corpus, gold peaks at 3 343 and gems at 230. The 138 px
  // that freed is the action list.
  it("the status column is 48, wide enough for five digits and a sprite", () => {
    expect(STATUS_W).toBe(48);
    // Five digits at the digit font's widest, a 3 px gap and a 16 px sprite.
    expect(5 * 5 + 3 + 16).toBeLessThanOrEqual(STATUS_W);
  });

  it("the panel is its four columns and nothing else", () => {
    expect(SLIDER_W + ACTIONS_W + STACK_W + STATUS_W).toBe(PANEL_W);
    // The action list took the width the status column gave up, and a little
    // more: the panel is 10 px narrower than it was, so the strip gained too.
    expect(PANEL_W).toBe(424);
  });

  it("visit i is drawn at x = i * 122 - scroll", () => {
    // The bricklayer offset: consecutive visits never share a horizontal range.
    const xs = [0, 1, 2, 3].map((i) => i * STAGGER);
    expect(xs).toEqual([0, 122, 244, 366]);
    // Same row, two apart: a full tile plus the gap, so they never overlap.
    expect(xs[2]! - xs[0]!).toBe(SAME_ROW_PITCH);
  });

  it("at least three tiles are visible, and a wider window shows more", () => {
    const s = { pixelPerfect: true, linearFilter: false, captions: true, zoom: "auto" as const };
    expect(visibleTiles(layoutFor(400, 300, s))).toBeGreaterThanOrEqual(MIN_TILES);
    const narrow = visibleTiles(layoutFor(1280, 720, s));
    const wide = visibleTiles(layoutFor(3840, 720, s));
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
  it("D34. `ScrollUnit` is a view concept and never appears below the UI", () => {
    const offenders: string[] = [];
    const scan = (dir: string): void => {
      for (const e of readdirSync(join(ROOT, dir))) {
        const rel = `${dir}/${e}`;
        if (statSync(join(ROOT, rel)).isDirectory()) scan(rel);
        else if (/\.tsx?$/.test(e) && readFileSync(join(ROOT, rel), "utf8").includes("ScrollUnit")) {
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
    expect(defs).toContain("export interface ScrollUnit");
  });

  // The other half of D34: the layout device must not have quietly adopted the
  // word it was renamed away from.
  it("D34. the UI does not call a scroll unit a segment", () => {
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
